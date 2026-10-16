import type { SiteJobKind } from './backup.js';
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

/** Numeric comparison of WordPress/plugin versions ("6.10" > "6.9", any number of parts); a pre-release suffix sorts first. */
export function compareWpVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [main = '', pre = ''] = v.split(/[-+]/, 2);
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

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

// ---- Known vulnerabilities (WPVulnerability database) ------------------------------------

export const WP_VULN_SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown'] as const;
export type WpVulnSeverity = (typeof WP_VULN_SEVERITIES)[number];

/** A published vulnerability that affects the installed version of core, a plugin or a theme. */
export interface WpVuln {
  id: string;
  title: string;
  severity: WpVulnSeverity;
  /** CVSS base score, when the database has one. */
  score: number | null;
  /** First version without the flaw; null when no fix is known. */
  fixedIn: string | null;
  /** The database says no fixed version exists. */
  unfixed: boolean;
  cves: string[];
  /** Advisory page (https), for the details. */
  link: string | null;
}

export interface WpSiteVulns {
  /** Oldest lookup the result is built from (null: nothing looked up yet). */
  checkedAt: string | null;
  core: WpVuln[];
  /** By slug; only items with at least one vulnerability. */
  plugins: Record<string, WpVuln[]>;
  themes: Record<string, WpVuln[]>;
  /** Items whose lookup failed or has not run yet (their vulnerabilities are unknown). */
  unknown: number;
}

/** Items (core, plugins, themes) with at least one known vulnerability, and the worst severity among them. */
export function wpVulnCount(v: WpSiteVulns | null | undefined): { items: number; worst: WpVulnSeverity | null } {
  if (!v) return { items: 0, worst: null };
  const lists = [v.core, ...Object.values(v.plugins), ...Object.values(v.themes)].filter((l) => l.length);
  const all = lists.flat();
  const worst = WP_VULN_SEVERITIES.find((s) => all.some((x) => x.severity === s)) ?? null;
  return { items: lists.length, worst };
}

export interface WpUpdatesResponse {
  inventory: WpInventory | null;
  checkedAt: string | null;
  checkError: string | null;
  pending: number;
  /** Update/backup/restore currently holding this site's lock. */
  running: { taskId: string; kind: SiteJobKind } | null;
  history: WpUpdateRun[];
  /** Known vulnerabilities of the installed versions; null when the check is turned off or nothing was read yet. */
  vulns: WpSiteVulns | null;
}

export interface WpUpdatesSummaryItem {
  siteId: number;
  pending: number;
  checkedAt: string | null;
  /** Items with a known vulnerability (0 when the check is off). */
  vulnerable: number;
  worstVuln: WpVulnSeverity | null;
}
