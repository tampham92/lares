import dns from 'node:dns/promises';
import type {
  AutoDnsInput,
  CloudflareDnsView,
  CloudflareZone,
  DnsActionResult,
  DnsPlanResult,
  DnsRecordBrief,
  DnsRecordPlan,
  DnsRecordType,
  HostnameDnsPlan,
  HostnameDnsStatus,
  Site,
  SiteDnsStatus,
} from '@lares/shared';
import { getSetting, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, errorMessage } from '../lib/errors.js';
import { CLOUDFLARE_IPV4, CLOUDFLARE_IPV6 } from './cloudflare.js';
import type { HostLogger } from './host.js';
import { getServerIp, ipInCidr, sameIp, serverAddresses } from './publicIp.js';

/**
 * Cloudflare DNS: an API token (Zone → DNS → Edit + Zone → Zone → Read) lets Lares create the
 * A/AAAA records of a site itself. Records are created as "DNS only" (grey cloud) so Let's Encrypt
 * HTTP-01 reaches nginx right away; the proxy can be switched on afterwards.
 *
 * Safety rules: a record that points somewhere else (another IP, a CNAME) is only replaced when
 * the admin explicitly asked to overwrite that hostname. Records Lares created itself (ids kept in
 * the settings) or records holding one of this server's own addresses may be updated freely.
 *
 * The token is stored encrypted under the settings key `cloudflareDns` and never leaves the
 * server: views carry a short hint, errors and logs never include it.
 */
const SETTING = 'cloudflareDns';
const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15_000;
const ZONES_STALE_MS = 2 * 60_000;
const MAX_MANAGED = 1000;
/** Cloudflare zone and record ids: 32 hex characters (checked before they go into a URL). */
const ID_RE = /^[0-9a-f]{32}$/i;
export const RECORD_COMMENT = 'Lares Panel';

interface Stored {
  tokenEnc: string | null;
  verifiedAt: string | null;
  accountName: string | null;
  zones: CloudflareZone[];
  zonesAt: string | null;
  lastError: string | null;
  /** Ids of records this panel created: safe to update later without asking. */
  managed: string[];
}

const EMPTY: Stored = { tokenEnc: null, verifiedAt: null, accountName: null, zones: [], zonesAt: null, lastError: null, managed: [] };
const stored = (): Stored => ({ ...EMPTY, ...getSetting<Partial<Stored>>(SETTING, {}) });
const save = (patch: Partial<Stored>) => setSetting(SETTING, { ...stored(), ...patch });

export const tokenHint = (token: string) => (token.length > 12 ? `${token.slice(0, 4)}…${token.slice(-4)}` : '••••');

function storedToken(s = stored()): string | null {
  if (!s.tokenEnc) return null;
  try {
    return decrypt<string>(s.tokenEnc);
  } catch {
    return null; // the panel secret changed: the token cannot be used any more
  }
}

export function getCloudflareDnsView(): CloudflareDnsView {
  const s = stored();
  const token = storedToken(s);
  return {
    connected: !!token && !!s.verifiedAt,
    tokenHint: token ? tokenHint(token) : null,
    verifiedAt: s.verifiedAt,
    accountName: s.accountName,
    zones: s.zones,
    lastError: s.lastError,
  };
}

// ---- API client -------------------------------------------------------------------

interface CfEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
  result_info?: { page?: number; total_pages?: number };
}

interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

const INVALID_TOKEN_CODES = [1000, 6003, 6111, 9106, 9109];

