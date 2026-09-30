import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppType, CreateSiteInput, IssueSslInput, Site, SslState } from '@tpanel/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { conflict, notFound } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { UndoStack } from '../lib/undo.js';
import * as databases from './databases.js';
import { host, type HostLogger } from './host.js';
import { applyVhost, nginxRunning, port80Owner, removeVhost, siteLogPaths, type VhostSpec } from './nginx.js';
import * as nodeapp from './nodeapp.js';
import { resolvePhpVersion } from './php.js';
import * as ssl from './ssl.js';
import { installWordpress } from './wordpress.js';

interface SiteRow {
  id: number;
  domain: string;
  aliases_json: string;
  root_path: string;
  web_root: string;
  php_version: string | null;
  app_type: AppType;
  app_port: number | null;
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
  if (!row) throw notFound('Site không tồn tại');
  return toSite(row);
}

export function getNodeConfig(id: number): nodeapp.NodeAppConfig {
  const row = db.prepare('SELECT app_config_enc FROM sites WHERE id = ?').get(id) as { app_config_enc: string | null } | undefined;
  return row?.app_config_enc ? decrypt<nodeapp.NodeAppConfig>(row.app_config_enc) : { packageManager: 'auto', env: {} };
}

export function saveNodeConfig(id: number, cfg: nodeapp.NodeAppConfig) {
  db.prepare('UPDATE sites SET app_config_enc = ? WHERE id = ?').run(encrypt(cfg), id);
}

/** Domain (or alias) owned by another TPanel site? */
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
    if (owner) throw conflict(`${n} đang được dùng bởi site ${owner.domain}`);
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
    throw conflict(`Thư mục ${layout.appDir} đã tồn tại và không trống`);
  }
  await fs.mkdir(layout.webRoot, { recursive: true });
  if (!rootExisted) undo.push(`xoá ${layout.rootPath}`, () => fs.rm(layout.rootPath, { recursive: true, force: true }));

  const phpVersion = usesPhp(input.appType) ? await resolvePhpVersion(input.phpVersion) : null;
  if (input.phpVersion && phpVersion && phpVersion !== input.phpVersion) {
    log(`PHP ${input.phpVersion} chưa được cài, dùng PHP ${phpVersion}`);
  }
  let appPort: number | null = null;
  if (input.appType === 'nextjs') {
    const used = (db.prepare('SELECT app_port FROM sites WHERE app_port IS NOT NULL').all() as Array<{ app_port: number }>).map((r) => r.app_port);
    appPort = input.nodeConfig?.port && !used.includes(input.nodeConfig.port) ? input.nodeConfig.port : await nodeapp.allocatePort(used);
  }

  const info = db
    .prepare(
      `INSERT INTO sites (domain, aliases_json, root_path, web_root, php_version, app_type, app_port, app_config_enc, migration_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.domain,
      JSON.stringify(input.aliases),
      layout.rootPath,
      layout.webRoot,
      phpVersion,
      input.appType,
      appPort,
      input.nodeConfig ? encrypt(input.nodeConfig) : null,
      input.migrationId ?? null,
    );
  const siteId = Number(info.lastInsertRowid);
  undo.push(`xoá bản ghi site ${input.domain}`, async () => db.prepare('DELETE FROM sites WHERE id = ?').run(siteId));

  const site = getSite(siteId);
  await applySiteVhost(site, log);
  undo.push(`xoá vhost ${input.domain}`, () => removeVhost(input.domain, log));
  log(`Đã tạo vhost nginx cho ${input.domain}${appPort ? ` → 127.0.0.1:${appPort}` : ''}`);
  return site;
}

export async function createSite(input: CreateSiteInput, log: HostLogger) {
  const undo = new UndoStack();
  try {
    const nodeConfig = input.type === 'nextjs' ? input.nextjs : undefined;
    const site = await provisionSite(
      {
        domain: input.domain,
        aliases: input.aliases,
        appType: input.type,
        phpVersion: 'phpVersion' in input ? input.phpVersion : undefined,
        nodeConfig,
      },
      log,
      undo,
    );
    let database: { name: string; username: string; password: string } | null = null;

    if (input.type === 'wordpress' || (input.type === 'php' && input.createDatabase)) {
      const name = databases.deriveDbName(input.domain);
      const created = await databases.createDatabase({ name, username: name, siteId: site.id }, log);
      undo.push(`xoá database ${name}`, () => databases.deleteDatabase(created.record.id, log));
      database = { name, username: name, password: created.password };
      log(`Đã tạo database ${name}`);
    }

    switch (input.type) {
      case 'wordpress':
        await installWordpress(site.webRoot, site.domain, { name: database!.name, user: database!.username, password: database!.password }, input.wordpress, log);
        break;
      case 'php':
        await host.writeFile(path.join(site.webRoot, 'index.php'), `<?php\necho '<h1>${site.domain}</h1><p>Site được tạo bởi TPanel.</p>';\n`);
        break;
      case 'static':
        await host.writeFile(path.join(site.webRoot, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${site.domain}</title><h1>${site.domain}</h1><p>Site được tạo bởi TPanel.</p>\n`);
        break;
      case 'nextjs': {
        undo.push(`xoá service ${nodeapp.serviceName(site.domain)}`, () => nodeapp.removeService(site.domain, log));
        if (input.nextjs.gitUrl) {
          await nodeapp.gitCloneOrPull(site.webRoot, site.rootPath, input.nextjs.gitUrl, input.nextjs.branch, log);
          await nodeapp.buildAndRestart({ ...site, appPort: site.appPort! }, input.nextjs, log);
        } else {
          await nodeapp.writeServiceFiles(site.domain, site.webRoot, site.rootPath, site.appPort!, input.nextjs, log);
          log(`Chưa có mã nguồn: upload project Next.js vào ${site.webRoot} rồi bấm "Build & khởi động".`);
        }
        break;
      }
    }

    await fixPermissions(site.rootPath, log);
    undo.clear();
    log(`Hoàn tất tạo site ${site.domain}`);
    return { site: getSite(site.id), database };
  } catch (err) {
    await undo.run(log);
    throw err;
  }
}

