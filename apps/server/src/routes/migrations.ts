import type { FastifyInstance } from 'fastify';
import { createMigrationSchema, inspectPathSchema, sourceInputSchema, type MigrationEvent } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { t } from '../i18n/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { subscribeMigration } from '../migration/events.js';
import * as repo from '../migration/repo.js';
import { runner } from '../migration/runner.js';
import { discoverSites, inspectPath, testConnection } from '../migration/source.js';

export async function migrationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/api/migrations/test-connection', async (req) => testConnection(parse(sourceInputSchema, req.body)));

  app.post('/api/migrations/discover', async (req) => discoverSites(parse(sourceInputSchema, req.body)));

  app.post('/api/migrations/inspect', async (req) => {
    const { source, path } = parse(inspectPathSchema, req.body);
    return inspectPath(source, path);
  });

  app.get('/api/migrations', () => repo.listMigrations());

  app.post('/api/migrations', async (req) => {
    const input = parse(createMigrationSchema, req.body);
    const targets = input.items.map((i) => i.targetDomain);
    const dup = targets.find((d, i) => targets.indexOf(d) !== i);
    if (dup) throw badRequest(t('Tên miền đích {domain} bị trùng', { domain: dup }));
    for (const it of input.items) {
      if (it.db.strategy !== 'skip' && !it.db.source && !['nextjs', 'static'].includes(it.appType)) {
        throw badRequest(t('{domain}: thiếu thông tin database nguồn', { domain: it.sourceDomain }));
      }
    }
    // Re-check reachability & same-host now: the job runs in the background and must not fail on typos.
    const report = await testConnection(input.source);
    const id = repo.insertMigration(input, { sameHost: report.sameHost, panel: input.source.panel === 'auto' ? report.detectedPanel : input.source.panel });
    runner.start(id);
    return repo.getMigration(id);
  });

  app.get('/api/migrations/:id', (req) => {
    const id = idParam(req.params);
    return { migration: repo.getMigration(id), logs: repo.listLogs(id, { limit: 1000 }) };
  });

  app.get('/api/migrations/:id/logs', (req) => {
    const q = req.query as { after?: string; item?: string; limit?: string };
    return repo.listLogs(idParam(req.params), {
      afterId: Number(q.after) || 0,
      itemId: Number(q.item) || undefined,
      limit: Math.min(Number(q.limit) || 1000, 5000),
    });
  });

  /** Server-Sent Events: live step/progress/log updates. */
  app.get('/api/migrations/:id/events', (req, reply) => {
    const id = idParam(req.params);
    const migration = repo.getMigration(id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (e: MigrationEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: 'snapshot', migration, logs: repo.listLogs(id, { limit: 1000 }) });
    const unsubscribe = subscribeMigration(id, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.post('/api/migrations/:id/cancel', (req) => {
    const id = idParam(req.params);
    if (!runner.cancel(id)) throw conflict(t('Migration không chạy'));
    repo.addLog(id, null, 'warn', t('Người dùng yêu cầu huỷ - đang dừng sau thao tác hiện tại...'));
    return { ok: true };
  });

  app.post('/api/migrations/:id/retry', (req) => {
    const id = idParam(req.params);
    if (runner.isRunning(id)) throw conflict(t('Migration đang chạy'));
    const n = repo.resetItemsForRetry(id);
    if (!n) throw badRequest(t('Không có site nào lỗi để chạy lại'));
    repo.addLog(id, null, 'info', t('Chạy lại {count} site', { count: n }));
    runner.start(id);
    return repo.getMigration(id);
  });

  app.delete('/api/migrations/:id', (req) => {
    const id = idParam(req.params);
    if (runner.isRunning(id)) throw conflict(t('Hãy huỷ migration trước khi xoá'));
    repo.deleteMigration(id);
    return { ok: true };
  });
}
