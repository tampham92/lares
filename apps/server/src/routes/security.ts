import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { allowlistUpdateSchema, twoFactorCodeSchema, twoFactorDisableSchema, type AllowlistView, type TwoFactorEnabled } from '@lares/shared';
import { currentUser, issueSession, requireAuth } from '../auth/index.js';
import { bumpTokenVersion, checkSecondFactor, confirmSetup, disableTwoFactor, regenerateRecoveryCodes, startSetup, twoFactorStatus } from '../auth/twofactor.js';
import { t } from '../i18n/index.js';
import { conflict, HttpError } from '../lib/errors.js';
import { normalizeIp } from '../lib/ipallow.js';
import { parse } from '../lib/validate.js';
import { getAllowlist, isIpAllowed, normalizeAllowlist, setAllowlist } from '../services/security.js';

const sensitive = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function securityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Two-factor authentication ----
  app.get('/api/security/2fa', (req) => twoFactorStatus(currentUser(req)));

  app.post('/api/security/2fa/setup', (req) => startSetup(currentUser(req)));

  /** Enabling 2FA signs out every other session (they never passed the second factor). */
  app.post('/api/security/2fa/enable', sensitive, (req): TwoFactorEnabled => {
    const { code } = parse(twoFactorCodeSchema, req.body);
    const u = currentUser(req);
    const recoveryCodes = confirmSetup(u, code);
    const tv = bumpTokenVersion(u.id);
    return { recoveryCodes, token: issueSession(app, { ...u, token_version: tv }) };
  });

  app.post('/api/security/2fa/recovery-codes', sensitive, (req) => {
    const { code } = parse(twoFactorCodeSchema, req.body);
    const u = currentUser(req);
    if (!checkSecondFactor(u, code)) throw new HttpError(400, t('Mã xác thực không đúng'));
    return { recoveryCodes: regenerateRecoveryCodes(currentUser(req)) };
  });

  app.post('/api/security/2fa/disable', sensitive, async (req) => {
    const body = parse(twoFactorDisableSchema, req.body);
    const u = currentUser(req);
    const ok = body.code ? !!checkSecondFactor(u, body.code) : await bcrypt.compare(body.password ?? '', u.password_hash);
    if (!ok) throw new HttpError(400, body.code ? t('Mã xác thực không đúng') : t('Mật khẩu hiện tại không đúng'));
    disableTwoFactor(u.id);
    return { ok: true };
  });

  // ---- IP allowlist ----
  app.get('/api/security/allowlist', (req): AllowlistView => ({ entries: getAllowlist(), currentIp: normalizeIp(req.ip) }));

  app.put('/api/security/allowlist', (req): AllowlistView => {
    const body = parse(allowlistUpdateSchema, req.body);
    const entries = normalizeAllowlist(body.entries);
    if (!body.force && !isIpAllowed(req.ip, entries)) {
      throw conflict(t('Danh sách này không gồm IP hiện tại của bạn ({ip}) - lưu lại sẽ khoá chính bạn khỏi panel.', { ip: normalizeIp(req.ip) }));
    }
    return { entries: setAllowlist(entries), currentIp: normalizeIp(req.ip) };
  });
}