export async function deploySite(id: number, log: HostLogger, signal?: AbortSignal) {
  const site = getSite(id);
  if (site.appType !== 'nextjs' || !site.appPort) throw conflict('Chỉ site Next.js mới có thể build/deploy');
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
  let state: SslState;
  if (input.type === 'letsencrypt') {
    if (!(await nginxRunning())) {
      const owner = await port80Owner();
      throw new Error(
        `nginx của TPanel chưa chạy${owner ? ` - port 80 đang do "${owner}" giữ` : ''}. Let's Encrypt cần xác thực qua port 80: dừng web server cũ rồi chạy "systemctl enable --now nginx" trước khi cài SSL.`,
      );
    }
    const names = input.includeAliases ? [site.domain, ...site.aliases] : [site.domain];
    for (const w of await ssl.dnsWarnings(names)) log(`Cảnh báo DNS: ${w}`);
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
    if (uncovered.length) log(`Cảnh báo: certificate không bao gồm ${uncovered.join(', ')}`);
  }
  await applySiteVhost({ ...site, ssl: state }, log);
  saveSsl(id, state);
  log(`Đã bật SSL cho ${site.domain}${state.expiresAt ? `, hết hạn ${state.expiresAt.slice(0, 10)}` : ''}`);
  return getSite(id);
}

export async function setForceHttps(id: number, forceHttps: boolean, log?: HostLogger) {
  const site = getSite(id);
  if (!site.ssl.enabled) throw conflict('Site chưa bật SSL');
  const state = { ...site.ssl, forceHttps };
  await applySiteVhost({ ...site, ssl: state }, log);
  saveSsl(id, state);
  return getSite(id);
}

export async function renewSsl(id: number, log: HostLogger) {
  const site = getSite(id);
  if (site.ssl.type !== 'letsencrypt') throw conflict("Chỉ gia hạn được chứng chỉ Let's Encrypt");
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

/** Refresh certificate expiry dates (certbot renews in the background via its own timer). */
export async function refreshSslExpiry() {
  for (const s of listSites()) {
    if (!s.ssl.enabled || !s.ssl.type) continue;
    const info = await ssl.readCertInfo(ssl.certPaths(s.domain, s.ssl.type).certificate);
    if (info.expiresAt && info.expiresAt !== s.ssl.expiresAt) saveSsl(s.id, { ...s.ssl, expiresAt: info.expiresAt });
  }
}

export async function deleteSite(
  id: number,
  opts: { removeFiles: boolean; removeDatabases: boolean; removeLogs: boolean; revokeSsl: boolean },
  log: HostLogger,
) {
  const site = getSite(id);
  if (site.appType === 'nextjs') await nodeapp.removeService(site.domain, log);
  await removeVhost(site.domain, log);
  if (site.ssl.type === 'letsencrypt' && opts.revokeSsl) await ssl.deleteLetsEncrypt(site.domain, log);
  if (site.ssl.type === 'custom') await ssl.removeCustomCert(site.domain);
  if (opts.removeDatabases) {
    for (const d of databases.databasesForSite(id)) {
      if (!d.managed) {
        log(`Bỏ qua database ${d.name} (dùng chung với panel khác, TPanel không xoá)`);
        continue;
      }
      await databases.deleteDatabase(d.id, log);
      log(`Đã xoá database ${d.name}`);
    }
  }
  if (opts.removeFiles) {
    // Guard against a corrupted row pointing somewhere dangerous.
    const root = path.resolve(site.rootPath);
    if (!root.startsWith(path.resolve(config.sitesRoot) + path.sep)) throw new Error(`Từ chối xoá thư mục ngoài ${config.sitesRoot}: ${root}`);
    await fs.rm(root, { recursive: true, force: true });
    log(`Đã xoá ${root}`);
  }
  if (opts.removeLogs) await fs.rm(siteLogPaths(site.domain).dir, { recursive: true, force: true });
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  log(`Đã xoá site ${site.domain}`);
}
