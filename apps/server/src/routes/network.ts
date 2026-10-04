import type { FastifyInstance } from 'fastify';
import { cloudflareSettingsSchema, panelDomainCheckSchema, panelDomainSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { t } from '../i18n/index.js';
import { conflict } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getCloudflareView, refreshCloudflareRanges, setCloudflareEnabled } from '../services/cloudflare.js';
import { checkPanelDomain, getPanelDomainView, panelDomainBusy, removePanelDomain, setPanelDomain } from '../services/panelTls.js';
import { startTask } from '../services/tasks.js';

export async function networkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Real visitor IP behind Cloudflare ------------------------------------------

  app.get('/api/settings/cloudflare', () => getCloudflareView());
  app.put('/api/settings/cloudflare', async (req) => setCloudflareEnabled(parse(cloudflareSettingsSchema, req.body).enabled, (m) => req.log.info(m)));
  app.post('/api/settings/cloudflare/refresh', async (req) => refreshCloudflareRanges((m) => req.log.info(m)));

  // ---- Panel domain + Let's Encrypt certificate -------------------------------------

  app.get('/api/settings/panel-domain', () => getPanelDomainView());
  app.post('/api/settings/panel-domain/check', async (req) => checkPanelDomain(parse(panelDomainCheckSchema, req.body).domain));
  app.post('/api/settings/panel-domain', async (req) => {
    const input = parse(panelDomainSchema, req.body);
    if (panelDomainBusy()) throw conflict(t('Đang có thao tác khác với tên miền trang quản trị, hãy chờ hoàn tất'));
    return startTask(t('Tên miền trang quản trị {domain}', { domain: input.domain }), (log) => setPanelDomain(input, log));
  });
  app.delete('/api/settings/panel-domain', async (req) => removePanelDomain((m) => req.log.info(m)));
}
