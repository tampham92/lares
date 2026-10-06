import fs from 'node:fs/promises';
import path from 'node:path';
import { LOCALHOST, type AppType, type CreateSiteInput, type CreateSiteResult, type IssueSslInput, type Site, type SslState } from '@lares/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { t, tDefault } from '../i18n/index.js';
import { decrypt, encrypt, randomPassword } from '../lib/crypto.js';
import { conflict, notFound } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { UndoStack } from '../lib/undo.js';
import * as databases from './databases.js';
import { host, type HostLogger } from './host.js';
import { applyVhost, nginxRunning, port80Owner, removeVhost, siteLogPaths, type VhostSpec } from './nginx.js';
import * as nodeapp from './nodeapp.js';
import * as ports from './ports.js';
import { resolvePhpVersion } from './php.js';
import * as ssl from './ssl.js';
import * as templates from './templates.js';
import { manifestFromSpec as builderManifest } from './builder/index.js';
import { ensurePortHostFix, installWordpress, wordpressReplaceUrl } from './wordpress.js';

interface SiteRow {
  id: number;
  domain: string;
  aliases_json: string;
  root_path: string;
  web_root: string;
  php_version: string | null;
  app_type: AppType;
  app_port: number | null;
  listen_port: number | null;
  app_config_enc: string | null;
  ssl_json: string;
  access_log: number;
  status: 'active' | 'disabled';
  migration_id: number | null;
  created_at: string;
}

const toSite = (r: SiteRow): Site => ({
  id: r.id,
  domain: r.domain,
  aliases: JSON.parse(r.aliases_json) as string[],
  rootPath: r.root_path,
  webRoot: r.web_root,
  phpVersion: r.php_version,
  appType: r.app_type,
  appPort: r.app_port,
  listenPort: r.listen_port,
  status: r.status,
  ssl: { ...ssl.EMPTY_SSL, ...(JSON.parse(r.ssl_json) as Partial<SslState>) },
  accessLog: r.access_log === 1,
  migrationId: r.migration_id,
  createdAt: r.created_at,
});

const PHP_TYPES: AppType[] = ['wordpress', 'laravel', 'php', 'unknown'];
export const usesPhp = (t: AppType) => PHP_TYPES.includes(t);

export function listSites(): Site[] {
  return (db.prepare('SELECT * FROM sites ORDER BY id DESC').all() as SiteRow[]).map(toSite);
}

export function getSite(id: number): Site {
  const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as SiteRow | undefined;
  if (!row) throw notFound(t('Site không tồn tại'));
  return toSite(row);
}

export function getNodeConfig(id: number): nodeapp.NodeAppConfig {
  const row = db.prepare('SELECT app_config_enc FROM sites WHERE id = ?').get(id) as { app_config_enc: string | null } | undefined;
  return row?.app_config_enc ? decrypt<nodeapp.NodeAppConfig>(row.app_config_enc) : { packageManager: 'auto', env: {} };
}

export function saveNodeConfig(id: number, cfg: nodeapp.NodeAppConfig) {
  db.prepare('UPDATE sites SET app_config_enc = ? WHERE id = ?').run(encrypt(cfg), id);
}

/** Domain (or alias) owned by another Lares site? */
export function findSiteByHostname(name: string, exceptId?: number): Site | null {
  for (const s of listSites()) {
    if (s.id === exceptId) continue;
    if (s.domain === name || s.aliases.includes(name)) return s;
  }
  return null;
}

function assertHostnamesFree(names: string[], exceptId?: number) {
  for (const n of names) {
    const owner = findSiteByHostname(n, exceptId);
    if (owner) throw conflict(t('{name} đang được dùng bởi site {domain}', { name: n, domain: owner.domain }));
  }
}

export function siteLayout(domain: string, appType: AppType, webRootSubdir = '') {
  const rootPath = path.join(config.sitesRoot, domain);
  const appDir = path.join(rootPath, appType === 'nextjs' ? 'app' : 'public_html');
  return { rootPath, appDir, webRoot: webRootSubdir ? path.join(appDir, webRootSubdir) : appDir };
}

