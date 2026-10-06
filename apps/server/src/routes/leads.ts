import net from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  LEAD_PANEL_PATH,
  leadListQuerySchema,
  leadSettingsInputSchema,
  leadUpdateSchema,
  notifyTestSchema,
  siteLeadSettingsInputSchema,
  telegramChatsSchema,
  type LeadSettingsView,
  type Site,
} from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { t } from '../i18n/index.js';
import { isLoopback, normalizeIp } from '../lib/ipallow.js';
import { idParam, parse } from '../lib/validate.js';
import { queueNotifications, recentFailures, resendLead, resolveBotToken, startLeadJobs, telegramChats, testChannel } from '../services/leadNotify.js';
import {
  deleteLead,
  ensureLeadVhosts,
  getGlobalNotify,
  getRetentionMonths,
  insertLead,
  ipLimiter,
  leadRedirect,
  leadsCsv,
  listLeads,
  newLeadCount,
  notifyView,
  parseLeadBody,
  refererOnSite,
  saveLeadSettings,
  saveSiteNotify,
  siteLeadSettingsView,
  siteLimiter,
  updateLead,
} from '../services/leads.js';
import { LEAD_CLIENT_IP_HEADER, LEAD_HOST_HEADER, LEAD_SCHEME_HEADER, LEAD_SITE_HEADER } from '../services/leadsNginx.js';
import * as sites from '../services/sites.js';

/** Contact forms are small; nginx caps the location at 64k too. */
const BODY_LIMIT = 32 * 1024;

const settingsView = (): LeadSettingsView => ({ retentionMonths: getRetentionMonths(), ...notifyView(getGlobalNotify()), recentFailures: recentFailures() });

const header = (req: FastifyRequest, name: string): string => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
};

/**
 * POST /api/public/leads - reached only through nginx's `location = /_lares/lead` on a managed
 * site. Answers in the form contract's shape: JSON for fetch() callers, otherwise a 303 back to
 * the page with #lares-sent / #lares-error.
 */
async function handlePublicLead(req: FastifyRequest, reply: FastifyReply) {
  const wantsJson = /application\/json/i.test(header(req, 'accept'));
  let site: Site | null = null;
  const hostHeader = header(req, LEAD_HOST_HEADER);
  const respond = (ok: boolean, status = 200, error?: string, page?: string) => {
    if (wantsJson) return reply.code(ok ? 200 : status).send(ok ? { ok: true } : { ok: false, error });
    const location = leadRedirect({ referer: header(req, 'referer'), host: hostHeader, siteHosts: site ? [site.domain, ...site.aliases] : [], page, ok });
    return reply.code(303).header('Location', location).send();
  };

  // Only nginx on this machine may call this endpoint (the panel port itself is public).
  if (!isLoopback(req.socket.remoteAddress ?? '')) return reply.code(403).send({ ok: false, error: t('Chỉ nhận yêu cầu từ máy chủ nội bộ') });

  const domain = header(req, LEAD_SITE_HEADER).toLowerCase();
  site = domain ? sites.listSites().find((s) => s.domain === domain) ?? null : null;
  if (!site || site.status !== 'active') {
    site = null;
    return respond(false, 404, t('Website này chưa nhận form liên hệ'));
  }

  const forwarded = normalizeIp(header(req, LEAD_CLIENT_IP_HEADER));
  const ip = net.isIP(forwarded) ? forwarded : normalizeIp(req.socket.remoteAddress ?? '');
  if (!ipLimiter.hit(ip)) return respond(false, 429, t('Bạn đã gửi quá nhiều lần, vui lòng thử lại sau ít phút'));

  const parsed = parseLeadBody(req.body);
  if (parsed.kind === 'spam') return respond(true);
  const body = req.body as { page?: unknown } | undefined;
  const page = typeof body?.page === 'string' ? body.page : undefined;
  if (parsed.kind === 'invalid') return respond(false, 400, parsed.error, page);
  if (!siteLimiter.hit(String(site.id))) return respond(false, 429, t('Website đang nhận quá nhiều yêu cầu, vui lòng thử lại sau'), page);

  const lead = parsed.lead;
  const referer = refererOnSite(header(req, 'referer'), hostHeader, [site.domain, ...site.aliases]);
  if (!lead.page && referer) lead.page = (referer.pathname + referer.search).slice(0, 500);
  const scheme = header(req, LEAD_SCHEME_HEADER) === 'https' ? 'https' : 'http';
  let pageUrl = '';
  if (referer) {
    referer.hash = '';
    pageUrl = referer.toString();
  } else if (hostHeader && /^[a-z0-9.:[\]-]+$/i.test(hostHeader)) {
    pageUrl = `${scheme}://${hostHeader}${lead.page || '/'}`;
  }

  const id = insertLead(site, lead, { host: hostHeader || site.domain, ip, pageUrl });
  try {
    queueNotifications(id, site.id);
  } catch (err) {
    req.log.warn({ err }, 'lead notifications could not be queued');
  }
  return respond(true, 200, undefined, lead.page);
}

