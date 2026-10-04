import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authRoutes } from '../src/auth/index.js';
import { LOCK_MS, MAX_FAILURES, clearFailures, lockRemaining, recordFailure } from '../src/auth/lockout.js';
import { db } from '../src/db/index.js';
import { buildAllowMatcher, isLoopback, normalizeIp, parseAllowEntry } from '../src/lib/ipallow.js';
import { base32Decode, base32Encode, generateRecoveryCodes, hotp, totpStep, verifyTotp } from '../src/lib/totp.js';
import { securityRoutes } from '../src/routes/security.js';
import { PANEL_CSP, installSecurityHooks, isIpAllowed, normalizeAllowlist, setAllowlist } from '../src/services/security.js';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 seed "12345678901234567890"; the 6-digit codes are the last 6 of the 8-digit ones.
  const seed = Buffer.from('12345678901234567890');
  const secret = base32Encode(seed);
  it('matches the RFC test vectors', () => {
    expect(hotp(seed, totpStep(59_000), 8)).toBe('94287082');
    expect(hotp(seed, totpStep(1_111_111_109_000), 8)).toBe('07081804');
    expect(hotp(seed, totpStep(1_234_567_890_000), 8)).toBe('89005924');
    expect(hotp(seed, totpStep(20_000_000_000_000), 8)).toBe('65353130');
  });
  it('round-trips base32', () => {
    const b = crypto.randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
  it('accepts ±1 step of drift and refuses replays', () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, '005924', { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, hotp(seed, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, hotp(seed, step + 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, '005924', { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, '12345', { nowMs: now })).toBeNull();
  });
  it('generates distinct recovery codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });
});

describe('IP allowlist matching', () => {
  it('parses IPv4/IPv6 addresses and CIDRs', () => {
    expect(parseAllowEntry('1.2.3.4')).toEqual({ address: '1.2.3.4', prefix: 32, family: 'ipv4' });
    expect(parseAllowEntry('10.0.0.0/8')).toEqual({ address: '10.0.0.0', prefix: 8, family: 'ipv4' });
    expect(parseAllowEntry('2001:DB8::/32')).toEqual({ address: '2001:db8::', prefix: 32, family: 'ipv6' });
    expect(parseAllowEntry('::ffff:1.2.3.4')?.address).toBe('1.2.3.4');
    for (const bad of ['1.2.3', '1.2.3.4/33', '::1/129', 'example.com', '1.2.3.4/8/1', '1.2.3.4/x', '']) expect(parseAllowEntry(bad)).toBeNull();
  });
  it('matches addresses against entries', () => {
    const m = buildAllowMatcher(['203.0.113.7', '10.1.0.0/16', '2001:db8::/32']);
    expect(m('203.0.113.7')).toBe(true);
    expect(m('::ffff:203.0.113.7')).toBe(true);
    expect(m('203.0.113.8')).toBe(false);
    expect(m('10.1.255.1')).toBe(true);
    expect(m('10.2.0.1')).toBe(false);
    expect(m('2001:0db8:0000::1')).toBe(true);
    expect(m('2001:db9::1')).toBe(false);
    expect(m('garbage')).toBe(false);
  });
  it('normalises and validates lists', () => {
    expect(normalizeAllowlist([' 1.2.3.4 ', '1.2.3.4/32', '', '2001:DB8::/32'])).toEqual(['1.2.3.4', '2001:db8::/32']);
    expect(() => normalizeAllowlist(['1.2.3.999'])).toThrow(/1\.2\.3\.999/);
  });
  it('always lets loopback through', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isIpAllowed('127.0.0.1', ['203.0.113.7'])).toBe(true);
    expect(isIpAllowed('198.51.100.1', [])).toBe(true);
    expect(isIpAllowed('198.51.100.1', ['203.0.113.7'])).toBe(false);
    expect(normalizeIp('[FE80::1%eth0]')).toBe('fe80::1');
  });
});