export function vhostSpecFor(site: Site): VhostSpec {
  const sslPaths = site.ssl.enabled && site.ssl.type ? ssl.certPaths(site.domain, site.ssl.type) : null;
  return {
    domain: site.domain,
    aliases: site.aliases,
    appType: site.appType,
    webRoot: site.webRoot,
    phpVersion: site.phpVersion,
    appPort: site.appPort,
    listenPort: site.listenPort,
    accessLog: site.accessLog,
    disabled: site.status === 'disabled',
    ssl: sslPaths ? { ...sslPaths, forceHttps: site.ssl.forceHttps } : null,
  };
}

export const applySiteVhost = (site: Site, log?: HostLogger) => applyVhost(vhostSpecFor(site), log);

export const fixPermissions = (rootPath: string, log?: HostLogger) =>
  host.mutate(
    [
      `chown -R ${shq(`${config.webUser}:${config.webUser}`)} ${shq(rootPath)}`,
      `find ${shq(rootPath)} -type d -exec chmod 755 {} +`,
      `find ${shq(rootPath)} -type f -not -perm -u+x -exec chmod 644 {} +`,
      // never keep setuid/setgid binaries that arrived inside a migrated archive
      `find ${shq(rootPath)} -type f -perm /6000 -exec chmod ug-s {} +`,
    ].join(' && '),
    { log, timeoutMs: 30 * 60_000 },
  );

export interface ProvisionInput {
  domain: string;
  aliases: string[];
  appType: AppType;
  phpVersion?: string | null;
  webRootSubdir?: string;
  migrationId?: number | null;
  nodeConfig?: nodeapp.NodeAppConfig;
  /** Allow an existing non-empty directory (migration overwrite). */
  allowExistingDir?: boolean;
  /** No domain: serve on a public port instead (domain must then be the synthetic `siteNNNN.localhost`). */
  listenPort?: number | null;
}

/** Synthetic, unique identifier for port-based sites; doubles as directory / vhost / log name. */
export const portSiteDomain = (port: number) => `site${port}.${LOCALHOST}`;

/** The address people type in a browser. */
export function siteUrl(site: Pick<Site, 'domain' | 'listenPort' | 'ssl'>, publicHost?: string | null): string {
  if (site.listenPort) return `http://${publicHost || 'IP-MAY-CHU'}:${site.listenPort}`;
  return `${site.ssl.enabled ? 'https' : 'http'}://${site.domain}`;
}

/**
 * Low-level: directories + DB row + nginx vhost. Shared by "Add site" and the migration engine.
 * Registers compensating actions on `undo` so a failed caller can roll everything back.
 */