/** `background: false` (tests) skips the notification worker and the vhost upgrade. */
export async function leadRoutes(app: FastifyInstance, opts: { background?: boolean } = {}) {
  if (opts.background !== false) {
    app.addHook('onReady', async () => {
      startLeadJobs((m) => app.log.warn(m));
      // existing vhosts get the /_lares/lead location in the background (nginx -t + reload)
      void ensureLeadVhosts((m) => app.log.info(m)).catch((err: Error) => app.log.warn(`lead capture vhosts: ${err.message}`));
    });
  }

  // ---- Public (loopback only, no session) ---------------------------------------------
  await app.register(async (pub) => {
    pub.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
    // Malformed JSON, oversize or unsupported bodies still answer in the contract's shape.
    pub.setErrorHandler((err, req, reply) => {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) req.log.error(err);
      const error = status === 413 ? t('Nội dung gửi quá lớn') : status === 415 ? t('Định dạng dữ liệu không được hỗ trợ') : t('Dữ liệu gửi lên không hợp lệ');
      if (/application\/json/i.test(header(req, 'accept'))) return reply.code(status >= 500 ? 500 : status).send({ ok: false, error });
      return reply.code(303).header('Location', leadRedirect({ referer: header(req, 'referer'), host: header(req, LEAD_HOST_HEADER), siteHosts: [], ok: false })).send();
    });
    pub.post(LEAD_PANEL_PATH, { bodyLimit: BODY_LIMIT }, handlePublicLead);
  });

  // ---- Panel UI -------------------------------------------------------------------------
  await app.register(async (priv) => {
    priv.addHook('preHandler', requireAuth);

    priv.get('/api/leads', async (req) => listLeads(parse(leadListQuerySchema, req.query)));
    priv.get('/api/leads/unread', async () => ({ count: newLeadCount() }));

    priv.get('/api/leads/export.csv', async (req, reply) => {
      const q = parse(leadListQuerySchema, req.query);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="lares-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
      return leadsCsv(q);
    });

    priv.patch('/api/leads/:id', async (req) => updateLead(idParam(req.params), parse(leadUpdateSchema, req.body ?? {})));
    priv.delete('/api/leads/:id', async (req) => {
      deleteLead(idParam(req.params));
      return { ok: true };
    });
    priv.post('/api/leads/:id/notify', async (req) => resendLead(idParam(req.params)));

    priv.get('/api/settings/leads', async () => settingsView());
    priv.put('/api/settings/leads', async (req) => {
      saveLeadSettings(parse(leadSettingsInputSchema, req.body ?? {}));
      return settingsView();
    });

    priv.post('/api/leads/notify-test', async (req) => {
      const input = parse(notifyTestSchema, req.body ?? {});
      const site = input.siteId ? sites.getSite(input.siteId).domain : undefined;
      return { message: await testChannel(input, site) };
    });

    priv.post('/api/leads/telegram/chats', async (req) => {
      const input = parse(telegramChatsSchema, req.body ?? {});
      if (input.siteId) sites.getSite(input.siteId);
      return { chats: await telegramChats(resolveBotToken(input)) };
    });

    priv.get('/api/sites/:id/lead-settings', async (req) => siteLeadSettingsView(idParam(req.params)));
    priv.put('/api/sites/:id/lead-settings', async (req) => {
      const id = idParam(req.params);
      saveSiteNotify(id, parse(siteLeadSettingsInputSchema, req.body ?? {}));
      return siteLeadSettingsView(id);
    });
  });
}
