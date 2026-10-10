import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppType } from '@lares/shared';
import { config } from '../config.js';
import { t, tDefault } from '../i18n/index.js';
import { ngxPath, shq } from '../lib/shell.js';
import { syncDevNginx } from './devNginx.js';
import { host, type HostLogger } from './host.js';
import { leadLocation } from './leadsNginx.js';
import { phpSocket } from './php.js';

export interface VhostSpec {
  domain: string;
  aliases: string[];
  appType: AppType;
  webRoot: string;
  phpVersion: string | null;
  /** FastCGI socket of the site's own PHP-FPM (isolated sites); unset = the shared pool of phpVersion. */
  phpSocket?: string | null;
  appPort: number | null;
  /** Port-based site: listen on this public port for any hostname instead of name-based :80. */
  listenPort?: number | null;
  accessLog: boolean;
  disabled: boolean;
  ssl: { certificate: string; privateKey: string; forceHttps: boolean } | null;
  /** client_max_body_size in MB, following the site's PHP upload limit (services/phpSettings.ts); unset = 256. */
  clientMaxBodyMb?: number | null;
}

export const vhostPath = (domain: string) => path.join(config.nginxAvailable, `${domain}.conf`);
export const vhostLink = (domain: string) => path.join(config.nginxEnabled, `${domain}.conf`);
export const siteLogPaths = (domain: string) => {
  const dir = path.join(config.siteLogDir, domain);
  return { dir, access: path.join(dir, 'access.log'), error: path.join(dir, 'error.log') };
};

/** http{}-level config shared by every Lares vhost (log format with $request_time, websocket map). */
export const GLOBAL_CONF = `# Managed by Lares
log_format lares '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time';

map $http_upgrade $lares_connection_upgrade {
    default upgrade;
    ''      close;
}
`;

export async function ensureGlobalConfig(log?: HostLogger) {
  const current = await fs.readFile(config.nginxGlobalConf, 'utf8').catch(() => '');
  if (current === GLOBAL_CONF) return;
  await host.writeFile(config.nginxGlobalConf, GLOBAL_CONF);
  await testAndReload(log).catch((err) => log?.(t('Không reload được nginx: {error}', { error: err instanceof Error ? err.message : String(err) })));
}

const indent = (block: string, n = 4) =>
  block
    .split('\n')
    .map((l) => (l ? ' '.repeat(n) + l : l))
    .join('\n');

export function acmeLocation(): string {
  return `location ^~ /.well-known/acme-challenge/ {
    root ${ngxPath(config.acmeDir)};
    default_type text/plain;
    try_files $uri =404;
}`;
}

/**
 * nginx's user is in every isolated site's group (it serves their static files), so a symlink planted
 * by one site pointing into another would be served with nginx's rights. Only follow symlinks whose
 * owner is the owner of their target (services/isolationPolicy.ts).
 */
const DISABLE_SYMLINKS = 'disable_symlinks if_not_owner from=$document_root;';

function appBody(spec: VhostSpec): string {
  const logs = siteLogPaths(spec.domain);
  const common = [
    spec.accessLog ? `access_log ${ngxPath(logs.access)} lares;` : 'access_log off;',
    `error_log ${ngxPath(logs.error)} warn;`,
    `client_max_body_size ${spec.clientMaxBodyMb ?? 256}m;`,
    '',
    acmeLocation(),
    '',
    'location ~ /\\.(?!well-known) {\n    deny all;\n}',
  ];
  // ---- Lead capture (contact forms -> panel), see services/leadsNginx.ts ----
  if (!spec.disabled) common.push('', leadLocation(spec.domain));

  if (spec.disabled) {
    return [...common, '', `location / {\n    default_type text/html;\n    return 503 "<h1>${tDefault('Site tạm ngưng hoạt động')}</h1>";\n}`].join('\n');
  }

  if (spec.appType === 'nextjs') {
    if (!spec.appPort) throw new Error(t('Site {domain} chưa được cấp port', { domain: spec.domain }));
    const upstream = `http://127.0.0.1:${spec.appPort}`;
    const proxy = `proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $lares_connection_upgrade;
proxy_read_timeout 300s;`;
    return [
      ...common,
      '',
      `location /_next/static/ {\n    proxy_pass ${upstream};\n${indent(proxy)}\n    expires 365d;\n    add_header Cache-Control "public, max-age=31536000, immutable";\n}`,
      '',
      `location / {\n    proxy_pass ${upstream};\n${indent(proxy)}\n}`,
    ].join('\n');
  }

  if (spec.appType === 'static') {
    return [`root ${ngxPath(spec.webRoot)};`, DISABLE_SYMLINKS, 'index index.html index.htm;', ...common, '', 'location / {\n    try_files $uri $uri/ =404;\n}'].join('\n');
  }

  // PHP family: wordpress, laravel, generic php
  const php = spec.phpVersion ?? config.defaultPhp;
  const lines = [
    `root ${ngxPath(spec.webRoot)};`,
    DISABLE_SYMLINKS,
    'index index.php index.html index.htm;',
    ...common,
    '',
    `location / {\n    try_files $uri $uri/ /index.php?$args;\n}`,
    '',
    `location ~ \\.php$ {
    try_files $uri =404;
    fastcgi_split_path_info ^(.+\\.php)(/.+)$;
    fastcgi_pass unix:${spec.phpSocket ?? phpSocket(php)};
    fastcgi_index index.php;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_param HTTPS $https if_not_empty;
    fastcgi_read_timeout 300s;
}`,
    '',
    'location ~* \\.(?:css|js|mjs|jpg|jpeg|gif|png|webp|avif|svg|ico|woff2?|ttf|eot)$ {\n    expires 30d;\n    try_files $uri =404;\n}',
  ];
  if (spec.appType === 'wordpress') {
    lines.push('', '# Never execute PHP from the uploads folder', 'location ~* /wp-content/uploads/.*\\.php$ {\n    deny all;\n}');
  }
  return lines.join('\n');
}

