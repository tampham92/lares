import { z } from 'zod';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// WordPress updates (core, plugins, themes) with a health check and automatic rollback
// ---------------------------------------------------------------------------

/**
 * Plugin / theme slug as wp-cli names it (directory, or file name for single-file plugins).
 * Never starts with "-" so it cannot be read as a wp-cli option.
 */
export const WP_SLUG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/;

export const WP_ITEM_TYPES = ['core', 'plugin', 'theme'] as const;
export type WpItemType = (typeof WP_ITEM_TYPES)[number];

export interface WpExtension {
  slug: string;
  title: string;
  /** wp-cli status: active, inactive, active-network (plugins); active, parent, inactive (themes). */
  status: string;
  version: string;
  /** Available version, null when up to date. */
  update: string | null;
  autoUpdate: boolean;
}

export interface WpInventory {
  core: { version: string; update: string | null };
  plugins: WpExtension[];
  themes: WpExtension[];
}

/** Number of items with an update available. */
export function wpPendingCount(inv: WpInventory | null | undefined): number {
  if (!inv) return 0;
  return (inv.core.update ? 1 : 0) + inv.plugins.filter((p) => p.update).length + inv.themes.filter((p) => p.update).length;
}

export const wpUpdateRequestSchema = z.object({
  /** Everything that has an update (ignores the lists below). */
  all: z.boolean().default(false),
  core: z.boolean().default(false),
  plugins: z.array(z.string().regex(WP_SLUG_RE, msg('Tên plugin/theme không hợp lệ'))).max(500).default([]),
  themes: z.array(z.string().regex(WP_SLUG_RE, msg('Tên plugin/theme không hợp lệ'))).max(500).default([]),
});
export type WpUpdateRequest = z.infer<typeof wpUpdateRequestSchema>;

export type WpPage = 'home' | 'login';

/** What the health check found worse after the update than before it. */
export type WpHealthProblem =
  | { code: 'status'; page: WpPage; before: number | null; after: number | null }
  | { code: 'marker'; page: WpPage; marker: string }
  | { code: 'title'; page: WpPage; before: string; after: string }
  | { code: 'blank'; page: WpPage }
  | { code: 'fatal'; line: string }
  | { code: 'deactivated'; slug: string; itemType: 'plugin' | 'theme' };

/** Error markers looked for in page bodies (id → label shown to the admin). */
export const WP_MARKER_LABELS: Record<string, string> = {
  critical: msg('thông báo "critical error" của WordPress'),
  'wp-die': msg('trang lỗi của WordPress (wp_die)'),
  fatal: msg('PHP Fatal error'),
  parse: msg('PHP Parse error'),
  database: msg('lỗi kết nối database'),
  maintenance: msg('chế độ bảo trì'),
};

export interface WpUpdateItem {
  type: WpItemType;
  slug: string;
  name: string;
  from: string;
  to: string | null;
  status: 'pending' | 'updated' | 'failed' | 'skipped';
  error?: string;
}

export type WpUpdateRunStatus = 'running' | 'success' | 'rolled_back' | 'failed';

export interface WpUpdateRun {
  id: number;
  taskId: string | null;
  status: WpUpdateRunStatus;
  items: WpUpdateItem[];
  /** Pre-update backup (kept for a manual restore). */
  backupId: string | null;
  /** Why it failed or was rolled back (already in the reader's language). */
  error: string | null;
  problems: WpHealthProblem[];
  /**
   * Who broke the site: `single` = the only updated item; `suspects` = items named by new PHP
   * fatal errors; `multiple` = several items updated, cause unknown.
   */
  culprit: { kind: 'single' | 'suspects' | 'multiple'; items: string[] } | null;
  /** Rolled back, but the health check still failed after the restore. */
  stillBroken: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface WpUpdatesResponse {
  inventory: WpInventory | null;
  checkedAt: string | null;
  checkError: string | null;
  pending: number;
  /** Update/backup/restore currently holding this site's lock. */
  running: { taskId: string; kind: 'backup' | 'restore' | 'update' } | null;
  history: WpUpdateRun[];
}

export interface WpUpdatesSummaryItem {
  siteId: number;
  pending: number;
  checkedAt: string | null;
}
