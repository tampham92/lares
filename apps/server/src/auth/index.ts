import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, loginSecondFactorSchema, passwordChangeSchema, type LoginResult, type SessionUser } from '@lares/shared';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { randomPassword } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { assertNotLocked, clearFailures, recordFailure } from './lockout.js';
import { bumpTokenVersion, checkSecondFactor, getUser, getUserByName, type UserRow } from './twofactor.js';

/** Claims of a panel session JWT. `tv` must match users.token_version, `jti` must not be revoked. */
export interface SessionClaims {
  kind: 'session';
  sub: number;
  username: string;
  tv: number;
  jti: string;
  exp: number;
}

/** Short-lived token between "password OK" and "2FA code OK"; never accepted as a session. */
interface MfaClaims {
  kind: 'mfa';
  sub: number;
  tv: number;
}

const MFA_TTL = '5m';
// Compared against when the username does not exist, so response time does not reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

export function ensureAdminUser(log: (msg: string) => void) {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return;
  const password = config.adminPassword || randomPassword(16);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(config.adminUser, bcrypt.hashSync(password, 12));
  if (!config.adminPassword) {
    log(t('Đã tạo tài khoản quản trị "{user}" với mật khẩu: {password}  (hãy đổi mật khẩu sau khi đăng nhập)', { user: config.adminUser, password }));
  }
}

const isRevoked = (jti: string) => !!db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);

function revoke(claims: SessionClaims) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(now);
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(claims.jti, claims.exp ?? now + 86_400);
}

/** The session behind the request, or null (bad signature, expired, stale version, revoked, not a session token). */
async function sessionOf(req: FastifyRequest): Promise<SessionClaims | null> {
  try {
    await req.jwtVerify();
  } catch {
    return null;
  }
  const c = req.user as Partial<SessionClaims>;
  if (c.kind !== 'session' || typeof c.sub !== 'number' || typeof c.jti !== 'string') return null;
  const user = getUser(c.sub);
  if (!user || user.token_version !== c.tv || isRevoked(c.jti)) return null;
  return c as SessionClaims;
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  // EventSource cannot send headers, so SSE endpoints pass the token as ?token=
  const q = (req.query as { token?: string } | undefined)?.token;
  if (q && !req.headers.authorization) req.headers.authorization = `Bearer ${q}`;
  if (!(await sessionOf(req))) throw new HttpError(401, t('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'));
}

export const sessionUser = (u: UserRow): SessionUser => ({ id: u.id, username: u.username, twoFactor: !!u.totp_secret_enc });

export function issueSession(app: FastifyInstance, u: Pick<UserRow, 'id' | 'username' | 'token_version'>): string {
  const claims: Omit<SessionClaims, 'exp'> = { kind: 'session', sub: u.id, username: u.username, tv: u.token_version, jti: crypto.randomUUID() };
  return app.jwt.sign(claims, { expiresIn: config.jwtExpiresIn });
}

/** The logged-in user's row (call after requireAuth). */
export function currentUser(req: FastifyRequest): UserRow {
  const u = getUser((req.user as SessionClaims).sub);
  if (!u) throw new HttpError(401, t('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'));
  return u;
}

const wrongCredentials = () => new HttpError(401, t('Sai tên đăng nhập hoặc mật khẩu'));

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req): Promise<LoginResult> => {
    const { username, password } = parse(loginSchema, req.body);
    assertNotLocked(username);
    const user = getUserByName(username);
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw recordFailure(username) ?? wrongCredentials();
    if (user.totp_secret_enc) {
      // Failures are only cleared after the second factor, so a known password cannot reset the counter.
      const claims: MfaClaims = { kind: 'mfa', sub: user.id, tv: user.token_version };
      return { mfaRequired: true, mfaToken: app.jwt.sign(claims, { expiresIn: MFA_TTL }) };
    }
    clearFailures(username);
    return { token: issueSession(app, user), user: sessionUser(user) };
  });

  app.post('/api/auth/login/2fa', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req): Promise<LoginResult> => {
    const { mfaToken, code } = parse(loginSecondFactorSchema, req.body);
    const expired = () => new HttpError(401, t('Phiên xác thực đã hết hạn, vui lòng đăng nhập lại'));
    let claims: MfaClaims;
    try {
      claims = app.jwt.verify<MfaClaims>(mfaToken);
    } catch {
      throw expired();
    }
    const user = claims.kind === 'mfa' ? getUser(claims.sub) : undefined;
    if (!user || user.token_version !== claims.tv || !user.totp_secret_enc) throw expired();
    assertNotLocked(user.username);
    const r = checkSecondFactor(user, code);
    if (!r) throw recordFailure(user.username) ?? new HttpError(401, t('Mã xác thực không đúng'));
    clearFailures(user.username);
    return { token: issueSession(app, user), user: sessionUser(user), ...(r.usedRecovery ? { recoveryCodesLeft: r.recoveryCodesLeft } : {}) };
  });

  /** Ends this session only. Always succeeds, so the UI can log out even with an expired token. */
  app.post('/api/auth/logout', async (req) => {
    const s = await sessionOf(req);
    if (s) revoke(s);
    return { ok: true };
  });

  /** Ends every session of this user, including this one. */
  app.post('/api/auth/logout-all', { preHandler: requireAuth }, async (req) => {
    bumpTokenVersion(currentUser(req).id);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req): Promise<SessionUser> => sessionUser(currentUser(req)));

  /** Changing the password signs out every other session; the caller gets a fresh token. */
  app.post('/api/auth/password', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(passwordChangeSchema, req.body);
    const row = currentUser(req);
    if (!(await bcrypt.compare(body.current, row.password_hash))) throw new HttpError(400, t('Mật khẩu hiện tại không đúng'));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.next, 12), row.id);
    const tv = bumpTokenVersion(row.id);
    return { ok: true, token: issueSession(app, { ...row, token_version: tv }) };
  });
}
