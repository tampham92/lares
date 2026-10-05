import net from 'node:net';
import os from 'node:os';
import type { ServerIpInput, ServerIpView } from '@lares/shared';
import { getSetting, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { badRequest } from '../lib/errors.js';

/**
 * The server's public addresses, used as the content of A/AAAA records.
 *
 * Asked from IP echo services first (they see the address the Internet sees, also behind 1:1 NAT
 * like AWS/GCP), falling back to a public address on a local interface. The result is cached in
 * the settings table; the admin can override either family (or switch IPv6 off entirely).
 */
const SETTING = 'serverPublicIp';
const MAX_AGE_MS = 6 * 3_600_000;
const ECHO_TIMEOUT_MS = 4_000;
/** Single-family hostnames: an IPv4-only name can only answer with the IPv4 address, and vice versa. */
const ECHO: Record<4 | 6, string[]> = {
  4: ['https://api.ipify.org', 'https://ipv4.icanhazip.com'],
  6: ['https://api6.ipify.org', 'https://ipv6.icanhazip.com'],
};

// ---- Address helpers ------------------------------------------------------------

function v4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n, p) => (n << 8n) | BigInt(Number(p)), 0n);
}

function v6ToBigInt(ip: string): bigint | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const embedded = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (embedded) {
    const v4 = v4ToBigInt(embedded[2]!);
    if (v4 === null) return null;
    s = `${embedded[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

const toBig = (ip: string): { family: 4 | 6; n: bigint } | null => {
  const family = net.isIP(ip);
  if (family === 4) {
    const n = v4ToBigInt(ip);
    return n === null ? null : { family: 4, n };
  }
  if (family === 6) {
    const n = v6ToBigInt(ip);
    return n === null ? null : { family: 6, n };
  }
  return null;
};

/** `ip` inside `cidr` (same family only). A bare address in `cidr` means /32 or /128. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const a = toBig(ip);
  const b = toBig(base ?? '');
  if (!a || !b || a.family !== b.family) return false;
  const width = a.family === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
  const shift = BigInt(width - bits);
  return a.n >> shift === b.n >> shift;
}

/** Same address, whatever the notation (2001:db8::1 vs 2001:0db8:0:0:0:0:0:1). */
export function sameIp(a: string, b: string): boolean {
  const x = toBig(a);
  const y = toBig(b);
  return !!x && !!y && x.family === y.family && x.n === y.n;
}

const NON_PUBLIC_V4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
];
const NON_PUBLIC_V6 = ['2001:db8::/32', '2001::/32', '2002::/16'];

/** Reachable from the Internet: not private, loopback, link-local, CGNAT, documentation or multicast. */
export function isPublicIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !NON_PUBLIC_V4.some((c) => ipInCidr(ip, c));
  // global unicast is 2000::/3; ULA (fc00::/7), link-local (fe80::/10), loopback, mapped... fall outside it
  if (family === 6) return ipInCidr(ip, '2000::/3') && !NON_PUBLIC_V6.some((c) => ipInCidr(ip, c));
  return false;
}

/** Every address configured on this machine (public or not). */
export function localAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flatMap((l) => (l ?? []).map((a) => a.address.split('%')[0]!));
}

// ---- Detection ------------------------------------------------------------------

async function echo(family: 4 | 6): Promise<string | null> {
  for (const url of ECHO[family]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(ECHO_TIMEOUT_MS), headers: { 'user-agent': 'lares-panel' } });
      if (!res.ok) continue;
      const ip = (await res.text()).trim().slice(0, 64);
      if (net.isIP(ip) === family && isPublicIp(ip)) return ip;
    } catch {
      /* no route / timeout: try the next service */
    }
  }
  return null;
}

const interfaceIp = (family: 4 | 6) => localAddresses().find((a) => net.isIP(a) === family && isPublicIp(a)) ?? null;

interface Stored {
  ipv4Override: string | null;
  ipv6Override: string | null;
  ipv6Disabled: boolean;
  detected: { ipv4: string | null; ipv6: string | null; at: string | null };
}

const stored = (): Stored => {
  const s = getSetting<Partial<Stored>>(SETTING, {});
  return {
    ipv4Override: s.ipv4Override ?? null,
    ipv6Override: s.ipv6Override ?? null,
    ipv6Disabled: s.ipv6Disabled ?? false,
    detected: { ipv4: null, ipv6: null, at: null, ...s.detected },
  };
};

let inflight: Promise<void> | null = null;

/** Ask the echo services (in parallel per family), fall back to interface addresses. */
export async function detectPublicIp(): Promise<void> {
  inflight ??= (async () => {
    const [v4, v6] = await Promise.all([echo(4), echo(6)]);
    const prev = stored();
    setSetting(SETTING, {
      ...prev,
      detected: {
        // a transient IPv4 failure keeps the last known address; IPv6 follows the machine (it may really be gone)
        ipv4: v4 ?? interfaceIp(4) ?? prev.detected.ipv4,
        ipv6: v6 ?? interfaceIp(6),
        at: new Date().toISOString(),
      },
    } satisfies Stored);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function view(s: Stored): ServerIpView {
  return {
    ipv4: s.ipv4Override ?? s.detected.ipv4,
    ipv6: s.ipv6Disabled ? null : (s.ipv6Override ?? s.detected.ipv6),
    detected: s.detected,
    override: { ipv4: s.ipv4Override, ipv6: s.ipv6Override },
    ipv6Disabled: s.ipv6Disabled,
  };
}

/** Effective addresses; detects first when never done or older than a few hours (or `refresh`). */
export async function getServerIp(opts: { refresh?: boolean } = {}): Promise<ServerIpView> {
  const s = stored();
  const age = Date.now() - (Date.parse(s.detected.at ?? '') || 0);
  if (opts.refresh || age > MAX_AGE_MS) await detectPublicIp();
  return view(stored());
}

export function saveServerIp(input: ServerIpInput): ServerIpView {
  for (const ip of [input.ipv4, input.ipv6]) {
    if (ip && !isPublicIp(ip)) throw badRequest(t('{ip} là địa chỉ nội bộ, không dùng được cho bản ghi DNS công khai', { ip }));
  }
  setSetting(SETTING, { ...stored(), ipv4Override: input.ipv4, ipv6Override: input.ipv6, ipv6Disabled: input.ipv6Disabled } satisfies Stored);
  return view(stored());
}

/** Addresses that count as "this server" when reading existing records (local, detected, overrides). */
export function serverAddresses(): string[] {
  const s = stored();
  return [...localAddresses(), s.detected.ipv4, s.detected.ipv6, s.ipv4Override, s.ipv6Override].filter((a): a is string => !!a && isPublicIp(a));
}