export async function provisionSite(input: ProvisionInput, log: HostLogger, undo: UndoStack): Promise<Site> {
  assertHostnamesFree([input.domain, ...input.aliases]);
  const layout = siteLayout(input.domain, input.appType, input.webRootSubdir);
  const rootExisted = await host.exists(layout.rootPath);
  if (rootExisted && !input.allowExistingDir && !(await host.isEmptyDir(layout.appDir))) {
    throw conflict(t('Thư mục {dir} đã tồn tại và không trống', { dir: layout.appDir }));
  }
  await fs.mkdir(layout.webRoot, { recursive: true });
  if (!rootExisted) undo.push(t('xoá {path}', { path: layout.rootPath }), () => fs.rm(layout.rootPath, { recursive: true, force: true }));

  const phpVersion = usesPhp(input.appType) ? await resolvePhpVersion(input.phpVersion) : null;
  if (input.phpVersion && phpVersion && phpVersion !== input.phpVersion) {
    log(t('PHP {wanted} chưa được cài, dùng PHP {used}', { wanted: String(input.phpVersion), used: String(phpVersion) }));
  }
  let appPort: number | null = null;
  if (input.appType === 'nextjs') {
    const wanted = input.nodeConfig?.port;
    appPort = wanted && (await ports.isPortFree(wanted)) ? wanted : await ports.allocatePort(config.nodeAppPortStart);
  }

  const info = db
    .prepare(
      `INSERT INTO sites (domain, aliases_json, root_path, web_root, php_version, app_type, app_port, listen_port, app_config_enc, migration_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.domain,
      JSON.stringify(input.aliases),
      layout.rootPath,
      layout.webRoot,
      phpVersion,
      input.appType,
      appPort,
      input.listenPort ?? null,
      input.nodeConfig ? encrypt(input.nodeConfig) : null,
      input.migrationId ?? null,
    );
  const siteId = Number(info.lastInsertRowid);
  undo.push(t('xoá bản ghi site {domain}', { domain: input.domain }), async () => db.prepare('DELETE FROM sites WHERE id = ?').run(siteId));

  const site = getSite(siteId);
  await applySiteVhost(site, log);
  undo.push(t('xoá vhost {domain}', { domain: input.domain }), () => removeVhost(input.domain, log));
  if (input.listenPort) {
    if (await ports.openFirewallPort(input.listenPort, log)) {
      undo.push(t('đóng port {port}', { port: input.listenPort }), () => ports.closeFirewallPort(input.listenPort!, log));
      log(t('Đã mở port {port} trên firewall (ufw)', { port: input.listenPort }));
    }
    log(t('Đã tạo vhost nginx lắng nghe port {port}', { port: input.listenPort }) + (appPort ? ` → 127.0.0.1:${appPort}` : ''));
  } else {
    log(t('Đã tạo vhost nginx cho {domain}', { domain: input.domain }) + (appPort ? ` → 127.0.0.1:${appPort}` : ''));
  }
  return site;
}

export async function createSite(input: CreateSiteInput, log: HostLogger): Promise<CreateSiteResult> {
  const undo = new UndoStack();
  try {
    // "localhost" = no domain yet: reserve a public port, the site lives at http://<ip>:<port>
    let listenPort: number | null = null;
    if (input.domain === LOCALHOST) {
      if (input.listenPort && !(await ports.isPortFree(input.listenPort))) throw conflict(t('Port {port} đang được sử dụng', { port: input.listenPort }));
      listenPort = input.listenPort ?? (await ports.allocatePort(config.sitePortStart));
    }
    const domain = listenPort ? portSiteDomain(listenPort) : input.domain;
    const nodeConfig = input.type === 'nextjs' ? input.nextjs : undefined;
    const site = await provisionSite(
      {
        domain,
        aliases: listenPort ? [] : input.aliases,
        appType: input.type,
        phpVersion: 'phpVersion' in input ? input.phpVersion : undefined,
        nodeConfig,
        listenPort,
      },
      log,
      undo,
    );
    const url = siteUrl(site, input.publicHost);
    let database: CreateSiteResult['database'] = null;
    let wordpressAdmin: CreateSiteResult['wordpressAdmin'] = null;

    if (input.type === 'wordpress' || (input.type === 'php' && input.createDatabase)) {
      const name = databases.deriveDbName(domain);
      const created = await databases.createDatabase({ name, username: name, siteId: site.id }, log);
      undo.push(t('xoá database {name}', { name }), () => databases.deleteDatabase(created.record.id, log));
      database = { name, username: name, password: created.password };
      log(t('Đã tạo database {name}', { name }));
    }

    switch (input.type) {
      case 'wordpress': {
        const tpl = input.builder ? builderManifest(input.builder) : input.template ? await templates.getTemplate(input.template) : null;
        const vars = tpl ? templates.templateVars(tpl, input.branding) : null;
        const wp = { ...input.wordpress, title: input.wordpress.title || vars?.SITE_NAME };
        // A template needs a finished install to import its content, so generate an admin account if none was given.
        if (tpl && !(wp.adminUser && wp.adminPassword && wp.adminEmail)) {
          wp.adminUser ||= 'admin';
          wp.adminPassword ||= randomPassword(16);
          wp.adminEmail ||= input.branding.email || `admin@${listenPort ? 'example.com' : domain}`;
        }
        const installed = await installWordpress(site.webRoot, url, { name: database!.name, user: database!.username, password: database!.password }, wp, log);
        if (installed && wp.adminUser && wp.adminPassword) {
          wordpressAdmin = { url: `${url}/wp-admin/`, user: wp.adminUser, password: wp.adminPassword };
        }
        if (tpl && vars) {
          if (installed) await templates.installWordpressTemplate(tpl, site.webRoot, vars, log);
          else log(t('Cảnh báo: cần wp-cli trên máy chủ để cài giao diện mẫu WordPress - site được tạo với giao diện mặc định'));
        }
        if (wordpressAdmin) log(t('Tài khoản quản trị WordPress: {user} / {password} - đăng nhập tại {url}', { user: wordpressAdmin.user, password: wordpressAdmin.password, url: wordpressAdmin.url }));
        break;
      }
      case 'php':
        await host.writeFile(path.join(site.webRoot, 'index.php'), `<?php\necho '<h1>${domain}</h1><p>${tDefault('Site được tạo bởi Lares.')}</p>';\n`);
        break;
      case 'static':
        if (input.builder || input.template) {
          const tpl = input.builder ? builderManifest(input.builder) : await templates.getTemplate(input.template!);
          await templates.installStaticTemplate(tpl, site.webRoot, templates.templateVars(tpl, input.branding), log);
        } else {
          await host.writeFile(path.join(site.webRoot, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${domain}</title><h1>${domain}</h1><p>${tDefault('Site được tạo bởi Lares.')}</p>\n`);
        }
        break;
      case 'nextjs': {
        undo.push(t('xoá service {name}', { name: nodeapp.serviceName(site.domain) }), () => nodeapp.removeService(site.domain, log));
        if (input.nextjs.gitUrl) {
          await nodeapp.gitCloneOrPull(site.webRoot, site.rootPath, input.nextjs.gitUrl, input.nextjs.branch, log);
          await nodeapp.buildAndRestart({ ...site, appPort: site.appPort! }, input.nextjs, log);
        } else {
          await nodeapp.writeServiceFiles(site.domain, site.webRoot, site.rootPath, site.appPort!, input.nextjs, log);
          log(t('Chưa có mã nguồn: upload project Next.js vào {dir} rồi bấm "Build & khởi động".', { dir: site.webRoot }));
        }
        break;
      }
    }

    await fixPermissions(site.rootPath, log);
    undo.clear();
    log(t('Hoàn tất tạo site - truy cập: {url}', { url }));
    return { site: getSite(site.id), url, database, wordpressAdmin };
  } catch (err) {
    await undo.run(log);
    throw err;
  }
}

