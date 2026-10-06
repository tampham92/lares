import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lead } from '@lares/shared';

// testAndReload() would otherwise start a real (dev) nginx on the developer's machine
vi.mock('../src/services/devNginx.js', () => ({ syncDevNginx: async () => {}, stopDevNginx: async () => {} }));

const { db } = await import('../src/db/index.js');
const { requestLang, runWithLang } = await import('../src/i18n/index.js');
const { leadRoutes } = await import('../src/routes/leads.js');
const leads = await import('../src/services/leads.js');
const notify = await import('../src/services/leadNotify.js');
const { renderVhost, vhostPath } = await import('../src/services/nginx.js');
const { hasCurrentLeadLocation, leadLocation, panelLeadUpstream } = await import('../src/services/leadsNginx.js');

const SUFFIX = Math.random().toString(36).slice(2, 8);
const DOMAIN = `leads-${SUFFIX}.example.com`;
const ALIAS = `www.leads-${SUFFIX}.example.com`;
const TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
let siteId = 0;

function addSite(domain: string, aliases: string[] = [], status = 'active'): number {
  const info = db
    .prepare(`INSERT INTO sites (domain, aliases_json, root_path, web_root, app_type, status) VALUES (?, ?, ?, ?, 'static', ?)`)
    .run(domain, JSON.stringify(aliases), `/var/www/${domain}`, `/var/www/${domain}/public_html`, status);
  return Number(info.lastInsertRowid);
}

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', (req, _reply, done) => runWithLang(requestLang(req.headers, req.query), done));
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(leadRoutes, { background: false });
  return app;
}
type App = Awaited<ReturnType<typeof buildApp>>;

/** What nginx forwards: site + visitor headers, from loopback. */
function post(app: App, opts: { payload: string | object; type?: string; accept?: string; ip?: string; site?: string; referer?: string; lang?: string; remote?: string }) {
  const headers: Record<string, string> = {
    'content-type': opts.type ?? (typeof opts.payload === 'string' ? 'application/x-www-form-urlencoded' : 'application/json'),
    'x-lares-site': opts.site ?? DOMAIN,
    'x-lares-client-ip': opts.ip ?? '198.51.100.10',
    'x-lares-host': DOMAIN,
    'x-lares-scheme': 'https',
  };
  if (opts.accept) headers.accept = opts.accept;
  if (opts.referer) headers.referer = opts.referer;
  if (opts.lang) headers['accept-language'] = opts.lang;
  return app.inject({
    method: 'POST',
    url: '/api/public/leads',
    headers,
    payload: typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload),
    remoteAddress: opts.remote ?? '127.0.0.1',
  });
}

const leadsOfSite = () => db.prepare('SELECT * FROM leads WHERE site_id = ? ORDER BY id').all(siteId) as Array<Record<string, string>>;

beforeAll(() => {
  siteId = addSite(DOMAIN, [ALIAS]);
});

afterAll(() => {
  db.prepare('DELETE FROM leads WHERE site_domain LIKE ?').run(`%leads-${SUFFIX}%`);
  db.prepare('DELETE FROM sites WHERE domain LIKE ?').run(`%leads-${SUFFIX}%`);
  db.prepare(`DELETE FROM settings WHERE key = 'leads'`).run();
});

beforeEach(() => {
  leads.ipLimiter.reset();
  leads.siteLimiter.reset();
});

