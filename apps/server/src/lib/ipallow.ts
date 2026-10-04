import net from 'node:net';

/** "::ffff:1.2.3.4" → "1.2.3.4", drops IPv6 zone ids and brackets; lowercases IPv6. */
export function normalizeIp(ip: string): string {
  let s = ip.trim().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped && net.isIPv4(mapped[1]!)) return mapped[1]!;
  return s.toLowerCase();
}

export interface AllowEntry {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** "1.2.3.4", "10.0.0.0/8", "2001:db8::/32" → parsed entry; anything else → null. */
export function parseAllowEntry(entry: string): AllowEntry | null {
  const [rawAddr, rawPrefix, extra] = entry.trim().split('/');
  if (!rawAddr || extra !== undefined) return null;
  const address = normalizeIp(rawAddr);
  const v = net.isIP(address);
  if (!v) return null;
  const max = v === 4 ? 32 : 128;
  let prefix = max;
  if (rawPrefix !== undefined) {
    if (!/^\d{1,3}$/.test(rawPrefix)) return null;
    prefix = Number(rawPrefix);
    if (prefix > max) return null;
  }
  return { address, prefix, family: v === 4 ? 'ipv4' : 'ipv6' };
}

/** Canonical text for storage: "1.2.3.4" for single hosts, "10.0.0.0/8" for networks. */
export function formatAllowEntry(e: AllowEntry): string {
  return e.prefix === (e.family === 'ipv4' ? 32 : 128) ? e.address : `${e.address}/${e.prefix}`;
}

export function isLoopback(ip: string): boolean {
  const s = normalizeIp(ip);
  return s === '::1' || /^127\./.test(s);
}

/** Returns a predicate telling whether a client IP is covered by any entry. Invalid entries are ignored. */
export function buildAllowMatcher(entries: string[]): (ip: string) => boolean {
  const list = new net.BlockList();
  for (const raw of entries) {
    const e = parseAllowEntry(raw);
    if (!e) continue;
    if (e.prefix === (e.family === 'ipv4' ? 32 : 128)) list.addAddress(e.address, e.family);
    else list.addSubnet(e.address, e.prefix, e.family);
  }
  return (ip: string) => {
    const s = normalizeIp(ip);
    const v = net.isIP(s);
    return v !== 0 && list.check(s, v === 4 ? 'ipv4' : 'ipv6');
  };
}