export async function deploySite(id: number, log: HostLogger, signal?: AbortSignal) {
  const site = getSite(id);
  if (site.appType !== 'nextjs' || !site.appPort) throw conflict(t('Chỉ site Next.js mới có thể build/deploy'));
  const cfg = getNodeConfig(id);
  if (cfg.gitUrl) await nodeapp.gitCloneOrPull(site.webRoot, site.rootPath, cfg.gitUrl, cfg.branch ?? 'main', log, signal);
  await nodeapp.buildAndRestart({ ...site, appPort: site.appPort }, cfg, log, signal);
  return getSite(id);
}

export async function updateSite(
  id: number,
  patch: { aliases?: string[]; phpVersion?: string; accessLog?: boolean; status?: 'active' | 'disabled' },
  log?: HostLogger,
) {
  const site = getSite(id);
  if (patch.aliases) assertHostnamesFree(patch.aliases, id);
  const next: Site = {
    ...site,
    aliases: patch.aliases ?? site.aliases,
    phpVersion: patch.phpVersion && usesPhp(site.appType) ? await resolvePhpVersion(patch.phpVersion) : site.phpVersion,
    accessLog: patch.accessLog ?? site.accessLog,
    status: patch.status ?? site.status,
  };
  await applySiteVhost(next, log);
  db.prepare('UPDATE sites SET aliases_json = ?, php_version = ?, access_log = ?, status = ? WHERE id = ?').run(
    JSON.stringify(next.aliases),
    next.phpVersion,
    next.accessLog ? 1 : 0,
    next.status,
    id,
  );
  if (site.appType === 'nextjs' && patch.status && patch.status !== site.status) {
    await nodeapp.serviceAction(site.domain, patch.status === 'disabled' ? 'stop' : 'start', log);
  }
  return getSite(id);
}

