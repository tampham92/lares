import crypto from 'node:crypto';
import { msg, type Site, type WpInventory, type WpSiteVulns, type WpVulnSeverity } from '@lares/shared';
import { db, nowIso } from '../db/index.js';
import { t, tDefault } from '../i18n/index.js';
import { errorMessage } from '../lib/errors.js';
import type { HostLogger } from './host.js';
import { sendTelegram, sendWebhook } from './leadNotify.js';
import { getGlobalNotify } from './leads.js';
import { registerNotificationSource } from './notifications.js';
import { VERSION } from './release.js';
import { getSecuritySettings } from './securityStore.js';
import * as policy from './wpVulnPolicy.js';

/*
 * Known vulnerabilities of the installed WordPress core, plugins and themes, from the
 * WPVulnerability database (https://www.wpvulnerability.com: free, no API key, aggregates
 * Wordfence, WPScan, Patchstack and CVE records).
 *
 * Privacy: a lookup sends a plugin/theme slug or the core version, never the domain or anything
 * else about the site. Lookups are shared by every site and cached (a day; a failed one is retried
 * after a few hours), so the API sees each slug about once a day per server. Turned off with the
 * vulnCheck security setting.
 *
 * The check refreshes after each inventory read (services/wpUpdates.ts) and the result is computed
 * from the cache on every read, so a site that was just updated shows its new versions at once.
 */

const API = 'https://www.wpvulnerability.net';
const TTL_MS = 24 * 3_600_000;
const FAILED_TTL_MS = 3 * 3_600_000;
const FETCH_TIMEOUT = 10_000;
const MAX_BODY = 8 * 1024 * 1024;
const CONCURRENCY = 4;

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;
let fetchImpl: Fetch = (url, init) => fetch(url, init);

/** Tests replace the HTTP client. */
export function setVulnFetch(f: Fetch) {
  fetchImpl = f;
}

export const vulnCheckEnabled = () => getSecuritySettings().vulnCheck;

// ---- Cache --------------------------------------------------------------------------------

function cached(kind: policy.VulnKind, key: string): policy.Lookup | undefined {
  const row = db.prepare('SELECT data_json, fetched_at FROM wp_vuln_cache WHERE kind = ? AND slug = ?').get(kind, key) as { data_json: string | null; fetched_at: string } | undefined;
  if (!row) return undefined;
  try {
    return { vulns: row.data_json ? (JSON.parse(row.data_json) as policy.StoredVuln[]) : null, fetchedAt: row.fetched_at };
  } catch {
    return { vulns: null, fetchedAt: row.fetched_at };
  }
}

