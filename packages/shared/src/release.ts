// ---------------------------------------------------------------------------
// Release info: version, update check, anonymous telemetry (shared by server & web)
// ---------------------------------------------------------------------------
import { z } from 'zod';

/** The same one-liner installs and upgrades in place (sites, data and accounts are kept). */
export const UPGRADE_COMMAND = 'curl -sSL https://lares.thocode.dev/install | sudo bash';

export const CHANGELOG_URL = 'https://github.com/tampham92/lares/blob/main/CHANGELOG.md';

/** GitHub repository releases are published from (owner/name). A release is a `vX.Y.Z` tag. */
export const RELEASE_REPO = 'tampham92/lares';

export interface VersionInfo {
  /** Version of the running panel, e.g. "0.2.0-beta". */
  version: string;
  /** Newest release tag on GitHub (without the "v"), null until the first successful check. */
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  upgradeCommand: string;
  /** Daily check for a new release (Settings toggle). */
  updateCheck: boolean;
  /** LARES_UPDATE_CHECK=0 in the env file: the daily check is off and the toggle is locked. */
  updateCheckLocked: boolean;
  /** Anonymous daily heartbeat enabled (LARES_TELEMETRY != 0). */
  telemetry: boolean;
}

export const updateCheckSchema = z.object({ enabled: z.boolean() });

/** One-click upgrade: the version the admin confirmed, re-checked against the latest known release. */
export const upgradeRequestSchema = z.object({ version: z.string().max(48) });

export type UpgradeState = 'idle' | 'running' | 'done' | 'failed';

export interface UpgradeStatus {
  state: UpgradeState;
  /** Version being installed (without the "v"). */
  target: string | null;
  /** Version that was running when the upgrade started. */
  from: string | null;
  startedAt: string | null;
  /** Exit code of the installer once it has finished. */
  exitCode: number | null;
  /** Last lines of the installer output. */
  log: string[];
}

/** A release tag: v + semver, nothing that a shell or git could read as an option or a path. */
export const RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]{1,20})?$/;

/** Newest release among tag names (semver order, a release beats its prereleases); null if none. */
export function pickLatestTag(names: readonly string[]): string | null {
  let best: string | null = null;
  for (const n of names) {
    if (!RELEASE_TAG_RE.test(n)) continue;
    const v = n.slice(1);
    if (!best || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

/** MAJOR.MINOR.PATCH with an optional -prerelease and +build, as written in package.json. */
export const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Semver precedence: <0 if a < b, 0 if equal, >0 if a > b. A release is newer than its
 * prereleases (0.2.0 > 0.2.0-beta > 0.2.0-alpha). Invalid input compares as equal so a
 * malformed remote version never shows an update notice.
 */
export function compareVersions(a: string, b: string): number {
  const ma = SEMVER_RE.exec(a.trim());
  const mb = SEMVER_RE.exec(b.trim());
  if (!ma || !mb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d) return d;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  const xa = pa.split('.');
  const xb = pb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const x = xa[i];
    const y = xb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (nx !== ny) {
      return nx ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export const TELEMETRY_EVENTS = ['install', 'upgrade', 'heartbeat'] as const;
export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];

/**
 * Everything the anonymous install counter ever sends - nothing else (no IP, domain,
 * hostname or site data). install.sh and the Cloudflare Worker in ops/telemetry-worker
 * use the same field names.
 */
export interface TelemetryPayload {
  install_id: string;
  version: string;
  event: TelemetryEvent;
  os: string;
  os_version: string;
  arch: string;
  lang: string;
}

export const TELEMETRY_URL = 'https://lares.thocode.dev/ping';