function saveSsl(id: number, state: SslState) {
  db.prepare('UPDATE sites SET ssl_json = ? WHERE id = ?').run(JSON.stringify(state), id);
}

export async function issueSsl(id: number, input: IssueSslInput, log: HostLogger) {
  const site = getSite(id);
  if (site.listenPort) throw conflict(t('Site đang chạy theo port (chưa có tên miền) nên không cài được SSL. Hãy tạo site với tên miền thật.'));
  let state: SslState;
  if (input.type === 'letsencrypt') {
    if (!(await nginxRunning())) {
      const owner = await port80Owner();
      throw new Error(
        (owner ? t('nginx của Lares chưa chạy - port 80 đang do "{owner}" giữ.', { owner }) : t('nginx của Lares chưa chạy.')) +
          ' ' +
          t('Let\'s Encrypt cần xác thực qua port 80: dừng web server cũ rồi chạy "systemctl enable --now nginx" trước khi cài SSL.'),
      );
    }
    const names = input.includeAliases ? [site.domain, ...site.aliases] : [site.domain];
    for (const w of await ssl.dnsWarnings(names)) log(t('Cảnh báo DNS: {warning}', { warning: w }));
    // make sure the ACME location is live on port 80 before certbot asks Let's Encrypt to hit it
    await applySiteVhost(site, log);
    await ssl.issueLetsEncrypt(site.domain, names, input.email, input.staging, log);
    const info = await ssl.readCertInfo(ssl.certPaths(site.domain, 'letsencrypt').certificate);
    state = {
      enabled: true,
      type: 'letsencrypt',
      domains: info.domains.length ? info.domains : names,
      issuer: info.issuer ?? (input.staging ? "Let's Encrypt (staging)" : "Let's Encrypt"),
      expiresAt: info.expiresAt,
      forceHttps: input.forceHttps,
    };
  } else {
    const paths = await ssl.installCustomCert(site.domain, input.certificate, input.privateKey);
    const info = await ssl.readCertInfo(paths.certificate);
    state = { enabled: true, type: 'custom', domains: info.domains, issuer: info.issuer, expiresAt: info.expiresAt, forceHttps: input.forceHttps };
    const uncovered = [site.domain, ...site.aliases].filter((d) => !info.domains.some((c) => c === d || (c.startsWith('*.') && d.endsWith(c.slice(1)))));
    if (uncovered.length) log(t('Cảnh báo: certificate không bao gồm {names}', { names: uncovered.join(', ') }));
  }
  await applySiteVhost({ ...site, ssl: state }, log);
  saveSsl(id, state);
  log(
    state.expiresAt
      ? t('Đã bật SSL cho {domain}, hết hạn {date}', { domain: site.domain, date: state.expiresAt.slice(0, 10) })
      : t('Đã bật SSL cho {domain}', { domain: site.domain }),
  );
  // An http:// home URL on an https page makes browsers block the theme's CSS/JS (mixed content).
  if (site.appType === 'wordpress') await wordpressReplaceUrl(site.webRoot, site.rootPath, `https://${site.domain}`, log);
  return getSite(id);
}

export async function setForceHttps(id: number, forceHttps: boolean, log?: HostLogger) {
  const site = getSite(id);
  if (!site.ssl.enabled) throw conflict(t('Site chưa bật SSL'));
  const state = { ...site.ssl, forceHttps };
  await applySiteVhost({ ...site, ssl: state }, log);
  saveSsl(id, state);
  return getSite(id);
}