/** Readable, translated error from a failed call. Uses 4xx statuses other than 401 (which would log the admin out). */
export function cloudflareError(status: number, body: CfEnvelope<unknown> | null): HttpError {
  const errors = body?.errors ?? [];
  const detail = errors.length ? errors.map((e) => `${e.message ?? '?'}${e.code ? ` (${e.code})` : ''}`).join('; ').slice(0, 300) : `HTTP ${status}`;
  if (status === 401 || errors.some((e) => INVALID_TOKEN_CODES.includes(e.code ?? 0))) {
    return badRequest(t('Cloudflare từ chối API token: {detail}. Kiểm tra lại token (còn hiệu lực, dán đủ ký tự).', { detail }));
  }
  if (status === 403 || errors.some((e) => e.code === 10000)) {
    return badRequest(t('API token không đủ quyền ({detail}). Token cần quyền Zone → DNS → Edit và Zone → Zone → Read cho zone này.', { detail }));
  }
  if (status === 429) return new HttpError(429, t('Cloudflare đang giới hạn số lượng yêu cầu, thử lại sau ít phút'));
  return badRequest(t('Cloudflare báo lỗi {status}: {detail}', { status, detail }));
}

async function cf<T>(token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<CfEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new HttpError(504, t('Hết thời gian chờ khi gọi API Cloudflare'));
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : errorMessage(err);
    throw new HttpError(502, t('Không kết nối được API Cloudflare: {error}', { error: cause }));
  }
  const text = await res.text().catch(() => '');
  let envelope: CfEnvelope<T> | null = null;
  try {
    envelope = JSON.parse(text) as CfEnvelope<T>;
  } catch {
    /* an HTML error page from a proxy */
  }
  if (res.ok && envelope?.success) return envelope;
  throw cloudflareError(res.status, envelope);
}

const zonePath = (zone: CloudflareZone) => {
  if (!ID_RE.test(zone.id)) throw badRequest(t('ID zone Cloudflare không hợp lệ'));
  return `/zones/${zone.id}`;
};

async function fetchZones(token: string): Promise<{ zones: CloudflareZone[]; accountName: string | null }> {
  const zones: CloudflareZone[] = [];
  let accountName: string | null = null;
  for (let page = 1; page <= 20; page++) {
    const r = await cf<Array<{ id: string; name: string; status: string; account?: { name?: string } }>>(token, 'GET', `/zones?per_page=50&page=${page}`);
    for (const z of r.result ?? []) {
      if (!ID_RE.test(z.id) || typeof z.name !== 'string') continue;
      zones.push({ id: z.id, name: z.name.toLowerCase(), status: String(z.status ?? '') });
      accountName ??= z.account?.name ?? null;
    }
    if (page >= (r.result_info?.total_pages ?? 1)) break;
  }
  return { zones, accountName };
}

/**
 * Check a token: /user/tokens/verify, then list its zones and read one zone's records.
 * Account-owned tokens are verified under /accounts/:id/tokens/verify instead, so a failed
 * user-level verify is accepted when the zone list works.
 */
export async function verifyToken(token: string): Promise<{ zones: CloudflareZone[]; accountName: string | null }> {
  let verifyError: unknown = null;
  let status: string | undefined;
  try {
    status = (await cf<{ status?: string }>(token, 'GET', '/user/tokens/verify')).result?.status;
  } catch (err) {
    verifyError = err;
  }
  if (status && status !== 'active') throw badRequest(t('API token đang ở trạng thái "{status}" (cần "active")', { status }));

  let found: { zones: CloudflareZone[]; accountName: string | null };
  try {
    found = await fetchZones(token);
  } catch (err) {
    throw verifyError ?? err;
  }
  if (!found.zones.length) {
    throw badRequest(t('Token hợp lệ nhưng không truy cập được zone nào. Khi tạo token, ở mục Zone Resources hãy chọn zone cần dùng (hoặc All zones).'));
  }
  try {
    await cf(token, 'GET', `${zonePath(found.zones[0]!)}/dns_records?per_page=1`);
  } catch (err) {
    throw badRequest(t('Token không đọc được bản ghi DNS của zone {zone}: {error}', { zone: found.zones[0]!.name, error: errorMessage(err) }));
  }
  return found;
}

export async function connectCloudflare(token: string): Promise<CloudflareDnsView> {
  const { zones, accountName } = await verifyToken(token);
  const now = new Date().toISOString();
  save({ tokenEnc: encrypt(token), verifiedAt: now, accountName, zones, zonesAt: now, lastError: null });
  return getCloudflareDnsView();
}

