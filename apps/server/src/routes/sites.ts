import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LOG_TYPES, createSiteSchema, deleteSiteSchema, issueSslSchema, nextjsConfigSchema, siteSettingsSchema } from '@tpanel/shared';
import { requireAuth } from '../auth/index.js';
import { badRequest } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import * as databases from '../services/databases.js';
import { tailFile, trafficStats, truncateLog } from '../services/logs.js';
import { siteLogPaths } from '../services/nginx.js';
import * as nodeapp from '../services/nodeapp.js';
import * as sites from '../services/sites.js';
import { startTask } from '../services/tasks.js';

const logQuerySchema = z.object({
  type: z.enum(LOG_TYPES).default('access'),
  lines: z.coerce.number().int().min(1).max(5000).default(200),
  q: z.string().max(200).optional(),
});

const statsQuerySchema = z.object({ hours: z.coerce.number().int().min(1).max(24 * 90).default(24) });

export async function siteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/sites', () => sites.listSites());

  app.get('/api/sites/:id', async (req) => {
    const site = sites.getSite(idParam(req.params));
    const nodeApp = site.appType === 'nextjs' ? await nodeapp.serviceStatus(site.domain, site.appPort, site.webRoot) : null;
    const cfg = site.appType === 'nextjs' ? sites.getNodeConfig(site.id) : null;
    return {
      site,
      databases: databases.databasesForSite(site.id),
      nodeApp,
      // env values may be secrets: return keys only
      nodeConfig: cfg ? { ...cfg, env: Object.fromEntries(Object.keys(cfg.env ?? {}).map((k) => [k, ''])) } : null,
    };
  });

  app.post('/api/sites', async (req) => {
    const input = parse(createSiteSchema, req.body);
    if (sites.findSiteByHostname(input.domain)) throw badRequest(`${input.domain} đã tồn tại`);
    return startTask(`Tạo site ${input.domain}`, (log) => sites.createSite(input, log));
  });

  app.patch('/api/sites/:id', async (req) => {
    const patch = parse(siteSettingsSchema, req.body);
    return sites.updateSite(idParam(req.params), patch);
  });

  app.delete('/api/sites/:id', async (req) => {
    const id = idParam(req.params);
    const opts = parse(deleteSiteSchema, req.body ?? {});
    const site = sites.getSite(id);
    return startTask(`Xoá site ${site.domain}`, (log) => sites.deleteSite(id, opts, log));
  });

  // ---- Next.js -------------------------------------------------------------

  app.put('/api/sites/:id/nextjs', async (req) => {
    const id = idParam(req.params);
    const site = sites.getSite(id);
    if (site.appType !== 'nextjs') throw badRequest('Site không phải Next.js');
    const input = parse(nextjsConfigSchema.partial({ branch: true }), req.body);
    const current = sites.getNodeConfig(id);
    // Empty env values from the UI mean "keep the stored secret".
    const env = Object.fromEntries(Object.entries(input.env ?? {}).map(([k, v]) => [k, v === '' ? (current.env?.[k] ?? '') : v]));
    const next = { ...current, ...input, env };
    sites.saveNodeConfig(id, next);
    return { ok: true };
  });

  app.post('/api/sites/:id/deploy', async (req) => {
    const id = idParam(req.params);
    const site = sites.getSite(id);
    return startTask(`Build & deploy ${site.domain}`, (log) => sites.deploySite(id, log));
  });

  app.post('/api/sites/:id/service/:action', async (req) => {
    const id = idParam(req.params);
    const action = (req.params as { action: string }).action;
    if (!['start', 'stop', 'restart'].includes(action)) throw badRequest('Hành động không hợp lệ');
    const site = sites.getSite(id);
    await nodeapp.serviceAction(site.domain, action as 'start' | 'stop' | 'restart');
    return nodeapp.serviceStatus(site.domain, site.appPort, site.webRoot);
  });

  // ---- SSL -----------------------------------------------------------------

  app.post('/api/sites/:id/ssl', async (req) => {
    const id = idParam(req.params);
    const input = parse(issueSslSchema, req.body);
    const site = sites.getSite(id);
    return startTask(`Cài SSL ${site.domain}`, (log) => sites.issueSsl(id, input, log));
  });

  app.post('/api/sites/:id/ssl/renew', async (req) => {
    const id = idParam(req.params);
    return startTask(`Gia hạn SSL ${sites.getSite(id).domain}`, (log) => sites.renewSsl(id, log));
  });

  app.patch('/api/sites/:id/ssl', async (req) => {
    const { forceHttps } = parse(z.object({ forceHttps: z.boolean() }), req.body);
    return sites.setForceHttps(idParam(req.params), forceHttps);
  });

  app.delete('/api/sites/:id/ssl', async (req) => {
    const { revoke } = parse(z.object({ revoke: z.boolean().default(false) }), req.body ?? {});
    return sites.disableSsl(idParam(req.params), revoke);
  });

  // ---- Traffic logs --------------------------------------------------------

  app.get('/api/sites/:id/logs', async (req) => {
    const site = sites.getSite(idParam(req.params));
    const q = parse(logQuerySchema, req.query);
    if (q.type === 'app') {
      const all = await nodeapp.appJournal(site.domain, q.lines);
      const lines = q.q ? all.filter((l) => l.toLowerCase().includes(q.q!.toLowerCase())) : all;
      return { file: `journalctl -u ${nodeapp.serviceName(site.domain)}`, sizeBytes: 0, lines, truncated: false };
    }
    return tailFile(siteLogPaths(site.domain)[q.type], q.lines, q.q);
  });

  app.get('/api/sites/:id/logs/stats', async (req) => {
    const site = sites.getSite(idParam(req.params));
    const { hours } = parse(statsQuerySchema, req.query);
    return trafficStats(siteLogPaths(site.domain).access, hours);
  });

  app.get('/api/sites/:id/logs/download', async (req, reply) => {
    const site = sites.getSite(idParam(req.params));
    const type = parse(z.enum(['access', 'error']).default('access'), (req.query as { type?: string }).type);
    const file = siteLogPaths(site.domain)[type];
    if (!fs.existsSync(file)) throw badRequest('Chưa có file log');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${site.domain}-${path.basename(file)}"`);
    return reply.send(fs.createReadStream(file));
  });

  app.delete('/api/sites/:id/logs', async (req) => {
    const site = sites.getSite(idParam(req.params));
    const type = parse(z.enum(['access', 'error']), (req.query as { type?: string }).type);
    await truncateLog(siteLogPaths(site.domain)[type]);
    return { ok: true };
  });
}