export async function renewSsl(id: number, log: HostLogger) {
  const site = getSite(id);
  if (site.ssl.type !== 'letsencrypt') throw conflict(t("Chỉ gia hạn được chứng chỉ Let's Encrypt"));
  await ssl.renewLetsEncrypt(site.domain, log);
  const info = await ssl.readCertInfo(ssl.certPaths(site.domain, 'letsencrypt').certificate);
  saveSsl(id, { ...site.ssl, expiresAt: info.expiresAt ?? site.ssl.expiresAt });
  return getSite(id);
}

export async function disableSsl(id: number, revoke: boolean, log?: HostLogger) {
  const site = getSite(id);
  await applySiteVhost({ ...site, ssl: ssl.EMPTY_SSL }, log);
  if (revoke && site.ssl.type === 'letsencrypt') await ssl.deleteLetsEncrypt(site.domain, log);
  if (site.ssl.type === 'custom') await ssl.removeCustomCert(site.domain);
  saveSsl(id, ssl.EMPTY_SSL);
  return getSite(id);
}

/** One-off repairs for sites created by older Lares versions (runs at startup, idempotent). */
export async function repairSites(log: HostLogger) {
  for (const s of listSites()) {
    if (s.appType === 'wordpress' && s.listenPort) await ensurePortHostFix(s.webRoot, log).catch((e) => log(t('Không vá được {domain}: {error}', { domain: s.domain, error: e instanceof Error ? e.message : String(e) })));
  }
}

/** Refresh certificate expiry dates (certbot renews in the background via its own timer). */
export async function refreshSslExpiry() {
  for (const s of listSites()) {
    if (!s.ssl.enabled || !s.ssl.type) continue;
    const info = await ssl.readCertInfo(ssl.certPaths(s.domain, s.ssl.type).certificate);
    if (info.expiresAt && info.expiresAt !== s.ssl.expiresAt) saveSsl(s.id, { ...s.ssl, expiresAt: info.expiresAt });
  }
}

/**
 * Give a site a (new) real domain - typically a port-based site that is ready to go live.
 * Files stay where they are (paths are stored per site); vhost, logs, Next.js service and
 * WordPress URLs move to the new name. Any certificate for the old name is dropped.
 */
export async function changeDomain(id: number, input: { domain: string; aliases: string[] }, log: HostLogger) {
  const site = getSite(id);
  const domain = input.domain.toLowerCase();
  if (domain === LOCALHOST) throw conflict(t('Hãy nhập tên miền thật'));
  if (domain === site.domain && !site.listenPort) throw conflict(t('Site đã dùng tên miền này'));
  assertHostnamesFree([domain, ...input.aliases], id);
  const target = siteLayout(domain, site.appType);
  if (target.rootPath !== site.rootPath && (await host.exists(target.rootPath))) {
    log(t('Lưu ý: thư mục {dir} đã tồn tại, site vẫn dùng thư mục hiện tại {current}', { dir: target.rootPath, current: site.rootPath }));
  }

  const undo = new UndoStack();
  const next: Site = { ...site, domain, aliases: input.aliases, listenPort: null, ssl: ssl.EMPTY_SSL };
  try {
    await applySiteVhost(next, log);
    undo.push(t('xoá vhost {domain}', { domain }), () => removeVhost(domain, log));

    if (site.appType === 'nextjs' && site.appPort) {
      await nodeapp.writeServiceFiles(domain, site.webRoot, site.rootPath, site.appPort, getNodeConfig(id), log);
      undo.push(t('xoá service {name}', { name: nodeapp.serviceName(domain) }), () => nodeapp.removeService(domain, log));
      await nodeapp.serviceAction(domain, 'restart', log);
    }

    db.prepare(`UPDATE sites SET domain = ?, aliases_json = ?, listen_port = NULL, ssl_json = '{}' WHERE id = ?`).run(domain, JSON.stringify(input.aliases), id);
    undo.clear();
  } catch (err) {
    await undo.run(log);
    throw err;
  }

  // Point of no return passed: clean up what belonged to the old name (best effort).
  await removeVhost(site.domain, log).catch((e) => log(t('Không xoá được vhost cũ: {error}', { error: e instanceof Error ? e.message : String(e) })));
  if (site.appType === 'nextjs') await nodeapp.removeService(site.domain, log).catch(() => {});
  // Only now - with the old vhost gone - can the old log files move (nginx -t opens every log path).
  await moveSiteLogs(site.domain, domain, log).catch((e) => log(t('Không chuyển được log cũ: {error}', { error: e instanceof Error ? e.message : String(e) })));
  if (site.listenPort) await ports.closeFirewallPort(site.listenPort, log);
  if (site.ssl.type === 'letsencrypt') await ssl.deleteLetsEncrypt(site.domain, log);
  if (site.ssl.type === 'custom') await ssl.removeCustomCert(site.domain);
  if (site.appType === 'wordpress') await wordpressReplaceUrl(site.webRoot, site.rootPath, `http://${domain}`, log);

  log(t('Đã gán tên miền {domains}. Tiếp theo: trỏ bản ghi DNS A về IP máy chủ, rồi cài SSL ở tab SSL.', { domains: [domain, ...input.aliases].join(', ') }));
  return getSite(id);
}