/** Verify the stored token again and reload its zones. */
export async function refreshCloudflare(): Promise<CloudflareDnsView> {
  const token = requireToken();
  try {
    const { zones, accountName } = await verifyToken(token);
    const now = new Date().toISOString();
    save({ verifiedAt: now, accountName, zones, zonesAt: now, lastError: null });
  } catch (err) {
    save({ lastError: errorMessage(err) });
    throw err;
  }
  return getCloudflareDnsView();
}

export function disconnectCloudflare(): CloudflareDnsView {
  // the ids of records Lares created stay known, in case the same account is connected again
  setSetting(SETTING, { ...EMPTY, managed: stored().managed });
  return getCloudflareDnsView();
}

function requireToken(): string {
  const token = storedToken();
  if (!token) throw conflict(t('Chưa kết nối Cloudflare - thêm API token trong Cài đặt → Cloudflare DNS'));
  return token;
}

// ---- Zones and planning (pure) -------------------------------------------------------

/** Most specific connected zone containing `hostname` (shop.example.com.vn → example.com.vn). */
export function matchZone(hostname: string, zones: CloudflareZone[]): CloudflareZone | null {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  let best: CloudflareZone | null = null;
  for (const z of zones) {
    const name = z.name.toLowerCase().replace(/\.$/, '');
    if ((h === name || h.endsWith(`.${name}`)) && (!best || name.length > best.name.length)) best = z;
  }
  return best;
}

export interface Ownership {
  /** Record ids created by this panel. */
  managed: ReadonlySet<string>;
  /** This server's own addresses. */
  addresses: readonly string[];
}

/**
 * Decide, per record type, what to do for one hostname given its current A/AAAA/CNAME records.
 * Never plans to touch a foreign record silently: those come out as `conflict`.
 */
export function planRecords(records: DnsRecordBrief[], want: { ipv4: string | null; ipv6: string | null }, own: Ownership): DnsRecordPlan[] {
  const managed = (r: DnsRecordBrief) => own.managed.has(r.id);
  const ownAddress = (r: DnsRecordBrief) => own.addresses.some((a) => sameIp(a, r.content));
  const ours = (r: DnsRecordBrief) => managed(r) || ownAddress(r);
  const cnames = records.filter((r) => r.type === 'CNAME');
  let cnameShown = false;
  return (['A', 'AAAA'] as const).map((type): DnsRecordPlan => {
    const content = type === 'A' ? want.ipv4 : want.ipv6;
    const same = records.filter((r) => r.type === type);
    if (!content) {
      // no address of this family wanted: records Lares created go, the admin's own records for this
      // server stay, anything pointing elsewhere is a conflict (it would take part of the traffic)
      if (!same.length) return { type, content, action: 'none', existing: [] };
      if (!same.every(ours)) return { type, content, action: 'conflict', existing: same };
      const created = same.filter(managed);
      return created.length ? { type, content, action: 'delete', existing: created } : { type, content, action: 'ok', existing: same };
    }
    // a CNAME cannot coexist with A/AAAA: report it once, on the first record we want
    const blocking = cnameShown ? [] : cnames;
    cnameShown ||= blocking.length > 0;
    const existing = [...same, ...blocking];
    if (!existing.length) return { type, content, action: 'create', existing };
    if (blocking.length) return { type, content, action: 'conflict', existing };
    const wrong = same.filter((r) => !sameIp(r.content, content));
    if (!wrong.length) return { type, content, action: 'ok', existing };
    return { type, content, action: wrong.every(ours) ? 'update' : 'conflict', existing };
  });
}

export const describeRecords = (records: DnsRecordBrief[]) =>
  records.map((r) => `${r.type} ${r.content}${r.proxied ? ' (proxy)' : ''}`).join(', ');

// ---- Context ------------------------------------------------------------------------

interface Ctx {
  token: string;
  zones: CloudflareZone[];
  want: { ipv4: string | null; ipv6: string | null };
  own: Ownership;
}

