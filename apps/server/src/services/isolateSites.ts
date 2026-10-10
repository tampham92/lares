import type { Site, SiteIsolationView } from '@lares/shared';
import { config } from '../config.js';
import { msg } from '@lares/shared';
import { t } from '../i18n/index.js';
import { conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { UndoStack } from '../lib/undo.js';
import { startLocked, withSiteLock } from './backups.js';
import { host, type HostLogger } from './host.js';
import * as isolation from './isolation.js';
import * as nodeapp from './nodeapp.js';
import { notify, registerNotificationSource } from './notifications.js';
import * as sites from './sites.js';
import { startTask, type TaskInfo } from './tasks.js';

/*
 * Converting a site created by an older Lares (shared www-data, shared PHP-FPM pool) to its own user
 * and PHP-FPM. Runs once per site after the upgrade, one site after another, holding the site's lock
 * (no backup/restore/update at the same time). Any failure puts the site back exactly as it was and
 * records why; such a site is not retried automatically (the site page offers a retry).
 *
 * Order matters for the visitors: the new PHP-FPM first (it can read the old files: 644 under 755),
 * then nginx (its reload also gives its workers the site's group), only then the chown/chmod. While
 * that runs, pages are served; only writes (uploads, caches) may fail for those seconds.
 */

/** HTTP status of the site's home page as nginx serves it on this machine ('000' = no answer). */
async function probe(site: Site): Promise<string> {
  const port = site.listenPort ?? (site.ssl.enabled ? 443 : 80);
  const scheme = site.ssl.enabled && !site.listenPort ? 'https' : 'http';
  const r = await host.exec(
    `curl -sk -o /dev/null -w '%{http_code}' --max-time 20 --resolve ${shq(`${site.domain}:${port}:127.0.0.1`)} ${shq(`${scheme}://${site.domain}:${port}/`)}`,
  );
  return r.stdout.trim() || '000';
}

const broken = (code: string) => code === '000' || code.startsWith('5');

export async function isolateSite(site: Site, log: HostLogger): Promise<Site> {
  if (site.sysUser) return site;
  if (!config.siteIsolation) throw conflict(t('Tính năng cách ly site đang tắt trên máy chủ này (LARES_SITE_ISOLATION=0)'));
  const ownPhp = sites.usesPhp(site.appType);
  const before = config.dryRun || site.status !== 'active' ? null : await probe(site);
  const undo = new UndoStack();
  try {
    const user = await isolation.ensureSiteUser(site.id, site.rootPath, log);
    undo.push(t('xoá user {user}', { user }), () => isolation.removeSiteUser(user, log));
    const next: Site = { ...site, sysUser: user };

    if (ownPhp) {
      undo.push(t('xoá PHP-FPM của site {domain}', { domain: site.domain }), () => isolation.removeSitePhp(site.id, log));
      await isolation.applySitePhp(next, log);
      if (site.status === 'disabled') await isolation.setSitePhpRunning(next, false, log);
    }

    undo.push(t('đặt lại vhost {domain}', { domain: site.domain }), () => sites.applySiteVhost(site, log));
    await sites.applySiteVhost(next, log);

    if (site.appType === 'nextjs' && site.appPort) {
      const cfg = sites.getNodeConfig(site.id);
      undo.push(t('đặt lại service {name}', { name: nodeapp.serviceName(site.domain) }), async () => {
        await nodeapp.writeServiceFiles({ ...site, appPort: site.appPort! }, cfg, log);
        if (site.status === 'active') await nodeapp.serviceAction(site.domain, 'restart', log);
      });
      await nodeapp.writeServiceFiles({ ...next, appPort: site.appPort }, cfg, log);
    }

    undo.push(t('trả quyền file cho {user}', { user: config.webUser }), () => sites.fixPermissions(site, log));
    log(t('Đang chuyển quyền sở hữu file sang {user}...', { user }));
    await sites.fixPermissions(next, log);
    if (site.appType === 'nextjs' && site.status === 'active') await nodeapp.serviceAction(site.domain, 'restart', log);

    sites.setSiteIsolation(site.id, { sysUser: user, error: null });
    undo.push(t('xoá bản ghi cách ly'), async () => sites.setSiteIsolation(site.id, { sysUser: null }));

    if (before !== null && !broken(before)) {
      // `systemctl reload nginx` returns before the old workers (still on the old socket) are gone,
      // and a restarted Next.js app needs a moment: wait, then probe twice - one 5xx is enough.
      for (const delay of [site.appType === 'nextjs' ? 6_000 : 3_000, 2_000]) {
        await new Promise((r) => setTimeout(r, delay));
        const after = await probe(next);
        if (broken(after)) throw new Error(t('Site trả về HTTP {after} sau khi chuyển (trước đó {before})', { after, before }));
      }
    }
    undo.clear();
    await isolation.syncSiteFirewall(log);
    log(t('Đã cách ly {domain}: user {user}{php}', { domain: site.domain, user, php: ownPhp ? `, ${isolation.phpPathsFor(site.id).unit}` : '' }));
    return sites.getSite(site.id);
  } catch (err) {
    log(t('LỖI khi cách ly {domain}: {error} - đang đưa site về như cũ', { domain: site.domain, error: errorMessage(err) }));
    await undo.run(log);
    sites.setSiteIsolation(site.id, { sysUser: null, error: errorMessage(err) });
    await isolation.syncSiteFirewall(log);
    throw err;
  }
}

/** Sites still on the shared user, in id order, minus those that already failed once. */
export const pendingSites = () =>
  sites
    .listSites()
    .filter((s) => !s.sysUser && !sites.siteIsolationError(s.id))
    .sort((a, b) => a.id - b.id);

let upgradeTask: TaskInfo | null = null;

/** Started at boot: converts the remaining older sites, one by one. Never throws; failures stay per site. */
export function startUpgradeConversion(log: HostLogger): TaskInfo | null {
  if (!config.siteIsolation || upgradeTask?.status === 'running') return upgradeTask;
  const todo = pendingSites();
  if (!todo.length) return null;
  upgradeTask = startTask(t('Cách ly các site cũ ({n})', { n: todo.length }), async (taskLog) => {
    const both = (m: string) => {
      taskLog(m);
      log(m);
    };
    let ok = 0;
    for (const s of todo) {
      try {
        await withSiteLock(s, 'isolate', () => isolateSite(sites.getSite(s.id), both));
        ok++;
      } catch (err) {
        both(t('Bỏ qua {domain}: {error}', { domain: s.domain, error: errorMessage(err) }));
      }
    }
    both(t('Đã cách ly {ok}/{n} site', { ok, n: todo.length }));
    // failures have their own live notice (below); this one tells what the upgrade changed
    if (ok) {
      notify({
        kind: 'isolation',
        tone: 'ok',
        title: msg('Đã chuyển {ok} site sang user riêng'),
        body: msg('Bản nâng cấp cho mỗi site một user Linux và PHP-FPM riêng: site bị nhiễm mã độc không còn đọc hay sửa được site khác.'),
        params: { ok },
        actions: [{ label: msg('Xem tài liệu'), href: 'https://github.com/tampham92/lares/blob/main/docs/vi/security.md#c%C3%A1ch-ly-t%E1%BB%ABng-site', external: true }],
        dedupeKey: 'isolation-upgrade',
      });
    }
  });
  return upgradeTask;
}

/** "Retry" on the site page: clears the recorded error and converts the site in a task. */
export function startIsolateSite(siteId: number): TaskInfo {
  const site = sites.getSite(siteId);
  if (site.sysUser) throw conflict(t('Site đã có user riêng'));
  if (!config.siteIsolation) throw conflict(t('Tính năng cách ly site đang tắt trên máy chủ này (LARES_SITE_ISOLATION=0)'));
  return startLocked(site, 'isolate', t('Cách ly {domain}', { domain: site.domain }), (log) => isolateSite(site, log));
}

export async function isolationView(siteId: number): Promise<SiteIsolationView> {
  const site = sites.getSite(siteId);
  const ownPhp = site.sysUser !== null && sites.usesPhp(site.appType);
  return {
    sysUser: site.sysUser,
    phpActive: ownPhp ? await isolation.sitePhpActive(site) : null,
    phpService: ownPhp ? isolation.phpPathsFor(site.id).unit : null,
    phpExecAllowed: site.phpExecAllowed,
    firewall: site.sysUser ? await isolation.siteFirewallLoaded() : null,
    error: sites.siteIsolationError(site.id),
    disabled: !config.siteIsolation,
  };
}

/** Turn exec() & co. on or off for an isolated PHP site (rewrites its php-fpm.conf, restarts it). */
export async function setPhpExecAllowed(siteId: number, allowed: boolean, log?: HostLogger): Promise<SiteIsolationView> {
  const site = sites.getSite(siteId);
  if (!site.sysUser || !sites.usesPhp(site.appType)) throw conflict(t('Chỉ áp dụng cho site PHP đã có user riêng'));
  if (site.phpExecAllowed !== allowed) {
    await isolation.applySitePhp({ ...site, phpExecAllowed: allowed }, log);
    if (site.status === 'disabled') await isolation.setSitePhpRunning(site, false, log);
    sites.setSiteIsolation(site.id, { sysUser: site.sysUser, phpExecAllowed: allowed, error: null });
  }
  return isolationView(siteId);
}

// Bell: sites still on the shared user because their conversion failed (gone once isolated).
registerNotificationSource('isolation', () =>
  sites.isolationFailures().map((f) => ({
    id: `isolation:${f.id}:${f.at}`,
    kind: 'isolation',
    tone: 'warn' as const,
    title: t('{domain} chưa được cách ly', { domain: f.domain }),
    body: t('Lần chuyển sang user riêng thất bại, site đã được đưa về như cũ: {error}', { error: f.error }),
    // older rows fall back to the site's created_at, which SQLite writes as "YYYY-MM-DD HH:MM:SS" (UTC)
    createdAt: f.at.includes('T') ? f.at : `${f.at.replace(' ', 'T')}Z`,
    actions: [{ label: t('Mở site'), href: `/sites/${f.id}` }],
    dismissible: false,
  })),
);
