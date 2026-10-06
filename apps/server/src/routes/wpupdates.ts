import type { FastifyInstance } from 'fastify';
import { wpUpdateRequestSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { idParam, parse } from '../lib/validate.js';
import * as wpUpdates from '../services/wpUpdates.js';

/** WordPress core/plugin/theme updates with health check and automatic rollback (services/wpUpdates.ts). */
export async function wpUpdateRoutes(app: FastifyInstance) {
  app.addHook('onReady', async () => {
    await wpUpdates.recoverInterruptedRuns((m) => app.log.warn(m));
    wpUpdates.startWpUpdateChecker((m) => app.log.warn(m));
  });

  await app.register(async (priv) => {
    priv.addHook('preHandler', requireAuth);

    /** Pending update counts of every WordPress site (badges). */
    priv.get('/api/wp-updates/summary', () => wpUpdates.updatesSummary());

    /** Cached inventory, running job and history of one site. */
    priv.get('/api/sites/:id/wp-updates', async (req) => wpUpdates.siteUpdates(idParam(req.params)));

    /** Ask wp-cli / wordpress.org again (takes a few seconds). */
    priv.post('/api/sites/:id/wp-updates/check', async (req) => wpUpdates.checkInventory(idParam(req.params)));

    /** Safe update as a background task: { all } or { core, plugins: [...], themes: [...] }. */
    priv.post('/api/sites/:id/wp-updates/run', async (req) => wpUpdates.startUpdate(idParam(req.params), parse(wpUpdateRequestSchema, req.body ?? {})));
  });
}
