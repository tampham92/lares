import fs from 'node:fs/promises';
import path from 'node:path';
import type { Site } from '@lares/shared';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { adminerPaths, adminerPort } from './adminer.js';
import { host, type HostLogger } from './host.js';
import {
  DEFAULT_PHP_MAX_CHILDREN,
  FIREWALL_TABLE,
  FIREWALL_UNIT,
  SITE_USER_RE,
  editDenyList,
  fpmBinary,
  parseUnitStats,
  resourceLines,
  permissionCommands,
  renderFirewallUnit,
  renderSiteFirewall,
  renderSitePhpUnit,
  renderSitePool,
  sandboxLines,
  siteUserName,
  sitePhpPaths,
  type SandboxOptions,
} from './isolationPolicy.js';
import { phpSocket } from './php.js';

/** System side of per-site isolation: users, the per-site PHP-FPM units, the firewall. Rules: isolationPolicy.ts. */

/** Who runs a site's code, and its HOME. Legacy sites (no own user yet) run as the shared web user. */
export interface RunAs {
  user: string;
  home: string;
}

type SiteIdentity = Pick<Site, 'sysUser' | 'rootPath'>;

export const siteOwner = (site: Pick<Site, 'sysUser'>): string => site.sysUser ?? config.webUser;
export const runAsOf = (site: SiteIdentity): RunAs => ({ user: siteOwner(site), home: site.rootPath });

export const phpPathsFor = (siteId: number) => sitePhpPaths(siteId, { systemdDir: config.systemdDir, poolDir: config.phpPoolDir });

/** The FastCGI socket nginx sends a PHP site to: its own master, or the shared pool of its PHP version. */
export function phpSocketFor(site: Pick<Site, 'id' | 'sysUser' | 'phpVersion'>): string {
  return site.sysUser ? phpPathsFor(site.id).socket : phpSocket(site.phpVersion ?? config.defaultPhp);
}

/** systemd service to reload so PHP picks up a change (new .user.ini values, restored files). */
export function phpServiceFor(site: Pick<Site, 'id' | 'sysUser' | 'phpVersion'>): string {
  return site.sysUser ? phpPathsFor(site.id).unit : `php${site.phpVersion ?? config.defaultPhp}-fpm`;
}

/** `runuser` wrapper for short root-started commands that must run with the site's rights. */
export const asUser = (user: string, command: string) => `runuser -u ${shq(user)} -- sh -c ${shq(command)}`;

/** chown + modes of a site folder for its owner (see permissionCommands). */
export function fixPermissions(site: SiteIdentity, log?: HostLogger) {
  const owner = siteOwner(site);
  return host.mutate(permissionCommands(site.rootPath, owner, site.sysUser !== null, (c) => asUser(owner, c)).join(' && '), { log, timeoutMs: 30 * 60_000 });
}

// ---- Users -----------------------------------------------------------------------------

/** Lists that must never contain a site user (cron jobs and `at` would survive cleaning the site). */
const DENY_LISTS = ['/etc/cron.deny', '/etc/at.deny'];

async function setDenied(user: string, denied: boolean) {
  for (const file of DENY_LISTS) {
    const current = await fs.readFile(file, 'utf8').catch(() => null);
    const next = editDenyList(current, user, denied);
    if (next !== null) await host.writeFile(file, next, 0o644);
  }
}

/**
 * Create the site's Linux user (idempotent): system account, no password, no shell, HOME = the site
 * folder. nginx's user joins the site's group to read static files; nginx must be reloaded after
 * this (its workers pick up supplementary groups when they start), which applying the vhost does.
 */
