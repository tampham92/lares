import { z } from 'zod';
import { HHMM_RE } from './backup.js';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// Site security tab (server: services/malware.ts, quarantine.ts, codeLock.ts):
// malware scan (C5), emergency quarantine + cleaning (C6), code lock (C7).
// ---------------------------------------------------------------------------

// ---- Malware scan ----------------------------------------------------------

export const SCAN_CHECKS = [
  'core-checksum',
  'plugin-checksum',
  'uploads-php',
  'uploads-code',
  'mu-plugin',
  'drop-in',
  'hidden-php',
  'payload',
  'implant-ref',
  'cron',
  'user-ini',
  'pattern',
  'changed',
  'new-admin',
  'site-url',
  'db-script',
  'firewall',
] as const;
export type ScanCheck = (typeof SCAN_CHECKS)[number];

/** Title of each kind of finding (translated in the UI). */
export const SCAN_CHECK_LABELS: Record<ScanCheck, string> = {
  'core-checksum': msg('File lõi WordPress khác bản gốc'),
  'plugin-checksum': msg('File plugin khác bản trên wordpress.org'),
  'uploads-php': msg('File PHP trong thư mục uploads'),
  'uploads-code': msg('File trong uploads có chứa mã PHP'),
  'mu-plugin': msg('File lạ trong mu-plugins'),
  'drop-in': msg('Drop-in lạ trong wp-content (WordPress nạp ở mọi request)'),
  'hidden-php': msg('File PHP trong thư mục hoặc file ẩn của wp-content'),
  payload: msg('File ẩn hoặc file zip lạ trong wp-content'),
  'implant-ref': msg('File mang tên hoặc nhắc tới mu-plugin bị đánh dấu'),
  cron: msg('Tác vụ WP-Cron đáng ngờ'),
  'user-ini': msg('.user.ini nạp file PHP vào mọi request'),
  pattern: msg('Mã thường gặp trong mã độc'),
  changed: msg('File PHP mới hoặc bị sửa từ lần quét trước'),
  'new-admin': msg('Tài khoản quản trị mới'),
  'site-url': msg('Địa chỉ site bị đổi'),
  'db-script': msg('Đoạn <script> trong database'),
  firewall: msg('Kết nối ra ngoài bị tường lửa chặn'),
};

export const SCAN_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type ScanSeverity = (typeof SCAN_SEVERITIES)[number];

export interface ScanFinding {
  check: ScanCheck;
  severity: ScanSeverity;
  /** Relative to the site folder (files) or a DB/firewall reference. */
  path?: string;
  /** Raw detail: the matched code, the checksum message, the blocked destination... (not translated). */
  detail?: string;
  /** Grouped findings (e.g. 57 changed files of one plugin). */
  count?: number;
  /** The owner marked this file (this exact content) as not malware: shown as info, with its original severity. */
  ignored?: ScanSeverity;
}

export const SCAN_STATUSES = ['running', 'clean', 'warning', 'infected', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SCAN_TRIGGERS = ['manual', 'scheduled', 'clean'] as const;
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];

export interface MalwareScanSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: ScanStatus;
  trigger: ScanTrigger;
  counts: Record<ScanSeverity, number>;
  filesScanned: number;
  error: string | null;
}

export interface MalwareScan extends MalwareScanSummary {
  findings: ScanFinding[];
  /** The site had more files than one scan reads; the rest was not checked. */
  truncated: boolean;
}

