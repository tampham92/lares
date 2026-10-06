import { type Lead, type LeadChannel, type LeadFailure, type NotifyTestInput, type TelegramChat } from '@lares/shared';
import { db, nowIso } from '../db/index.js';
import { defaultLang, t, tDefault } from '../i18n/index.js';
import { badRequest, errorMessage } from '../lib/errors.js';
import { VERSION } from './release.js';
import { effectiveNotify, enabledChannels, getGlobalNotify, getLead, getSiteNotify, ipLimiter, mergeNotify, purgeExpiredLeads, siteLimiter, type StoredNotifyConfig } from './leads.js';

/*
 * Lead notifications: Telegram (Bot API sendMessage) and a generic JSON webhook (Make, n8n,
 * Zapier, Google Apps Script...). Each lead gets one row per channel in lead_notifications,
 * processed by a small in-process worker with exponential backoff for transient failures.
 * The lead itself is stored before any of this runs, so a failing target never loses a lead.
 * Lead data goes nowhere except the targets configured here.
 */

type Fetch = typeof fetch;
export type SendResult = { ok: true } | { ok: false; error: string; retry: boolean };

const TIMEOUT_MS = 10_000;
/** Wait before attempt n+1 after a transient failure; attempts beyond the list give up. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// ---------------------------------------------------------------------------
// Message formatting (always the panel's default language: it is read by the owner)
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Phone in a form Telegram turns into a tap-to-call link (+country code). */
export function phoneForTel(phone: string, lang = defaultLang): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  // Vietnamese local numbers (0909 123 456) - the panel's home market
  if (lang === 'vi' && /^0\d{8,10}$/.test(digits)) return `+84${digits.slice(1)}`;
  return digits;
}

export function formatLeadTime(iso: string, lang = defaultLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Lines of the notification; `html` = Telegram HTML parse mode (values escaped). */
export function formatLeadMessage(lead: Lead, opts: { html: boolean; test?: boolean } = { html: false }): string {
  const v = (s: string) => (opts.html ? escapeHtml(s) : s);
  const b = (s: string) => (opts.html ? `<b>${escapeHtml(s)}</b>` : s);
  const title = opts.test ? tDefault('Thử thông báo khách liên hệ') : tDefault('Khách liên hệ mới');
  const lines = [`${b(title)} · ${v(lead.site)}`, ''];
  const add = (label: string, value: string) => value && lines.push(`${b(`${label}:`)} ${v(value)}`);
  add(tDefault('Họ tên'), lead.name);
  if (lead.phone) {
    const tel = phoneForTel(lead.phone);
    add(tDefault('Điện thoại'), tel && tel !== lead.phone.replace(/\s/g, '') ? `${lead.phone} · ${tel}` : lead.phone);
  }
  add('Email', lead.email);
  add(tDefault('Công ty'), lead.company);
  add(tDefault('Dịch vụ'), lead.service);
  if (lead.message) lines.push(b(`${tDefault('Lời nhắn')}:`), v(truncate(lead.message, 3000)));
  add(tDefault('Trang'), lead.pageUrl || lead.page);
  add(tDefault('Thời gian'), formatLeadTime(lead.createdAt));
  return lines.join('\n');
}

export function webhookPayload(lead: Lead, test = false) {
  return {
    event: 'lead.created',
    test,
    lead: {
      id: lead.id,
      site: lead.site,
      siteId: lead.siteId,
      name: lead.name,
      phone: lead.phone,
      phoneTel: lead.phone ? phoneForTel(lead.phone) : '',
      email: lead.email,
      company: lead.company,
      service: lead.service,
      message: lead.message,
      page: lead.page,
      pageUrl: lead.pageUrl,
      createdAt: lead.createdAt,
    },
    /** Ready-made plain text, handy for forwarding to Zalo/Slack/email from Make or n8n. */
    text: formatLeadMessage(lead, { html: false, test }),
  };
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

const isTransientStatus = (s: number) => s === 408 || s === 425 || s === 429 || s >= 500;

function networkError(err: unknown, secret?: string): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  let m = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? t('hết thời gian chờ ({seconds} giây)', { seconds: TIMEOUT_MS / 1000 }) : e?.cause?.code || e?.cause?.message || errorMessage(err);
  if (secret) m = m.split(secret).join('***');
  return t('Lỗi mạng: {error}', { error: m });
}

function telegramHint(description: string): string {
  if (/chat not found/i.test(description)) return t('Chưa tìm thấy chat: hãy nhắn /start cho bot (hoặc thêm bot vào nhóm) rồi kiểm tra lại Chat ID.');
  if (/unauthorized/i.test(description)) return t('Bot token sai hoặc đã bị thu hồi - tạo lại token trong @BotFather.');
  if (/blocked by the user/i.test(description)) return t('Người nhận đã chặn bot - mở chat với bot và bấm Bỏ chặn / Start.');
  if (/not enough rights|have no rights/i.test(description)) return t('Bot chưa có quyền gửi tin trong nhóm/kênh này.');
  return '';
}

export async function sendTelegram(cfg: StoredNotifyConfig['telegram'], text: string, fetchFn: Fetch = fetch): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchFn(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: networkError(err, cfg.botToken), retry: true };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (res.ok && body?.ok) return { ok: true };
  const description = (body?.description ?? res.statusText ?? '').split(cfg.botToken).join('***');
  const hint = telegramHint(description);
  return { ok: false, error: `Telegram ${res.status}: ${description}${hint ? ` - ${hint}` : ''}`, retry: isTransientStatus(res.status) };
}

