import { WP_SLUG_RE, WP_VULN_SEVERITIES, type WpInventory, type WpSiteVulns, type WpVuln, type WpVulnSeverity } from '@lares/shared';
import { compareVersions, decodeEntities } from './wpUpdatePolicy.js';

/*
 * Pure rules of the known-vulnerability check (no I/O): reading WPVulnerability API answers,
 * deciding whether an installed version is affected, and which findings are worth an alert.
 * The lookups themselves (HTTP, cache) live in services/wpVulns.ts.
 *
 * The API answers are third-party data shown in the panel: every string is decoded, stripped of
 * markup and cut to a bounded length, and only https links are kept.
 */

export type VulnKind = 'core' | 'plugin' | 'theme';

/** Version range of a plugin/theme vulnerability, as the API's `operator` block gives it. */
export interface VulnRange {
  min: { version: string; op: 'ge' | 'gt' } | null;
  max: { version: string; op: 'lt' | 'le' | 'eq' } | null;
}

/** What is cached per lookup. `range` null = core: the API already listed it for the version asked about. */
export interface StoredVuln extends WpVuln {
  range: VulnRange | null;
}

const VERSION_RE = /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;
const MAX_TITLE = 240;
const MAX_VULNS = 500;

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Plain one-line text from an API string (entities decoded, tags and control characters removed). */
const clean = (s: string, max = MAX_TITLE) => {
  const text = decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const httpsUrl = (s: string): string | null => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && s.length <= 500 ? u.toString() : null;
  } catch {
    return null;
  }
};

// Advisory pages in order of preference (the most readable write-up first)
const LINK_HOSTS = ['wordfence.com', 'wpscan.com', 'patchstack.com', 'cve.org'];
const hostRank = (url: string) => {
  const host = new URL(url).hostname;
  const i = LINK_HOSTS.findIndex((h) => host === h || host.endsWith(`.${h}`));
  return i < 0 ? LINK_HOSTS.length : i;
};

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;

const SEVERITY_LETTERS: Record<string, WpVulnSeverity> = { c: 'critical', h: 'high', m: 'medium', l: 'low', n: 'low' };

function severityOf(impact: Record<string, unknown> | null): { severity: WpVulnSeverity; score: number | null } {
  const cvss3 = (impact?.cvss3 ?? null) as Record<string, unknown> | null;
  const cvss = (impact?.cvss ?? null) as Record<string, unknown> | null;
  const word = str(cvss3?.severity).toLowerCase();
  const letter = str(cvss?.severity).toLowerCase();
  const severity: WpVulnSeverity =
    word === 'none' ? 'low' : (WP_VULN_SEVERITIES as readonly string[]).includes(word) ? (word as WpVulnSeverity) : (SEVERITY_LETTERS[letter] ?? 'unknown');
  const score = Number.parseFloat(str(cvss3?.score) || str(cvss?.score));
  return { severity, score: Number.isFinite(score) && score > 0 && score <= 10 ? score : null };
}

function rangeOf(op: Record<string, unknown> | null): VulnRange | null | 'invalid' {
  if (!op) return 'invalid';
  const minV = str(op.min_version).trim();
  const maxV = str(op.max_version).trim();
  const minOp = str(op.min_operator);
  const maxOp = str(op.max_operator);
  const min: VulnRange['min'] | 'invalid' = minV ? (VERSION_RE.test(minV) && (minOp === 'ge' || minOp === 'gt') ? { version: minV, op: minOp } : 'invalid') : null;
  const max: VulnRange['max'] | 'invalid' = maxV ? (VERSION_RE.test(maxV) && (maxOp === 'lt' || maxOp === 'le' || maxOp === 'eq') ? { version: maxV, op: maxOp } : 'invalid') : null;
  // no bound at all would flag every version: not something to guess about
  if (min === 'invalid' || max === 'invalid' || (!min && !max)) return 'invalid';
  return { min, max };
}

/**
 * A WPVulnerability answer (`/plugin/<slug>/`, `/theme/<slug>/`, `/core/<version>/`) as cached
 * entries. null = not an answer we understand (treated like a failed lookup); [] = nothing known,
 * including a slug the database has never heard of.
 */
export function parseVulnResponse(kind: VulnKind, body: unknown): StoredVuln[] | null {
  const root = body as { error?: unknown; data?: { vulnerability?: unknown } | null } | null;
  if (!root || typeof root !== 'object' || (root.error !== 0 && root.error !== '0')) return null;
  if (!root.data || typeof root.data !== 'object') return null;
  const list = root.data.vulnerability;
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) return null;

  const out = new Map<string, StoredVuln>();
  for (const raw of list.slice(0, MAX_VULNS) as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.uuid).trim();
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id) || out.has(id)) continue;
    const op = (raw.operator ?? null) as Record<string, unknown> | null;
    const range = kind === 'core' ? null : rangeOf(op);
    if (range === 'invalid') continue;
    const sources = (Array.isArray(raw.source) ? raw.source : []) as Array<Record<string, unknown>>;
    const cves = [...new Set(sources.map((s) => str(s?.id).trim()).filter((s) => CVE_RE.test(s)))].slice(0, 10);
    const links = sources.map((s) => httpsUrl(str(s?.link))).filter((l): l is string => !!l);
    links.sort((a, b) => hostRank(a) - hostRank(b));
    // an advisory title ("Plugin <= 1.2 - Stored XSS") reads better than the database's own name
    // ("Plugin [slug] < 1.3") or a CVE description, which is a paragraph
    const advisory = sources.find((s) => !CVE_RE.test(str(s?.id)) && clean(str(s?.name)));
    const cveText = sources.map((s) => clean(str(s?.description).replace(/^\[[a-z]{2}\]\s*/i, ''))).find(Boolean);
    const title = (advisory && clean(str(advisory.name))) || cveText || clean(str(raw.name)) || cves[0] || id;
    const { severity, score } = severityOf((raw.impact ?? null) as Record<string, unknown> | null);
    const unfixed = str(op?.unfixed) === '1';
    out.set(id, {
      id,
      title,
      severity,
      score,
      unfixed,
      fixedIn: !unfixed && range?.max?.op === 'lt' ? range.max.version : null,
      cves,
      link: links[0] ?? null,
      range,
    });
  }
  return [...out.values()];
}

