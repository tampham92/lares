/**
 * Pure rules of the PHP security updates (no I/O, unit-tested): which packages are PHP's, how apt's
 * output is read, the commands that refresh and upgrade them, php.net's support dates and when the
 * nightly automatic update may run.
 *
 * Why the panel does this itself: PHP comes from the ondrej PPA (Ubuntu) or packages.sury.org
 * (Debian). The OS's unattended-upgrades only installs fixes from the distribution's own security
 * pocket, so without this a PHP security release never reaches the server unless someone runs apt.
 */
import type { PhpBranchUpdates, PhpPackageUpdate, PhpSupport } from '@lares/shared';
import { shq } from '../lib/shell.js';

/**
 * End of security support of each branch on php.net (https://www.php.net/supported-versions.php).
 * Since 2024 a branch gets 4 years and ends on 31 December. A branch newer than the table is
 * treated as supported; an older unknown one as unknown.
 */
export const PHP_EOL: Record<string, string> = {
  '5.6': '2018-12-31',
  '7.0': '2019-01-10',
  '7.1': '2019-12-01',
  '7.2': '2020-11-30',
  '7.3': '2021-12-06',
  '7.4': '2022-11-28',
  '8.0': '2023-11-26',
  '8.1': '2025-12-31',
  '8.2': '2026-12-31',
  '8.3': '2027-12-31',
  '8.4': '2028-12-31',
  '8.5': '2029-12-31',
};

/** Support ending within this many days shows as 'ending' (time to plan moving the sites). */
const ENDING_DAYS = 180;
const DAY = 86_400_000;

export function phpSupport(branch: string, now = Date.now()): { support: PhpSupport; eolDate: string | null } {
  const eolDate = PHP_EOL[branch] ?? null;
  if (!eolDate) {
    const newest = Object.keys(PHP_EOL).sort((a, b) => Number(a) - Number(b)).at(-1)!;
    return { support: Number(branch) > Number(newest) ? 'supported' : 'unknown', eolDate: null };
  }
  // support lasts through that whole day (UTC)
  const end = Date.parse(`${eolDate}T23:59:59Z`);
  if (now > end) return { support: 'eol', eolDate };
  return { support: end - now <= ENDING_DAYS * DAY ? 'ending' : 'supported', eolDate };
}

/**
 * Debian package names of PHP: php8.3-fpm, php8.3, php-common, php-imagick, php-pear... Only these are
 * ever passed to apt, and they are also validated as safe shell words (quoted on top of that).
 */
export const PHP_PKG_RE = /^php-?[a-z0-9][a-z0-9.+-]{0,60}$/;

/** Branch a package belongs to ("php8.3-fpm" → "8.3"), null for php-common and friends. */
export function branchOf(pkg: string): string | null {
  return /^php(\d\.\d)(?:-|$)/.exec(pkg)?.[1] ?? null;
}

/**
 * Upstream part of a Debian version: "8.3.14-1+ubuntu24.04.1+deb.sury.org+1" → "8.3.14",
 * "2:93+ubuntu24.04.1+deb.sury.org+1" → "93". The epoch and the packaging revision are dropped.
 */
export function upstreamOf(version: string): string {
  const noEpoch = version.replace(/^\d+:/, '');
  const m = /^(\d+(?:\.\d+)*)/.exec(noEpoch);
  return m ? m[1]! : noEpoch.split('-')[0]!;
}

/** `dpkg-query -W -f='${db:Status-Abbrev}\t${Package}\t${Version}\n' 'php*'`: installed PHP packages. */
export const INSTALLED_QUERY = `dpkg-query -W -f='\${db:Status-Abbrev}\\t\${Package}\\t\${Version}\\n' 'php*' 2>/dev/null`;

export function parseInstalled(out: string): Map<string, string> {
  const pkgs = new Map<string, string>();
  for (const line of out.split('\n')) {
    const [status, name, version] = line.split('\t');
    // "ii " = installed; "rc " (removed, config files left) and half-installed states are skipped
    if (!status?.startsWith('ii') || !name || !version || !PHP_PKG_RE.test(name)) continue;
    pkgs.set(name, version.trim());
  }
  return pkgs;
}

/** Lists, upgrades and dpkg itself wait for an unattended-upgrades run instead of failing at once. */
const APT = 'apt-get -q -o DPkg::Lock::Timeout=300';

/** Refreshes the package lists (every repository: apt cannot refresh one source on its own reliably). */
export const REFRESH_COMMAND = `DEBIAN_FRONTEND=noninteractive ${APT} update`;

function pkgArgs(pkgs: readonly string[]): string {
  const bad = pkgs.find((p) => !PHP_PKG_RE.test(p));
  if (bad !== undefined) throw new Error(`invalid package name: ${JSON.stringify(bad)}`);
  return pkgs.map(shq).join(' ');
}

/**
 * Dry run of the upgrade (`-s`, no lock taken): prints one `Inst` line per package it would install,
 * dependencies pulled in by the new versions included. `--only-upgrade` never installs a package that
 * is not there yet among the ones named.
 */
export function simulateCommand(pkgs: readonly string[]): string {
  return `LANG=C apt-get -s -q -o Debug::NoLocking=1 --only-upgrade install ${pkgArgs(pkgs)}`;
}