export const securitySettingsSchema = z.object({
  /** Daily scan of every site. */
  scanEnabled: z.boolean().default(true),
  /** Server local time. */
  scanTime: z.string().regex(HHMM_RE, msg('Giờ phải có dạng HH:MM')).default('04:30'),
  /** Also send alerts to the Telegram / webhook set up under Leads → Notifications. */
  externalAlerts: z.boolean().default(true),
  /** Quarantine a site by itself when the daily scan finds something new and critical (off: a false positive takes the site down). */
  autoQuarantine: z.boolean().default(false),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

// ---- Quarantine and cleaning -----------------------------------------------

export const quarantineSchema = z.object({ reason: z.string().trim().max(500).default('') });

/** "Not malware" on one finding of the latest scan (a file path from that scan), or undoing it. */
export const ignoreFindingSchema = z.object({ path: z.string().min(1).max(1000), ignore: z.boolean() });

/** Containment steps of a quarantine; a failed one is kept in QuarantineState.problems until a retry succeeds. */
export const QUARANTINE_STEPS = ['nginx', 'firewall', 'processes'] as const;
export type QuarantineStep = (typeof QUARANTINE_STEPS)[number];
export const QUARANTINE_STEP_LABELS: Record<QuarantineStep, string> = {
  nginx: msg('trang bảo trì (nginx)'),
  firewall: msg('chặn kết nối ra ngoài (tường lửa)'),
  processes: msg('dừng PHP/Node, tiến trình và cron'),
};

/** Lifting the quarantine needs a clean scan, unless `force` (the owner checked the site by hand). */
export const releaseQuarantineSchema = z.object({ force: z.boolean().default(false) });

export const cleanSiteSchema = z.object({
  /** Fresh WordPress core of the installed version (or the latest, with updateToLatest). */
  reinstallCore: z.boolean().default(true),
  /** Plugins / themes from wordpress.org, same version; the others are listed to re-upload by hand. */
  reinstallPlugins: z.boolean().default(true),
  reinstallThemes: z.boolean().default(true),
  updateToLatest: z.boolean().default(false),
  /** Move the files the scan flagged out of the web root (never deleted). */
  quarantineFiles: z.boolean().default(true),
  /** Administrator accounts to delete (ids from the scan); their content goes to the first remaining admin. */
  deleteUserIds: z.array(z.number().int().positive()).max(50).default([]),
  shuffleSalts: z.boolean().default(true),
  rotateDbPassword: z.boolean().default(true),
  revokeAppPasswords: z.boolean().default(true),
  /** home / siteurl pointing at another host go back to the site's own address. */
  resetSiteUrl: z.boolean().default(true),
  /** Random passwords for the remaining administrators (a stolen password must not work any more). */
  resetAdminPasswords: z.boolean().default(true),
});
export type CleanSiteInput = z.infer<typeof cleanSiteSchema>;

export interface QuarantineState {
  active: boolean;
  since: string | null;
  by: string | null;
  reason: string | null;
  /** Backup taken when the quarantine started (trigger "quarantine": not offered for a normal restore). */
  backupId: string | null;
  /** Containment steps that failed: the quarantine is incomplete until a retry succeeds. */
  problems: QuarantineStep[];
}

export const SECURITY_EVENT_ACTIONS = ['quarantine', 'release', 'clean', 'code-lock', 'code-unlock', 'acknowledge', 'ignore', 'unignore'] as const;
export type SecurityEventAction = (typeof SECURITY_EVENT_ACTIONS)[number];

export const SECURITY_EVENT_LABELS: Record<SecurityEventAction, string> = {
  quarantine: msg('Cách ly khẩn'),
  release: msg('Gỡ cách ly'),
  clean: msg('Dọn site'),
  'code-lock': msg('Khoá code'),
  'code-unlock': msg('Mở khoá code'),
  acknowledge: msg('Đánh dấu đã kiểm tra'),
  ignore: msg('Đánh dấu không phải mã độc'),
  unignore: msg('Bỏ đánh dấu không phải mã độc'),
};

export interface SecurityEvent {
  at: string;
  action: SecurityEventAction;
  by: string | null;
  detail: string | null;
}

// ---- Code lock -------------------------------------------------------------

/** A folder relative to the site folder, no "..", no leading slash. */
export const writableDirSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/, msg('Thư mục không hợp lệ (đường dẫn tương đối trong thư mục site)'))
  .transform((v) => v.replace(/\/+$/, ''));

export const codeLockSchema = z.object({
  locked: z.boolean(),
  /** Folders PHP may still write (uploads, caches). Empty/omitted = the defaults for the site type. */
  writableDirs: z.array(writableDirSchema).max(30).optional(),
});
export type CodeLockInput = z.infer<typeof codeLockSchema>;

export interface CodeLockState {
  locked: boolean;
  writableDirs: string[];
  defaultWritableDirs: string[];
}

// ---- The tab --------------------------------------------------------------

export interface SiteSecurityView {
  supported: {
    /** File checks (PHP sites); the firewall check runs for every isolated site. */
    scan: boolean;
    /** Emergency quarantine: any site with its own Linux user (PHP, Next.js). */
    quarantine: boolean;
    /** Automatic cleaning (isolated PHP sites; full reinstall for WordPress). */
    clean: boolean;
    /** Code lock (isolated PHP sites). */
    codeLock: boolean;
  };
  lastScan: MalwareScan | null;
  history: MalwareScanSummary[];
  running: { taskId: string; kind: string } | null;
  settings: SecuritySettings;
  /** Administrators known as legitimate (set by the first scan, "mark as checked" and cleaning). */
  adminsAcknowledgedAt: string | null;
  quarantine: QuarantineState;
  events: SecurityEvent[];
  codeLock: CodeLockState;
  /** Where moved files go (outside the web root). */
  quarantineDir: string;
}
