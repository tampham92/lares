import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiScheduleSchema, aiSettingsSchema, articleRequestSchema, publicHostSchema, publishArticleSchema, wpAdminTargetSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { t } from '../i18n/index.js';
import { badRequest } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import * as ai from '../services/ai.js';
import * as schedules from '../services/aiSchedules.js';
import * as sites from '../services/sites.js';
import { startTask } from '../services/tasks.js';
import { aiSiteContext, publishArticle, wpLoginUrl, wpSiteInfo } from '../services/wpContent.js';

function wordpressSite(params: unknown) {
  const site = sites.getSite(idParam(params));
  if (site.appType !== 'wordpress') throw badRequest(t('Chỉ áp dụng cho site WordPress'));
  return site;
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('onReady', async () => schedules.startAiScheduler((m) => app.log.warn(m)));
  app.addHook('preHandler', requireAuth);

  // ---- Settings: AI provider & API key ---------------------------------------

  app.get('/api/settings/ai', () => ai.getAiSettings());
  app.put('/api/settings/ai', async (req) => ai.saveAiSettings(parse(aiSettingsSchema, req.body)));
  app.delete('/api/settings/ai/key', () => ai.deleteAiKey());
  app.post('/api/settings/ai/test', () => ai.testAi());

  // ---- WordPress: AI articles, posts, one-click admin -------------------------

  app.get('/api/sites/:id/wp/info', async (req) => {
    const info = await wpSiteInfo(wordpressSite(req.params));
    return { name: info.name, categories: info.categories };
  });

  app.post('/api/sites/:id/ai/article', async (req) => {
    const site = wordpressSite(req.params);
    const input = parse(articleRequestSchema, req.body);
    if (!ai.getAiSettings().hasKey) throw badRequest(t('Chưa có API key AI - thêm key trong mục Cài đặt'));
    return startTask(t('Viết bài AI: {keyword}', { keyword: input.keyword }), async (log) => ai.generateArticle(input, await aiSiteContext(site, log), log));
  });

  // ---- Scheduled AI articles (services/aiSchedules.ts) ---------------------------

  app.get('/api/sites/:id/ai/schedules', async (req) => schedules.siteSchedules(wordpressSite(req.params).id));
  app.post('/api/sites/:id/ai/schedules', async (req) => schedules.createSchedule(wordpressSite(req.params), parse(aiScheduleSchema, req.body)));
  app.put('/api/ai/schedules/:id', async (req) => schedules.updateSchedule(idParam(req.params), parse(aiScheduleSchema, req.body)));
  app.delete('/api/ai/schedules/:id', async (req) => {
    schedules.deleteSchedule(idParam(req.params));
    return { ok: true };
  });
  app.post('/api/ai/schedules/:id/run', async (req) => {
    if (!ai.getAiSettings().hasKey) throw badRequest(t('Chưa có API key AI - thêm key trong mục Cài đặt'));
    return schedules.runNow(idParam(req.params));
  });
  app.get('/api/ai/schedule-runs/:id/article', async (req) => schedules.runArticle(idParam(req.params)));

  app.post('/api/sites/:id/wp/posts', async (req) => publishArticle(wordpressSite(req.params), parse(publishArticleSchema, req.body)));

  app.post('/api/sites/:id/wp/login', async (req) => {
    const site = wordpressSite(req.params);
    const { target, publicHost } = parse(z.object({ target: wpAdminTargetSchema, publicHost: publicHostSchema.optional() }), req.body ?? {});
    // port-based sites are reached through the host the admin is using
    return { url: await wpLoginUrl(site, sites.siteUrl(site, publicHost || req.hostname.replace(/:\d+$/, '')), target) };
  });
}
