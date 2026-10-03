import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiSettingsSchema, articleRequestSchema, publicHostSchema, publishArticleSchema, wpAdminTargetSchema } from '@tpanel/shared';
import { requireAuth } from '../auth/index.js';
import { badRequest } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import * as ai from '../services/ai.js';
import * as sites from '../services/sites.js';
import { startTask } from '../services/tasks.js';
import { aiSiteContext, publishArticle, wpLoginUrl, wpSiteInfo } from '../services/wpContent.js';

function wordpressSite(params: unknown) {
  const site = sites.getSite(idParam(params));
  if (site.appType !== 'wordpress') throw badRequest('Chỉ áp dụng cho site WordPress');
  return site;
}

export async function aiRoutes(app: FastifyInstance) {
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
    if (!ai.getAiSettings().hasKey) throw badRequest('Chưa có API key AI - thêm key trong mục Cài đặt');
    return startTask(`Viết bài AI: ${input.keyword}`, async (log) => ai.generateArticle(input, await aiSiteContext(site, log), log));
  });

  app.post('/api/sites/:id/wp/posts', async (req) => publishArticle(wordpressSite(req.params), parse(publishArticleSchema, req.body)));

  app.post('/api/sites/:id/wp/login', async (req) => {
    const site = wordpressSite(req.params);
    const { target, publicHost } = parse(z.object({ target: wpAdminTargetSchema, publicHost: publicHostSchema.optional() }), req.body ?? {});
    // port-based sites are reached through the host the admin is using
    return { url: await wpLoginUrl(site, sites.siteUrl(site, publicHost || req.hostname.replace(/:\d+$/, '')), target) };
  });
}
