/**
 * PHP security updates (Settings > Updates): patch releases of the installed PHP branches from the
 * ondrej / sury repository, which the OS's unattended-upgrades never installs (phpUpdatePolicy.ts).
 *
 * The check refreshes the apt lists and keeps apt's own dry run of the upgrade in SQLite, so the
 * page and the bell never wait for apt. The upgrade runs as a task: apt (old config files kept), then
 * a restart of every PHP-FPM master of the touched branches - the shared php<v>-fpm and the isolated
 * sites' own units, which would otherwise keep running the old, replaced binary.
 */
import { msg, type PhpPackageUpdate, type PhpUpdateRun, type PhpUpdatesView } from '@lares/shared';
import { config } from '../config.js';
import { getSetting, nowIso, setSetting } from '../db/index.js';
import { t, tDefault } from '../i18n/index.js';
import { conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';
import { phpPathsFor } from './isolation.js';
import { notify, registerNotificationSource } from './notifications.js';
import { installedPhpVersions } from './php.js';
import {
  autoUpdateDue,
  branchOf,
  branchesToRestart,
  CHECK_MAX_AGE_MS,
  FRESH_BEFORE_AUTO_MS,
  groupUpdates,
  INSTALLED_QUERY,
  isOlderThan,
  packagesToUpgrade,
  parseInstalled,
  parseSimulation,
  PHP_PKG_RE,
  REFRESH_COMMAND,
  simulateCommand,
  upgradeCommand,
} from './phpUpdatePolicy.js';
import { listSites } from './sites.js';
import { startTask, type TaskInfo } from './tasks.js';

interface CheckState {
  checkedAt: string | null;
  error: string | null;
  /** apt's dry run of the upgrade at the last check. */
  pending: PhpPackageUpdate[];
}

const STATE = 'php.updates';
const AUTO = 'php.autoUpdate';
const LAST_RUN = 'php.lastRun';
const LAST_AUTO = 'php.lastAutoAt';

const checkState = () => getSetting<CheckState>(STATE, { checkedAt: null, error: null, pending: [] });
const autoUpdateOn = () => getSetting<boolean>(AUTO, false);

/** Check or upgrade in progress: apt takes one at a time anyway, and the UI shows the running task. */
let busy: { kind: 'check' } | { kind: 'upgrade'; taskId: string | null } | null = null;

const shortError = (err: unknown) => errorMessage(err).trim().split('\n').slice(-4).join(' ').slice(0, 400);

// ---- dry-run (laptop): a made-up server with a few pending updates, gone after one "upgrade" ----

let dryRunUpgraded = false;
const DRY_INSTALLED: Record<string, string> = {
  'php8.3-fpm': '8.3.12-1+ubuntu24.04.1+deb.sury.org+1',
  'php8.3-cli': '8.3.12-1+ubuntu24.04.1+deb.sury.org+1',
  'php8.3-common': '8.3.12-1+ubuntu24.04.1+deb.sury.org+1',
  'php8.2-fpm': '8.2.29-1+ubuntu24.04.1+deb.sury.org+1',
  'php8.1-fpm': '8.1.33-1+ubuntu24.04.1+deb.sury.org+1',
  'php7.4-fpm': '7.4.33-20+ubuntu24.04.1+deb.sury.org+1',
  'php-common': '2:93+ubuntu24.04.1+deb.sury.org+2',
};
const DRY_PENDING: PhpPackageUpdate[] = [
  { name: 'php8.3-fpm', from: DRY_INSTALLED['php8.3-fpm']!, to: '8.3.14-1+ubuntu24.04.1+deb.sury.org+1' },
  { name: 'php8.3-cli', from: DRY_INSTALLED['php8.3-cli']!, to: '8.3.14-1+ubuntu24.04.1+deb.sury.org+1' },
  { name: 'php8.3-common', from: DRY_INSTALLED['php8.3-common']!, to: '8.3.14-1+ubuntu24.04.1+deb.sury.org+1' },
  { name: 'php7.4-fpm', from: DRY_INSTALLED['php7.4-fpm']!, to: '7.4.33-21+ubuntu24.04.1+deb.sury.org+1' },
  { name: 'php-common', from: DRY_INSTALLED['php-common']!, to: '2:94+ubuntu24.04.1+deb.sury.org+1' },
];

async function installedPackages(): Promise<Map<string, string>> {
  if (config.dryRun) return new Map(Object.entries(DRY_INSTALLED));
  return parseInstalled((await host.exec(INSTALLED_QUERY)).stdout);
}

/** apt's dry run of upgrading every installed PHP package (no lock taken, nothing changed). */
async function simulate(installed: Map<string, string>): Promise<PhpPackageUpdate[]> {
  if (config.dryRun) return dryRunUpgraded ? [] : DRY_PENDING;
  if (!installed.size) return [];
  return parseSimulation(await host.run(simulateCommand([...installed.keys()]), { timeoutMs: 120_000 }));
}

/** Sites per PHP branch (every PHP site has its version set; Node and static sites have none). */
function siteCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of listSites()) if (s.phpVersion) counts.set(s.phpVersion, (counts.get(s.phpVersion) ?? 0) + 1);
  return counts;
}

