import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { afterAll, describe, expect, it } from 'vitest';
import { phpSettingsSchema, type PhpSettings } from '@lares/shared';
import { authRoutes } from '../src/auth/index.js';
import { db } from '../src/db/index.js';
import { siteToolsRoutes } from '../src/routes/sitetools.js';
import {
  ADMINER_SHA256,
  downloadAdminer,
  downstreamHeaders,
  proxyToAdminer,
  readCookie,
  renderAdminerNginx,
  renderIndexPhp,
  renderPool,
  upstreamHeaders,
} from '../src/services/adminer.js';
import { cloudflareConnected, computeOnboarding, dismissState, type OnboardingFacts } from '../src/services/onboarding.js';
import {
  BLOCK_BEGIN,
  blockSettings,
  clientMaxBodyFor,
  foreignKeys,
  iniSizeToMb,
  mergeUserIni,
  parsePoolFile,
  readServerPhp,
  renderBlock,
} from '../src/services/phpSettings.js';
import { renderVhost } from '../src/services/nginx.js';
import { installSecurityHooks, setAllowlist } from '../src/services/security.js';

const none: PhpSettings = { upload_max_filesize: null, post_max_size: null, memory_limit: null, max_execution_time: null, max_input_vars: null };

// ---------------------------------------------------------------------------
describe('per-site PHP settings', () => {
  it('parses ini sizes', () => {
    expect(iniSizeToMb('256M')).toBe(256);
    expect(iniSizeToMb('1G')).toBe(1024);
    expect(iniSizeToMb('512K')).toBe(0.5);
    expect(iniSizeToMb('-1')).toBe(Infinity);
    expect(iniSizeToMb('0', 'post_max_size')).toBe(Infinity);
    expect(iniSizeToMb('abc')).toBeNull();
  });

  it('validates ranges and post >= upload', () => {
    expect(phpSettingsSchema.safeParse({ upload_max_filesize: 128, post_max_size: 64 }).success).toBe(false);
    expect(phpSettingsSchema.safeParse({ upload_max_filesize: 128, post_max_size: 128 }).success).toBe(true);
    expect(phpSettingsSchema.safeParse({ max_execution_time: 301 }).success).toBe(false);
    expect(phpSettingsSchema.safeParse({ memory_limit: 32 }).success).toBe(false);
    expect(phpSettingsSchema.safeParse({ max_input_vars: 1.5 }).success).toBe(false);
    expect(phpSettingsSchema.parse({})).toEqual(none);
  });

  it('manages its own block and keeps other lines', () => {
    const block = renderBlock({ ...none, upload_max_filesize: 128, post_max_size: 128, max_execution_time: 120 })!;
    expect(block).toContain('upload_max_filesize = 128M');
    expect(block).toContain('max_execution_time = 120');
    expect(block).not.toContain('memory_limit');
    const foreign = "auto_prepend_file = '/var/www/x/wordfence-waf.php'\nmemory_limit = 64M\n";
    const merged = mergeUserIni(foreign, block)!;
    expect(merged.startsWith('auto_prepend_file')).toBe(true);
    expect(merged.trimEnd().endsWith('; END Lares PHP settings')).toBe(true);
    // replace, not duplicate
    const again = mergeUserIni(merged, renderBlock({ ...none, memory_limit: 512 }))!;
    expect(again.split(BLOCK_BEGIN).length).toBe(2);
    expect(again).toContain('memory_limit = 512M');
    expect(again).not.toContain('upload_max_filesize');
    expect(blockSettings(again)).toEqual({ ...none, memory_limit: 512 });
    expect(foreignKeys(again)).toEqual(['memory_limit']);
    // removing the block leaves the foreign lines; an empty file is deleted
    expect(mergeUserIni(again, null)).toBe(foreign);
    expect(mergeUserIni(mergeUserIni(null, block), null)).toBeNull();
  });

  it('reads server values: php.ini < conf.d < pool, php_admin_value locks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lares-php-'));
    const fpm = path.join(dir, '8.3', 'fpm');
    fs.mkdirSync(path.join(fpm, 'conf.d'), { recursive: true });
    fs.mkdirSync(path.join(fpm, 'pool.d'), { recursive: true });
    fs.writeFileSync(path.join(fpm, 'php.ini'), '[PHP]\nupload_max_filesize = 256M\npost_max_size = 256M ; comment\nmemory_limit = 512M\n');
    fs.writeFileSync(path.join(fpm, 'conf.d', '99-x.ini'), 'post_max_size = "300M"\n');
    fs.writeFileSync(path.join(fpm, 'pool.d', 'www.conf'), '[www]\nlisten = /run/php/php8.3-fpm.sock\nphp_admin_value[memory_limit] = 1G\nphp_value[max_input_vars] = 2000\n;php_admin_value[max_execution_time] = 1\n');
    const s = await readServerPhp('8.3', '/run/php/php8.3-fpm.sock', dir);
    expect(s.values.upload_max_filesize).toEqual({ value: '256M', source: 'php.ini' });
    expect(s.values.post_max_size).toEqual({ value: '300M', source: 'php.ini' });
    expect(s.values.memory_limit).toEqual({ value: '1G', source: 'pool' });
    expect(s.values.max_input_vars).toEqual({ value: '2000', source: 'pool' });
    expect(s.values.max_execution_time).toEqual({ value: '30', source: 'builtin' });
    expect([...s.locked]).toEqual(['memory_limit']);
    expect(s.userIniFilename).toBe('.user.ini');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('parses multi-pool files', () => {
    const pools = parsePoolFile('[global]\npid = x\n[a]\nlisten = /a.sock\nphp_admin_flag[log_errors] = on\n[b]\nlisten=/b.sock\n');
    expect([...pools.keys()]).toEqual(['a', 'b']);
    expect(pools.get('a')!.overrides.admin.get('log_errors')).toBe('on');
    expect(pools.get('b')!.listen).toBe('/b.sock');
  });

  it('makes nginx client_max_body_size follow the upload limit', () => {
    expect(clientMaxBodyFor(none, 2, 8)).toBeNull();
    expect(clientMaxBodyFor({ ...none, upload_max_filesize: 512 }, 512, 256)).toBe(512);
    expect(clientMaxBodyFor({ ...none, upload_max_filesize: 100 }, 100, Infinity)).toBe(100);
    const spec = { domain: 'a.test', aliases: [], appType: 'php' as const, webRoot: '/w', phpVersion: '8.3', appPort: null, accessLog: true, disabled: false, ssl: null };
    expect(renderVhost(spec)).toContain('client_max_body_size 256m;');
    expect(renderVhost({ ...spec, clientMaxBodyMb: 1024 })).toContain('client_max_body_size 1024m;');
  });
});

