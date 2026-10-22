import type { FastifyInstance } from 'fastify';
import { phpUpdateSettingsSchema, phpUpgradeRequestSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { parse } from '../lib/validate.js';
import { checkPhpUpdates, getPhpUpdates, setPhpAutoUpdate, startPhpUpdateJobs, startPhpUpgrade } from '../services/phpUpdates.js';

/** PHP security updates in Settings > Updates (services/phpUpdates.ts) + their hourly job. */
export async function phpUpdateRoutes(app: FastifyInstance, opts: { jobs?: boolean } = {}) {
  app.get('/api/php-updates', { preHandler: requireAuth }, () => getPhpUpdates());
  app.post('/api/php-updates/check', { preHandler: requireAuth }, () => checkPhpUpdates());
  app.put('/api/php-updates/settings', { preHandler: requireAuth }, (req) => setPhpAutoUpdate(parse(phpUpdateSettingsSchema, req.body).autoUpdate));
  app.post('/api/php-updates/upgrade', { preHandler: requireAuth }, (req) => startPhpUpgrade({ branches: parse(phpUpgradeRequestSchema, req.body ?? {}).branches }));

  if (opts.jobs !== false) {
    let stop: (() => void) | null = null;
    app.addHook('onReady', async () => {
      stop = startPhpUpdateJobs((m) => app.log.warn(m));
    });
    app.addHook('onClose', async () => stop?.());
  }
}