export async function sendWebhook(cfg: StoredNotifyConfig['webhook'], payload: unknown, fetchFn: Fetch = fetch): Promise<SendResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': `Lares-Panel/${VERSION}`, 'X-Lares-Event': 'lead.created' };
  if (cfg.secret) headers[cfg.secretHeader || 'X-Lares-Secret'] = cfg.secret;
  let res: Response;
  try {
    res = await fetchFn(cfg.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch (err) {
    return { ok: false, error: networkError(err, cfg.secret), retry: true };
  }
  if (res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: true };
  }
  const text = truncate((await res.text().catch(() => '')).replace(/\s+/g, ' ').trim(), 200);
  return { ok: false, error: `Webhook HTTP ${res.status}${text ? `: ${text}` : ''}`, retry: isTransientStatus(res.status) };
}

export function sendChannel(channel: LeadChannel, cfg: StoredNotifyConfig, lead: Lead, fetchFn: Fetch = fetch, test = false): Promise<SendResult> {
  if (channel === 'telegram') return sendTelegram(cfg.telegram, formatLeadMessage(lead, { html: true, test }), fetchFn);
  return sendWebhook(cfg.webhook, webhookPayload(lead, test), fetchFn);
}

// ---------------------------------------------------------------------------
// Queue + worker
// ---------------------------------------------------------------------------

interface QueueRow {
  id: number;
  lead_id: number;
  channel: LeadChannel;
  attempts: number;
}

let fetchImpl: Fetch = fetch;
/** Tests swap the network out. */
export function setNotifyFetch(f: Fetch) {
  fetchImpl = f;
}