/** Whether `version` falls in the range (an unreadable version is never reported as affected). */
export function affects(range: VulnRange | null, version: string): boolean {
  if (!range) return true;
  if (!VERSION_RE.test(version)) return false;
  if (range.min) {
    const c = compareVersions(version, range.min.version);
    if (range.min.op === 'ge' ? c < 0 : c <= 0) return false;
  }
  if (range.max) {
    const c = compareVersions(version, range.max.version);
    if (range.max.op === 'lt' ? c >= 0 : range.max.op === 'le' ? c > 0 : c !== 0) return false;
  }
  return true;
}

const SEVERITY_ORDER = (s: WpVulnSeverity) => WP_VULN_SEVERITIES.indexOf(s);

const byRisk = (a: WpVuln, b: WpVuln) => SEVERITY_ORDER(a.severity) - SEVERITY_ORDER(b.severity) || (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title);

const toPublic = ({ range: _range, ...v }: StoredVuln): WpVuln => v;

/** A cached lookup: `vulns` null = it failed. */
export interface Lookup {
  vulns: StoredVuln[] | null;
  fetchedAt: string;
}

/** Cache key of the lookup for one item: core is looked up per version, plugins and themes per slug. */
export const lookupSlug = (kind: VulnKind, slugOrVersion: string): string | null =>
  kind === 'core' ? (VERSION_RE.test(slugOrVersion) ? slugOrVersion : null) : WP_SLUG_RE.test(slugOrVersion) ? slugOrVersion.toLowerCase() : null;

/** What has to be looked up for this inventory: [kind, cache key] pairs, without duplicates. */
export function lookupsFor(inv: WpInventory): Array<[VulnKind, string]> {
  const out = new Map<string, [VulnKind, string]>();
  const add = (kind: VulnKind, s: string) => {
    const key = lookupSlug(kind, s);
    if (key) out.set(`${kind}:${key}`, [kind, key]);
  };
  add('core', inv.core.version);
  for (const p of inv.plugins) add('plugin', p.slug);
  for (const x of inv.themes) add('theme', x.slug);
  return [...out.values()];
}

/** The vulnerabilities of the installed versions, from the cached lookups. */
export function matchInventory(inv: WpInventory, lookup: (kind: VulnKind, key: string) => Lookup | undefined): WpSiteVulns {
  let unknown = 0;
  let oldest: string | null = null;
  const read = (kind: VulnKind, slugOrVersion: string, version: string): WpVuln[] => {
    const key = lookupSlug(kind, slugOrVersion);
    const l = key ? lookup(kind, key) : undefined;
    if (!l?.vulns) {
      unknown++;
      return [];
    }
    if (!oldest || l.fetchedAt < oldest) oldest = l.fetchedAt;
    return l.vulns.filter((v) => affects(v.range, version)).map(toPublic).sort(byRisk);
  };
  const out: WpSiteVulns = { checkedAt: null, core: read('core', inv.core.version, inv.core.version), plugins: {}, themes: {}, unknown: 0 };
  for (const [list, target, kind] of [
    [inv.plugins, out.plugins, 'plugin'],
    [inv.themes, out.themes, 'theme'],
  ] as const) {
    for (const x of list) {
      const hits = read(kind, x.slug, x.version);
      if (hits.length) target[x.slug] = hits;
    }
  }
  out.unknown = unknown;
  out.checkedAt = oldest;
  return out;
}

/** Severities that send an alert (bell, Telegram/webhook); lower ones are only shown in the Updates tab. */
export const ALERT_SEVERITIES: WpVulnSeverity[] = ['critical', 'high'];

export interface AlertItem {
  key: string;
  type: VulnKind;
  slug: string;
  vuln: WpVuln;
}

/** Findings worth an alert, one per (item, vulnerability). */
export function alertItems(v: WpSiteVulns): AlertItem[] {
  const out: AlertItem[] = [];
  const add = (type: VulnKind, slug: string, list: WpVuln[]) => {
    for (const vuln of list) if (ALERT_SEVERITIES.includes(vuln.severity) || vuln.unfixed) out.push({ key: `${type}:${slug}:${vuln.id}`, type, slug, vuln });
  };
  add('core', 'wordpress', v.core);
  for (const [slug, list] of Object.entries(v.plugins)) add('plugin', slug, list);
  for (const [slug, list] of Object.entries(v.themes)) add('theme', slug, list);
  return out;
}

/** Alert items not reported before (`alerted` = keys already sent for this site). */
export const freshAlerts = (items: AlertItem[], alerted: ReadonlySet<string>) => items.filter((i) => !alerted.has(i.key));