export async function getPhpUpdates(): Promise<PhpUpdatesView> {
  const s = checkState();
  const [branches, installed] = await Promise.all([installedPhpVersions(), installedPackages()]);
  // a package upgraded by hand since the check is no longer pending (nor what came with it)
  const still = s.pending.filter((p) => p.from === null || !PHP_PKG_RE.test(p.name) || installed.get(p.name) === p.from);
  const pending = packagesToUpgrade(still).length ? still : [];
  const grouped = groupUpdates(branches, installed, pending, siteCounts());
  return {
    ...grouped,
    checkedAt: s.checkedAt,
    error: s.error,
    autoUpdate: autoUpdateOn(),
    lastRun: getSetting<PhpUpdateRun | null>(LAST_RUN, null),
    running: busy?.kind === 'upgrade' ? busy.taskId : null,
  };
}

export function setPhpAutoUpdate(enabled: boolean): Promise<PhpUpdatesView> {
  setSetting(AUTO, enabled);
  return getPhpUpdates();
}

/** Refresh the apt lists, then keep apt's dry run. A failed refresh still reads what apt knows. */
async function refresh(log?: HostLogger): Promise<void> {
  let error: string | null = null;
  try {
    await host.mutate(REFRESH_COMMAND, { log, timeoutMs: 10 * 60_000 });
  } catch (err) {
    // usually one broken third-party repository: the PHP one may still have been refreshed.
    // Stored and shown to every viewer: in the panel's language.
    error = tDefault('Không làm mới được danh sách gói (apt-get update): {error}', { error: shortError(err) });
  }
  try {
    const pending = await simulate(await installedPackages());
    setSetting(STATE, { checkedAt: nowIso(), error, pending } satisfies CheckState);
  } catch (err) {
    // keep the previous answer; the time still moves on so the hourly job does not retry at once
    setSetting(STATE, { ...checkState(), checkedAt: nowIso(), error: error ?? shortError(err) } satisfies CheckState);
  }
}

/** "Check now". */
export async function checkPhpUpdates(): Promise<PhpUpdatesView> {
  if (busy) throw conflict(t('Đang kiểm tra hoặc cập nhật PHP, hãy đợi lần này xong.'));
  busy = { kind: 'check' };
  try {
    await refresh();
  } finally {
    busy = null;
  }
  return getPhpUpdates();
}

/**
 * Upgrade the pending PHP packages (of `branches` only, when given) as a task. The package names are
 * the ones apt's last dry run listed, never taken from the request.
 */