// ---------------------------------------------------------------------------
describe('Adminer', () => {
  const okFetch = (body: Buffer) => async () => ({ ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer });

  it('fails closed when the download does not match the pinned SHA-256', async () => {
    await expect(downloadAdminer(okFetch(Buffer.from('<?php evil();')), 'https://x.test/a.php')).rejects.toThrow(/SHA-256/);
    await expect(downloadAdminer(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }), 'https://x.test/a.php')).rejects.toThrow(/404/);
    expect(ADMINER_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('renders a loopback-only nginx block guarded by the secret', () => {
    const secret = 'a'.repeat(64);
    const conf = renderAdminerNginx({ port: 18686, secret, index: '/var/lib/lares-adminer/www/index.php', socket: '/run/php/lares-adminer.sock' });
    expect(conf).toContain('listen 127.0.0.1:18686;');
    expect(conf).not.toMatch(/listen (80|443|\[::\])/);
    expect(conf).toContain(`$http_x_lares_adminer_key != "${secret}"`);
    expect(conf).toContain('fastcgi_param HTTP_X_LARES_ADMINER_KEY "";');
    expect(() => renderAdminerNginx({ port: 1, secret: 'x"; }', index: '/i', socket: '/s' })).toThrow();
  });

  it('runs Adminer in its own restricted pool, with no secret in index.php', () => {
    const pool = renderPool({ user: 'lares-adminer', socket: '/run/php/lares-adminer.sock', listenOwner: 'www-data', dir: '/var/lib/lares-adminer' });
    expect(pool).toContain('user = lares-adminer');
    expect(pool).toContain('php_admin_value[open_basedir] = /var/lib/lares-adminer/');
    expect(pool).toContain('php_admin_value[session.save_path] = /var/lib/lares-adminer/sessions');
    const php = renderIndexPhp({ ticketsDir: '/t', dbServer: 'localhost', adminerFile: 'adminer.php', loginMessage: "it's" });
    expect(php).toContain("const LARES_LOGIN_MESSAGE = 'it\\'s';");
    expect(php).toContain('@unlink($file);');
    expect(php).toContain('class LaresAdminer extends \\Adminer\\Adminer');
    expect(php).not.toMatch(/[a-f0-9]{64}/);
  });

  it('forwards only what Adminer needs and keeps redirects on the panel', () => {
    const h = upstreamHeaders(
      { cookie: 'lares_adminer=abc; adminer_sid=1; adminer_key=2', authorization: 'Bearer x', 'x-forwarded-prefix': '/evil', 'x-lares-adminer-ticket': 'f'.repeat(64), 'content-type': 'text/plain', host: 'panel' },
      { secret: 's', ticket: null, https: true, port: 18686 },
    );
    expect(h.cookie).toBe('adminer_sid=1; adminer_key=2');
    expect(h.authorization).toBeUndefined();
    expect(h['x-forwarded-prefix']).toBeUndefined();
    expect(h['x-lares-adminer-ticket']).toBeUndefined();
    expect(h['x-lares-proto']).toBe('https');
    expect(h.host).toBe('127.0.0.1:18686');
    const d = downstreamHeaders({ location: 'http://127.0.0.1:18686/adminer/?username=a', connection: 'close', 'x-powered-by': 'PHP', 'set-cookie': ['a=1'] }, 18686);
    expect(d.location).toBe('/adminer/?username=a');
    expect(d.connection).toBeUndefined();
    expect(d['x-powered-by']).toBeUndefined();
    expect(d['set-cookie']).toEqual(['a=1']);
    expect(readCookie('x=1; lares_adminer=tok')).toBe('tok');
  });

  it('proxies with the secret and attaches a ticket to one request only', async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(req.headers);
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/adminer/?username=u`, 'set-cookie': 'adminer_sid=x; path=/adminer/', 'content-type': 'text/html' });
        res.end(body);
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as { port: number }).port;
    const app = Fastify();
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', (_r, payload, done) => done(null, payload));
    let ticket: string | null = 'b'.repeat(64);
    app.route({ method: ['GET', 'POST'], url: '/adminer/*', handler: (req, reply) => { const tk = ticket; ticket = null; return proxyToAdminer(req, reply, { port, secret: 'sekrit', ticket: tk }); } });
    const r1 = await app.inject({ method: 'POST', url: '/adminer/?username=u', payload: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-lares-adminer-key': 'forged' } });
    expect(r1.statusCode).toBe(302);
    expect(r1.headers.location).toBe('/adminer/?username=u');
    expect(r1.headers['cache-control']).toBe('no-store');
    expect(r1.body).toBe('a=1');
    await app.inject({ url: '/adminer/?username=u' });
    expect(seen[0]!['x-lares-adminer-key']).toBe('sekrit');
    expect(seen[0]!['x-lares-adminer-ticket']).toBe('b'.repeat(64));
    expect(seen[1]!['x-lares-adminer-ticket']).toBeUndefined();
    await app.close();
    upstream.close();
  });

  // ---- launch flow against the real routes (dry-run) ----
  const username = `adm-${crypto.randomBytes(4).toString('hex')}`;
  const dbName = `db_${crypto.randomBytes(4).toString('hex')}`;
  let dbId = 0;
  afterAll(() => {
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    db.prepare('DELETE FROM databases WHERE name = ?').run(dbName);
    setAllowlist([]);
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret' });
    await app.register(rateLimit, { global: false });
    installSecurityHooks(app);
    await app.register(authRoutes);
    await app.register(siteToolsRoutes);
    return app;
  }

  it('one-time launch link → scoped cookie → proxied page; dies with the panel session', async () => {
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, bcrypt.hashSync('pw-long-enough', 4));
    const { encrypt } = await import('../src/lib/crypto.js');
    dbId = Number(db.prepare('INSERT INTO databases (name, username, password_enc, managed) VALUES (?, ?, ?, 1)').run(dbName, dbName, encrypt('s3cret-pass')).lastInsertRowid);
    const app = await buildApp();
    const ip = '198.51.100.77';
    const token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'pw-long-enough' }, remoteAddress: ip })).json().token as string;
    const auth = { authorization: `Bearer ${token}` };

    expect((await app.inject({ method: 'POST', url: '/api/adminer/open', payload: { databaseId: dbId }, remoteAddress: ip })).statusCode).toBe(401);
    const open = await app.inject({ method: 'POST', url: '/api/adminer/open', headers: auth, payload: { databaseId: dbId }, remoteAddress: ip });
    expect(open.statusCode).toBe(200);
    const url = open.json().url as string;
    expect(url).toMatch(/^\/adminer\/launch\?token=/);
    expect(open.body).not.toContain('s3cret-pass');

    // another IP cannot use it (and it is burnt)
    const stolen = await app.inject({ url, remoteAddress: '203.0.113.9' });
    expect(stolen.statusCode).toBe(403);
    expect((await app.inject({ url, remoteAddress: ip })).statusCode).toBe(403);

    const url2 = (await app.inject({ method: 'POST', url: '/api/adminer/open', headers: auth, payload: { databaseId: dbId }, remoteAddress: ip })).json().url as string;
    const launch = await app.inject({ url: url2, remoteAddress: ip });
    expect(launch.statusCode).toBe(302);
    expect(launch.headers.location).toBe(`/adminer/?username=${dbName}&db=${dbName}`);
    const setCookie = String(launch.headers['set-cookie']);
    expect(setCookie).toMatch(/^lares_adminer=[A-Za-z0-9_-]+; Path=\/adminer\/; HttpOnly; SameSite=Strict$/);
    expect(launch.headers.location).not.toContain('s3cret');
    // single use
    expect((await app.inject({ url: url2, remoteAddress: ip })).statusCode).toBe(403);

    const cookie = setCookie.split(';')[0]!;
    expect((await app.inject({ url: '/adminer/', remoteAddress: ip })).statusCode).toBe(401);
    const page = await app.inject({ url: launch.headers.location as string, headers: { cookie }, remoteAddress: ip });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(dbName);
    expect(page.body).not.toContain('s3cret-pass');
    expect((await app.inject({ url: '/adminer/other.php', headers: { cookie }, remoteAddress: ip })).statusCode).toBe(404);

    // the IP allowlist applies to /adminer/ too
    setAllowlist(['192.0.2.1']);
    expect((await app.inject({ url: '/adminer/', headers: { cookie }, remoteAddress: ip })).statusCode).toBe(403);
    setAllowlist([]);

    // logging out of the panel ends the Adminer session
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth, remoteAddress: ip });
    expect((await app.inject({ url: '/adminer/', headers: { cookie }, remoteAddress: ip })).statusCode).toBe(401);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
describe('onboarding', () => {
  const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ allowlist: false, twoFactor: false, panelDomain: false, firstSite: false, backups: false, cloudflare: false, ...over });

  it('counts required items only', () => {
    const { view } = computeOnboarding(facts({ allowlist: true, cloudflare: true }), { dismissedAt: null, securityDone: [] });
    expect(view.total).toBe(5);
    expect(view.done).toBe(1);
    expect(view.items.find((i) => i.id === 'cloudflare')).toMatchObject({ optional: true, done: true });
  });

  it('stays dismissed until a security item regresses', () => {
    const f = facts({ allowlist: true, twoFactor: true, firstSite: true });
    const state = dismissState(f);
    expect(state.securityDone).toEqual(['allowlist', 'twoFactor']);
    expect(computeOnboarding(f, state).view.dismissed).toBe(true);
    // non-security regression or new progress: still hidden
    expect(computeOnboarding({ ...f, firstSite: false, backups: true }, state).view.dismissed).toBe(true);
    const back = computeOnboarding({ ...f, twoFactor: false }, state);
    expect(back.view).toMatchObject({ dismissed: false, reappeared: true });
    expect(back.state.dismissedAt).toBeNull();
  });

  it('treats a missing or empty cloudflareDns setting as not connected', () => {
    expect(cloudflareConnected(null)).toBe(false);
    expect(cloudflareConnected({})).toBe(false);
    expect(cloudflareConnected({ apiTokenEnc: 'x' })).toBe(true);
    expect(cloudflareConnected({ tokenEnc: 'x', enabled: false })).toBe(false);
    expect(cloudflareConnected({ connected: true })).toBe(true);
  });
});

describe('saving PHP settings (dry-run)', () => {
  it('writes .user.ini, stores the values and follows them in the vhost', async () => {
    const { config } = await import('../src/config.js');
    const { savePhpSettings, getPhpSettingsView } = await import('../src/services/sitePhpSettings.js');
    const { vhostLink, vhostPath } = await import('../src/services/nginx.js');
    const domain = `php-${crypto.randomBytes(3).toString('hex')}.test`;
    const root = path.join(config.sitesRoot, domain);
    const webRoot = path.join(root, 'public_html');
    fs.mkdirSync(webRoot, { recursive: true });
    fs.writeFileSync(path.join(webRoot, '.user.ini'), 'auto_prepend_file = /x.php\n');
    const id = Number(db.prepare(`INSERT INTO sites (domain, root_path, web_root, php_version, app_type) VALUES (?, ?, ?, '8.3', 'wordpress')`).run(domain, root, webRoot).lastInsertRowid);
    try {
      await expect(savePhpSettings(id, { ...none, upload_max_filesize: 64 })).rejects.toThrow(/post_max_size/); // server post is 8M (PHP default)
      const v = await savePhpSettings(id, { ...none, upload_max_filesize: 512, post_max_size: 512, memory_limit: 256 });
      expect(v.clientMaxBodyMb).toBe(512);
      expect(v.directives.find((d) => d.key === 'upload_max_filesize')).toMatchObject({ effective: '512M', effectiveSource: 'site' });
      const ini = fs.readFileSync(path.join(webRoot, '.user.ini'), 'utf8');
      expect(ini).toContain('auto_prepend_file = /x.php');
      expect(ini).toContain('upload_max_filesize = 512M');
      expect(fs.readFileSync(vhostPath(domain), 'utf8')).toContain('client_max_body_size 512m;');
      expect((await getPhpSettingsView(id)).settings.memory_limit).toBe(256);
      // back to server values: block removed, nginx default again
      await savePhpSettings(id, none);
      expect(fs.readFileSync(path.join(webRoot, '.user.ini'), 'utf8')).toBe('auto_prepend_file = /x.php\n');
      expect(fs.readFileSync(vhostPath(domain), 'utf8')).toContain('client_max_body_size 256m;');
    } finally {
      db.prepare('DELETE FROM sites WHERE id = ?').run(id);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(vhostPath(domain), { force: true });
      fs.rmSync(vhostLink(domain), { force: true });
    }
  });
});
