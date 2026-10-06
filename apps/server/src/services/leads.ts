import fs from 'node:fs/promises';
import {
  LEAD_ERROR_HASH,
  LEAD_LIMITS,
  LEAD_SENT_HASH,
  LEAD_STATUSES,
  leadSettingsInputSchema,
  type Lead,
  type LeadChannel,
  type LeadField,
  type LeadListQuery,
  type LeadListResponse,
  type LeadNotification,
  type LeadSettingsInput,
  type LeadStatus,
  type LeadUpdate,
  type NotifyConfigInput,
  type NotifyConfigView,
  type SiteLeadSettingsInput,
  type SiteLeadSettingsView,
  type SiteNotifyMode,
} from '@lares/shared';
import { db, getSetting, nowIso, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, errorMessage, notFound } from '../lib/errors.js';
import { hasCurrentLeadLocation } from './leadsNginx.js';
import { renderVhost, supportsHttp2Directive, testAndReload, vhostPath } from './nginx.js';
import { host, type HostLogger } from './host.js';
import * as sites from './sites.js';

/*
 * Lead capture: parsing of the public form contract, spam controls (honeypot + rate limits),
 * storage, inbox queries, notification settings and retention. Delivery lives in leadNotify.ts.
 */

// ---------------------------------------------------------------------------
// Form contract parsing
// ---------------------------------------------------------------------------

export type LeadInput = Record<LeadField, string>;
export type ParsedLead = { kind: 'ok'; lead: LeadInput } | { kind: 'spam' } | { kind: 'invalid'; error: string };

function fieldLabel(f: LeadField): string {
  const labels: Record<LeadField, string> = {
    name: t('Họ tên'),
    phone: t('Số điện thoại'),
    email: 'Email',
    company: t('Công ty'),
    service: t('Dịch vụ'),
    message: t('Lời nhắn'),
    page: t('Trang'),
  };
  return labels[f];
}

const PHONE_RE = /^\+?[0-9 ().-]{6,40}$/;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:.]{2,}$/;

/** Form values arrive as strings (urlencoded) or JSON scalars; anything else counts as empty. */
function scalar(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return '';
}

/** NFC, no control characters, trimmed; single-line fields also collapse runs of whitespace. */
export function cleanText(v: string, multiline: boolean): string {
  let s = v.normalize('NFC').replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  s = multiline ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '') : s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  s = s.replace(/[\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  else s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  return s.trim();
}

/**
 * A same-site path (`/x?y`) safe to use in a Location header: one leading slash (no
 * protocol-relative `//evil`), no backslashes, no fragment, printable ASCII only.
 */
export function safePath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  let s = p.trim().split('#')[0]!;
  if (!s.startsWith('/') && !s.startsWith('\\')) return null;
  s = '/' + s.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/[^\x21-\x7e]/.test(s)) {
    try {
      s = encodeURI(decodeURI(s));
    } catch {
      return null;
    }
  }
  return /^\/[\x21-\x7e]*$/.test(s) ? s : null;
}

export function parseLeadBody(body: unknown): ParsedLead {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'invalid', error: t('Dữ liệu gửi lên không hợp lệ') };
  const raw = body as Record<string, unknown>;
  // Honeypot: humans never see the field. Pretend success so bots learn nothing.
  if (cleanText(scalar(raw._hp), false) !== '') return { kind: 'spam' };

  const lead = {} as LeadInput;
  for (const f of Object.keys(LEAD_LIMITS) as LeadField[]) {
    const value = cleanText(scalar(raw[f]), f === 'message');
    if (f === 'page') {
      lead.page = (safePath(value) ?? '').slice(0, LEAD_LIMITS.page);
      continue;
    }
    if (value.length > LEAD_LIMITS[f]) return { kind: 'invalid', error: t('{field} quá dài (tối đa {max} ký tự)', { field: fieldLabel(f), max: LEAD_LIMITS[f] }) };
    lead[f] = value;
  }
  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, '').length;
    if (!PHONE_RE.test(lead.phone) || digits < 6 || digits > 20) return { kind: 'invalid', error: t('Số điện thoại không hợp lệ') };
  }
  if (lead.email && !EMAIL_RE.test(lead.email)) return { kind: 'invalid', error: t('Email không hợp lệ') };
  if (!lead.phone && !lead.email) return { kind: 'invalid', error: t('Vui lòng nhập số điện thoại hoặc email') };
  return { kind: 'ok', lead };
}

