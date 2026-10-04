import type { FastifyInstance } from 'fastify';
import { ALLOWLIST_MAX } from '@lares/shared';
import { getSetting, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { badRequest } from '../lib/errors.js';
import { buildAllowMatcher, formatAllowEntry, isLoopback, normalizeIp, parseAllowEntry } from '../lib/ipallow.js';

// ---------------------------------------------------------------------------
// Panel IP allowlist
// ---------------------------------------------------------------------------

const ALLOWLIST_KEY = 'panel_allowlist';
// The CLI edits the list from another process, so the in-memory copy is only trusted for a few seconds.
const CACHE_MS = 5_000;
let cache: { at: number; entries: string[]; match: (ip: string) => boolean } | null = null;

export const getAllowlist = (): string[] => getSetting<string[]>(ALLOWLIST_KEY, []);

/** Validates, canonicalises and de-duplicates entries; throws 400 naming the first bad one. */
export function normalizeAllowlist(entries: string[]): string[] {
  const out: string[] = [];
  for (const raw of entries) {
    if (!raw.trim()) continue;
    const e = parseAllowEntry(raw);
    if (!e) throw badRequest(t('"{entry}" không phải địa chỉ IP hoặc dải CIDR hợp lệ', { entry: raw.trim() }));
    const s = formatAllowEntry(e);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > ALLOWLIST_MAX) throw badRequest(t('Tối đa {n} mục', { n: ALLOWLIST_MAX }));
  return out;
}

export function setAllowlist(entries: string[]): string[] {
  const list = normalizeAllowlist(entries);
  setSetting(ALLOWLIST_KEY, list);
  cache = null;
  return list;
}

/**
 * Empty list = everyone may reach the login page. Loopback is always allowed: it is the
 * SSH-tunnel escape hatch (ssh -L 8686:127.0.0.1:8686) and is used by local health checks.
 */
export function isIpAllowed(ip: string, entries?: string[]): boolean {
  if (isLoopback(ip)) return true;
  if (entries) return entries.length === 0 || buildAllowMatcher(entries)(ip);
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const list = getAllowlist();
    cache = { at: Date.now(), entries: list, match: buildAllowMatcher(list) };
  }
  return cache.entries.length === 0 || cache.match(ip);
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

/**
 * The built SPA is a single module script plus a stylesheet, all same-origin. Inline styles are
 * allowed because React `style={...}` props need them; images may come from template thumbnails
 * and WordPress sites. The template preview route sets its own, stricter CSP (kept as is).
 */
export const PANEL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Registers the allowlist gate and the security headers on the root instance (call before routes). */
export function installSecurityHooks(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (isIpAllowed(req.ip)) return;
    const text = t('Địa chỉ IP {ip} không được phép truy cập Lares Panel', { ip: normalizeIp(req.ip) });
    req.log.warn({ ip: req.ip, url: req.url }, 'blocked by panel IP allowlist');
    if (req.url.startsWith('/api/')) return reply.code(403).send({ error: text });
    return reply.code(403).type('text/plain; charset=utf-8').send(text);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!reply.hasHeader('X-Frame-Options')) reply.header('X-Frame-Options', 'SAMEORIGIN');
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', PANEL_CSP);
    // Tokens, recovery codes and site credentials must never sit in a browser or proxy cache.
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