describe('form contract parsing', () => {
  it('reads and trims the contract fields', () => {
    const r = leads.parseLeadBody({ name: '  Nguyễn   Văn A ', phone: ' 0909 123 456 ', email: 'a@b.vn', message: ' Xin chào\r\n\r\ndòng 2  ', service: 'Mua', page: '/lien-he', extra: 'ignored' });
    expect(r).toEqual({ kind: 'ok', lead: { name: 'Nguyễn Văn A', phone: '0909 123 456', email: 'a@b.vn', company: '', service: 'Mua', message: 'Xin chào\n\ndòng 2', page: '/lien-he' } });
  });

  it('needs a phone or an email and validates both', () => {
    expect(leads.parseLeadBody({ name: 'A' })).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody({ email: 'a@b.vn' })).toMatchObject({ kind: 'ok' });
    expect(leads.parseLeadBody({ phone: '+84 (909) 123-456' })).toMatchObject({ kind: 'ok' });
    expect(leads.parseLeadBody({ phone: 'call me' })).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody({ phone: '12' })).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody({ email: 'not-an-email' })).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody({ phone: 909123456 })).toMatchObject({ kind: 'ok', lead: { phone: '909123456' } });
    expect(leads.parseLeadBody({ phone: { $gt: '' } })).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody(null)).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody(['x'])).toMatchObject({ kind: 'invalid' });
  });

  it('enforces length limits and strips control characters', () => {
    expect(leads.parseLeadBody({ phone: '0909123456', message: 'x'.repeat(5001) })).toMatchObject({ kind: 'invalid' });
    expect(leads.parseLeadBody({ phone: '0909123456', name: 'y'.repeat(121) })).toMatchObject({ kind: 'invalid' });
    const r = leads.parseLeadBody({ phone: '0909123456', name: 'A\u0000B​C\nD' });
    expect(r).toMatchObject({ kind: 'ok', lead: { name: 'A BC D' } });
  });

  it('treats a filled honeypot as spam', () => {
    expect(leads.parseLeadBody({ phone: '0909123456', _hp: 'http://spam' })).toEqual({ kind: 'spam' });
    expect(leads.parseLeadBody({ phone: '0909123456', _hp: '   ' })).toMatchObject({ kind: 'ok' });
  });

  it('keeps only safe page paths', () => {
    expect(leads.parseLeadBody({ phone: '0909123456', page: '//evil.com/x' })).toMatchObject({ lead: { page: '/evil.com/x' } });
    expect(leads.parseLeadBody({ phone: '0909123456', page: 'https://evil.com/' })).toMatchObject({ lead: { page: '' } });
  });
});

describe('redirect after a plain form post', () => {
  const base = { host: DOMAIN, siteHosts: [DOMAIN, ALIAS] };
  it('goes back to a same-site Referer', () => {
    expect(leads.leadRedirect({ ...base, referer: `https://${DOMAIN}/lien-he?x=1#top`, ok: true })).toBe('/lien-he?x=1#lares-sent');
    expect(leads.leadRedirect({ ...base, referer: `http://${ALIAS}/a`, ok: false })).toBe('/a#lares-error');
  });
  it('never leaves the site', () => {
    expect(leads.leadRedirect({ ...base, referer: 'https://evil.com/phish', ok: true })).toBe('/#lares-sent');
    expect(leads.leadRedirect({ ...base, referer: 'https://evil.com/phish', page: '/contact', ok: true })).toBe('/contact#lares-sent');
    expect(leads.leadRedirect({ ...base, referer: `https://${DOMAIN}//evil.com/x`, ok: true })).toBe('/evil.com/x#lares-sent');
    expect(leads.leadRedirect({ ...base, page: '/\\evil.com', ok: true })).toBe('/evil.com#lares-sent');
    expect(leads.leadRedirect({ ...base, page: 'javascript:alert(1)', ok: true })).toBe('/#lares-sent');
    expect(leads.leadRedirect({ ...base, referer: 'javascript:alert(1)', ok: true })).toBe('/#lares-sent');
    expect(leads.leadRedirect({ ...base, page: '/a\r\nSet-Cookie: x=1', ok: true })).not.toMatch(/[\r\n ]/);
  });
  it('matches port-based sites by host:port', () => {
    expect(leads.leadRedirect({ host: '203.0.113.9:8001', siteHosts: ['site8001.localhost'], referer: 'http://203.0.113.9:8001/p', ok: true })).toBe('/p#lares-sent');
    expect(leads.leadRedirect({ host: '203.0.113.9:8001', siteHosts: ['site8001.localhost'], referer: 'http://203.0.113.9:8002/p', ok: true })).toBe('/#lares-sent');
  });
});