async function context(hostnames: string[], ipv4Only = false): Promise<Ctx> {
  const token = requireToken();
  let s = stored();
  // a zone added in Cloudflare after connecting: reload the list (at most every couple of minutes)
  const stale = Date.now() - (Date.parse(s.zonesAt ?? '') || 0) > ZONES_STALE_MS;
  if (stale && hostnames.some((h) => !matchZone(h, s.zones))) {
    try {
      const { zones, accountName } = await fetchZones(token);
      save({ zones, accountName: accountName ?? s.accountName, zonesAt: new Date().toISOString() });
      s = stored();
    } catch {
      /* keep the cached list */
    }
  }
  const ip = await getServerIp();
  return { token, zones: s.zones, want: { ipv4: ip.ipv4, ipv6: ipv4Only ? null : ip.ipv6 }, own: { managed: new Set(s.managed), addresses: [...serverAddresses(), ip.ipv4, ip.ipv6].filter((a): a is string => !!a) } };
}

const pointsHere = (ctx: Ctx, content: string) => ctx.own.addresses.some((a) => sameIp(a, content));

function remember(id: string) {
  const s = stored();
  if (!s.managed.includes(id)) save({ managed: [...s.managed, id].slice(-MAX_MANAGED) });
}

function forget(id: string) {
  const s = stored();
  if (s.managed.includes(id)) save({ managed: s.managed.filter((m) => m !== id) });
}

async function listRecords(ctx: Ctx, zone: CloudflareZone, hostname: string): Promise<DnsRecordBrief[]> {
  const r = await cf<CfRecord[]>(ctx.token, 'GET', `${zonePath(zone)}/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`);
  return (r.result ?? [])
    .filter((rec) => ['A', 'AAAA', 'CNAME'].includes(rec.type) && rec.name?.toLowerCase() === hostname && ID_RE.test(rec.id))
    .map((rec) => ({ id: rec.id, type: rec.type as DnsRecordType, content: rec.content, proxied: rec.proxied === true }));
}

// ---- Output (task log or API response) -----------------------------------------------------

export interface DnsOut {
  info(text: string): void;
  warn(text: string): void;
}

/** Task log lines; warnings start with "Cảnh báo"/"Warning" so the console colours them. */
export const taskOut = (log: HostLogger): DnsOut => ({ info: log, warn: (m) => log(t('Cảnh báo: {message}', { message: m })) });

export function collectOut(): { out: DnsOut; result: DnsActionResult } {
  const result: DnsActionResult = { messages: [] };
  return {
    result,
    out: { info: (text) => result.messages.push({ level: 'info', text }), warn: (text) => result.messages.push({ level: 'warn', text }) },
  };
}

// ---- Applying a plan ----------------------------------------------------------------------

interface ApplyOptions {
  /** Hostnames whose conflicting records the admin agreed to replace. */
  overwrite: string[];
  /** Panel hostname: records must end up DNS only. */
  dnsOnly?: boolean;
  /** Panel hostname: A only (the panel listens on IPv4). */
  ipv4Only?: boolean;
}

