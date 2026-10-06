import type { FastifyInstance } from 'fastify';
import { adminerOpenSchema, phpSettingsSchema } from '@lares/shared';
import { currentUser, requireAuth, type SessionClaims } from '../auth/index.js';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { idParam, parse } from '../lib/validate.js';
import * as adminer from '../services/adminer.js';
import { dismissOnboarding, getOnboarding, restoreOnboarding } from '../services/onboarding.js';
import { getPhpSettingsView, savePhpSettings } from '../services/sitePhpSettings.js';

const sensitive = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

/** Per-site PHP settings, Adminer, onboarding checklist (JSON API, panel login required). */
async function apiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Per-site PHP settings ----
  app.get('/api/sites/:id/php-settings', (req) => getPhpSettingsView(idParam(req.params)));
  app.put('/api/sites/:id/php-settings', async (req) => savePhpSettings(idParam(req.params), parse(phpSettingsSchema, req.body)));

  // ---- Adminer ----
  app.get('/api/adminer', () => adminer.adminerStatus());

  /** Installs/repairs Adminer if needed, then hands out a one-time launch link (relative URL). */
  app.post('/api/adminer/open', sensitive, async (req) => {
    const { databaseId } = parse(adminerOpenSchema, req.body);
    await adminer.ensureAdminer((m) => req.log.info(m));
    const token = adminer.createLaunch(req.user as SessionClaims, req.ip, databaseId);
    return { url: `${adminer.ADMINER_PATH}launch?token=${token}` };
  });

  app.delete('/api/adminer', async (req) => adminer.removeAdminer((m) => req.log.info(m)));

  // ---- Onboarding ----
  app.get('/api/onboarding', (req) => getOnboarding(currentUser(req)));
  app.post('/api/onboarding/dismiss', (req) => dismissOnboarding(currentUser(req)));
  app.post('/api/onboarding/restore', (req) => restoreOnboarding(currentUser(req)));
}

/**
 * Browser-facing Adminer routes. No JWT here (a new tab cannot send it): /adminer/launch trades a
 * one-time token for the scoped cookie, everything else under /adminer/ needs that cookie.
 * The IP allowlist (root onRequest hook) applies before any of this. Bodies are streamed as is.
 */
async function adminerBrowserRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

  const html = 'text/html; charset=utf-8';

  app.get('/adminer', (_req, reply) => reply.redirect(adminer.ADMINER_PATH));

  app.get('/adminer/launch', sensitive, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = (req.query as { token?: unknown }).token;
    const launch = typeof token === 'string' ? adminer.consumeLaunch(token, req.ip) : null;
    if (!launch) {
      return reply
        .code(403)
        .type(html)
        .send(adminer.adminerPage(t('Liên kết Adminer không hợp lệ'), t('Liên kết đã dùng, đã hết hạn (60 giây) hoặc được mở từ địa chỉ IP khác. Hãy bấm lại "Mở Adminer" trong Lares.')));
    }
    const { cookie, location } = await adminer.startSession(launch, req.headers.cookie);
    if (cookie) reply.header('Set-Cookie', adminer.sessionCookieHeader(cookie, req.protocol === 'https'));
    return reply.redirect(location, 302);
  });

  app.route({
    method: ['GET', 'POST'],
    url: '/adminer/*',
    handler: async (req, reply) => {
      const url = new URL(req.url, 'http://lares.invalid');
      if (url.pathname !== adminer.ADMINER_PATH) return reply.code(404).type(html).send(adminer.adminerPage(t('Không tìm thấy'), t('Adminer chỉ có tại /adminer/.')));
      const session = adminer.sessionFromCookie(req.headers.cookie);
      if (!session) {
        reply.header('Set-Cookie', adminer.clearCookieHeader(req.protocol === 'https'));
        return reply
          .code(401)
          .type(html)
          .send(adminer.adminerPage(t('Phiên Adminer đã hết hạn'), t('Adminer chỉ mở được từ Lares Panel. Vào trang Database (hoặc trang site) và bấm "Mở Adminer".')));
      }
      const username = url.searchParams.get('username');
      if (config.dryRun) {
        adminer.takeTicket(session, username);
        return reply.type(html).header('Cache-Control', 'no-store').send(adminer.dryRunPage(username, url.searchParams.get('db')));
      }
      const status = await adminer.adminerStatus();
      if (!status.installed) {
        return reply.code(503).type(html).send(adminer.adminerPage(t('Adminer chưa sẵn sàng'), t('Mở Adminer từ trang Database để Lares cài đặt và kiểm tra lại.')));
      }
      const secret = adminer.adminerSecret();
      return adminer.proxyToAdminer(req, reply, { port: adminer.adminerPort(), secret, ticket: adminer.takeTicket(session, username) });
    },
  });
}

export async function siteToolsRoutes(app: FastifyInstance) {
  await app.register(apiRoutes);
  await app.register(adminerBrowserRoutes);
  adminer.startAdminerSweeper();
}
