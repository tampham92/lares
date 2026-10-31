/**
 * Memory rules for building a site (npm install, next build) on a small VPS. Pure: the I/O is in
 * buildMemory.ts.
 *
 * A Next.js build needs 1-2 GB. On a 2 GB VPS that also runs MySQL, PHP, the panel and the app's
 * running version, a build without swap does not get OOM-killed: the kernel keeps reclaiming page
 * cache instead, and the whole machine (sites, SSH, the panel) stalls until the 30-minute timeout.
 * So the build gets a temporary swap when the machine is short, and runs in its own cgroup scope
 * whose limits make the build (not MySQL) the one that swaps, or is killed with a clear error.
 */
import { shq } from '../lib/shell.js';

/** Below this much free RAM + swap a build gets a temporary swap file (same rule as install.sh). */
export const BUILD_MIN_FREE_MB = 2048;
export const BUILD_SWAP_MB = 2048;
/** Disk the swap file must leave free: sites, MySQL and logs still have to write. */
const DISK_RESERVE_MB = 1024;

export const BUILD_SCOPE_PREFIX = 'lares-build-';

export interface MemInfo {
  totalMb: number;
  availableMb: number;
  swapFreeMb: number;
}

/** /proc/meminfo → MB, null when a field is missing (not Linux). */
export function parseMeminfo(text: string): MemInfo | null {
  const kb = (key: string) => {
    const v = text.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm'))?.[1];
    return v === undefined ? null : Math.floor(Number(v) / 1024);
  };
  const totalMb = kb('MemTotal');
  const availableMb = kb('MemAvailable');
  const swapFreeMb = kb('SwapFree');
  if (totalMb === null || availableMb === null || swapFreeMb === null) return null;
  return { totalMb, availableMb, swapFreeMb };
}

export type SwapPlan = 'enough' | 'no-disk' | 'add';

export function swapPlan(mem: MemInfo, diskFreeMb: number): SwapPlan {
  if (mem.availableMb + mem.swapFreeMb >= BUILD_MIN_FREE_MB) return 'enough';
  if (diskFreeMb < BUILD_SWAP_MB + DISK_RESERVE_MB) return 'no-disk';
  return 'add';
}

/**
 * MemoryMax of the build scope, from the machine's RAM. It counts RAM only: past it the kernel moves
 * the build's own memory to swap (not MySQL's), and only when swap is full too it kills the build -
 * never another service. 75 % leaves MySQL, PHP, nginx and the panel their working set.
 * No MemoryHigh: it never kills, it throttles, and a build above it with no swap left to reclaim
 * into crawls forever (seen on a 2 GB VPS: >10 min stuck after filling a 2 GB swap) - the very hang
 * this is meant to avoid.
 */
export function buildMemoryMaxMb(mem: MemInfo): number {
  return Math.floor(mem.totalMb * 0.75);
}

/** A unique, valid unit name: a build of the same site may still be stopping when the next starts. */
export function buildScopeName(domain: string, seq: number): string {
  return `${BUILD_SCOPE_PREFIX}${domain.replace(/[^a-z0-9.-]/gi, '-')}-${seq}.scope`;
}

/**
 * Wrap a command (already wrapped by host.asWebUser) so it runs at low priority, and in its own
 * scope when systemd is there (`memoryMaxMb` null: no systemd, e.g. a container).
 * The scope also gives one handle on every process of the build (next spawns workers): stopping it
 * on cancel or timeout leaves nothing running.
 */
export function lowPriorityCommand(command: string, unit: string, memoryMaxMb: number | null): string {
  if (!memoryMaxMb) return `nice -n 10 ${command}`;
  // under contention: below MySQL, nginx, PHP and the panel (weight 100)
  const props = ['CPUWeight=20', 'IOWeight=20', `MemoryMax=${memoryMaxMb}M`];
  return ['systemd-run', '--scope', '--quiet', '--collect', `--unit=${shq(unit)}`, ...props.map((p) => `-p ${p}`), '--', 'nice', '-n', '10', command].join(' ');
}

/**
 * Did the build die for lack of memory, judging by its own output? Without a scope: 137 = 128 +
 * SIGKILL, what runuser returns when the OOM killer killed the command; npm and next only print the
 * signal. (A timeout is a SIGKILL too, but on the outer bash: its exit code is not 137 and the
 * build's own output says nothing about it.)
 */
export function isOutOfMemory(output: string, code: number): boolean {
  return code === 137 || /\bSIGKILL\b|JavaScript heap out of memory|\bENOMEM\b|^Killed\s*$/m.test(output);
}

/**
 * Inside a scope an OOM kill stops the whole scope (OOMPolicy=stop): runuser gets SIGTERM and exits
 * 143 with nothing about memory in the output. systemd says it in the journal (`journalctl -o cat
 * -u <unit>`): "<unit>: A process of this unit has been killed by the OOM killer." and "<unit>:
 * Failed with result 'oom-kill'."
 */
export function scopeKilledForMemory(journal: string, unit: string): boolean {
  return journal.split('\n').some((l) => l.startsWith(`${unit}:`) && /OOM killer|'oom-kill'/.test(l));
}
