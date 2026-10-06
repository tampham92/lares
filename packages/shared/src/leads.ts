import { z } from 'zod';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// Lead capture: contact forms on managed sites post to /_lares/lead, nginx proxies
// that location to the panel (loopback only), leads land in the panel DB and are
// forwarded to the configured notification targets.
// ---------------------------------------------------------------------------

/** Path every managed site answers on its own domain/port (the form contract). */
export const LEAD_FORM_PATH = '/_lares/lead';
/** Panel endpoint nginx proxies LEAD_FORM_PATH to; refuses anything but loopback. */
export const LEAD_PANEL_PATH = '/api/public/leads';
/** Hash appended to the 303 redirect after a plain (no-JS) form post. */
export const LEAD_SENT_HASH = '#lares-sent';
export const LEAD_ERROR_HASH = '#lares-error';

/** Contract field limits (characters, after trimming). */
export const LEAD_LIMITS = {
  name: 120,
  phone: 40,
  email: 200,
  company: 200,
  service: 200,
  message: 5000,
  page: 500,
} as const;
export type LeadField = keyof typeof LEAD_LIMITS;

export const LEAD_STATUSES = ['new', 'contacted', 'done'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: msg('Mới'),
  contacted: msg('Đã liên hệ'),
  done: msg('Hoàn tất'),
};

export const LEAD_CHANNELS = ['telegram', 'webhook'] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];
export const LEAD_CHANNEL_LABELS: Record<LeadChannel, string> = { telegram: 'Telegram', webhook: 'Webhook' };

export type LeadNotificationStatus = 'pending' | 'sent' | 'failed';

export interface LeadNotification {
  channel: LeadChannel;
  status: LeadNotificationStatus;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
}

export interface Lead {
  id: number;
  siteId: number | null;
  /** Current domain of the site (or the domain stored with the lead when the site is gone). */
  site: string;
  /** Host the visitor used (domain or ip:port). */
  host: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  service: string;
  message: string;
  /** Path of the page the form was on. */
  page: string;
  /** Absolute URL of that page when known. */
  pageUrl: string;
  ip: string;
  status: LeadStatus;
  note: string;
  createdAt: string;
  updatedAt: string | null;
  notifications: LeadNotification[];
}

export const leadListQuerySchema = z.object({
  siteId: z.coerce.number().int().positive().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export interface LeadListResponse {
  leads: Lead[];
  total: number;
  /** Leads still "new" across all sites (the sidebar badge). */
  newCount: number;
}

export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().max(2000, msg('Ghi chú tối đa 2000 ký tự')).optional(),
});
export type LeadUpdate = z.infer<typeof leadUpdateSchema>;

// ---- Notification settings ---------------------------------------------------------
// Secrets (bot token, webhook secret) are write-only: empty/omitted = keep the stored one.

export const TELEGRAM_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
export const TELEGRAM_CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
export const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;

export const telegramInputSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z
    .string()
    .trim()
    .max(100)
    .refine((v) => v === '' || TELEGRAM_TOKEN_RE.test(v), msg('Bot token không hợp lệ (dạng 123456789:ABC...)'))
    .optional(),
  clearBotToken: z.boolean().optional(),
  chatId: z
    .string()
    .trim()
    .max(64)
    .refine((v) => v === '' || TELEGRAM_CHAT_RE.test(v), msg('Chat ID không hợp lệ (số, ví dụ 123456789 hoặc -100123..., hoặc @tenkenh)'))
    .default(''),
});
export type TelegramInput = z.infer<typeof telegramInputSchema>;

export const webhookInputSchema = z.object({
  enabled: z.boolean().default(false),
  url: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === '' || /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(v), msg('URL webhook phải bắt đầu bằng https:// hoặc http://'))
    .default(''),
  secretHeader: z
    .string()
    .trim()
    .refine((v) => v === '' || HEADER_NAME_RE.test(v), msg('Tên header chỉ gồm chữ, số và dấu gạch ngang'))
    .default('X-Lares-Secret'),
  secret: z.string().max(500).optional(),
  clearSecret: z.boolean().optional(),
});
export type WebhookInput = z.infer<typeof webhookInputSchema>;

export const notifyConfigInputSchema = z.object({
  telegram: telegramInputSchema.default({}),
  webhook: webhookInputSchema.default({}),
});
export type NotifyConfigInput = z.infer<typeof notifyConfigInputSchema>;

export const leadSettingsInputSchema = notifyConfigInputSchema.extend({
  /** Leads older than this are deleted automatically; 0 = keep forever. */
  retentionMonths: z.coerce.number().int().min(0).max(120).default(12),
});
export type LeadSettingsInput = z.infer<typeof leadSettingsInputSchema>;

export interface TelegramView {
  enabled: boolean;
  hasToken: boolean;
  /** "123456789:…xYz" - enough to recognise the bot, useless to an attacker. */
  tokenHint: string | null;
  chatId: string;
}

export interface WebhookView {
  enabled: boolean;
  url: string;
  secretHeader: string;
  hasSecret: boolean;
}

export interface NotifyConfigView {
  telegram: TelegramView;
  webhook: WebhookView;
}

export interface LeadFailure {
  leadId: number;
  site: string;
  channel: LeadChannel;
  error: string;
  at: string;
}

export interface LeadSettingsView extends NotifyConfigView {
  retentionMonths: number;
  /** Most recent notifications that gave up (shown in the Settings card). */
  recentFailures: LeadFailure[];
}

export const SITE_NOTIFY_MODES = ['inherit', 'custom', 'off'] as const;
export type SiteNotifyMode = (typeof SITE_NOTIFY_MODES)[number];

export const siteLeadSettingsInputSchema = notifyConfigInputSchema.extend({
  mode: z.enum(SITE_NOTIFY_MODES).default('inherit'),
});
export type SiteLeadSettingsInput = z.infer<typeof siteLeadSettingsInputSchema>;

export interface SiteLeadSettingsView extends NotifyConfigView {
  mode: SiteNotifyMode;
  /** The site's nginx vhost already proxies LEAD_FORM_PATH to the panel. */
  vhostReady: boolean;
}

/** "Gửi thử": test one channel with the values in the form (missing secrets fall back to the stored ones). */
export const notifyTestSchema = z.object({
  channel: z.enum(LEAD_CHANNELS),
  siteId: z.number().int().positive().optional(),
  telegram: telegramInputSchema.optional(),
  webhook: webhookInputSchema.optional(),
});
export type NotifyTestInput = z.infer<typeof notifyTestSchema>;

/** "Tìm chat ID": recent chats that talked to the bot (Telegram getUpdates). */
export const telegramChatsSchema = z.object({
  siteId: z.number().int().positive().optional(),
  botToken: z
    .string()
    .trim()
    .max(100)
    .refine((v) => v === '' || TELEGRAM_TOKEN_RE.test(v), msg('Bot token không hợp lệ (dạng 123456789:ABC...)'))
    .optional(),
});

export interface TelegramChat {
  id: string;
  title: string;
  type: string;
}