async function execute(ctx: Ctx, zone: CloudflareZone, hostname: string, plan: DnsRecordPlan[], overwrite: boolean, dnsOnly: boolean, out: DnsOut) {
  const base = zonePath(zone);
  const conflicts = plan.filter((p) => p.action === 'conflict');
  if (conflicts.length && !overwrite) {
    // all or nothing per hostname: an AAAA here and an A elsewhere would split visitors (and Let's Encrypt) between servers
    const current = describeRecords([...new Map(conflicts.flatMap((p) => p.existing).map((r) => [r.id, r])).values()]);
    out.warn(t('Cloudflare DNS: {hostname} đang có {current} - không thay đổi. Chọn "Ghi đè" nếu muốn trỏ về máy chủ này.', { hostname, current }));
    return;
  }
  const deleted = new Set<string>();
  for (const p of plan) {
    const record = `${p.type} ${hostname}`;
    if (p.action === 'none') continue;
    if (p.action === 'ok') {
      const proxiedRecs = dnsOnly ? p.existing.filter((r) => r.type === p.type && r.proxied) : [];
      for (const r of proxiedRecs) await cf(ctx.token, 'PATCH', `${base}/dns_records/${r.id}`, { proxied: false });
      if (proxiedRecs.length) out.info(t('Cloudflare DNS: đã tắt proxy (DNS only) cho {record}', { record }));
      else if (p.content) out.info(t('Cloudflare DNS: {record} đã trỏ về {ip}, giữ nguyên', { record, ip: p.content }));
      continue;
    }
    if (p.action === 'create') {
      const r = await cf<CfRecord>(ctx.token, 'POST', `${base}/dns_records`, { type: p.type, name: hostname, content: p.content, ttl: 1, proxied: false, comment: RECORD_COMMENT });
      if (r.result?.id) remember(r.result.id);
      out.info(t('Cloudflare DNS: đã tạo {record} → {ip} (DNS only)', { record, ip: p.content ?? '' }));
      continue;
    }
    // update / delete / confirmed overwrite: keep one record of the right type, remove the rest (CNAME first)
    const keep = p.content ? (p.existing.find((r) => r.type === p.type && sameIp(r.content, p.content!)) ?? p.existing.find((r) => r.type === p.type)) : undefined;
    for (const r of p.existing) {
      if (r === keep || deleted.has(r.id)) continue;
      await cf(ctx.token, 'DELETE', `${base}/dns_records/${r.id}`);
      deleted.add(r.id);
      forget(r.id);
      out.info(t('Cloudflare DNS: đã xoá {type} {name} → {content}', { type: r.type, name: hostname, content: r.content }));
    }
    if (!p.content) continue;
    // a confirmed overwrite starts DNS only, like a new record; our own record keeps its proxy setting
    const proxied = p.action === 'conflict' || dnsOnly ? false : (keep?.proxied ?? false);
    if (keep) {
      if (!sameIp(keep.content, p.content) || keep.proxied !== proxied) {
        await cf(ctx.token, 'PATCH', `${base}/dns_records/${keep.id}`, { content: p.content, proxied });
      }
      remember(keep.id);
      out.info(t('Cloudflare DNS: đã cập nhật {record}: {old} → {ip}', { record, old: keep.content, ip: p.content }) + (proxied ? '' : ' (DNS only)'));
    } else {
      const r = await cf<CfRecord>(ctx.token, 'POST', `${base}/dns_records`, { type: p.type, name: hostname, content: p.content, ttl: 1, proxied: false, comment: RECORD_COMMENT });
      if (r.result?.id) remember(r.result.id);
      out.info(t('Cloudflare DNS: đã tạo {record} → {ip} (DNS only)', { record, ip: p.content }));
    }
  }
}

/** Create/update the A (and AAAA) records of `hostnames` so they point to this server. */
export async function applyDnsRecords(hostnames: string[], opts: ApplyOptions, out: DnsOut): Promise<void> {
  const ctx = await context(hostnames, opts.ipv4Only);
  if (!ctx.want.ipv4 && !ctx.want.ipv6) throw conflict(t('Chưa xác định được IP public của máy chủ - nhập IP trong Cài đặt → Cloudflare DNS'));
  for (const hostname of hostnames) {
    const zone = matchZone(hostname, ctx.zones);
    if (!zone) {
      out.warn(t('Cloudflare DNS: {hostname} không thuộc zone nào của tài khoản Cloudflare đã kết nối - bỏ qua', { hostname }));
      continue;
    }
    try {
      const plan = planRecords(await listRecords(ctx, zone, hostname), ctx.want, ctx.own);
      await execute(ctx, zone, hostname, plan, opts.overwrite.includes(hostname), opts.dnsOnly ?? false, out);
    } catch (err) {
      out.warn(t('Cloudflare DNS: lỗi với {hostname}: {error}', { hostname, error: errorMessage(err) }));
    }
  }
}