/**
 * The upgrade. Changed config files (php.ini, pool.d) keep the server's version (confold), never a
 * prompt. needrestart is suspended: it could restart lares.service in the middle of the task; the
 * PHP-FPM services are restarted by the panel afterwards instead.
 */
export function upgradeCommand(pkgs: readonly string[]): string {
  if (!pkgs.length) throw new Error('no packages to upgrade');
  return `DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 ${APT} -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --only-upgrade install ${pkgArgs(pkgs)}`;
}

/** `Inst php8.3-fpm [8.3.12-1+...] (8.3.14-1+... ondrej:24.04/noble [amd64])`; no [..] = new package. */
const INST_RE = /^Inst (\S+) (?:\[([^\]]+)\] )?\((\S+)/;

export function parseSimulation(out: string): PhpPackageUpdate[] {
  const updates: PhpPackageUpdate[] = [];
  for (const line of out.split('\n')) {
    const m = INST_RE.exec(line.trim());
    // "libfoo:amd64" on multi-arch systems
    if (m) updates.push({ name: m[1]!.replace(/:[a-z0-9]+$/, ''), from: m[2] ?? null, to: m[3]! });
  }
  return updates;
}

/**
 * Pending updates per installed branch, plus the rest (php-common, libraries of the same repository).
 * `installed` = the dpkg versions; `branches` = branches with an FPM (what sites can use).
 */
export function groupUpdates(
  branches: readonly string[],
  installed: ReadonlyMap<string, string>,
  pending: readonly PhpPackageUpdate[],
  siteCounts: ReadonlyMap<string, number>,
  now = Date.now(),
): { branches: PhpBranchUpdates[]; others: PhpPackageUpdate[] } {
  const known = new Set(branches);
  const others: PhpPackageUpdate[] = [];
  const byBranch = new Map<string, PhpPackageUpdate[]>();
  for (const p of pending) {
    const b = branchOf(p.name);
    if (b && known.has(b)) byBranch.set(b, [...(byBranch.get(b) ?? []), p]);
    else others.push(p);
  }
  const list = [...branches]
    .sort((a, b) => Number(b) - Number(a))
    .map((branch): PhpBranchUpdates => {
      const packages = byBranch.get(branch) ?? [];
      const fpm = installed.get(`php${branch}-fpm`);
      // the FPM package tells the version sites run; fall back on any package of the branch
      const target = packages.find((p) => p.name === `php${branch}-fpm`) ?? packages.find((p) => p.name === `php${branch}-common`) ?? packages[0];
      return {
        branch,
        installed: fpm ? upstreamOf(fpm) : null,
        available: target ? upstreamOf(target.to) : null,
        packages,
        ...phpSupport(branch, now),
        sites: siteCounts.get(branch) ?? 0,
      };
    });
  return { branches: list, others };
}

/** Names the upgrade is asked for: the PHP packages with a newer version (dependencies follow). */
export function packagesToUpgrade(pending: readonly PhpPackageUpdate[], onlyBranches?: readonly string[]): string[] {
  const only = onlyBranches?.length ? new Set(onlyBranches) : null;
  return pending
    .filter((p) => p.from !== null && PHP_PKG_RE.test(p.name))
    .filter((p) => {
      if (!only) return true;
      const b = branchOf(p.name);
      // php-common and the like are shared by every branch: upgraded with any of them
      return b === null || only.has(b);
    })
    .map((p) => p.name);
}

/**
 * PHP-FPM branches to restart after upgrading `pkgs`: the branches of those packages, or every
 * installed branch when the dry run also changes a library (libpcre2, libgd...) that any of them may
 * load. php-common and the like hold no code a running master uses.
 */
export function branchesToRestart(pkgs: readonly string[], pending: readonly PhpPackageUpdate[], installed: readonly string[]): string[] {
  if (pending.some((p) => !PHP_PKG_RE.test(p.name))) return [...installed];
  const touched = new Set(pkgs.map(branchOf));
  return installed.filter((b) => touched.has(b));
}

// ---- Nightly automatic update --------------------------------------------------------------

/** Local hours (server time) in which the automatic update may restart PHP-FPM: [start, end). */
export const AUTO_WINDOW = { start: 2, end: 6 } as const;
/** A check older than this is redone before the automatic update decides anything. */
export const CHECK_MAX_AGE_MS = 20 * 3_600_000;
/** Before an automatic update the lists are refreshed again when older than this. */
export const FRESH_BEFORE_AUTO_MS = 6 * 3_600_000;

export const isOlderThan = (iso: string | null | undefined, ms: number, now: number) => !iso || Number.isNaN(Date.parse(iso)) || now - Date.parse(iso) > ms;

/**
 * Whether the nightly automatic update should run now: turned on, something to install, inside the
 * night window, and no automatic attempt in the last 20 hours (a failure is not retried every hour).
 */
export function autoUpdateDue(o: { autoUpdate: boolean; pending: number; lastAutoAt: string | null; now: Date }): boolean {
  if (!o.autoUpdate || o.pending === 0) return false;
  const hour = o.now.getHours();
  if (hour < AUTO_WINDOW.start || hour >= AUTO_WINDOW.end) return false;
  return isOlderThan(o.lastAutoAt, CHECK_MAX_AGE_MS, o.now.getTime());
}
