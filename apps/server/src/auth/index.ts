import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema } from '@lares/shared';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { randomPassword } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

export function ensureAdminUser(log: (msg: string) => void) {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return;
  const password = config.adminPassword || randomPassword(16);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(config.adminUser, bcrypt.hashSync(password, 12));
  if (!config.adminPassword) {
    log(t('Đã tạo tài khoản quản trị "{user}" với mật khẩu: {password}  (hãy đổi mật khẩu sau khi đăng nhập)', { user: config.adminUser, password }));
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  try {
    // EventSource cannot send headers, so SSE endpoints pass the token as ?token=
    const q = (req.query as { token?: string } | undefined)?.token;
    if (q && !req.headers.authorization) req.headers.authorization = `Bearer ${q}`;
    await req.jwtVerify();
  } catch {
    throw new HttpError(401, t('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'));
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { username, password } = parse(loginSchema, req.body);
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw new HttpError(401, t('Sai tên đăng nhập hoặc mật khẩu'));
      }
      const token = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: config.jwtExpiresIn });
      return { token, user: { id: user.id, username: user.username } };
    },
  );

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user as { sub: number; username: string };
    return { id: u.sub, username: u.username };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req) => {
    const body = req.body as { current?: string; next?: string };
    const u = req.user as { sub: number };
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(u.sub) as UserRow | undefined;
    if (!row || !body.current || !(await bcrypt.compare(body.current, row.password_hash))) {
      throw new HttpError(400, t('Mật khẩu hiện tại không đúng'));
    }
    if (!body.next || body.next.length < 10) throw new HttpError(400, t('Mật khẩu mới tối thiểu 10 ký tự'));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.next, 12), u.sub);
    return { ok: true };
  });
}
