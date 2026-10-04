import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/index.js';
import { startReleaseJobs, versionInfo } from '../services/release.js';

/** GET /api/system/version + the daily update check / anonymous heartbeat scheduler. */
export async function releaseRoutes(app: FastifyInstance, opts: { jobs?: boolean } = {}) {
  app.get('/api/system/version', { preHandler: requireAuth }, () => versionInfo());

  if (opts.jobs !== false) {
    let stop: (() => void) | null = null;
    app.addHook('onReady', async () => {
      stop = startReleaseJobs((m) => app.log.info(m));
    });
    app.addHook('onClose', async () => stop?.());
  }
}