function store(kind: policy.VulnKind, key: string, vulns: policy.StoredVuln[] | null) {
  db.prepare(
    `INSERT INTO wp_vuln_cache (kind, slug, data_json, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, slug) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
  ).run(kind, key, vulns ? JSON.stringify(vulns) : null, nowIso());
}

const isFresh = (l: policy.Lookup | undefined, now: number) => !!l && now - Date.parse(l.fetchedAt) < (l.vulns ? TTL_MS : FAILED_TTL_MS);

// ---- Lookups ------------------------------------------------------------------------------

async function lookup(kind: policy.VulnKind, key: string): Promise<policy.StoredVuln[] | null> {
  // key is a validated slug or version (policy.lookupSlug); encode anyway, it goes into a URL path
  const url = `${API}/${kind}/${encodeURIComponent(key)}/`;
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': `Lares-Panel/${VERSION}`, Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_BODY) return null;
    return policy.parseVulnResponse(kind, JSON.parse(text));
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<void>>();

const dueLookups = (inv: WpInventory, now: number) => policy.lookupsFor(inv).filter(([kind, key]) => !isFresh(cached(kind, key), now));

/** Some lookup of this inventory is missing or stale (and the check is on). */
export const hasDueLookups = (inv: WpInventory, now = Date.now()) => vulnCheckEnabled() && dueLookups(inv, now).length > 0;

/** Look up what is missing or stale in the cache for this inventory. Never throws. */
export async function refreshVulns(inv: WpInventory, now = Date.now()): Promise<void> {
  if (!vulnCheckEnabled()) return;
  const todo = dueLookups(inv, now);
  const queue = [...todo];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [kind, key] = next;
      const id = `${kind}:${key}`;
      // two sites with the same plugin refreshing at once share one request
      let job = inflight.get(id);
      if (!job) {
        job = lookup(kind, key)
          .then((vulns) => store(kind, key, vulns))
          .finally(() => inflight.delete(id));
        inflight.set(id, job);
      }
      await job.catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
}

/** Vulnerabilities of the installed versions, from the cache; null when the check is off. */
export function siteVulns(inv: WpInventory | null): WpSiteVulns | null {
  if (!inv || !vulnCheckEnabled()) return null;
  return policy.matchInventory(inv, cached);
}

// ---- Alerts -------------------------------------------------------------------------------

const SEVERITY_LABELS: Record<WpVulnSeverity, string> = {
  critical: msg('Nghiêm trọng'),
  high: msg('Cao'),
  medium: msg('Trung bình'),
  low: msg('Thấp'),
  unknown: msg('Chưa rõ'),
};

const PLUGIN = msg('Plugin {slug}');
const THEME = msg('Theme {slug}');
const FIXED_IN = msg('đã vá ở {version}');
const NO_FIX = msg('chưa có bản vá');
const FIX_UNKNOWN = msg('chưa rõ bản nào đã vá');

/** One finding on one line, in the language of `tr` (t: the viewer's, tDefault: the panel's). */
function alertLine(i: policy.AlertItem, tr: typeof t) {
  const name = i.type === 'core' ? 'WordPress' : tr(i.type === 'plugin' ? PLUGIN : THEME, { slug: i.slug });
  const fix = i.vuln.fixedIn ? tr(FIXED_IN, { version: i.vuln.fixedIn }) : tr(i.vuln.unfixed ? NO_FIX : FIX_UNKNOWN);
  return `${name}: ${i.vuln.title} (${tr(SEVERITY_LABELS[i.vuln.severity])}, ${fix})`;
}

const alertedKeys = (siteId: number): Set<string> => {
  const row = db.prepare('SELECT keys_json FROM wp_vuln_alerts WHERE site_id = ?').get(siteId) as { keys_json: string } | undefined;
  try {
    return new Set(row ? (JSON.parse(row.keys_json) as string[]) : []);
  } catch {
    return new Set();
  }
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Telegram / webhook message for findings not reported before (when external alerts are on). The
 * stored keys are replaced by the current ones, so a finding that went away (plugin updated) and
 * comes back (rolled back) is reported again.
 */
async function alertNew(site: Site, vulns: WpSiteVulns) {
  const items = policy.alertItems(vulns);
  const fresh = policy.freshAlerts(items, alertedKeys(site.id));
  db.prepare('INSERT INTO wp_vuln_alerts (site_id, keys_json) VALUES (?, ?) ON CONFLICT(site_id) DO UPDATE SET keys_json = excluded.keys_json').run(
    site.id,
    JSON.stringify(items.map((i) => i.key)),
  );
  if (!fresh.length || !getSecuritySettings().externalAlerts) return;
  const cfg = getGlobalNotify();
  const title = tDefault('{domain}: {count} lỗ hổng đã công bố trong WordPress, plugin hoặc theme', { domain: site.domain, count: fresh.length });
  if (cfg.telegram.enabled && cfg.telegram.botToken && cfg.telegram.chatId) {
    const lines = fresh.slice(0, 10).map((i) => `• ${alertLine(i, tDefault)}`);
    if (fresh.length > 10) lines.push(tDefault('... và {n} lỗ hổng khác', { n: fresh.length - 10 }));
    lines.push('', tDefault('Mở tab Cập nhật của site để cập nhật.'));
    await sendTelegram(cfg.telegram, [`<b>${escapeHtml(`Lares · ${title}`)}</b>`, '', ...lines.map(escapeHtml)].join('\n')).catch(() => undefined);
  }
  if (cfg.webhook.enabled && cfg.webhook.url) {
    const payload = {
      event: 'security.vulnerabilities',
      site: { id: site.id, domain: site.domain },
      vulnerabilities: fresh.slice(0, 50).map((i) => ({ type: i.type, slug: i.slug, ...i.vuln })),
    };
    await sendWebhook(cfg.webhook, payload, fetch, payload.event).catch(() => undefined);
  }
}

/** After an inventory read: refresh the lookups, then send what is new. Never throws. */
export async function afterInventory(site: Site, inv: WpInventory, log?: HostLogger): Promise<void> {
  if (!vulnCheckEnabled()) return;
  try {
    await refreshVulns(inv);
    const v = siteVulns(inv);
    if (v) await alertNew(site, v);
  } catch (err) {
    log?.(t('Cảnh báo: không tra được lỗ hổng đã công bố: {error}', { error: errorMessage(err) }));
  }
}

// ---- Bell ---------------------------------------------------------------------------------

/** Cached inventories of every WordPress site (read here so wpUpdates.ts can import this module). */
function inventories(): Array<{ id: number; domain: string; inv: WpInventory }> {
  const rows = db
    .prepare("SELECT s.id, s.domain, i.data_json FROM sites s JOIN wp_update_inventory i ON i.site_id = s.id WHERE s.app_type = 'wordpress' AND i.data_json IS NOT NULL")
    .all() as Array<{ id: number; domain: string; data_json: string }>;
  const out: Array<{ id: number; domain: string; inv: WpInventory }> = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, domain: r.domain, inv: JSON.parse(r.data_json) as WpInventory });
    } catch {
      /* unreadable cache */
    }
  }
  return out;
}

// Bell: sites with a critical/high or unfixed vulnerability (gone once the items are updated).
registerNotificationSource('wp-vulns', () => {
  if (!vulnCheckEnabled()) return [];
  return inventories().flatMap(({ id, domain, inv }) => {
    const v = policy.matchInventory(inv, cached);
    const items = policy.alertItems(v);
    if (!items.length) return [];
    const keys = items.map((i) => i.key).sort();
    const critical = items.some((i) => i.vuln.severity === 'critical');
    return [
      {
        // a new finding gets a new id, so the entry is unread again
        id: `wp-vulns:${id}:${crypto.createHash('sha1').update(keys.join('\n')).digest('hex').slice(0, 12)}`,
        kind: 'security',
        tone: critical ? ('err' as const) : ('warn' as const),
        title: t('{domain}: {count} lỗ hổng đã công bố trong WordPress, plugin hoặc theme', { domain, count: items.length }),
        body: items
          .slice(0, 3)
          .map((i) => alertLine(i, t))
          .join(' · '),
        createdAt: v.checkedAt ?? nowIso(),
        actions: [{ label: t('Mở tab Cập nhật'), href: `/sites/${id}?tab=updates` }],
        dismissible: false,
      },
    ];
  });
});
