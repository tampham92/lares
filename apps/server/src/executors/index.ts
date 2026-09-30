import os from 'node:os';
import dns from 'node:dns/promises';
import type { SourceConnection } from '@tpanel/shared';
import { localExecutor } from './local.js';
import { SshExecutor } from './ssh.js';
import type { Executor } from './types.js';

export * from './types.js';
export { localExecutor } from './local.js';

export async function connectSource(conn: SourceConnection): Promise<Executor> {
  if (conn.mode === 'local') return localExecutor;
  return SshExecutor.connect(conn);
}

export async function readMachineId(ex: Executor): Promise<string | null> {
  const r = await ex.exec('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null');
  const id = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{16,}$/i.test(id) ? id : null;
}

function localAddresses(): Set<string> {
  const set = new Set<string>(['127.0.0.1', '::1', 'localhost']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) set.add(addr.address);
  }
  return set;
}

/**
 * Decide whether the "source VPS" is actually this machine (another panel installed next to TPanel).
 * Machine-id is the authoritative signal; an IP bound to a local interface is the fallback.
 * Hostnames are deliberately NOT compared - many VPS images share names like "ubuntu".
 */
export async function detectSameHost(conn: SourceConnection, source: Executor): Promise<{ same: boolean; reason?: string }> {
  if (conn.mode === 'local') return { same: true, reason: 'Nguồn là chính máy chủ TPanel (chế độ local)' };
  const [remoteId, localId] = await Promise.all([readMachineId(source), readMachineId(localExecutor)]);
  if (remoteId && localId) {
    return remoteId === localId
      ? { same: true, reason: `Trùng machine-id (${localId.slice(0, 8)}…) - panel nguồn chạy chung VPS với TPanel` }
      : { same: false };
  }
  const locals = localAddresses();
  let ips: string[] = [conn.host];
  try {
    ips = (await dns.lookup(conn.host, { all: true })).map((a) => a.address);
  } catch {
    /* host is probably already an IP */
  }
  const hit = ips.find((ip) => locals.has(ip));
  return hit ? { same: true, reason: `${conn.host} trỏ về IP cục bộ ${hit}` } : { same: false };
}