export async function ensureSiteUser(siteId: number, rootPath: string, log?: HostLogger): Promise<string> {
  const user = siteUserName(siteId);
  if (config.dryRun) {
    log?.(`[dry-run] useradd ${user} (home ${rootPath}); usermod -aG ${user} ${config.webUser}`);
    return user;
  }
  if ((await host.exec(`id -u ${shq(user)}`)).code !== 0) {
    await host.run(`useradd --system --user-group --no-create-home --home-dir ${shq(rootPath)} --shell /usr/sbin/nologin ${shq(user)}`);
    log?.(t('Đã tạo user hệ thống {user} cho site', { user }));
  } else {
    await host.run(`usermod --home ${shq(rootPath)} ${shq(user)}`);
  }
  await host.run(`usermod -a -G ${shq(user)} ${shq(config.webUser)}`);
  await setDenied(user, true);
  // listing /var/www would tell a site the other sites' domains; nginx only needs to traverse it
  await host.run(`chmod 711 ${shq(config.sitesRoot)}`).catch(() => undefined);
  return user;
}

/** Remove a site user: its last processes, the account and its group, the deny-list lines. */
export async function removeSiteUser(user: string, log?: HostLogger) {
  if (!SITE_USER_RE.test(user)) throw new Error(`refusing to remove ${user}: not a site user`);
  if (config.dryRun) {
    log?.(`[dry-run] userdel ${user}`);
    return;
  }
  if ((await host.exec(`id -u ${shq(user)}`)).code === 0) {
    await host.exec(`pkill -KILL -u ${shq(user)}`);
    const r = await host.exec(`userdel ${shq(user)}`);
    if (r.code !== 0) log?.(t('Cảnh báo: không xoá được user {user}: {error}', { user, error: r.stderr.trim() }));
  }
  // userdel keeps the group when another user (nginx's) is still listed in it
  if ((await host.exec(`getent group ${shq(user)}`)).code === 0) await host.exec(`groupdel ${shq(user)}`);
  await setDenied(user, false);
}

// ---- Sandbox inputs --------------------------------------------------------------------

/** A local MTA's sendmail runs a setgid/setuid helper and writes its spool (see SandboxOptions.mta). */
async function detectMta(): Promise<SandboxOptions['mta']> {
  if (await host.exists('/usr/sbin/postdrop')) return { spool: ['/var/spool/postfix/maildrop'] };
  if (await host.exists('/usr/sbin/exim4')) return { spool: ['/var/spool/exim4', '/var/log/exim4'] };
  return null;
}

/** Everything of Lares a site never needs to see. All are root-only already; this is the second lock. */
function hiddenPaths(): string[] {
  return [
    config.dataDir,
    config.sslDir,
    config.envFile,
    adminerPaths().dir,
    path.resolve(process.env.LARES_BACKUP_DIR || '/var/backups/lares'),
    ...(config.tlsKey ? [config.tlsKey] : []),
  ];
}

export async function sandboxFor(site: Pick<Site, 'rootPath'>): Promise<Omit<SandboxOptions, 'noExecSite'>> {
  return { rootPath: site.rootPath, sitesRoot: config.sitesRoot, hidden: hiddenPaths(), mta: await detectMta() };
}

/** systemd lines for a Node app's unit: its limits, then the sandbox (no NoExec on the site: `next start` runs node_modules/.bin). */
export async function nodeSandboxLines(site: Pick<Site, 'rootPath' | 'limits'>): Promise<string[]> {
  return [...resourceLines(site.limits), ...sandboxLines({ ...(await sandboxFor(site)), noExecSite: false })];
}

/** Current RAM and task count of a unit (null = unknown, dry-run, or not running). */
export async function unitStats(unit: string): Promise<{ memoryBytes: number | null; tasks: number | null }> {
  if (config.dryRun) return { memoryBytes: null, tasks: null };
  const r = await host.exec(`systemctl show ${shq(unit)} -p MemoryCurrent -p TasksCurrent`);
  return parseUnitStats(r.stdout);
}

// ---- Per-site PHP-FPM ------------------------------------------------------------------

type PhpSite = Pick<Site, 'id' | 'domain' | 'rootPath' | 'phpVersion' | 'sysUser' | 'phpExecAllowed' | 'limits'>;

