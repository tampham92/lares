import type { FastifyInstance } from 'fastify';
import { notificationIdsSchema } from '@lares/shared';
import { requireAuth, type SessionClaims } from '../auth/index.js';
import { t } from '../i18n/index.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { dismiss, listNotifications, markRead } from '../services/notifications.js';

/** Top bar bell (services/notifications.ts). Read state belongs to the logged-in user. */
export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const userId = (req: { user: unknown }) => (req.user as SessionClaims).sub;

  app.get('/api/notifications', async (req) => listNotifications(userId(req)));

  app.post('/api/notifications/read', async (req) => markRead(userId(req), parse(notificationIdsSchema, req.body).ids));

  app.delete('/api/notifications/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!dismiss(id)) throw notFound(t('Không tìm thấy thông báo'));
    return listNotifications(userId(req));
  });
}