/** Switch the Cloudflare proxy of the records pointing to this server. */
export async function setProxied(hostnames: string[], proxied: boolean, out: DnsOut): Promise<void> {
  const ctx = await context(hostnames);
  const checkedZones = new Set<string>();
  for (const hostname of hostnames) {
    const zone = matchZone(hostname, ctx.zones);
    if (!zone) {
      out.warn(t('Cloudflare DNS: {hostname} không thuộc zone nào của tài khoản Cloudflare đã kết nối - bỏ qua', { hostname }));
      continue;
    }
    try {
      const mine = (await listRecords(ctx, zone, hostname)).filter((r) => r.type !== 'CNAME' && pointsHere(ctx, r.content));
      if (!mine.length) {
        out.warn(t('Cloudflare DNS: {hostname} chưa có bản ghi trỏ về máy chủ này - bấm "Tạo/sửa bản ghi" trước', { hostname }));
        continue;
      }
      for (const r of mine) {
        const record = `${r.type} ${hostname}`;
        if (r.proxied === proxied) {
          out.info(proxied ? t('Cloudflare DNS: {record} đã bật proxy từ trước', { record }) : t('Cloudflare DNS: {record} đã ở chế độ DNS only', { record }));
          continue;
        }
        await cf(ctx.token, 'PATCH', `${zonePath(zone)}/dns_records/${r.id}`, { proxied });
        out.info(proxied ? t('Cloudflare DNS: đã bật proxy cho {record}', { record }) : t('Cloudflare DNS: đã tắt proxy (DNS only) cho {record}', { record }));
      }
      if (proxied && !checkedZones.has(zone.id)) {
        checkedZones.add(zone.id);
        await warnSslMode(ctx, zone, out);
      }
    } catch (err) {
      out.warn(t('Cloudflare DNS: lỗi với {hostname}: {error}', { hostname, error: errorMessage(err) }));
    }
  }
}

/** Behind the proxy the origin must speak HTTPS: "Flexible" with "force HTTPS" loops forever. */
async function warnSslMode(ctx: Ctx, zone: CloudflareZone, out: DnsOut) {
  let mode: string | undefined;
  try {
    mode = (await cf<{ value?: string }>(ctx.token, 'GET', `${zonePath(zone)}/settings/ssl`)).result?.value;
  } catch {
    /* the token may not read zone settings */
  }
  if (mode === 'full' || mode === 'strict') return;
  if (mode) out.warn(t('Chế độ SSL/TLS của zone {zone} đang là "{mode}". Hãy đổi sang Full (strict) trong Cloudflare, nếu không site có thể bị lặp chuyển hướng.', { zone: zone.name, mode }));
  else out.info(t('Nhớ đặt chế độ SSL/TLS của zone {zone} là Full (strict) trong Cloudflare.', { zone: zone.name }));
}

// ---- Preview, status ----------------------------------------------------------------------

const NO_IP = () => t('Chưa xác định được IP public của máy chủ - nhập IP trong Cài đặt → Cloudflare DNS');

async function planOne(ctx: Ctx, hostname: string): Promise<HostnameDnsPlan> {
  const zone = matchZone(hostname, ctx.zones);
  if (!zone) return { hostname, zone: null, records: [], plan: [], error: null };
  try {
    const records = await listRecords(ctx, zone, hostname);
    const known = !!(ctx.want.ipv4 || ctx.want.ipv6);
    return { hostname, zone, records, plan: known ? planRecords(records, ctx.want, ctx.own) : [], error: known ? null : NO_IP() };
  } catch (err) {
    return { hostname, zone, records: [], plan: [], error: errorMessage(err) };
  }
}

/** What "create records" would do for each hostname (empty when Cloudflare is not connected). */
export async function planDns(hostnames: string[], opts: { ipv4Only?: boolean } = {}): Promise<DnsPlanResult> {
  if (!getCloudflareDnsView().connected) {
    const ip = await getServerIp();
    return { connected: false, ipv4: ip.ipv4, ipv6: ip.ipv6, hostnames: [] };
  }
  const ctx = await context(hostnames, opts.ipv4Only);
  return { connected: true, ...ctx.want, hostnames: await Promise.all(hostnames.map((h) => planOne(ctx, h))) };
}

