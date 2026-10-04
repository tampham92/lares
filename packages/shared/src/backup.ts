import { z } from 'zod';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// Site backups (files + databases + manifest), manual and scheduled
// ---------------------------------------------------------------------------

/** Backup ids are the local creation time, e.g. 20261004-031500 (a -2, -3... suffix on collision). */
export const BACKUP_ID_RE = /^\d{8}-\d{6}(?:-\d{1,3})?$/;

export const BACKUP_TRIGGERS = ['manual', 'scheduled', 'safety'] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

export const BACKUP_TRIGGER_LABELS: Record<BackupTrigger, string> = {
  manual: msg('Thủ công'),
  scheduled: msg('Tự động'),
  safety: msg('An toàn (trước khi khôi phục)'),
};

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const backupSettingsSchema = z.object({
  /** Master switch for scheduled backups (each site can still opt out). */
  enabled: z.boolean().default(false),
  /** Daily run time, server local time. */
  time: z.string().regex(HHMM_RE, msg('Giờ phải có dạng HH:MM')).default('03:00'),
  /** Scheduled backups kept per site (older ones are deleted after each successful run). */
  keep: z.coerce.number().int().min(1).max(365).default(7),
  /** Where backups are written; empty = default (/var/backups/lares). */
  root: z
    .string()
    .trim()
    .max(255)
    .regex(/^(\/[^\0\r\n]*)?$/, msg('Đường dẫn phải là đường dẫn tuyệt đối'))
    .refine((p) => !p.split('/').includes('..'), msg('Đường dẫn không được chứa ".."'))
    .default(''),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export interface BackupSettingsView extends BackupSettings {
  /** Effective directory (default applied). */
  effectiveRoot: string;
  defaultRoot: string;
}

export const siteBackupPrefsSchema = z.object({ scheduled: z.boolean() });

export const manifestDatabaseSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
  file: z.string().regex(/^db-[A-Za-z0-9_]{1,64}\.sql\.gz$/),
  bytes: z.number().int().nonnegative(),
});

/** manifest.json written next to the archives of every backup. */
export const backupManifestSchema = z.object({
  format: z.literal(1),
  laresVersion: z.string().max(50),
  createdAt: z.string(),
  trigger: z.enum(BACKUP_TRIGGERS),
  site: z.object({
    id: z.number().int(),
    domain: z.string().max(253),
    appType: z.string().max(20),
    rootPath: z.string(),
    webRoot: z.string(),
  }),
  files: z.object({
    file: z.literal('files.tar.gz'),
    bytes: z.number().int().nonnegative(),
    /** Size of the archived tree before compression (estimate used for restore disk checks). */
    sourceBytes: z.number().int().nonnegative(),
    excludes: z.array(z.string()),
  }),
  databases: z.array(manifestDatabaseSchema),
  totalBytes: z.number().int().nonnegative(),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

export interface BackupEntry {
  id: string;
  createdAt: string;
  trigger: BackupTrigger;
  totalBytes: number;
  filesBytes: number;
  databases: Array<{ name: string; bytes: number }>;
  laresVersion: string;
  /** manifest.json missing or invalid: can only be deleted. */
  damaged?: boolean;
}

export interface SiteBackupsResponse {
  backups: BackupEntry[];
  /** Effective schedule for this site (global switch AND per-site toggle). */
  schedule: { globalEnabled: boolean; siteEnabled: boolean; time: string; keep: number };
  last: { date: string | null; status: 'ok' | 'failed' | null; error: string | null; at: string | null };
  /** Backup/restore currently running for this site (attach a TaskLog to follow it). */
  running: { taskId: string; kind: 'backup' | 'restore' } | null;
  root: string;
}
