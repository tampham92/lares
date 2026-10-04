/**
 * Lares anonymous install counter - Cloudflare Worker bound to https://lares.thocode.dev/ping
 *
 * Accepts exactly this JSON (POST, <= 1 KB) and nothing else:
 *   { install_id, version, event: install|upgrade|heartbeat, os, os_version, arch, lang }
 *
 * Privacy: the Worker never reads the client IP, CF-Connecting-IP, User-Agent or any other
 * header besides Content-Length/Content-Type, and stores only the validated fields above.
 * Unknown fields are dropped. Storage: Cloudflare D1 (see schema.sql and README.md).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,20})?(?:\+[0-9A-Za-z.-]{1,20})?$/;
const EVENTS = new Set(['install', 'upgrade', 'heartbeat']);
const LANGS = new Set(['vi', 'en']);
const MAX_BODY = 1024;
/** Daily rows older than this are deleted by the cron trigger. */
const RETENTION_DAYS = 400;

const empty = (status, headers = {}) => new Response(null, { status, headers });

/** Returns the clean payload, or null if anything is off. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const s = (k, max) => (typeof body[k] === 'string' && body[k].length <= max ? body[k] : null);
  const p = {
    install_id: s('install_id', 36),
    version: s('version', 48),
    event: s('event', 16),
    os: s('os', 32),
    os_version: typeof body.os_version === 'string' ? body.os_version : '',
    arch: s('arch', 16),
    lang: s('lang', 8),
  };
  if (!p.install_id || !UUID_RE.test(p.install_id)) return null;
  if (!p.version || !SEMVER_RE.test(p.version)) return null;
  if (!p.event || !EVENTS.has(p.event)) return null;
  if (!p.os || !/^[a-z0-9._-]{1,32}$/.test(p.os)) return null;
  if (!/^[0-9A-Za-z._-]{0,16}$/.test(p.os_version)) return null;
  if (!p.arch || !/^[a-z0-9_]{1,16}$/.test(p.arch)) return null;
  if (!p.lang || !LANGS.has(p.lang)) return null;
  return p;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The route only sends /ping here; anything else is not ours (Redirect Rules own /install, /uninstall).
    if (url.pathname !== '/ping') return empty(404);
    if (request.method !== 'POST') return empty(405, { Allow: 'POST' });
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return empty(413);

    const text = await request.text();
    if (text.length > MAX_BODY) return empty(413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return empty(400);
    }
    const p = validate(body);
    if (!p) return empty(400);

    const now = new Date();
    const iso = now.toISOString();
    const day = iso.slice(0, 10);
    try {
      await env.DB.batch([
        // One row per install: first/last seen and its current version/OS.
        env.DB.prepare(
          `INSERT INTO installs (install_id, first_seen, last_seen, last_event, version, os, os_version, arch, lang)
           VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(install_id) DO UPDATE SET
             last_seen = excluded.last_seen, last_event = excluded.last_event, version = excluded.version,
             os = excluded.os, os_version = excluded.os_version, arch = excluded.arch, lang = excluded.lang`,
        ).bind(p.install_id, iso, p.event, p.version, p.os, p.os_version, p.arch, p.lang),
        // At most one row per install, event and day: retries and restarts cannot inflate counts.
        env.DB.prepare(
          `INSERT OR IGNORE INTO daily (day, install_id, event, version, os, os_version, arch, lang)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(day, p.install_id, p.event, p.version, p.os, p.os_version, p.arch, p.lang),
      ]);
    } catch {
      return empty(503); // clients ignore the answer anyway
    }
    return empty(204);
  },

  /** Daily cron: drop old per-day rows (the installs table keeps one row per install). */
  async scheduled(_event, env) {
    await env.DB.prepare(`DELETE FROM daily WHERE day < date('now', ?1)`).bind(`-${RETENTION_DAYS} day`).run();
  },
};
