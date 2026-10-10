import type { FastifyInstance } from 'fastify';
import { updateCheckSchema, upgradeRequestSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { parse } from '../lib/validate.js';
import { checkForUpdate, setUpdateCheck, startReleaseJobs, versionInfo } from '../services/release.js';
import { getUpgradeStatus, startUpgrade } from '../services/upgrade.js';

/**
 * GET /api/system/version, the update-check toggle, "check now", the one-click upgrade
 * + the daily update check / anonymous heartbeat scheduler.
 */
export async function releaseRoutes(app: FastifyInstance, opts: { jobs?: boolean } = {}) {
  app.get('/api/system/version', { preHandler: requireAuth }, () => versionInfo());
  app.put('/api/system/update-check', { preHandler: requireAuth }, (req) => setUpdateCheck(parse(updateCheckSchema, req.body).enabled));
  app.post('/api/system/update-check', { preHandler: requireAuth }, () => checkForUpdate());
  app.get('/api/system/upgrade', { preHandler: requireAuth }, () => getUpgradeStatus());
  app.post('/api/system/upgrade', { preHandler: requireAuth }, (req) => startUpgrade(parse(upgradeRequestSchema, req.body).version, (m) => req.log.info(m)));

  if (opts.jobs !== false) {
    let stop: (() => void) | null = null;
    app.addHook('onReady', async () => {
      stop = startReleaseJobs((m) => app.log.info(m));
    });
    app.addHook('onClose', async () => stop?.());
  }
}