/** One pending row per enabled channel of the lead's site; delivery starts right away. */
export function queueNotifications(leadId: number, siteId: number | null): LeadChannel[] {
  const channels = enabledChannels(effectiveNotify(siteId));
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO lead_notifications (lead_id, channel, status, attempts, next_attempt_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?)
     ON CONFLICT(lead_id, channel) DO UPDATE SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at`,
  );
  for (const c of channels) ins.run(leadId, c, now, nowIso());
  if (channels.length) kick();
  return channels;
}

/** "Gửi lại": retry every channel of a lead (failed or not yet sent) with the current settings. */
export async function resendLead(leadId: number): Promise<Lead> {
  const lead = getLead(leadId);
  const channels = enabledChannels(effectiveNotify(lead.siteId));
  if (!channels.length) throw badRequest(t('Chưa bật kênh thông báo nào cho site này'));
  // channels that were turned off since: drop their stale rows
  db.prepare(`DELETE FROM lead_notifications WHERE lead_id = ? AND status != 'sent' AND channel NOT IN (${channels.map(() => '?').join(',')})`).run(leadId, ...channels);
  queueNotifications(leadId, lead.siteId);
  await processDue();
  return getLead(leadId);
}

const inFlight = new Set<number>();
let running: Promise<number> | null = null;

/** Deliver every due row (at most `limit`). Returns how many were attempted. */
export function processDue(now = Date.now(), limit = 25): Promise<number> {
  if (running) return running;
  running = (async () => {
    const rows = db
      .prepare(`SELECT id, lead_id, channel, attempts FROM lead_notifications WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`)
      .all(now, limit) as QueueRow[];
    for (const r of rows) {
      if (inFlight.has(r.id)) continue;
      inFlight.add(r.id);
      try {
        await deliver(r);
      } finally {
        inFlight.delete(r.id);
      }
    }
    return rows.length;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function deliver(r: QueueRow) {
  const attempts = r.attempts + 1;
  let lead: Lead;
  try {
    lead = getLead(r.lead_id);
  } catch {
    return; // deleted meanwhile (cascade removes the row)
  }
  const cfg = effectiveNotify(lead.siteId);
  let result: SendResult;
  if (!cfg || !enabledChannels(cfg).includes(r.channel)) result = { ok: false, error: tDefault('Kênh thông báo đã bị tắt hoặc chưa cấu hình'), retry: false };
  else {
    try {
      result = await sendChannel(r.channel, cfg, lead, fetchImpl);
    } catch (err) {
      result = { ok: false, error: errorMessage(err), retry: true };
    }
  }
  if (result.ok) {
    db.prepare(`UPDATE lead_notifications SET status = 'sent', attempts = ?, last_error = NULL, next_attempt_at = NULL, sent_at = ?, updated_at = ? WHERE id = ?`).run(attempts, nowIso(), nowIso(), r.id);
    return;
  }
  const delay = result.retry ? RETRY_DELAYS_MS[attempts - 1] : undefined;
  if (delay !== undefined) {
    db.prepare(`UPDATE lead_notifications SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`).run(attempts, result.error, Date.now() + delay, nowIso(), r.id);
  } else {
    db.prepare(`UPDATE lead_notifications SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`).run(attempts, result.error, nowIso(), r.id);
  }
}

function kick() {
  setImmediate(() => void processDue().catch(() => {}));
}

export function recentFailures(limit = 5): LeadFailure[] {
  const rows = db
    .prepare(
      `SELECT n.lead_id, n.channel, n.last_error, n.updated_at, COALESCE(s.domain, l.site_domain) AS site
       FROM lead_notifications n JOIN leads l ON l.id = n.lead_id LEFT JOIN sites s ON s.id = l.site_id
       WHERE n.status = 'failed' ORDER BY n.updated_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ lead_id: number; channel: LeadChannel; last_error: string | null; updated_at: string | null; site: string }>;
  return rows.map((r) => ({ leadId: r.lead_id, site: r.site, channel: r.channel, error: r.last_error ?? '', at: r.updated_at ?? '' }));
}

// ---------------------------------------------------------------------------
// "Gửi thử" and "Tìm chat ID"
// ---------------------------------------------------------------------------

function storedFor(siteId?: number): StoredNotifyConfig {
  return siteId ? getSiteNotify(siteId).config : getGlobalNotify();
}

export function sampleLead(site = 'example.com'): Lead {
  return {
    id: 0,
    siteId: null,
    site,
    host: site,
    name: tDefault('Nguyễn Văn A'),
    phone: '0909 123 456',
    email: 'khach@example.com',
    company: '',
    service: tDefault('Tư vấn'),
    message: tDefault('Đây là tin nhắn thử từ Lares Panel. Nếu bạn nhận được, thông báo khách liên hệ đã hoạt động.'),
    page: '/lien-he',
    pageUrl: `https://${site}/lien-he`,
    ip: '',
    status: 'new',
    note: '',
    createdAt: nowIso(),
    updatedAt: null,
    notifications: [],
  };
}