describe('rate limiting', () => {
  it('allows 5 per minute and 50 per day per key', () => {
    const rl = new leads.RateLimiter([
      { windowMs: 60_000, max: 5 },
      { windowMs: 86_400_000, max: 50 },
    ]);
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rl.hit('ip', t0 + i)).toBe(true);
    expect(rl.hit('ip', t0 + 10)).toBe(false);
    expect(rl.hit('other', t0 + 10)).toBe(true);
    expect(rl.hit('ip', t0 + 61_000)).toBe(true);
    let ok = 6;
    for (let m = 2; m < 100; m++) for (let i = 0; i < 5; i++) if (rl.hit('ip', t0 + m * 61_000 + i)) ok++;
    expect(ok).toBe(50);
    rl.sweep(t0 + 3 * 86_400_000);
    expect(rl.hit('ip', t0 + 3 * 86_400_000)).toBe(true);
  });
});

describe('POST /api/public/leads', () => {
  let app: App;
  beforeAll(async () => {
    notify.setNotifyFetch(async () => new Response('{"ok":true}', { status: 200 }));
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('refuses anything but loopback', async () => {
    const r = await post(app, { payload: { phone: '0909123456' }, accept: 'application/json', remote: '203.0.113.5' });
    expect(r.statusCode).toBe(403);
    expect(r.json().ok).toBe(false);
    const v6 = await post(app, { payload: { phone: '0909123456' }, accept: 'application/json', remote: '::1' });
    expect(v6.statusCode).toBe(200);
  });

  it('stores a urlencoded form post and redirects back with #lares-sent', async () => {
    const before = leadsOfSite().length;
    const r = await post(app, {
      payload: 'name=Tr%E1%BA%A7n+B&phone=0912+345+678&message=C%E1%BA%A7n+t%C6%B0+v%E1%BA%A5n&service=Mua&_hp=',
      referer: `https://${DOMAIN}/lien-he`,
      ip: '198.51.100.20',
    });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('/lien-he#lares-sent');
    const rows = leadsOfSite();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ name: 'Trần B', phone: '0912 345 678', message: 'Cần tư vấn', service: 'Mua', page: '/lien-he', page_url: `https://${DOMAIN}/lien-he`, ip: '198.51.100.20', status: 'new' });
  });

  it('answers JSON callers with {ok:true}', async () => {
    const r = await post(app, { payload: { email: 'x@y.vn', page: '/bang-gia' }, accept: 'application/json', ip: '198.51.100.21' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(leadsOfSite().at(-1)).toMatchObject({ email: 'x@y.vn', page: '/bang-gia', page_url: `https://${DOMAIN}/bang-gia` });
  });

  it('reports validation errors in the visitor language', async () => {
    const en = await post(app, { payload: { name: 'A' }, accept: 'application/json', lang: 'en-US,en;q=0.9', ip: '198.51.100.22' });
    expect(en.statusCode).toBe(400);
    expect(en.json()).toEqual({ ok: false, error: 'Please enter a phone number or an email address' });
    const vi = await post(app, { payload: { name: 'A' }, accept: 'application/json', lang: 'vi', ip: '198.51.100.22' });
    expect(vi.json().error).toBe('Vui lòng nhập số điện thoại hoặc email');
    const form = await post(app, { payload: 'name=A', referer: `https://${DOMAIN}/x`, ip: '198.51.100.22' });
    expect(form.statusCode).toBe(303);
    expect(form.headers.location).toBe('/x#lares-error');
  });

  it('silently drops honeypot submissions', async () => {
    const before = leadsOfSite().length;
    const r = await post(app, { payload: { phone: '0909123456', _hp: 'gotcha' }, accept: 'application/json', ip: '198.51.100.23' });
    expect(r.json()).toEqual({ ok: true });
    expect(leadsOfSite().length).toBe(before);
  });

  it('rate-limits a client IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post(app, { payload: { phone: '0909123456' }, accept: 'application/json', ip: '198.51.100.30' })).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect((await post(app, { payload: { phone: '0909123456' }, accept: 'application/json', ip: '198.51.100.31' })).statusCode).toBe(200);
  });

  it('rejects unknown or suspended sites and bad bodies in the contract shape', async () => {
    const unknown = await post(app, { payload: { phone: '0909123456' }, accept: 'application/json', site: 'nope.example.com' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().ok).toBe(false);
    const suspended = addSite(`off-leads-${SUFFIX}.example.com`, [], 'disabled');
    expect((await post(app, { payload: { phone: '0909123456' }, accept: 'application/json', site: `off-leads-${SUFFIX}.example.com` })).statusCode).toBe(404);
    db.prepare('DELETE FROM sites WHERE id = ?').run(suspended);
    const bad = await post(app, { payload: '{"phone":', type: 'application/json', accept: 'application/json', ip: '198.51.100.40' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ ok: false });
    const badForm = await post(app, { payload: '{"phone":', type: 'application/json', referer: `https://${DOMAIN}/y`, ip: '198.51.100.41' });
    expect(badForm.statusCode).toBe(303);
    expect(badForm.headers.location).toBe('/y#lares-error');
    const plain = await post(app, { payload: 'phone=1', type: 'text/plain', accept: 'application/json', ip: '198.51.100.42' });
    expect(plain.statusCode).toBe(400);
    expect(plain.json().ok).toBe(false);
    const multipart = await post(app, { payload: 'x', type: 'multipart/form-data; boundary=x', accept: 'application/json', ip: '198.51.100.43' });
    expect(multipart.statusCode).toBe(415);
    expect(multipart.json().ok).toBe(false);
  });
});

describe('notifications', () => {
  const lead: Lead = {
    id: 7,
    siteId: 1,
    site: 'shop.example.com',
    host: 'shop.example.com',
    name: 'Lê <b>C</b>',
    phone: '0909 123 456',
    email: 'c@example.com',
    company: '',
    service: 'Thuê',
    message: 'Giá & diện tích?',
    page: '/lien-he',
    pageUrl: 'https://shop.example.com/lien-he',
    ip: '198.51.100.1',
    status: 'new',
    note: '',
    createdAt: '2026-10-05T07:30:00.000Z',
    updatedAt: null,
    notifications: [],
  };

  it('formats the Telegram message (escaped HTML, tap-to-call number)', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"ok":true,"result":{}}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await notify.sendChannel('telegram', { ...leads.EMPTY_NOTIFY, telegram: { enabled: true, botToken: TOKEN, chatId: '-100123' } }, lead, fetchFn);
    expect(r).toEqual({ ok: true });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ chat_id: '-100123', parse_mode: 'HTML', disable_web_page_preview: true });
    expect(body.text).toContain('<b>Khách liên hệ mới</b> · shop.example.com');
    expect(body.text).toContain('Lê &lt;b&gt;C&lt;/b&gt;');
    expect(body.text).toContain('0909 123 456 · +84909123456');
    expect(body.text).toContain('Giá &amp; diện tích?');
    expect(body.text).toContain('https://shop.example.com/lien-he');
    expect(body.text).not.toContain('<b>C</b>');
  });

  it('classifies Telegram failures and never leaks the token', async () => {
    const tg = { enabled: true, botToken: TOKEN, chatId: '42' };
    const notFound = (async () => new Response('{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}', { status: 400 })) as unknown as typeof fetch;
    const r1 = await notify.sendTelegram(tg, 'x', notFound);
    expect(r1).toMatchObject({ ok: false, retry: false });
    expect(r1.ok === false && r1.error).toContain('chat not found');
    const down = (async () => new Response('Bad gateway', { status: 502 })) as unknown as typeof fetch;
    expect(await notify.sendTelegram(tg, 'x', down)).toMatchObject({ ok: false, retry: true });
    const offline = (async () => {
      throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendMessage`);
    }) as unknown as typeof fetch;
    const r3 = await notify.sendTelegram(tg, 'x', offline);
    expect(r3).toMatchObject({ ok: false, retry: true });
    expect(r3.ok === false && r3.error).not.toContain(TOKEN);
  });

  it('posts the webhook JSON with the secret header', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const cfg = { ...leads.EMPTY_NOTIFY, webhook: { enabled: true, url: 'https://hook.example.com/abc', secretHeader: 'X-Token', secret: 's3cret' } };
    expect(await notify.sendChannel('webhook', cfg, lead, fetchFn)).toEqual({ ok: true });
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe('https://hook.example.com/abc');
    const headers = s.init.headers as Record<string, string>;
    expect(headers['X-Token']).toBe('s3cret');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(s.init.body));
    expect(body).toMatchObject({ event: 'lead.created', test: false, lead: { id: 7, site: 'shop.example.com', phone: '0909 123 456', phoneTel: '+84909123456', message: 'Giá & diện tích?', pageUrl: 'https://shop.example.com/lien-he' } });
    expect(body.text).toContain('Lê <b>C</b>');
    const gone = (async () => new Response('no such hook', { status: 410 })) as unknown as typeof fetch;
    expect(await notify.sendWebhook(cfg.webhook, {}, gone)).toMatchObject({ ok: false, retry: false, error: 'Webhook HTTP 410: no such hook' });
  });

  it('queues per channel, retries transient failures with backoff and stores the lead regardless', async () => {
    leads.saveLeadSettings({
      retentionMonths: 12,
      telegram: { enabled: true, botToken: TOKEN, chatId: '42' },
      webhook: { enabled: true, url: 'https://hook.example.com/x', secretHeader: 'X-Lares-Secret' },
    });
    const view = leads.notifyView(leads.getGlobalNotify());
    expect(view.telegram).toEqual({ enabled: true, hasToken: true, tokenHint: '123456789:…ghi', chatId: '42' });
    expect(JSON.stringify(view)).not.toContain(TOKEN);

    let telegramStatus = 503;
    notify.setNotifyFetch((async (url: string) => (String(url).includes('telegram') ? new Response('{"ok":false,"description":"busy"}', { status: telegramStatus }) : new Response('ok'))) as unknown as typeof fetch);
    const id = leads.insertLead({ id: siteId, domain: DOMAIN }, { name: 'Q', phone: '0909000111', email: '', company: '', service: '', message: '', page: '/' }, { host: DOMAIN, ip: '198.51.100.50', pageUrl: '' });
    expect(notify.queueNotifications(id, siteId)).toEqual(['telegram', 'webhook']);
    await notify.processDue();
    await notify.processDue();
    let l = leads.getLead(id);
    const byChannel = (c: string) => l.notifications.find((n) => n.channel === c)!;
    expect(byChannel('webhook')).toMatchObject({ status: 'sent', attempts: 1 });
    expect(byChannel('telegram')).toMatchObject({ status: 'pending', attempts: 1 });
    expect(byChannel('telegram').error).toContain('503');
    const next = Date.parse(byChannel('telegram').nextAttemptAt!);
    expect(next - Date.now()).toBeGreaterThan(20_000);

    // the retry is due later: run the worker "in the future"
    telegramStatus = 200;
    notify.setNotifyFetch((async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch);
    await notify.processDue(next + 1);
    l = leads.getLead(id);
    expect(byChannel('telegram')).toMatchObject({ status: 'sent', attempts: 2 });

    // permanent failure: no retry, visible as failed
    notify.setNotifyFetch((async () => new Response('{"ok":false,"description":"Unauthorized"}', { status: 401 })) as unknown as typeof fetch);
    const id2 = leads.insertLead({ id: siteId, domain: DOMAIN }, { name: 'R', phone: '0909000222', email: '', company: '', service: '', message: '', page: '/' }, { host: DOMAIN, ip: '198.51.100.51', pageUrl: '' });
    notify.queueNotifications(id2, siteId);
    await notify.processDue();
    await notify.processDue();
    l = leads.getLead(id2);
    expect(byChannel('telegram')).toMatchObject({ status: 'failed', attempts: 1 });
    expect(notify.recentFailures().some((f) => f.leadId === id2 && f.channel === 'telegram')).toBe(true);

    // per-site override "off": nothing is queued
    leads.saveSiteNotify(siteId, { mode: 'off', telegram: { enabled: false, chatId: '' }, webhook: { enabled: false, url: '', secretHeader: 'X-Lares-Secret' } });
    expect(notify.queueNotifications(id2, siteId)).toEqual([]);
    leads.saveSiteNotify(siteId, { mode: 'inherit', telegram: { enabled: false, chatId: '' }, webhook: { enabled: false, url: '', secretHeader: 'X-Lares-Secret' } });
  });

  it('keeps stored secrets when the form leaves them empty', () => {
    const cur = { ...leads.EMPTY_NOTIFY, telegram: { enabled: true, botToken: TOKEN, chatId: '1' }, webhook: { enabled: true, url: 'https://h.example.com', secretHeader: 'X-A', secret: 'old' } };
    const next = leads.mergeNotify(cur, { telegram: { enabled: true, botToken: '', chatId: '2' }, webhook: { enabled: true, url: 'https://h.example.com', secretHeader: 'X-A' } });
    expect(next.telegram.botToken).toBe(TOKEN);
    expect(next.webhook.secret).toBe('old');
    const cleared = leads.mergeNotify(cur, { telegram: { enabled: false, clearBotToken: true, chatId: '' }, webhook: { enabled: false, url: '', secretHeader: '', clearSecret: true } });
    expect(cleared.telegram.botToken).toBe('');
    expect(cleared.webhook.secret).toBe('');
    expect(() => leads.mergeNotify(leads.EMPTY_NOTIFY, { telegram: { enabled: true, chatId: '1' }, webhook: { enabled: false, url: '', secretHeader: '' } })).toThrow();
  });
});

describe('retention', () => {
  it('deletes leads older than the retention period only', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const old = leads.insertLead({ id: siteId, domain: DOMAIN }, { name: 'Old', phone: '0909', email: '', company: '', service: '', message: '', page: '' }, { host: '', ip: '', pageUrl: '' }, '2025-09-01T00:00:00.000Z');
    const recent = leads.insertLead({ id: siteId, domain: DOMAIN }, { name: 'New', phone: '0909', email: '', company: '', service: '', message: '', page: '' }, { host: '', ip: '', pageUrl: '' }, '2026-01-01T00:00:00.000Z');
    expect(leads.purgeExpiredLeads(0, now)).toBe(0);
    expect(leads.purgeExpiredLeads(12, now)).toBeGreaterThanOrEqual(1);
    expect(() => leads.getLead(old)).toThrow();
    expect(leads.getLead(recent).name).toBe('New');
  });
});

describe('inbox', () => {
  it('filters, searches, updates and exports', () => {
    const id = leads.insertLead({ id: siteId, domain: DOMAIN }, { name: 'Phạm Search', phone: '+84901', email: '', company: '', service: '', message: '=HYPERLINK("x")', page: '/' }, { host: DOMAIN, ip: '', pageUrl: '' });
    expect(leads.listLeads({ siteId, q: 'Search', limit: 50, offset: 0 }).leads.map((l) => l.id)).toEqual([id]);
    expect(leads.listLeads({ siteId, q: '%', limit: 50, offset: 0 }).leads.length).toBe(0);
    const updated = leads.updateLead(id, { status: 'contacted', note: 'Gọi lại thứ 2' });
    expect(updated).toMatchObject({ status: 'contacted', note: 'Gọi lại thứ 2', site: DOMAIN });
    expect(leads.listLeads({ siteId, status: 'contacted', limit: 50, offset: 0 }).leads.some((l) => l.id === id)).toBe(true);
    const csv = leads.leadsCsv({ siteId, q: 'Search' });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`'=HYPERLINK(""x"")`);
    expect(csv).toContain(',+84901,');
    leads.deleteLead(id);
    expect(() => leads.getLead(id)).toThrow();
  });

  it('defuses spreadsheet formulas', () => {
    expect(leads.csvCell('=1+1')).toBe("'=1+1");
    expect(leads.csvCell('+84 909')).toBe('+84 909');
    expect(leads.csvCell('-cmd|x')).toBe("'-cmd|x");
    expect(leads.csvCell('a,b')).toBe('"a,b"');
  });
});