const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);

/** Public answer for A/AAAA, asked from public resolvers (the local cache may still hold an old/negative answer). */
async function resolvePublic(hostname: string): Promise<HostnameDnsStatus['resolved']> {
  const ask = async (r: Pick<dns.Resolver, 'resolve4' | 'resolve6'>, rr: 4 | 6) => {
    try {
      return rr === 4 ? await r.resolve4(hostname) : await r.resolve6(hostname);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
      throw err;
    }
  };
  try {
    const [a, aaaa] = await Promise.all([ask(resolver, 4), ask(resolver, 6)]);
    return { a, aaaa, error: null };
  } catch {
    try {
      // outbound DNS to public resolvers blocked: use the system resolver
      const [a, aaaa] = await Promise.all([ask(dns, 4), ask(dns, 6)]);
      return { a, aaaa, error: null };
    } catch (err) {
      return { a: [], aaaa: [], error: errorMessage(err) };
    }
  }
}

export const isCloudflareIp = (ip: string) => [...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6].some((c) => ipInCidr(ip, c));

export const siteHostnames = (site: Pick<Site, 'domain' | 'aliases' | 'listenPort'>) => (site.listenPort ? [] : [site.domain, ...site.aliases]);

export async function siteDnsStatus(site: Site): Promise<SiteDnsStatus> {
  const hostnames = siteHostnames(site);
  const [plan, resolved] = await Promise.all([planDns(hostnames), Promise.all(hostnames.map(resolvePublic))]);
  const mine = [...serverAddresses(), plan.ipv4, plan.ipv6].filter((a): a is string => !!a);
  const here = (ip: string) => mine.some((m) => sameIp(m, ip));
  return {
    connected: plan.connected,
    ipv4: plan.ipv4,
    ipv6: plan.ipv6,
    sslEnabled: site.ssl.enabled,
    hostnames: hostnames.map((hostname, i): HostnameDnsStatus => {
      const p = plan.hostnames.find((x) => x.hostname === hostname) ?? { hostname, zone: null, records: [], plan: [], error: null };
      const r = resolved[i]!;
      const answers = [...r.a, ...r.aaaa];
      const ours = p.records.filter((rec) => rec.type !== 'CNAME' && here(rec.content));
      return {
        ...p,
        resolved: r,
        pointsHere: answers.some(here),
        viaCloudflare: answers.length > 0 && answers.every(isCloudflareIp),
        proxied: ours.length ? ours.every((rec) => rec.proxied) : null,
      };
    }),
  };
}

// ---- Hooks for "Add site" / "Assign domain" ----------------------------------------------------

/** Create the site's records inside its task. Never fails the task: problems become warnings. */
export async function autoDnsForSite(opt: AutoDnsInput | undefined, site: Site, log: HostLogger): Promise<void> {
  const hostnames = siteHostnames(site);
  if (!opt || !hostnames.length) return;
  const out = taskOut(log);
  if (!getCloudflareDnsView().connected) {
    out.warn(t('Chưa kết nối Cloudflare - bỏ qua tạo bản ghi DNS'));
    return;
  }
  log(t('Tạo bản ghi DNS trên Cloudflare (DNS only - đám mây xám)…'));
  try {
    await applyDnsRecords(hostnames, { overwrite: opt.overwrite }, out);
  } catch (err) {
    out.warn(t('Không tạo được bản ghi DNS trên Cloudflare: {error}', { error: errorMessage(err) }));
  }
}

/** The panel hostname: an A record, DNS only, always (Cloudflare does not proxy the panel port; the panel listens on IPv4). */
export async function ensurePanelRecord(domain: string, overwrite: boolean, out: DnsOut): Promise<void> {
  await applyDnsRecords([domain], { overwrite: overwrite ? [domain] : [], dnsOnly: true, ipv4Only: true }, out);
}