describe('login lockout', () => {
  const name = `lock-${crypto.randomBytes(4).toString('hex')}`;
  it(`locks after ${MAX_FAILURES} failures and forgets stale ones`, () => {
    const t0 = Date.now();
    for (let i = 1; i < MAX_FAILURES; i++) expect(recordFailure(name, t0)).toBeNull();
    expect(lockRemaining(name, t0)).toBe(0);
    expect(recordFailure(name, t0)?.statusCode).toBe(429);
    expect(lockRemaining(name.toUpperCase(), t0)).toBe(LOCK_MS);
    expect(lockRemaining(name, t0 + LOCK_MS + 1)).toBe(0);
    // after the lock expires the counter starts over
    expect(recordFailure(name, t0 + LOCK_MS + 1)).toBeNull();
    clearFailures(name);
    expect(lockRemaining(name)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP flow against the real routes (test database, see vitest.config.ts)
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(rateLimit, { global: false });
  installSecurityHooks(app);
  await app.register(authRoutes);
  await app.register(securityRoutes);
  app.get('/spa', async (_req, reply) => reply.type('text/html').send('<!doctype html>'));
  return app;
}

describe('auth HTTP flow', () => {
  const username = `u-${crypto.randomBytes(4).toString('hex')}`;
  const password = 'correct horse battery';
  let userId = 0;
  let ip = 0;
  // A fresh client address per test keeps the per-IP rate limit out of the way.
  const nextIp = () => `198.51.100.${++ip}`;

  beforeEach(() => {
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    userId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, bcrypt.hashSync(password, 4)).lastInsertRowid);
    clearFailures(username);
  });
  afterAll(() => {
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    clearFailures(username);
    setAllowlist([]);
  });

  const login = (app: Awaited<ReturnType<typeof buildApp>>, remoteAddress: string, pw = password) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: pw }, remoteAddress });

  it('logs in, sends security headers, and revokes tokens on logout / logout-all / password change', async () => {
    const app = await buildApp();
    const addr = nextIp();
    const res = await login(app, addr);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toBe(PANEL_CSP);
    const { token } = res.json() as { token: string };
    const me = (tok: string) => app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${tok}` }, remoteAddress: addr });
    expect((await me(token)).json()).toMatchObject({ username, twoFactor: false });

    // logout ends only that token
    const other = (await login(app, addr)).json().token as string;
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` }, remoteAddress: addr });
    expect((await me(token)).statusCode).toBe(401);
    expect((await me(other)).statusCode).toBe(200);

    // password change: other sessions die, the caller gets a fresh token
    const third = (await login(app, addr)).json().token as string;
    const pw = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { authorization: `Bearer ${other}` }, payload: { current: password, next: 'another long password' }, remoteAddress: addr });
    expect(pw.statusCode).toBe(200);
    expect((await me(third)).statusCode).toBe(401);
    const fresh = pw.json().token as string;
    expect((await me(fresh)).statusCode).toBe(200);

    // log out everywhere
    await app.inject({ method: 'POST', url: '/api/auth/logout-all', headers: { authorization: `Bearer ${fresh}` }, remoteAddress: addr });
    expect((await me(fresh)).statusCode).toBe(401);
    await app.close();
  });

  it('locks the username after repeated failures, from any IP', async () => {
    const app = await buildApp();
    for (let i = 0; i < MAX_FAILURES - 1; i++) expect((await login(app, nextIp(), 'wrong')).statusCode).toBe(401);
    expect((await login(app, nextIp(), 'wrong')).statusCode).toBe(429);
    // even the right password is refused while locked
    const locked = await login(app, nextIp());
    expect(locked.statusCode).toBe(429);
    await app.close();
  });

  it('ignores X-Forwarded-For (no trustProxy) for the per-IP rate limit', async () => {
    const app = await buildApp();
    const addr = nextIp();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `nobody-${i}`, password: 'x' }, remoteAddress: addr, headers: { 'x-forwarded-for': `203.0.113.${i}` } })).statusCode;
    }
    expect(last).toBe(429);
    await app.close();
  });

  it('runs the 2FA setup, login and disable flow', async () => {
    const app = await buildApp();
    const addr = nextIp();
    let token = (await login(app, addr)).json().token as string;
    const auth = () => ({ authorization: `Bearer ${token}` });
    const setup = (await app.inject({ method: 'POST', url: '/api/security/2fa/setup', headers: auth(), remoteAddress: addr })).json() as { secret: string; otpauthUrl: string };
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
    const code = (offset = 0) => hotp(base32Decode(setup.secret), totpStep() + offset);

    expect((await app.inject({ method: 'POST', url: '/api/security/2fa/enable', headers: auth(), payload: { code: '000000' === code() ? '111111' : '000000' }, remoteAddress: addr })).statusCode).toBe(400);
    const enabled = await app.inject({ method: 'POST', url: '/api/security/2fa/enable', headers: auth(), payload: { code: code() }, remoteAddress: addr });
    expect(enabled.statusCode).toBe(200);
    const { recoveryCodes, token: newToken } = enabled.json() as { recoveryCodes: string[]; token: string };
    expect(recoveryCodes).toHaveLength(10);
    const stale = token;
    token = newToken;
    expect((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${stale}` }, remoteAddress: addr })).statusCode).toBe(401);
    expect(db.prepare('SELECT totp_secret_enc FROM users WHERE id = ?').get(userId)).not.toMatchObject({ totp_secret_enc: setup.secret });

    // password alone is not enough any more
    const step1 = (await login(app, addr)).json() as { mfaRequired?: boolean; mfaToken: string; token?: string };
    expect(step1).toMatchObject({ mfaRequired: true });
    expect(step1.token).toBeUndefined();
    // the intermediate token is not a session
    expect((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${step1.mfaToken}` }, remoteAddress: addr })).statusCode).toBe(401);
    const second = (c: string) => app.inject({ method: 'POST', url: '/api/auth/login/2fa', payload: { mfaToken: step1.mfaToken, code: c }, remoteAddress: addr });
    // the code used to enable is already spent; the next step's code works once
    expect((await second(code())).statusCode).toBe(401);
    const ok = await second(code(1));
    expect(ok.statusCode).toBe(200);
    expect((await second(code(1))).statusCode).toBe(401);
    // recovery codes work once each
    const viaRecovery = await second(recoveryCodes[0]!.toUpperCase());
    expect(viaRecovery.json()).toMatchObject({ recoveryCodesLeft: 9 });
    expect((await second(recoveryCodes[0]!)).statusCode).toBe(401);
    clearFailures(username);

    token = viaRecovery.json().token;
    expect((await app.inject({ url: '/api/security/2fa', headers: auth(), remoteAddress: addr })).json()).toEqual({ enabled: true, pending: false, recoveryCodesLeft: 9 });
    expect((await app.inject({ method: 'POST', url: '/api/security/2fa/disable', headers: auth(), payload: { password: 'wrong' }, remoteAddress: addr })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/security/2fa/disable', headers: auth(), payload: { password }, remoteAddress: addr })).statusCode).toBe(200);
    expect((await login(app, addr)).json().token).toBeTruthy();
    await app.close();
  });

  it('enforces the IP allowlist and refuses to lock the caller out', async () => {
    const app = await buildApp();
    const me = '198.51.100.200';
    const token = (await login(app, me)).json().token as string;
    const put = (entries: string[], force?: boolean) =>
      app.inject({ method: 'PUT', url: '/api/security/allowlist', headers: { authorization: `Bearer ${token}` }, payload: { entries, force }, remoteAddress: me });

    expect((await app.inject({ url: '/api/security/allowlist', headers: { authorization: `Bearer ${token}` }, remoteAddress: me })).json()).toEqual({ entries: [], currentIp: me });
    expect((await put(['203.0.113.0/24'])).statusCode).toBe(409);
    expect((await put(['not-an-ip'])).statusCode).toBe(400);
    expect((await put(['198.51.100.0/24', '203.0.113.0/24'])).json().entries).toEqual(['198.51.100.0/24', '203.0.113.0/24']);

    const blocked = await app.inject({ url: '/spa', remoteAddress: '192.0.2.1' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).toContain('192.0.2.1');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, remoteAddress: '192.0.2.1' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/spa', remoteAddress: '203.0.113.9' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/spa', remoteAddress: '127.0.0.1' })).statusCode).toBe(200);

    // explicit confirmation saves a list without the caller's IP
    expect((await put(['203.0.113.0/24'], true)).statusCode).toBe(200);
    expect((await app.inject({ url: '/spa', remoteAddress: me })).statusCode).toBe(403);
    setAllowlist([]);
    expect((await app.inject({ url: '/spa', remoteAddress: me })).statusCode).toBe(200);
    await app.close();
  });
});