const daemonReload = (log?: HostLogger) => host.mutate('systemctl daemon-reload', { log });

/** pm.max_children of a site that sets no limit (LARES_SITE_PHP_MAX_CHILDREN, else 8). */
export const defaultPhpWorkers = () => config.sitePhpMaxChildren || DEFAULT_PHP_MAX_CHILDREN;

/**
 * Write the site's php-fpm.conf and unit, check them with php-fpm -t (as the site user, like the
 * real master), then (re)start it. A rejected config is put back as it was and the error thrown.
 */
export async function applySitePhp(site: PhpSite, log?: HostLogger): Promise<void> {
  if (!site.sysUser) throw new Error(`site ${site.id} has no own user`);
  const version = site.phpVersion ?? config.defaultPhp;
  const p = phpPathsFor(site.id);
  const pool = renderSitePool({ siteId: site.id, domain: site.domain, paths: p, maxChildren: site.limits.phpWorkers ?? defaultPhpWorkers(), execAllowed: site.phpExecAllowed });
  const unit = renderSitePhpUnit({ siteId: site.id, domain: site.domain, phpVersion: version, user: site.sysUser, paths: p, sandbox: await sandboxFor(site), tasksMax: 256, limits: site.limits });

  const [prevPool, prevUnit] = await Promise.all([fs.readFile(p.conf, 'utf8').catch(() => null), fs.readFile(p.unitFile, 'utf8').catch(() => null)]);
  if (!config.dryRun && !(await host.exists(fpmBinary(version)))) throw new Error(t('Chưa cài PHP-FPM {version} ({bin})', { version, bin: fpmBinary(version) }));
  await host.writeFile(p.conf, pool, 0o644);
  await host.writeFile(p.unitFile, unit, 0o644);
  const restore = async () => {
    if (prevPool === null) await fs.rm(p.conf, { force: true });
    else await host.writeFile(p.conf, prevPool, 0o644);
    if (prevUnit === null) await fs.rm(p.unitFile, { force: true });
    else await host.writeFile(p.unitFile, prevUnit, 0o644);
    await daemonReload(log).catch(() => undefined);
  };
  try {
    if (!config.dryRun) {
      const test = await host.exec(asUser(site.sysUser, `${fpmBinary(version)} -t --fpm-config ${shq(p.conf)}`));
      if (test.code !== 0) throw new Error(t('PHP-FPM từ chối cấu hình của site: {error}', { error: (test.stderr || test.stdout).trim().split('\n').slice(-3).join(' ') }));
    }
    await daemonReload(log);
    await host.mutate(`systemctl enable ${shq(p.unit)} && systemctl restart ${shq(p.unit)}`, { log, timeoutMs: 60_000 });
  } catch (err) {
    await restore();
    if (prevUnit !== null) await host.mutate(`systemctl restart ${shq(p.unit)}`, { log }).catch(() => undefined);
    throw err;
  }
}

/** Graceful reload (new workers, same master): picks up .user.ini changes at once. */
export const reloadSitePhp = (site: Pick<Site, 'id' | 'sysUser' | 'phpVersion'>, log?: HostLogger) =>
  host.mutate(`systemctl reload ${shq(phpServiceFor(site))}`, { log });

/**
 * After the site folder itself was swapped for another one (backup restore): the sandbox bind-mounts
 * the folder when the master starts, so an isolated site needs a restart to see the new folder. The
 * shared pool of older sites only needs a reload.
 */
export const restartSitePhp = (site: Pick<Site, 'id' | 'sysUser' | 'phpVersion'>, log?: HostLogger) =>
  host.mutate(`systemctl ${site.sysUser ? 'restart' : 'reload'} ${shq(phpServiceFor(site))}`, { log });

