import os from 'node:os';
import type { Site, SiteLimits, SiteLimitsView } from '@lares/shared';
import { t } from '../i18n/index.js';
import { conflict, errorMessage } from '../lib/errors.js';
import * as databases from './databases.js';
import type { HostLogger } from './host.js';
import * as isolation from './isolation.js';
import * as mysql from './mysql.js';
import * as nodeapp from './nodeapp.js';
import * as sites from './sites.js';

/*
 * Per-site resource limits (issue #1): RAM and CPU are cgroup limits of the site's own systemd unit
 * (PHP-FPM, or the Next.js service), PHP workers its pm.max_children, MySQL connections the
 * MAX_USER_CONNECTIONS of the database users Lares created for it. Rendering: isolationPolicy.ts.
 */

const ownProcess = (site: Site) => site.sysUser !== null && (sites.usesPhp(site.appType) || site.appType === 'nextjs');

/** The unit holding the site's processes (null = none of its own). */
function serviceOf(site: Site): string | null {
  if (!site.sysUser) return null;
  if (sites.usesPhp(site.appType)) return isolation.phpPathsFor(site.id).unit;
  if (site.appType === 'nextjs') return nodeapp.serviceName(site.domain);
  return null;
}

/** MySQL users Lares created for the site (a database shared with another panel is left alone). */
const mysqlUsers = (siteId: number) => [...new Set(databases.databasesForSite(siteId).filter((d) => d.managed).map((d) => d.username))];

export async function limitsView(siteId: number): Promise<SiteLimitsView> {
  const site = sites.getSite(siteId);
  const service = serviceOf(site);
  const users = mysqlUsers(site.id);
  const [stats, conns] = await Promise.all([
    service ? isolation.unitStats(service) : Promise.resolve({ memoryBytes: null, tasks: null }),
    mysql.userConnections(users).catch(() => null),
  ]);
  return {
    limits: site.limits,
    applies: { process: ownProcess(site), phpWorkers: site.sysUser !== null && sites.usesPhp(site.appType), mysql: users.length > 0 },
    service,
    defaultPhpWorkers: isolation.defaultPhpWorkers(),
    usage: { ...stats, mysqlConnections: conns },
    server: { cpuCount: os.cpus().length, memoryMb: Math.round(os.totalmem() / 1048576) },
  };
}

/**
 * Save and apply. The unit is rewritten and restarted (a few seconds without PHP for the site);
 * a failure puts the previous limits back. Limits that do not apply to the site must stay empty.
 */
export async function setLimits(siteId: number, next: SiteLimits, log?: HostLogger): Promise<SiteLimitsView> {
  const site = sites.getSite(siteId);
  const users = mysqlUsers(site.id);
  if (!ownProcess(site) && (next.memoryMb !== null || next.cpuPercent !== null)) {
    throw conflict(t('Giới hạn RAM/CPU cần site có user và tiến trình riêng (site PHP hoặc Next.js đã cách ly)'));
  }
  if (next.phpWorkers !== null && !(site.sysUser && sites.usesPhp(site.appType))) throw conflict(t('Số worker PHP chỉ áp dụng cho site PHP đã cách ly'));
  if (next.mysqlConnections !== null && !users.length) throw conflict(t('Site không có database do Lares tạo'));

  const prev = site.limits;
  const apply = async (limits: SiteLimits) => {
    const s = { ...site, limits };
    if (site.sysUser && sites.usesPhp(site.appType)) {
      await isolation.applySitePhp(s, log);
      if (site.status === 'disabled') await isolation.setSitePhpRunning(s, false, log);
    } else if (site.sysUser && site.appType === 'nextjs' && site.appPort) {
      await nodeapp.writeServiceFiles({ ...s, appPort: site.appPort }, sites.getNodeConfig(site.id), log ?? (() => {}));
      if (site.status === 'active') await nodeapp.serviceAction(site.domain, 'restart', log);
    }
    if (limits.mysqlConnections !== prev.mysqlConnections || limits === prev) {
      for (const u of users) await mysql.setMaxUserConnections(u, limits.mysqlConnections ?? 0, log);
    }
  };

  try {
    await apply(next);
  } catch (err) {
    await apply(prev).catch((e) => log?.(t('Cảnh báo: không khôi phục được giới hạn cũ: {error}', { error: errorMessage(e) })));
    throw err;
  }
  sites.setSiteLimits(site.id, next);
  return limitsView(site.id);
}