/** Send a sample lead through one channel using the form values (stored secrets fill the gaps). */
export async function testChannel(input: NotifyTestInput, site?: string, fetchFn: Fetch = fetchImpl): Promise<string> {
  const cur = storedFor(input.siteId);
  const merged = mergeNotify(cur, {
    telegram: { ...(input.telegram ?? { chatId: cur.telegram.chatId }), enabled: input.channel === 'telegram' },
    webhook: { ...(input.webhook ?? { url: cur.webhook.url, secretHeader: cur.webhook.secretHeader }), enabled: input.channel === 'webhook' },
  });
  const r = await sendChannel(input.channel, merged, sampleLead(site), fetchFn, true);
  if (!r.ok) throw badRequest(r.error);
  return input.channel === 'telegram' ? t('Đã gửi tin nhắn thử tới Telegram') : t('Webhook đã nhận dữ liệu thử');
}

/** Chats that recently messaged the bot, so the owner can pick a chat ID instead of hunting for it. */
export async function telegramChats(token: string, fetchFn: Fetch = fetchImpl): Promise<TelegramChat[]> {
  if (!token) throw badRequest(t('Nhập bot token trước'));
  let res: Response;
  try {
    res = await fetchFn(`https://api.telegram.org/bot${token}/getUpdates?limit=100&allowed_updates=${encodeURIComponent('["message","channel_post","my_chat_member"]')}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw badRequest(networkError(err, token));
  }
  type Chat = { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: Array<Record<string, { chat?: Chat } | undefined>> } | null;
  if (!res.ok || !body?.ok) {
    const description = (body?.description ?? res.statusText).split(token).join('***');
    if (res.status === 409) throw badRequest(t('Bot đang dùng webhook nên không đọc được tin nhắn - tắt webhook của bot (deleteWebhook) hoặc nhập Chat ID thủ công.'));
    const hint = telegramHint(description);
    throw badRequest(`Telegram ${res.status}: ${description}${hint ? ` - ${hint}` : ''}`);
  }
  const chats = new Map<string, TelegramChat>();
  for (const u of body.result ?? []) {
    for (const key of ['message', 'channel_post', 'my_chat_member', 'edited_message']) {
      const c = u[key]?.chat;
      if (!c) continue;
      const title = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.username ? `@${c.username}` : String(c.id));
      chats.set(String(c.id), { id: String(c.id), title, type: c.type });
    }
  }
  return [...chats.values()].reverse();
}

/** Token for "Tìm chat ID": the one typed in the form, else the stored one (global or site). */
export function resolveBotToken(input: { botToken?: string; siteId?: number }): string {
  return input.botToken || storedFor(input.siteId).telegram.botToken;
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

let jobsStarted = false;

/** Notification worker, daily retention purge, rate-limiter cleanup. Safe to call more than once. */
export function startLeadJobs(log: (m: string) => void): () => void {
  if (jobsStarted) return () => {};
  jobsStarted = true;
  const purge = () => {
    try {
      const n = purgeExpiredLeads();
      if (n) log(tDefault('Đã xoá {count} khách liên hệ quá hạn lưu trữ', { count: n }));
    } catch (err) {
      log(`lead retention: ${errorMessage(err)}`);
    }
  };
  purge();
  kick();
  const worker = setInterval(() => void processDue().catch((err) => log(`lead notifications: ${errorMessage(err)}`)), 15_000);
  const daily = setInterval(purge, 6 * 3_600_000);
  const sweep = setInterval(() => {
    ipLimiter.sweep();
    siteLimiter.sweep();
  }, 10 * 60_000);
  for (const h of [worker, daily, sweep]) h.unref();
  return () => {
    clearInterval(worker);
    clearInterval(daily);
    clearInterval(sweep);
    jobsStarted = false;
  };
}