/** A disabled site needs no PHP workers; its master is stopped (and started again when enabled). */
export async function setSitePhpRunning(site: Pick<Site, 'id' | 'sysUser'>, running: boolean, log?: HostLogger) {
  if (!site.sysUser) return;
  const unit = phpPathsFor(site.id).unit;
  await host.mutate(running ? `systemctl enable --now ${shq(unit)}` : `systemctl disable --now ${shq(unit)}`, { log });
}

export async function removeSitePhp(siteId: number, log?: HostLogger) {
  const p = phpPathsFor(siteId);
  await host.mutate(`systemctl disable --now ${shq(p.unit)} 2>/dev/null || true`, { log });
  await Promise.all([fs.rm(p.unitFile, { force: true }), fs.rm(p.conf, { force: true })]);
  await daemonReload(log).catch(() => undefined);
  // sessions (StateDirectory=); systemd leaves it behind on purpose
  if (!config.dryRun) await fs.rm(`/var/lib/${p.runtimeName}`, { recursive: true, force: true });
}

/** Is the site's own PHP-FPM running? null = not applicable / unknown (dry-run). */
export async function sitePhpActive(site: Pick<Site, 'id' | 'sysUser'>): Promise<boolean | null> {
  if (!site.sysUser || config.dryRun) return null;
  return (await host.exec(`systemctl is-active --quiet ${shq(phpPathsFor(site.id).unit)}`)).code === 0;
}

// ---- Outbound firewall ----------------------------------------------------------------

/** uid of every site user on the machine (getent: also users of sites Lares no longer lists). */
async function siteUids(): Promise<number[]> {
  const r = await host.exec('getent passwd');
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.split(':'))
    .filter((f) => SITE_USER_RE.test(f[0] ?? ''))
    .map((f) => Number(f[2]))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

let firewallQueue: Promise<void> = Promise.resolve();

/**
 * Rewrite and load the nftables rules for every site user. Never throws: a server without nftables
 * (some container VPS) keeps working, only without these rules, and the log says so.
 */
export function syncSiteFirewall(log?: HostLogger): Promise<void> {
  firewallQueue = firewallQueue.then(() => doSyncFirewall(log)).catch((err) => log?.(t('Cảnh báo: không cập nhật được tường lửa của site: {error}', { error: errorMessage(err) })));
  return firewallQueue;
}

async function doSyncFirewall(log?: HostLogger) {
  const rules = renderSiteFirewall({ uids: config.dryRun ? [] : await siteUids(), localPorts: [config.port, adminerPort()] });
  await host.writeFile(config.siteFirewallFile, rules, 0o644);
  if (config.dryRun) {
    log?.(`[dry-run] nft -f ${config.siteFirewallFile}`);
    return;
  }
  const nft = (await host.exec('command -v nft')).stdout.trim();
  if (!nft) {
    log?.(t('Cảnh báo: máy chủ chưa có nftables (apt install nftables) nên chưa chặn được kết nối ra ngoài của các site'));
    return;
  }
  const unitFile = path.join(config.systemdDir, `${FIREWALL_UNIT}.service`);
  const unit = renderFirewallUnit(nft, config.siteFirewallFile);
  if ((await fs.readFile(unitFile, 'utf8').catch(() => null)) !== unit) {
    await host.writeFile(unitFile, unit, 0o644);
    await host.run(`systemctl daemon-reload && systemctl enable ${shq(FIREWALL_UNIT)}`);
  }
  await host.run(`${shq(nft)} -f ${shq(config.siteFirewallFile)}`);
  // started for the boot ordering of the PHP units (RemainAfterExit); the rules are already loaded
  await host.exec(`systemctl start ${shq(FIREWALL_UNIT)}`);
}

/** For the diagnostics: is the table loaded? */
export async function siteFirewallLoaded(): Promise<boolean | null> {
  if (config.dryRun) return null;
  return (await host.exec(`nft list table inet ${FIREWALL_TABLE} >/dev/null 2>&1`)).code === 0;
}
