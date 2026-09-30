import type { FastifyInstance } from 'fastify';
import { logrotateSchema } from '@tpanel/shared';
import { requireAuth } from '../auth/index.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getLogrotate, saveLogrotate } from '../services/logs.js';
import { systemStats } from '../services/system.js';
import { getTask } from '../services/tasks.js';

export async function systemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/system/stats', () => systemStats());

  app.get('/api/tasks/:id', (req) => {
    const since = Number((req.query as { since?: string }).since ?? 0) || 0;
    const t = getTask((req.params as { id: string }).id, since);
    if (!t) throw notFound('Task không tồn tại (có thể đã hết hạn)');
    return t;
  });

  app.get('/api/settings/logrotate', () => getLogrotate());
  app.put('/api/settings/logrotate', async (req) => {
    const body = parse(logrotateSchema, req.body);
    await saveLogrotate(body);
    return body;
  });
}
