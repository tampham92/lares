import type { FastifyInstance } from 'fastify';
import { createDatabaseSchema } from '@tpanel/shared';
import { requireAuth } from '../auth/index.js';
import { idParam, parse } from '../lib/validate.js';
import * as databases from '../services/databases.js';

export async function databaseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/databases', () => databases.listDatabases());

  app.post('/api/databases', async (req) => {
    const input = parse(createDatabaseSchema, req.body);
    return databases.createDatabase(input);
  });

  /** Reveal credentials on demand only (never included in list responses). */
  app.get('/api/databases/:id/credentials', (req) => databases.getDatabaseCredentials(idParam(req.params)));

  app.delete('/api/databases/:id', async (req) => {
    await databases.deleteDatabase(idParam(req.params));
    return { ok: true };
  });
}