// ---------------------------------------------------------------------------
// Redirect after a plain form post (no JS)
// ---------------------------------------------------------------------------

/**
 * Where to send the browser back to: the Referer when it is on the same site (the host the
 * visitor used, or one of the site's names), else the posted page path, else "/". Always a
 * relative path so the redirect can never leave the site.
 */
export function leadRedirect(opts: { referer?: string; host?: string; siteHosts: string[]; page?: string; ok: boolean }): string {
  const hash = opts.ok ? LEAD_SENT_HASH : LEAD_ERROR_HASH;
  const ref = refererOnSite(opts.referer, opts.host, opts.siteHosts);
  const target = (ref && safePath(ref.pathname + ref.search)) ?? safePath(opts.page) ?? '/';
  return target + hash;
}

/** The Referer as a URL when it points at this site, else null. */
export function refererOnSite(referer: string | undefined, hostHeader: string | undefined, siteHosts: string[]): URL | null {
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const h = url.host.toLowerCase();
  if (hostHeader && h === hostHeader.trim().toLowerCase()) return url;
  return siteHosts.some((s) => s.toLowerCase() === url.hostname.toLowerCase()) ? url : null;
}

// ---------------------------------------------------------------------------
// Rate limiting (in memory: per client IP and per site)
// ---------------------------------------------------------------------------

export interface RateRule {
  windowMs: number;
  max: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly longest: number;

  constructor(private readonly rules: RateRule[]) {
    this.longest = Math.max(...rules.map((r) => r.windowMs));
  }

