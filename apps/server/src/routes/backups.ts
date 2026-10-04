import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BACKUP_ID_RE, backupSettingsSchema, msg, siteBackupPrefsSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { signDownload, verifyDownload } from '../services/backupPolicy.js';
import * as backups from '../services/backups.js';
import * as sites from '../services/sites.js';

const backupIdSchema = z.string().regex(BACKUP_ID_RE, msg('ID không hợp lệ'));
const backupIdParam = (params: unknown) => parse(backupIdSchema, (params as { backupId?: string }).backupId);

export async function backupRoutes(app: FastifyInstance) {
  // the scheduler lives in the panel process: start it once the server is up
  app.addHook('onReady', async () => {
    await backups.startBackupScheduler((m) => app.log.warn(m));
  });

  // Short-lived signed link (see signDownload): a plain <a href> cannot send the Bearer header.
  await app.register(async (pub) => {
    pub.get('/api/backup-download', async (req, reply) => {
      const token = (req.query as { token?: string }).token ?? '';
      const ref = verifyDownload(config.secret, token);
      if (!ref) throw new HttpError(403, t('Link tải đã hết hạn hoặc không hợp lệ'));
      const { stream, filename } = await backups.downloadBackup(ref.siteId, ref.id);
      reply.header('Content-Type', 'application/x-tar');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Cache-Control', 'no-store');
      return reply.send(stream);
    });
  });

  await app.register(async (priv) => {
    priv.addHook('preHandler', requireAuth);

    priv.get('/api/settings/backup', () => backups.backupSettingsView());
    priv.put('/api/settings/backup', async (req) => backups.saveBackupSettings(parse(backupSettingsSchema, req.body)));

    priv.get('/api/sites/:id/backups', async (req) => backups.siteBackups(idParam(req.params)));

    priv.post('/api/sites/:id/backups', async (req) => backups.startBackup(idParam(req.params)));

    priv.put('/api/sites/:id/backups/schedule', async (req) => {
      const { scheduled } = parse(siteBackupPrefsSchema, req.body);
      backups.setSiteScheduled(idParam(req.params), scheduled);
      return { ok: true };
    });

    priv.delete('/api/sites/:id/backups/:backupId', async (req) => {
      await backups.deleteBackup(idParam(req.params), backupIdParam(req.params));
      return { ok: true };
    });

    priv.post('/api/sites/:id/backups/:backupId/restore', async (req) => {
      const id = idParam(req.params);
      const backupId = backupIdParam(req.params);
      // the UI makes the admin type the domain; the API insists on it too
      const { confirm } = parse(z.object({ confirm: z.string() }), req.body ?? {});
      if (confirm !== sites.getSite(id).domain) throw badRequest(t('Xác nhận không khớp tên miền của site'));
      return backups.startRestore(id, backupId);
    });

    priv.post('/api/sites/:id/backups/:backupId/download', async (req) => {
      const id = idParam(req.params);
      const backupId = backupIdParam(req.params);
      sites.getSite(id);
      return { url: `/api/backup-download?token=${encodeURIComponent(signDownload(config.secret, { siteId: id, id: backupId }))}` };
    });
  });
}