/** Keep traffic history when a site is renamed: move old log files unless the new ones already have data. */
async function moveSiteLogs(from: string, to: string, log: HostLogger) {
  const src = siteLogPaths(from).dir;
  const dst = siteLogPaths(to).dir;
  if (src === dst || !(await host.exists(src))) return;
  await fs.mkdir(dst, { recursive: true });
  for (const f of await fs.readdir(src)) {
    const target = path.join(dst, f);
    const size = (await fs.stat(target).catch(() => null))?.size ?? 0;
    if (size === 0) await fs.rename(path.join(src, f), target);
  }
  await fs.rm(src, { recursive: true, force: true });
  // nginx still holds the replaced (empty) files open
  if (!config.dryRun && (await nginxRunning())) await host.run(`${shq(config.nginxBin)} -s reopen`).catch(() => undefined);
  log(t('Đã giữ lại lịch sử log traffic cho tên miền mới'));
}

export async function deleteSite(
  id: number,
  opts: { removeFiles: boolean; removeDatabases: boolean; removeLogs: boolean; revokeSsl: boolean },
  log: HostLogger,
) {
  const site = getSite(id);
  if (site.appType === 'nextjs') await nodeapp.removeService(site.domain, log);
  await removeVhost(site.domain, log);
  if (site.listenPort) await ports.closeFirewallPort(site.listenPort, log);
  if (site.ssl.type === 'letsencrypt' && opts.revokeSsl) await ssl.deleteLetsEncrypt(site.domain, log);
  if (site.ssl.type === 'custom') await ssl.removeCustomCert(site.domain);
  if (opts.removeDatabases) {
    for (const d of databases.databasesForSite(id)) {
      if (!d.managed) {
        log(t('Bỏ qua database {name} (dùng chung với panel khác, Lares không xoá)', { name: d.name }));
        continue;
      }
      await databases.deleteDatabase(d.id, log);
      log(t('Đã xoá database {name}', { name: d.name }));
    }
  }
  if (opts.removeFiles) {
    // Guard against a corrupted row pointing somewhere dangerous.
    const root = path.resolve(site.rootPath);
    if (!root.startsWith(path.resolve(config.sitesRoot) + path.sep)) throw new Error(t('Từ chối xoá thư mục ngoài {root}: {path}', { root: config.sitesRoot, path: root }));
    await fs.rm(root, { recursive: true, force: true });
    log(t('Đã xoá {path}', { path: root }));
  }
  if (opts.removeLogs) await fs.rm(siteLogPaths(site.domain).dir, { recursive: true, force: true });
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  log(t('Đã xoá site {domain}', { domain: site.domain }));
}