  /** Counts a hit unless one of the rules is already exhausted; false = limited (not counted). */
  hit(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((ts) => ts > now - this.longest);
    for (const r of this.rules) {
      let n = 0;
      for (const ts of list) if (ts > now - r.windowMs) n++;
      if (n >= r.max) {
        this.hits.set(key, list);
        return false;
      }
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Forget keys with no hit inside the longest window (called periodically). */
  sweep(now = Date.now()) {
    for (const [k, list] of this.hits) {
      const kept = list.filter((ts) => ts > now - this.longest);
      if (kept.length) this.hits.set(k, kept);
      else this.hits.delete(k);
    }
  }

  reset() {
    this.hits.clear();
  }
}

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Per visitor IP: every attempt counts (also invalid ones and honeypot hits). */
export const ipLimiter = new RateLimiter([
  { windowMs: MINUTE, max: 5 },
  { windowMs: DAY, max: 50 },
]);
/** Per site: stored leads only, caps a flood coming from many IPs. */
export const siteLimiter = new RateLimiter([
  { windowMs: MINUTE, max: 30 },
  { windowMs: DAY, max: 1000 },
]);

// ---------------------------------------------------------------------------
// Storage + inbox
// ---------------------------------------------------------------------------

interface LeadRow {
  id: number;
  site_id: number | null;
  site_domain: string;
  current_domain: string | null;
  host: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  service: string;
  message: string;
  page: string;
  page_url: string;
  ip: string;
  status: LeadStatus;
  note: string;
  created_at: string;
  updated_at: string | null;
}

interface NotificationRow {
  lead_id: number;
  channel: LeadChannel;
  status: LeadNotification['status'];
  attempts: number;
  last_error: string | null;
  next_attempt_at: number | null;
  sent_at: string | null;
}

const SELECT_LEAD = `SELECT l.*, s.domain AS current_domain FROM leads l LEFT JOIN sites s ON s.id = l.site_id`;

function toLead(r: LeadRow, notifications: LeadNotification[] = []): Lead {
  return {
    id: r.id,
    siteId: r.site_id,
    site: r.current_domain ?? r.site_domain,
    host: r.host,
    name: r.name,
    phone: r.phone,
    email: r.email,
    company: r.company,
    service: r.service,
    message: r.message,
    page: r.page,
    pageUrl: r.page_url,
    ip: r.ip,
    status: (LEAD_STATUSES as readonly string[]).includes(r.status) ? r.status : 'new',
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    notifications,
  };
}

const toNotification = (n: NotificationRow): LeadNotification => ({
  channel: n.channel,
  status: n.status,
  attempts: n.attempts,
  error: n.last_error,
  sentAt: n.sent_at,
  nextAttemptAt: n.status === 'pending' && n.next_attempt_at ? new Date(n.next_attempt_at).toISOString() : null,
});

function notificationsFor(ids: number[]): Map<number, LeadNotification[]> {
  const out = new Map<number, LeadNotification[]>();
  if (!ids.length) return out;
  const rows = db
    .prepare(`SELECT lead_id, channel, status, attempts, last_error, next_attempt_at, sent_at FROM lead_notifications WHERE lead_id IN (${ids.map(() => '?').join(',')}) ORDER BY channel`)
    .all(...ids) as NotificationRow[];
  for (const r of rows) out.set(r.lead_id, [...(out.get(r.lead_id) ?? []), toNotification(r)]);
  return out;
}

export interface LeadMeta {
  host: string;
  ip: string;
  pageUrl: string;
}

export function insertLead(site: { id: number; domain: string }, lead: LeadInput, meta: LeadMeta, now = nowIso()): number {
  const info = db
    .prepare(
      `INSERT INTO leads (site_id, site_domain, host, name, phone, email, company, service, message, page, page_url, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(site.id, site.domain, meta.host.slice(0, 255), lead.name, lead.phone, lead.email, lead.company, lead.service, lead.message, lead.page, meta.pageUrl.slice(0, 1000), meta.ip.slice(0, 64), now);
  return Number(info.lastInsertRowid);
}

export function getLead(id: number): Lead {
  const row = db.prepare(`${SELECT_LEAD} WHERE l.id = ?`).get(id) as LeadRow | undefined;
  if (!row) throw notFound(t('Không tìm thấy khách liên hệ'));
  return toLead(row, notificationsFor([id]).get(id) ?? []);
}

function whereFor(q: Pick<LeadListQuery, 'siteId' | 'status' | 'q'>): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (q.siteId) {
    parts.push('l.site_id = ?');
    params.push(q.siteId);
  }
  if (q.status) {
    parts.push('l.status = ?');
    params.push(q.status);
  }
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(`(${['l.name', 'l.phone', 'l.email', 'l.company', 'l.service', 'l.message', 'l.note', 'l.site_domain'].map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    params.push(...Array(8).fill(like));
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export const newLeadCount = (): number => (db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE status = 'new'`).get() as { c: number }).c;

export function listLeads(q: LeadListQuery): LeadListResponse {
  const w = whereFor(q);
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM leads l ${w.sql}`).get(...w.params) as { c: number }).c;
  const rows = db.prepare(`${SELECT_LEAD} ${w.sql} ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...w.params, q.limit, q.offset) as LeadRow[];
  const notes = notificationsFor(rows.map((r) => r.id));
  return { leads: rows.map((r) => toLead(r, notes.get(r.id) ?? [])), total, newCount: newLeadCount() };
}

export function updateLead(id: number, patch: LeadUpdate): Lead {
  const cur = getLead(id);
  db.prepare('UPDATE leads SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(patch.status ?? cur.status, patch.note ?? cur.note, nowIso(), id);
  return getLead(id);
}

export function deleteLead(id: number) {
  if (db.prepare('DELETE FROM leads WHERE id = ?').run(id).changes === 0) throw notFound(t('Không tìm thấy khách liên hệ'));
}

// ---- CSV export --------------------------------------------------------------------

const CSV_MAX_ROWS = 50_000;

/** Quote for CSV and defuse spreadsheet formulas (a phone number like +84... stays as is). */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^\+?[0-9 ().-]+$/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadsCsv(q: Pick<LeadListQuery, 'siteId' | 'status' | 'q'>): string {
  const w = whereFor(q);
  const rows = db.prepare(`${SELECT_LEAD} ${w.sql} ORDER BY l.id DESC LIMIT ${CSV_MAX_ROWS}`).all(...w.params) as LeadRow[];
  const header = [t('Thời gian'), 'Website', t('Họ tên'), t('Số điện thoại'), 'Email', t('Công ty'), t('Dịch vụ'), t('Lời nhắn'), t('Trang'), t('Trạng thái'), t('Ghi chú'), 'IP'];
  const statusLabel: Record<LeadStatus, string> = { new: t('Mới'), contacted: t('Đã liên hệ'), done: t('Hoàn tất') };
  const lines = rows.map((r) => {
    const l = toLead(r);
    return [l.createdAt, l.site, l.name, l.phone, l.email, l.company, l.service, l.message, l.pageUrl || l.page, statusLabel[l.status], l.note, l.ip].map(csvCell).join(',');
  });
  // BOM: Excel otherwise opens UTF-8 Vietnamese as mojibake
  return '\ufeff' + [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Notification settings (global + per-site override), secrets encrypted
// ---------------------------------------------------------------------------

export interface StoredNotifyConfig {
  telegram: { enabled: boolean; botToken: string; chatId: string };
  webhook: { enabled: boolean; url: string; secretHeader: string; secret: string };
}

export const EMPTY_NOTIFY: StoredNotifyConfig = {
  telegram: { enabled: false, botToken: '', chatId: '' },
  webhook: { enabled: false, url: '', secretHeader: 'X-Lares-Secret', secret: '' },
};

function decodeNotify(enc: string | null | undefined): StoredNotifyConfig {
  if (!enc) return structuredClone(EMPTY_NOTIFY);
  try {
    const v = decrypt<Partial<StoredNotifyConfig>>(enc);
    return { telegram: { ...EMPTY_NOTIFY.telegram, ...v.telegram }, webhook: { ...EMPTY_NOTIFY.webhook, ...v.webhook } };
  } catch {
    return structuredClone(EMPTY_NOTIFY);
  }
}

/** Apply a form submission: empty secrets keep the stored value, clear* flags remove it. */
export function mergeNotify(cur: StoredNotifyConfig, input: NotifyConfigInput): StoredNotifyConfig {
  const tg = input.telegram;
  const wh = input.webhook;
  const next: StoredNotifyConfig = {
    telegram: {
      enabled: tg.enabled,
      botToken: tg.clearBotToken ? '' : tg.botToken || cur.telegram.botToken,
      chatId: tg.chatId,
    },
    webhook: {
      enabled: wh.enabled,
      url: wh.url,
      secretHeader: wh.secretHeader || 'X-Lares-Secret',
      secret: wh.clearSecret ? '' : wh.secret || cur.webhook.secret,
    },
  };
  if (next.telegram.enabled && (!next.telegram.botToken || !next.telegram.chatId)) throw badRequest(t('Bật Telegram cần có bot token và chat ID'));
  if (next.webhook.enabled && !next.webhook.url) throw badRequest(t('Bật webhook cần có URL'));
  return next;
}

export function tokenHint(token: string): string | null {
  if (!token) return null;
  const [id] = token.split(':');
  return `${id}:…${token.slice(-3)}`;
}

export function notifyView(c: StoredNotifyConfig): NotifyConfigView {
  return {
    telegram: { enabled: c.telegram.enabled, hasToken: !!c.telegram.botToken, tokenHint: tokenHint(c.telegram.botToken), chatId: c.telegram.chatId },
    webhook: { enabled: c.webhook.enabled, url: c.webhook.url, secretHeader: c.webhook.secretHeader, hasSecret: !!c.webhook.secret },
  };
}

const SETTINGS_KEY = 'leads';
interface StoredLeadSettings {
  retentionMonths: number;
  notify_enc?: string;
}

const storedSettings = (): StoredLeadSettings => ({ retentionMonths: 12, ...getSetting<Partial<StoredLeadSettings>>(SETTINGS_KEY, {}) });

export const getRetentionMonths = () => storedSettings().retentionMonths;
export const getGlobalNotify = (): StoredNotifyConfig => decodeNotify(storedSettings().notify_enc);

export function saveLeadSettings(input: LeadSettingsInput) {
  const parsed = leadSettingsInputSchema.parse(input);
  const notify = mergeNotify(getGlobalNotify(), parsed);
  setSetting(SETTINGS_KEY, { retentionMonths: parsed.retentionMonths, notify_enc: encrypt(notify) } satisfies StoredLeadSettings);
}

interface SiteSettingsRow {
  mode: SiteNotifyMode;
  config_enc: string | null;
}

export function getSiteNotify(siteId: number): { mode: SiteNotifyMode; config: StoredNotifyConfig } {
  const row = db.prepare('SELECT mode, config_enc FROM site_lead_settings WHERE site_id = ?').get(siteId) as SiteSettingsRow | undefined;
  return { mode: row?.mode ?? 'inherit', config: decodeNotify(row?.config_enc) };
}

export function saveSiteNotify(siteId: number, input: SiteLeadSettingsInput) {
  sites.getSite(siteId);
  const cur = getSiteNotify(siteId);
  // "inherit"/"off" keep the site's own config around so switching back does not lose it
  const config = input.mode === 'custom' ? mergeNotify(cur.config, input) : cur.config;
  db.prepare(
    'INSERT INTO site_lead_settings (site_id, mode, config_enc) VALUES (?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET mode = excluded.mode, config_enc = excluded.config_enc',
  ).run(siteId, input.mode, encrypt(config));
}

/** What a lead of this site is sent to: the site's own config, the global one, or nothing. */
export function effectiveNotify(siteId: number | null): StoredNotifyConfig | null {
  if (siteId) {
    const s = getSiteNotify(siteId);
    if (s.mode === 'off') return null;
    if (s.mode === 'custom') return s.config;
  }
  return getGlobalNotify();
}

export function enabledChannels(c: StoredNotifyConfig | null): LeadChannel[] {
  if (!c) return [];
  const out: LeadChannel[] = [];
  if (c.telegram.enabled && c.telegram.botToken && c.telegram.chatId) out.push('telegram');
  if (c.webhook.enabled && c.webhook.url) out.push('webhook');
  return out;
}

export async function siteLeadSettingsView(siteId: number): Promise<SiteLeadSettingsView> {
  const site = sites.getSite(siteId);
  const s = getSiteNotify(siteId);
  const vhost = await fs.readFile(vhostPath(site.domain), 'utf8').catch(() => '');
  return { mode: s.mode, ...notifyView(s.config), vhostReady: site.status === 'disabled' || hasCurrentLeadLocation(vhost, site.domain) };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Delete leads older than `months` (0 = keep forever). Returns how many were removed. */
export function purgeExpiredLeads(months = getRetentionMonths(), now = new Date()): number {
  if (!months || months <= 0) return 0;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return db.prepare('DELETE FROM leads WHERE created_at < ?').run(cutoff.toISOString()).changes;
}

// ---------------------------------------------------------------------------
// Existing vhosts: add the lead location (startup, idempotent)
// ---------------------------------------------------------------------------

/**
 * Sites created before lead capture existed (or before the panel port/TLS changed) lack the
 * current /_lares/lead location. Re-render only those vhosts, validate once with `nginx -t`,
 * and restore every file if the batch is rejected (then retry site by site, so one broken
 * vhost does not keep the others from being fixed).
 */
export async function ensureLeadVhosts(log: HostLogger): Promise<number> {
  const http2Directive = await supportsHttp2Directive();
  const changed: Array<{ domain: string; file: string; previous: string; next: string }> = [];
  for (const site of sites.listSites()) {
    if (site.status === 'disabled') continue;
    const file = vhostPath(site.domain);
    const previous = await fs.readFile(file, 'utf8').catch(() => null);
    if (previous === null || hasCurrentLeadLocation(previous, site.domain)) continue;
    changed.push({ domain: site.domain, file, previous, next: renderVhost(sites.vhostSpecFor(site), { http2Directive }) });
  }
  if (!changed.length) return 0;

  for (const c of changed) await host.writeFile(c.file, c.next);
  try {
    await testAndReload(log);
    log(t('Đã thêm địa chỉ nhận form liên hệ vào {count} vhost', { count: changed.length }));
    return changed.length;
  } catch (err) {
    for (const c of changed) await host.writeFile(c.file, c.previous);
    log(t('Không cập nhật được vhost cho form liên hệ, thử từng site: {error}', { error: errorMessage(err) }));
  }

  let ok = 0;
  for (const c of changed) {
    await host.writeFile(c.file, c.next);
    try {
      await testAndReload(log);
      ok++;
    } catch (err) {
      await host.writeFile(c.file, c.previous);
      log(t('Bỏ qua vhost {domain}: {error}', { domain: c.domain, error: errorMessage(err) }));
    }
  }
  return ok;
}
