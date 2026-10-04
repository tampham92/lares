/**
 * Version, daily update check and the anonymous daily heartbeat.
 *
 * Both network jobs are best effort: short timeouts, at most one attempt per day (the time of
 * the last attempt is kept in SQLite so restarts do not cause extra requests), and failures are
 * only logged at debug level - an offline or firewalled VPS must not fill the journal with noise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  SEMVER_RE,
  TELEMETRY_URL,
  UPGRADE_COMMAND,
  type TelemetryEvent,
  type TelemetryPayload,
  type VersionInfo,
} from '@lares/shared';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/index.js';
import { defaultLang, t } from '../i18n/index.js';

const DAY = 24 * 3_600_000;
const env = (key: string) => (process.env[key] ?? '').trim();
const off = (v: string) => /^(0|false|no|off)$/i.test(v);

/** Root package.json of the Lares checkout (same file the update check reads on GitHub). */
function readVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  let fallback = '';
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'lares' && pkg.version) return pkg.version;
      if (pkg.name === '@lares/server' && pkg.version) fallback = pkg.version;
    } catch {
      /* not here - keep walking up */
    }
    dir = path.dirname(dir);
  }
  return fallback || '0.0.0';
}

export const VERSION = readVersion();

export const releaseSettings = {
  updateCheck: () => !off(env('LARES_UPDATE_CHECK')),
  updateUrl: () => env('LARES_UPDATE_URL') || 'https://raw.githubusercontent.com/tampham92/lares/main/package.json',
  telemetry: () => !off(env('LARES_TELEMETRY')),
  telemetryUrl: () => env('LARES_TELEMETRY_URL') || TELEMETRY_URL,
  installIdFile: () => env('LARES_INSTALL_ID_FILE') || '/etc/lares/install-id',
};

interface UpdateState {
  latest: string | null;
  checkedAt: string | null;
}

export function versionInfo(): VersionInfo {
  const s = getSetting<UpdateState>('release.update', { latest: null, checkedAt: null });
  const latest = releaseSettings.updateCheck() ? s.latest : null;
  return {
    version: VERSION,
    latest,
    updateAvailable: !!latest && compareVersions(latest, VERSION) > 0,
    checkedAt: latest ? s.checkedAt : null,
    upgradeCommand: UPGRADE_COMMAND,
    telemetry: releaseSettings.telemetry(),
  };
}

type Fetch = typeof fetch;

/** Reads `version` from package.json on GitHub `main`; null on any problem. */
export async function fetchLatestVersion(fetchFn: Fetch = fetch, timeoutMs = 10_000): Promise<string | null> {
  try {
    const res = await fetchFn(releaseSettings.updateUrl(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': `lares/${VERSION}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown }).version;
    return typeof v === 'string' && v.length <= 32 && SEMVER_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function osRelease(file = '/etc/os-release'): { id: string; version: string } {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const get = (k: string) => (new RegExp(`^${k}=("?)([^"\\n]*)\\1$`, 'm').exec(txt)?.[2] ?? '').trim();
    return { id: get('ID'), version: get('VERSION_ID') };
  } catch {
    return { id: process.platform, version: '' };
  }
}

const clean = (s: string, re: RegExp, max: number) => s.replace(re, '').slice(0, max);

/** dpkg naming, like install.sh sends (`dpkg --print-architecture`). */
const ARCH: Record<string, string> = { x64: 'amd64', arm64: 'arm64', arm: 'armhf', ia32: 'i386' };

/** The complete payload - the only data the counter sends. */
export function telemetryPayload(event: TelemetryEvent, installId: string, osFile?: string): TelemetryPayload {
  const os = osRelease(osFile);
  return {
    install_id: clean(installId, /[^0-9a-f-]/g, 36),
    version: clean(VERSION, /[^0-9A-Za-z.+-]/g, 32),
    event,
    os: clean(os.id.toLowerCase(), /[^a-z0-9._-]/g, 32) || 'unknown',
    os_version: clean(os.version, /[^0-9A-Za-z._-]/g, 16),
    arch: ARCH[process.arch] ?? clean(process.arch, /[^a-z0-9_]/g, 16),
    lang: defaultLang,
  };
}

function readInstallId(): string | null {
  try {
    const id = fs.readFileSync(releaseSettings.installIdFile(), 'utf8').trim();
    return /^[0-9a-f-]{36}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function sendHeartbeat(fetchFn: Fetch = fetch): Promise<boolean> {
  const id = readInstallId();
  if (!id) return false;
  try {
    const res = await fetchFn(releaseSettings.telemetryUrl(), {
      method: 'POST',
      signal: AbortSignal.timeout(3_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetryPayload('heartbeat', id)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const olderThanADay = (iso: string | null | undefined, now: number) => !iso || now - Date.parse(iso) > DAY - 3_600_000 || Number.isNaN(Date.parse(iso));

/** One pass of the scheduler: does whatever is due. Exported for tests. */
export async function releaseTick(log: (m: string) => void, fetchFn: Fetch = fetch, now = Date.now()): Promise<void> {
  if (releaseSettings.updateCheck()) {
    const s = getSetting<UpdateState>('release.update', { latest: null, checkedAt: null });
    if (olderThanADay(s.checkedAt, now)) {
      const latest = await fetchLatestVersion(fetchFn);
      // A failed check keeps the previous answer but still waits a day before trying again.
      setSetting('release.update', { latest: latest ?? s.latest, checkedAt: new Date(now).toISOString() });
      if (latest && compareVersions(latest, VERSION) > 0) log(t('Đã có Lares {latest} (đang chạy {version}). Nâng cấp: {command}', { latest, version: VERSION, command: UPGRADE_COMMAND }));
    }
  }
  // Heartbeats only come from real installs: never from a developer machine or dry-run.
  if (releaseSettings.telemetry() && config.isProd && !config.dryRun) {
    const last = getSetting<string | null>('release.heartbeatAt', null);
    if (olderThanADay(last, now)) {
      setSetting('release.heartbeatAt', new Date(now).toISOString());
      await sendHeartbeat(fetchFn);
    }
  }
}

/** Starts the hourly scheduler (first pass one minute after startup). Returns a stop function. */
export function startReleaseJobs(log: (m: string) => void): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void releaseTick(log)
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(tick, 60_000);
  const every = setInterval(tick, 3_600_000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
