import { config } from '../config.js';
import { db } from '../db/index.js';
import { host, type HostLogger } from './host.js';

/** TCP ports something is listening on right now. */
export async function listeningPorts(): Promise<Set<number>> {
  const r = await host.exec(`ss -ltnH 2>/dev/null | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\\1/'`);
  return new Set(
    r.stdout
      .split('\n')
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

/** Every port TPanel has handed out (Next.js upstreams + port-based sites) plus the panel itself. */
export function reservedPorts(): Set<number> {
  const rows = db.prepare('SELECT app_port AS p FROM sites WHERE app_port IS NOT NULL UNION SELECT listen_port FROM sites WHERE listen_port IS NOT NULL').all() as Array<{ p: number }>;
  return new Set([config.port, 80, 443, ...rows.map((r) => r.p)]);
}

export async function allocatePort(start: number, extraReserved: Iterable<number> = []): Promise<number> {
  const taken = new Set([...reservedPorts(), ...(await listeningPorts()), ...extraReserved]);
  for (let port = start; port < 65000; port++) if (!taken.has(port)) return port;
  throw new Error('Hết port trống');
}

export async function isPortFree(port: number): Promise<boolean> {
  return !reservedPorts().has(port) && !(await listeningPorts()).has(port);
}

async function ufwActive(): Promise<boolean> {
  if (config.dryRun) return false;
  const r = await host.exec('ufw status 2>/dev/null | head -1');
  return r.stdout.includes('Status: active');
}

/** Port-based sites must be reachable from outside: open them in ufw when it is enabled. */
export async function openFirewallPort(port: number, log?: HostLogger): Promise<boolean> {
  if (!(await ufwActive())) return false;
  await host.mutate(`ufw allow ${port}/tcp comment 'tpanel site'`, { log });
  return true;
}

export async function closeFirewallPort(port: number, log?: HostLogger) {
  if (!(await ufwActive())) return;
  await host.mutate(`ufw delete allow ${port}/tcp 2>/dev/null || true`, { log });
}