describe('nginx lead location', () => {
  const spec = (domain: string, disabled = false) => ({ domain, aliases: [], appType: 'wordpress' as const, webRoot: `/var/www/${domain}/public_html`, phpVersion: '8.2', appPort: null, listenPort: null, accessLog: true, disabled, ssl: null });

  it('proxies /_lares/lead to the panel with the site header, only for active sites', () => {
    const conf = renderVhost(spec('shop.example.com'));
    expect(conf).toContain('location = /_lares/lead {');
    expect(conf).toContain('proxy_set_header X-Lares-Site "shop.example.com";');
    expect(conf).toContain('proxy_set_header X-Lares-Client-IP $remote_addr;');
    expect(conf).toContain('proxy_set_header Cookie "";');
    expect(conf).toContain(`proxy_pass ${panelLeadUpstream()};`);
    expect(hasCurrentLeadLocation(conf, 'shop.example.com')).toBe(true);
    expect(hasCurrentLeadLocation(conf, 'other.example.com')).toBe(false);
    expect(renderVhost(spec('shop.example.com', true))).not.toContain('/_lares/lead');
  });

  it('uses https towards a TLS panel', () => {
    expect(panelLeadUpstream(true, 8686)).toBe('https://127.0.0.1:8686/api/public/leads');
    expect(panelLeadUpstream(false, 9443)).toBe('http://127.0.0.1:9443/api/public/leads');
    expect(hasCurrentLeadLocation(leadLocation('a.example.com', panelLeadUpstream(false, 1)), 'a.example.com', panelLeadUpstream(true, 1))).toBe(false);
  });

  it('adds the location to existing vhosts at startup', async () => {
    const domain = `old-leads-${SUFFIX}.example.com`;
    addSite(domain);
    const file = vhostPath(domain);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'server {\n    listen 80;\n    server_name old;\n}\n');
    try {
      expect(await leads.ensureLeadVhosts(() => {})).toBeGreaterThanOrEqual(1);
      const content = await fs.readFile(file, 'utf8');
      expect(hasCurrentLeadLocation(content, domain)).toBe(true);
      // idempotent: nothing left to change for this site
      await leads.ensureLeadVhosts(() => {});
      expect(await fs.readFile(file, 'utf8')).toBe(content);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

describe('built-in template contact forms', () => {
  it('static pages post the contract fields to /_lares/lead with progressive enhancement', async () => {
    const { config } = await import('../src/config.js');
    config.templatesDir = path.resolve(__dirname, '../../../templates');
    const { getTemplate, renderStaticPage, templateVars } = await import('../src/services/templates.js');
    for (const id of ['bat-dong-san', 'doanh-nghiep']) {
      const tpl = await getTemplate(id);
      const html = await renderStaticPage(id, templateVars(tpl, { siteName: 'Test Co', phone: '0909 000 111' }));
      const form = html.slice(html.indexOf('<form class="form"'), html.indexOf('</form>', html.indexOf('<form class="form"')));
      expect(form).toContain('method="post" action="/_lares/lead" data-lares-lead');
      for (const field of ['name="name"', 'name="phone"', 'name="service"', 'name="message"', 'name="_hp"']) expect(form, `${id} ${field}`).toContain(field);
      expect(form).toContain('id="lares-sent"');
      expect(form).toContain('id="lares-error"');
      expect(form).not.toContain('mailto:');
      expect(html).toContain("form[data-lares-lead]");
      expect(html).not.toContain('{{LEAD_JS}}');
      expect(html).not.toContain('sendContact');
    }
  });

  it('WordPress themes ship the form as a template part plus the script', async () => {
    const os = await import('node:os');
    const { getTemplate, templateVars, writeWordpressTheme, contactFormBlock } = await import('../src/services/templates.js');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lares-lead-theme-'));
    try {
      const tpl = await getTemplate('doanh-nghiep');
      expect(tpl.wordpress?.pages.find((p) => p.slug === 'lien-he')?.contactForm).toBe(true);
      const slug = await writeWordpressTheme(tpl, dir, templateVars(tpl, { siteName: 'ACME' }));
      const theme = path.join(dir, 'wp-content/themes', slug);
      const part = await fs.readFile(path.join(theme, 'parts/contact-form.html'), 'utf8');
      expect(part.startsWith('<!-- wp:html -->\n<form class="form" method="post" action="/_lares/lead" data-lares-lead>')).toBe(true);
      expect(part.trim().endsWith('<!-- /wp:html -->')).toBe(true);
      expect(part).toContain('ACME');
      expect(part).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(await fs.readFile(path.join(theme, 'lares-lead.js'), 'utf8')).toContain('/_lares/lead');
      expect(await fs.readFile(path.join(theme, 'functions.php'), 'utf8')).toContain("get_theme_file_uri('lares-lead.js')");
      const themeJson = JSON.parse(await fs.readFile(path.join(theme, 'theme.json'), 'utf8'));
      expect(themeJson.templateParts.map((p: { name: string }) => p.name)).toContain('contact-form');
      expect(contactFormBlock(slug)).toBe(`<!-- wp:template-part {"slug":"contact-form","theme":"${slug}"} /-->`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
