import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { CommandError } from '../executors/types.js';
import { t } from '../i18n/index.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';
import {
  BUILD_SCOPE_PREFIX,
  BUILD_SWAP_MB,
  buildMemoryMaxMb,
  buildScopeName,
  isOutOfMemory,
  lowPriorityCommand,
  parseMeminfo,
  scopeKilledForMemory,
  swapPlan,
} from './buildMemoryPolicy.js';

const SWAP_FILE = path.join(config.dataDir, 'build.swap');

async function meminfo() {
  return parseMeminfo(await fs.readFile('/proc/meminfo', 'utf8').catch(() => ''));
}

async function swapActive(): Promise<boolean> {
  const swaps = await fs.readFile('/proc/swaps', 'utf8').catch(() => '');
  return swaps.split('\n').some((l) => l.startsWith(`${SWAP_FILE} `));
}

/** Add the temporary swap if the machine is short. True when it was added. */
async function addSwapIfShort(log: HostLogger): Promise<boolean> {
  const mem = await meminfo();
  if (!mem) return false;
  const disk = await fs.statfs(config.dataDir);
  const plan = swapPlan(mem, Math.floor((disk.bavail * disk.bsize) / 1024 / 1024));
  const free = String(mem.availableMb + mem.swapFreeMb);
  if (plan === 'enough') return false;
  if (plan === 'no-disk') {
    log(t('Cảnh báo: máy còn ít RAM/swap ({free} MB) và không đủ chỗ trống cho swap tạm - build có thể chậm hoặc bị dừng', { free }));
    return false;
  }
  const f = shq(SWAP_FILE);
  const make = (alloc: string) => `${alloc} && mkswap ${f} >/dev/null 2>&1 && swapon ${f} 2>/dev/null`;
  try {
    // umask: the file holds swapped-out memory of every process, root-only from the start.
    // fallocate is instant but some filesystems refuse a swap file made that way: then write it out.
    await host.mutate(
      `umask 077; { ${make(`fallocate -l ${BUILD_SWAP_MB}M ${f}`)}; } || { rm -f ${f}; ${make(`dd if=/dev/zero of=${f} bs=1M count=${BUILD_SWAP_MB} status=none`)}; } || { rm -f ${f}; exit 1; }`,
      { log },
    );
  } catch {
    log(t('Cảnh báo: không tạo được swap tạm (container?) - build có thể chậm hoặc bị dừng'));
    return false;
  }
  log(t('Máy còn ít RAM/swap ({free} MB): thêm swap tạm {size} MB cho lúc build', { free, size: String(BUILD_SWAP_MB) }));
  return true;
}

async function releaseSwap(log: HostLogger) {
  if (await swapActive()) {
    try {
      await host.mutate(`swapoff ${shq(SWAP_FILE)}`, { log });
    } catch {
      // swapoff needs room in RAM for what is swapped out: leave it, the next build or start retries
      log(t('Cảnh báo: chưa gỡ được swap tạm {file} (RAM đang đầy), sẽ gỡ ở lần build sau', { file: SWAP_FILE }));
      return;
    }
  }
  await fs.rm(SWAP_FILE, { force: true });
}

// The swap is shared by the builds running at the same time (one per site): added by the first one
// that finds the machine short, removed when the last one ends. Calls are serialized.
let builds = 0;
let swapAdded = false;
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
};
let scopeSeq = 0;

/**
 * Run a site's install + build with the memory guards: temporary swap if needed, and `wrap(command)`
 * to run each heavy command at low priority in its own limited scope. A build killed for lack of
 * memory fails with a message that says so instead of a bare "exit 137".
 */
export async function withBuildMemory<T>(domain: string, log: HostLogger, fn: (wrap: (command: string) => string) => Promise<T>): Promise<T> {
  // dry-run: nothing is executed, and a laptop's memory says nothing about the server's
  if (config.dryRun) return fn((c) => c);
  await serial(async () => {
    builds++;
    if (!swapAdded) swapAdded = await addSwapIfShort(log).catch(() => false);
  });
  const mem = await meminfo();
  const systemd = await host.exists('/run/systemd/system');
  const memoryMaxMb = mem && systemd ? buildMemoryMaxMb(mem) : null;
  const scopes: string[] = [];
  const wrap = (command: string) => {
    const unit = buildScopeName(domain, ++scopeSeq);
    if (memoryMaxMb) scopes.push(unit);
    return lowPriorityCommand(command, unit, memoryMaxMb);
  };
  const killedInScope = async () => {
    for (const unit of scopes) {
      const journal = await host.exec(`journalctl -o cat --no-pager -n 50 -u ${shq(unit)}`);
      if (scopeKilledForMemory(journal.stdout, unit)) return true;
    }
    return false;
  };
  try {
    return await fn(wrap);
  } catch (err) {
    if (err instanceof CommandError && (isOutOfMemory(`${err.result.stdout}\n${err.result.stderr}`, err.result.code) || (await killedInScope()))) {
      throw new Error(
        t('Build bị dừng vì hết RAM. Thêm swap cố định cho VPS (vd. 4 GB), nâng RAM, hoặc giảm bộ nhớ build (experimental.cpus: 1 trong next.config).'),
        { cause: err },
      );
    }
    throw err;
  } finally {
    // cancel / timeout kill only the outer shell: stop what is left of the build (next's workers)
    for (const unit of scopes) await host.mutate(`systemctl stop ${shq(unit)} 2>/dev/null || true`).catch(() => {});
    await serial(async () => {
      if (--builds === 0 && swapAdded) {
        swapAdded = false;
        await releaseSwap(log).catch(() => {});
      }
    });
  }
}

/**
 * On start: builds left running by a panel restart (their scopes are outside lares.service, so they
 * survive it) have no task following them any more and no lock - stop them; remove a leftover swap.
 */
export async function cleanupBuildLeftovers(log: HostLogger) {
  if (config.dryRun) return;
  if (await host.exists('/run/systemd/system')) {
    await host.mutate(`systemctl stop ${shq(`${BUILD_SCOPE_PREFIX}*.scope`)} 2>/dev/null || true`);
  }
  if (await host.exists(SWAP_FILE)) await releaseSwap(log);
}
