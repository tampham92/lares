/**
 * Pure rules of the one-click upgrade (no I/O, unit-tested): the command that runs the installer
 * and how its log file is read back into a status.
 *
 * The upgrade restarts lares.service, which would kill anything the panel started itself, so the
 * installer runs in its own transient systemd unit and writes to a log file. The last line of that
 * file carries the installer's exit code; the panel reads it after it comes back up.
 */
import { RELEASE_TAG_RE, type UpgradeState, type UpgradeStatus } from '@lares/shared';
import { shq } from '../lib/shell.js';

export const UPGRADE_UNIT = 'lares-upgrade';
export const EXIT_MARKER = '__LARES_UPGRADE_EXIT__';
/** A unit that has not shown up after this long never started. */
const START_GRACE_MS = 30_000;
const LOG_TAIL = 200;

export interface UpgradeMeta {
  target: string;
  from: string;
  startedAt: string;
}

/**
 * systemd-run command that downloads install.sh of the release tag and runs it as an upgrade.
 * `repo` is owner/name, `tag` must be a release tag: both end up in a URL and a git ref, so they are
 * validated here as well as quoted.
 */
export function upgradeCommand(repo: string, tag: string, logFile: string): string {
  if (!RELEASE_TAG_RE.test(tag)) throw new Error(`invalid release tag: ${tag}`);
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) throw new Error(`invalid repository: ${repo}`);
  // The installer of the release itself (not of main), checking out that same tag.
  const url = `https://raw.githubusercontent.com/${repo}/${tag}/install.sh`;
  const script = [
    `exec >>${shq(logFile)} 2>&1`,
    `echo "Lares upgrade to ${tag} - $(date -u +%FT%TZ)"`,
    'tmp=$(mktemp)',
    `if curl -fsSL --max-time 60 -o "$tmp" ${shq(url)}; then bash "$tmp" --branch ${shq(tag)}; code=$?; else echo "download failed: ${url}"; code=97; fi`,
    'rm -f "$tmp"',
    `echo "${EXIT_MARKER} $code"`,
  ].join('\n');
  // A clean environment: the panel's own variables (LARES_SECRET, passwords) must not reach the
  // installer, which reads what it needs from /etc/lares/lares.env.
  return [
    'systemd-run',
    `--unit=${UPGRADE_UNIT}`,
    '--collect',
    '--quiet',
    '--setenv=HOME=/root',
    '--setenv=LANG=C.UTF-8',
    '--setenv=DEBIAN_FRONTEND=noninteractive',
    '/bin/bash',
    '-c',
    shq(script),
  ].join(' ');
}

/** Exit code from the marker line, or null while the installer is still running. */
export function exitCodeOf(log: string): number | null {
  const m = new RegExp(`^${EXIT_MARKER} (\\d+)\\s*$`, 'm').exec(log);
  return m ? Number(m[1]) : null;
}

/** Status shown in Settings, from what is on disk and whether the unit is still active. */
export function upgradeStatus(meta: UpgradeMeta | null, log: string | null, unitActive: boolean, now = Date.now()): UpgradeStatus {
  if (!meta) return { state: 'idle', target: null, from: null, startedAt: null, exitCode: null, log: [] };
  const text = log ?? '';
  const exitCode = exitCodeOf(text);
  let state: UpgradeState;
  if (exitCode !== null) state = exitCode === 0 ? 'done' : 'failed';
  else if (unitActive || now - Date.parse(meta.startedAt) < START_GRACE_MS) state = 'running';
  else state = 'failed'; // no exit line and no unit: the run was interrupted (reboot, killed)
  const lines = text
    .split('\n')
    .filter((l) => l && !l.startsWith(EXIT_MARKER))
    // colour codes of the installer's output
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  return { state, target: meta.target, from: meta.from, startedAt: meta.startedAt, exitCode, log: lines.slice(-LOG_TAIL) };
}