export function startPhpUpgrade(opts: { branches?: string[]; auto?: boolean } = {}): TaskInfo {
  if (busy) throw conflict(t('Đang kiểm tra hoặc cập nhật PHP, hãy đợi lần này xong.'));
  const pending = checkState().pending;
  const pkgs = packagesToUpgrade(pending, opts.branches);
  if (!pkgs.length) throw conflict(t('Không có bản cập nhật PHP nào để cài. Hãy bấm "Kiểm tra ngay" rồi thử lại.'));
  const run: { kind: 'upgrade'; taskId: string | null } = { kind: 'upgrade', taskId: null };
  busy = run;
  const task = startTask(t('Cập nhật PHP'), (log) =>
    runUpgrade(pkgs, pending, !!opts.auto, log).finally(() => {
      busy = null;
    }),
  );
  run.taskId = task.id;
  return task;
}

async function runUpgrade(pkgs: string[], pending: PhpPackageUpdate[], auto: boolean, log: HostLogger): Promise<PhpUpdatesView> {
  const installedBranches = await installedPhpVersions();
  const restart = branchesToRestart(pkgs, pending, installedBranches);
  const touched = [...new Set(pkgs.map(branchOf).filter((b): b is string => !!b))].sort();
  if (auto) setSetting(LAST_AUTO, nowIso());
  const record = (error: string | null) =>
    setSetting(LAST_RUN, { at: nowIso(), ok: !error, auto, branches: touched, error } satisfies PhpUpdateRun);
  try {
    log(t('Cài bản vá cho các gói: {packages}', { packages: pkgs.join(' ') }));
    let partial = '';
    await host.mutate(upgradeCommand(pkgs), {
      log,
      timeoutMs: 30 * 60_000,
      onOutput: (chunk) => {
        const lines = (partial + chunk).split('\n');
        partial = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) log(l.trimEnd());
      },
    });
    if (config.dryRun) dryRunUpgraded = true;
    await restartPhp(restart, log);
    record(null);
    log(t('Đã cập nhật PHP.'));
  } catch (err) {
    record(shortError(err));
    if (auto) notify({ kind: 'php', tone: 'err', title: msg('Tự động cập nhật PHP thất bại'), body: msg('Lỗi: {error}'), params: { error: shortError(err) }, actions: [{ label: msg('Xem cập nhật PHP'), href: '/settings?tab=update' }], dedupeKey: 'php-auto' });
    throw err;
  } finally {
    // what is still pending now (nothing on success), without refreshing the lists again
    try {
      setSetting(STATE, { ...checkState(), pending: await simulate(await installedPackages()) } satisfies CheckState);
    } catch {
      /* the next check fixes it */
    }
  }
  if (auto) notify({ kind: 'php', tone: 'ok', title: msg('Đã tự động cập nhật PHP {branches}'), params: { branches: touched.join(', ') || '-' }, dedupeKey: 'php-auto' });
  return getPhpUpdates();
}

/**
 * New PHP binaries only take effect in a new master. The packages restart php<v>-fpm themselves;
 * `try-restart` makes sure, and does the same for the isolated sites' own units of those branches.
 * try-restart leaves stopped units (disabled or quarantined sites) stopped.
 */
async function restartPhp(branches: string[], log: HostLogger): Promise<void> {
  if (!branches.length) return;
  const sites = listSites();
  for (const v of branches) {
    const units = [`php${v}-fpm`, ...sites.filter((s) => s.sysUser && s.phpVersion === v).map((s) => phpPathsFor(s.id).unit)];
    log(t('Khởi động lại PHP-FPM {version} ({count} tiến trình chính)', { version: v, count: units.length }));
    try {
      await host.mutate(`systemctl try-restart ${units.map(shq).join(' ')}`, { log, timeoutMs: 5 * 60_000 });
    } catch (err) {
      log(t('Cảnh báo: {error}', { error: shortError(err) }));
    }
    if (config.dryRun) continue;
    const failed = (await host.exec(`for u in ${units.map(shq).join(' ')}; do systemctl is-failed --quiet "$u" && echo "$u"; done`)).stdout.trim();
    if (failed) throw new Error(t('PHP-FPM không chạy lại được sau khi cập nhật: {units}. Xem: journalctl -u <tên>', { units: failed.split('\n').join(', ') }));
  }
}

