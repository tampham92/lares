import { WP_SLUG_RE, type WpExtension, type WpHealthProblem, type WpInventory, type WpPage, type WpUpdateItem, type WpUpdateRequest, type WpUpdateRun } from '@lares/shared';

/*
 * Pure rules of the WordPress update feature (no I/O): parsing wp-cli output, choosing what to
 * update, comparing the site's health before and after, and naming the likely culprit.
 * Kept separate from services/wpUpdates.ts so they are easy to unit test.
 */

// ---- wp-cli output --------------------------------------------------------------------------

/**
 * The JSON document in wp-cli output. PHP notices from plugins may come before it and a
 * "Success: ..." line after it, so take the last line that parses as JSON.
 */
export function findJson<T>(stdout: string): T | null {
  const lines = stdout.split('\n').map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.startsWith('[') && !l.startsWith('{')) continue;
    try {
      return JSON.parse(l) as T;
    } catch {
      /* not JSON - keep looking */
    }
  }
  return null;
}

const VERSION_RE = /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;

/** `wp core version` → "6.6.2" (last line that looks like a version). */
export function parseCoreVersion(stdout: string): string | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (VERSION_RE.test(lines[i]!)) return lines[i]!;
  return null;
}

/** Numeric comparison of dotted versions ("6.10" > "6.9"); a pre-release suffix sorts first. */
export function compareVersions(a: string, b: string): number {
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

/**
 * `wp core check-update --format=json` → newest offered version, or null. wp-cli prints
 * "Success: WordPress is at the latest version." (no JSON) when there is nothing to do.
 */
export function parseCoreCheckUpdate(stdout: string): string | null {
  const rows = findJson<Array<{ version?: unknown }>>(stdout);
  if (!Array.isArray(rows)) return null;
  const versions = rows.map((r) => (typeof r?.version === 'string' ? r.version.trim() : '')).filter((v) => VERSION_RE.test(v));
  return versions.sort(compareVersions).pop() ?? null;
}

interface RawExtension {
  name?: unknown;
  title?: unknown;
  status?: unknown;
  version?: unknown;
  update?: unknown;
  update_version?: unknown;
  auto_update?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * `wp plugin list` / `wp theme list --format=json --fields=name,title,status,version,update,update_version,auto_update`.
 * Must-use plugins and drop-ins cannot be updated by wp-cli and are left out, as are names that
 * would not be safe to pass back to wp-cli.
 */
export function parseExtensionList(stdout: string): WpExtension[] | null {
  const rows = findJson<RawExtension[]>(stdout);
  if (!Array.isArray(rows)) return null;
  const out: WpExtension[] = [];
  for (const r of rows) {
    const slug = str(r?.name);
    const status = str(r?.status);
    if (!WP_SLUG_RE.test(slug) || status === 'must-use' || status === 'dropin') continue;
    const updateVersion = str(r.update_version).trim();
    const hasUpdate = str(r.update) === 'available';
    out.push({
      slug,
      // wp-cli prints the escaped display name ("Spa &amp; Beauty"); the panel escapes on render itself
      title: decodeEntities(str(r.title)).trim() || slug,
      status,
      version: str(r.version).trim(),
      update: hasUpdate ? updateVersion || '?' : null,
      autoUpdate: str(r.auto_update) === 'on',
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
}

export interface UpdateResult {
  slug: string;
  from: string;
  to: string;
  status: 'updated' | 'failed' | 'unchanged';
}

/** `wp plugin|theme update <names> --format=json` → per-item result. */
export function parseUpdateResults(stdout: string): UpdateResult[] {
  const rows = findJson<Array<{ name?: unknown; old_version?: unknown; new_version?: unknown; status?: unknown }>>(stdout);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => str(r?.name))
    .map((r) => {
      const status = str(r.status).toLowerCase();
      return {
        slug: str(r.name),
        from: str(r.old_version),
        to: str(r.new_version),
        status: status === 'updated' ? 'updated' : status.includes('error') || status.includes('fail') ? 'failed' : 'unchanged',
      };
    });
}

// ---- What to update -----------------------------------------------------------------------

/** Items of the request that have an update, in the order they are applied: core, plugins, themes. */
export function selectItems(inv: WpInventory, req: WpUpdateRequest): { items: WpUpdateItem[]; missing: string[] } {
  const items: WpUpdateItem[] = [];
  const missing: string[] = [];
  if (req.all || req.core) {
    if (inv.core.update) items.push({ type: 'core', slug: 'wordpress', name: 'WordPress', from: inv.core.version, to: inv.core.update, status: 'pending' });
    else if (req.core) missing.push('WordPress');
  }
  for (const [type, list, wanted] of [
    ['plugin', inv.plugins, req.plugins],
    ['theme', inv.themes, req.themes],
  ] as const) {
    const bySlug = new Map(list.map((x) => [x.slug, x]));
    for (const x of list) {
      if (x.update && (req.all || wanted.includes(x.slug))) items.push({ type, slug: x.slug, name: x.title, from: x.version, to: x.update, status: 'pending' });
    }
    if (!req.all) for (const slug of new Set(wanted)) if (!bySlug.get(slug)?.update) missing.push(slug);
  }
  return { items, missing };
}

/**
 * Plugins that were active before and are not any more (missing after a failed update, or
 * deactivated by WordPress), and an active theme that was replaced by another one.
 */
export function lostItems(before: WpInventory, after: WpInventory): WpHealthProblem[] {
  const active = (s: string) => s === 'active' || s === 'active-network';
  const out: WpHealthProblem[] = [];
  const now = new Map(after.plugins.map((p) => [p.slug, p]));
  for (const p of before.plugins) if (active(p.status) && !active(now.get(p.slug)?.status ?? '')) out.push({ code: 'deactivated', slug: p.slug, itemType: 'plugin' });
  const theme = before.themes.find((x) => x.status === 'active');
  if (theme && after.themes.find((x) => x.slug === theme.slug)?.status !== 'active') out.push({ code: 'deactivated', slug: theme.slug, itemType: 'theme' });
  return out;
}

// ---- Health -------------------------------------------------------------------------------

export interface PageProbe {
  url: string;
  /** HTTP status, null when nothing answered. */
  status: number | null;
  error?: string;
  title: string;
  /** Ids of WP_MARKERS found in the body. */
  markers: string[];
  /** Length of the trimmed body. */
  bodyBytes: number;
}

export interface HealthSnapshot {
  at: string;
  home: PageProbe;
  login: PageProbe;
  /** Normalised fatal errors among the recent lines of the site's error logs. */
  recentFatals: string[];
  /** Fatal errors logged since the given log marks (only for the check after the update). */
  newFatals: string[];
}

/** Error markers looked for in page bodies (labels: WP_MARKER_LABELS in @lares/shared). */
export const WP_MARKERS: Array<{ id: string; re: RegExp }> = [
  // WordPress >= 5.2 fatal error handler (5.2-5.4 wording, then 5.5+)
  { id: 'critical', re: /There has been a critical error on (?:this|your) website|The site is experiencing technical difficulties/i },
  // wp_die() pages, whatever the language
  { id: 'wp-die', re: /<body[^>]*\bid=["']error-page["']/i },
  { id: 'fatal', re: /(?:<b>)?Fatal error(?:<\/b>)?:\s/ },
  { id: 'parse', re: /(?:<b>)?Parse error(?:<\/b>)?:\s/ },
  { id: 'database', re: /Error establishing a database connection/i },
  { id: 'maintenance', re: /Briefly unavailable for scheduled maintenance/i },
];

export const findMarkers = (body: string) => WP_MARKERS.filter((m) => m.re.test(body)).map((m) => m.id);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsaquo: '›', lsaquo: '‹', raquo: '»', laquo: '«', ndash: '–', mdash: '—', hellip: '…' };

const codePoint = (e: string, n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : e);

/** Decodes the HTML entities WordPress puts in names and titles (`&amp;`, `&#8211;`, ...). */
export const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (e, n: string) => codePoint(e, Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (e, n: string) => codePoint(e, Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (e, n: string) => ENTITIES[n.toLowerCase()] ?? e);

/** Text of the page's <title>, entities decoded, whitespace collapsed. */
export function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  return decodeEntities(m[1]!)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** A title that reads like an error page rather than the site. */
export const ERROR_TITLE_RE = /\b(?:error|critical|fatal|maintenance|unavailable|bad gateway|gateway time-?out|internal server|not found|forbidden|database|50[0-4])\b|lỗi|bảo trì/i; // i18n-ignore - matched against page titles, not shown

/** Lines of nginx / PHP / WordPress debug logs that report a fatal PHP error. */
export const isFatalLine = (line: string) => /PHP (?:Fatal|Parse) error|PHP Fatal|Uncaught (?:Error|Exception|TypeError|ArgumentCountError|ValueError)/i.test(line);

/**
 * The stable part of a fatal error line: the message from "PHP Fatal error:" up to the end of the
 * first line of the PHP message, without timestamps, client IPs or request ids, so the same error
 * logged twice compares equal.
 */
export function fatalKey(line: string): string {
  const m = /(PHP (?:Fatal|Parse) error:[\s\S]*?|Uncaught [\s\S]*?)(?:\\n|\n|" while |, client: |$)/i.exec(line);
  return (m?.[1] ?? line).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** 0 = fine (2xx/3xx), 1 = 4xx and others, 2 = 5xx, 3 = no answer. */
const rank = (s: number | null) => (s === null ? 3 : s >= 200 && s < 400 ? 0 : s >= 500 ? 2 : 1);

export const statusOk = (s: number | null) => rank(s) === 0;

const PAGES: WpPage[] = ['home', 'login'];

const healthyPage: PageProbe = { url: '', status: 200, title: '', markers: [], bodyBytes: 0 };
const HEALTHY: HealthSnapshot = { at: '', home: healthyPage, login: healthyPage, recentFatals: [], newFatals: [] };

/** What is already wrong before the update (bad status, error markers or title): not blamed on it. */
export const baselineIssues = (h: HealthSnapshot): WpHealthProblem[] => compareHealth(HEALTHY, { ...h, newFatals: [] });

/**
 * Health regressions after the update. Only what got worse counts: a login page hidden by a
 * security plugin (404 before and after) or an error text that was already on the page is not
 * blamed on the update.
 */
export function compareHealth(before: HealthSnapshot, after: HealthSnapshot): WpHealthProblem[] {
  const out: WpHealthProblem[] = [];
  for (const page of PAGES) {
    const b = before[page];
    const a = after[page];
    if (rank(a.status) > rank(b.status)) out.push({ code: 'status', page, before: b.status, after: a.status });
    for (const marker of a.markers) if (!b.markers.includes(marker)) out.push({ code: 'marker', page, marker });
    if (a.title !== b.title && ERROR_TITLE_RE.test(a.title) && !ERROR_TITLE_RE.test(b.title)) out.push({ code: 'title', page, before: b.title, after: a.title });
    // white screen: the page answers 200 but with (almost) nothing in it
    if (statusOk(a.status) && statusOk(b.status) && b.bodyBytes >= 512 && a.bodyBytes < 64) out.push({ code: 'blank', page });
  }
  const seen = new Set(before.recentFatals);
  for (const line of after.newFatals) {
    if (seen.has(line)) continue;
    seen.add(line);
    if (out.filter((p) => p.code === 'fatal').length < 5) out.push({ code: 'fatal', line });
  }
  return out;
}

/**
 * Who broke the site. One updated item: that one. Several: the plugins/themes named by new PHP
 * fatal errors (or deactivated), else unknown - the admin should update them one by one.
 */
export function findCulprit(items: WpUpdateItem[], problems: WpHealthProblem[]): WpUpdateRun['culprit'] {
  const changed = items.filter((i) => i.status === 'updated' || i.status === 'failed');
  if (!changed.length) return null;
  if (changed.length === 1) return { kind: 'single', items: [changed[0]!.name] };
  const suspects = new Set<string>();
  for (const p of problems) {
    if (p.code === 'fatal') {
      for (const m of p.line.matchAll(/wp-content\/(plugins|themes)\/([^/\s'"]+)/g)) {
        const type = m[1] === 'plugins' ? 'plugin' : 'theme';
        const hit = changed.find((i) => i.type === type && i.slug === m[2]);
        if (hit) suspects.add(hit.name);
      }
      const core = changed.find((i) => i.type === 'core');
      if (core && /\/wp-(?:includes|admin)\//.test(p.line)) suspects.add(core.name);
    } else if (p.code === 'deactivated') {
      const hit = changed.find((i) => i.type === p.itemType && i.slug === p.slug);
      if (hit) suspects.add(hit.name);
    }
  }
  return suspects.size ? { kind: 'suspects', items: [...suspects] } : { kind: 'multiple', items: changed.map((i) => i.name) };
}