let http2DirectiveCache: boolean | null = null;

/** nginx >= 1.25.1 deprecates `listen ... http2` in favour of the standalone `http2 on;` directive. */
export async function supportsHttp2Directive(): Promise<boolean> {
  if (http2DirectiveCache !== null) return http2DirectiveCache;
  const r = await host.exec(`${shq(config.nginxBin)} -v 2>&1`);
  const m = r.stdout.match(/nginx\/(\d+)\.(\d+)\.(\d+)/);
  const v = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  http2DirectiveCache = v[0]! > 1 || (v[0] === 1 && (v[1]! > 25 || (v[1] === 25 && v[2]! >= 1)));
  return http2DirectiveCache;
}

export function renderVhost(spec: VhostSpec, opts: { http2Directive?: boolean } = {}): string {
  const names = [spec.domain, ...spec.aliases].join(' ');
  const body = appBody(spec);
  const header = `# Managed by Lares - changes will be overwritten\n# site: ${spec.domain} (${spec.appType})\n`;

  if (spec.listenPort) {
    // reachable as http://<server-ip>:<port>; the ACME location is harmless here
    return `${header}server {\n    listen ${spec.listenPort};\n    listen [::]:${spec.listenPort};\n    server_name _;\n\n${indent(body)}\n}\n`;
  }

  if (!spec.ssl) {
    return `${header}server {\n    listen 80;\n    listen [::]:80;\n    server_name ${names};\n\n${indent(body)}\n}\n`;
  }

  const httpBody = spec.ssl.forceHttps ? `${acmeLocation()}\n\nlocation / {\n    return 301 https://$host$request_uri;\n}` : body;
  return `${header}server {
    listen 80;
    listen [::]:80;
    server_name ${names};

${indent(httpBody)}
}

server {
${opts.http2Directive ? '    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;' : '    listen 443 ssl http2;\n    listen [::]:443 ssl http2;'}
    server_name ${names};

    ssl_certificate ${ngxPath(spec.ssl.certificate)};
    ssl_certificate_key ${ngxPath(spec.ssl.privateKey)};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:LARES_SSL:10m;
    ssl_session_timeout 1d;
${spec.ssl.forceHttps ? '    add_header Strict-Transport-Security "max-age=31536000" always;\n' : ''}
${indent(body)}
}
`;
}

export async function nginxRunning(): Promise<boolean> {
  if (config.dryRun) return true;
  return (await host.exec('systemctl is-active --quiet nginx')).code === 0;
}

export async function testAndReload(log?: HostLogger) {
  if (config.dryRun) {
    log?.('[dry-run] nginx -t && systemctl reload nginx');
    await syncDevNginx(log);
    return;
  }
  const test = await host.exec(`${shq(config.nginxBin)} -t`);
  if (test.code !== 0) throw new Error(`${t('Cấu hình nginx lỗi:')}\n${test.stderr.trim()}`);
  // Coexist mode: another web server still owns :80, nginx is intentionally stopped.
  // The config is validated and takes effect once nginx is started - do not try to start it here.
  if (!(await nginxRunning())) {
    log?.(t('nginx chưa chạy (port 80 có thể đang do web server khác giữ) - cấu hình hợp lệ, sẽ có hiệu lực khi nginx được khởi động'));
    return;
  }
  await host.run('systemctl reload nginx');
}

/** Write + enable a vhost; restores the previous file if `nginx -t` rejects the new one. */
export async function applyVhost(spec: VhostSpec, log?: HostLogger) {
  const file = vhostPath(spec.domain);
  const link = vhostLink(spec.domain);
  const previous = await fs.readFile(file, 'utf8').catch(() => null);
  const logs = siteLogPaths(spec.domain);
  await fs.mkdir(logs.dir, { recursive: true });
  await host.writeFile(file, renderVhost(spec, { http2Directive: await supportsHttp2Directive() }));
  if (!(await host.exists(link))) {
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(file, link);
  }
  try {
    await testAndReload(log);
  } catch (err) {
    if (previous !== null) await host.writeFile(file, previous);
    else await Promise.all([fs.rm(file, { force: true }), fs.rm(link, { force: true })]);
    throw err;
  }
}

export async function removeVhost(domain: string, log?: HostLogger) {
  await Promise.all([fs.rm(vhostLink(domain), { force: true }), fs.rm(vhostPath(domain), { force: true })]);
  await testAndReload(log);
}

/** Who listens on :80? Used to warn when another panel's web server still owns the port. */
export async function port80Owner(): Promise<string | null> {
  const r = await host.exec(`ss -ltnpH 'sport = :80' 2>/dev/null | head -n 3`);
  if (r.code !== 0 || !r.stdout.trim()) return null;
  const m = r.stdout.match(/users:\(\("([^"]+)"/);
  return m?.[1] ?? 'unknown';
}