// ---- Background ---------------------------------------------------------------------------

/**
 * Hourly: refresh the lists once a day; with the automatic update on, install pending patches in the
 * night window (lists refreshed first when older than a few hours). Exported for tests.
 */
export async function phpUpdateTick(log: HostLogger, now = new Date()): Promise<void> {
  if (busy) return;
  const s = checkState();
  const due = () => autoUpdateDue({ autoUpdate: autoUpdateOn(), pending: packagesToUpgrade(checkState().pending).length, lastAutoAt: getSetting<string | null>(LAST_AUTO, null), now });
  if (isOlderThan(s.checkedAt, CHECK_MAX_AGE_MS, now.getTime()) || (due() && isOlderThan(s.checkedAt, FRESH_BEFORE_AUTO_MS, now.getTime()))) {
    busy = { kind: 'check' };
    try {
      await refresh();
    } finally {
      busy = null;
    }
  }
  if (!due()) return;
  const task = startPhpUpgrade({ auto: true });
  log(t('Tự động cập nhật PHP (task {id})', { id: task.id }));
}

/** Starts the hourly job (first pass a few minutes after startup). Never on a laptop. */
export function startPhpUpdateJobs(log: HostLogger): () => void {
  if (config.dryRun) return () => undefined;
  const tick = () => void phpUpdateTick(log).catch((err) => log(`php updates: ${errorMessage(err)}`));
  const first = setTimeout(tick, 5 * 60_000);
  const every = setInterval(tick, 3_600_000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

// Bell: pending PHP patches (unless the nightly update will install them) and PHP branches past
// their end of life that sites still use. Both go away once fixed.
registerNotificationSource('php-updates', async () => {
  const v = await getPhpUpdates();
  const out = [];
  const pending = v.branches.filter((b) => b.packages.length);
  const autoWorks = v.autoUpdate && v.lastRun?.ok !== false;
  if (pending.length && !autoWorks) {
    const versions = pending.map((b) => b.branch).join(', ');
    out.push({
      id: `php-updates:${pending.map((b) => `${b.branch}=${b.available}`).join(',')}`,
      kind: 'security',
      tone: 'warn' as const,
      title: t('Có bản vá cho PHP {versions}', { versions }),
      body: t('Kho PHP (ondrej/sury) không được cập nhật bảo mật tự động của hệ điều hành cài. Cài bản vá trong Cài đặt → Cập nhật.'),
      createdAt: v.checkedAt ?? nowIso(),
      actions: [{ label: t('Xem cập nhật PHP'), href: '/settings?tab=update' }],
      dismissible: false,
    });
  }
  const eol = v.branches.filter((b) => b.support === 'eol' && b.sites > 0);
  if (eol.length) {
    out.push({
      id: `php-eol:${eol.map((b) => `${b.branch}=${b.sites}`).join(',')}`,
      kind: 'security',
      tone: 'warn' as const,
      title: t('{count} site đang chạy phiên bản PHP đã hết hỗ trợ bảo mật', { count: eol.reduce((n, b) => n + b.sites, 0) }),
      body: t('PHP {versions} không còn bản vá bảo mật từ php.net. Chuyển các site sang PHP mới hơn trong trang của từng site.', { versions: eol.map((b) => b.branch).join(', ') }),
      createdAt: v.checkedAt ?? nowIso(),
      actions: [{ label: t('Xem cập nhật PHP'), href: '/settings?tab=update' }],
      dismissible: false,
    });
  }
  return out;
});
