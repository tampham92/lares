import type { FastifyInstance } from 'fastify';
import { cleanSiteSchema, codeLockSchema, quarantineSchema, releaseQuarantineSchema, securitySettingsSchema } from '@lares/shared';
import { currentUser, requireAuth } from '../auth/index.js';
import { idParam, parse } from '../lib/validate.js';
import { startCodeLock } from '../services/codeLock.js';
import { acknowledgeAdmins, getScan, siteAdmins, startMalwareScheduler, startScan } from '../services/malware.js';
import { startClean, startQuarantine, startRelease } from '../services/quarantine.js';
import { saveSecuritySettings, securitySettings, securityView } from '../services/siteSecurity.js';
import * as sites from '../services/sites.js';

/** Site → Security tab: malware scan (C5), quarantine + cleaning (C6), code lock (C7). */
export async function siteSecurityRoutes(app: FastifyInstance) {
  app.addHook('onReady', async () => startMalwareScheduler((m) => app.log.warn(m)));
  app.addHook('preHandler', requireAuth);
  const by = (req: Parameters<typeof currentUser>[0]) => currentUser(req).username;

  app.get('/api/sites/:id/security', async (req) => securityView(idParam(req.params)));

  app.post('/api/sites/:id/security/scan', async (req) => startScan(idParam(req.params)));

  app.get('/api/sites/:id/security/scans/:scanId', async (req) => {
    const { scanId } = req.params as { scanId: string };
    return getScan(idParam(req.params), Number(scanId) || 0);
  });

  /** Current administrators (cleaning form: which ones to delete). */
  app.get('/api/sites/:id/security/admins', async (req) => siteAdmins(sites.getSite(idParam(req.params))));

  app.post('/api/sites/:id/security/acknowledge', async (req) => {
    const id = idParam(req.params);
    await acknowledgeAdmins(id, by(req));
    return securityView(id);
  });

  app.post('/api/sites/:id/security/quarantine', async (req) => startQuarantine(idParam(req.params), parse(quarantineSchema, req.body ?? {}).reason, by(req)));

  app.post('/api/sites/:id/security/release', async (req) => startRelease(idParam(req.params), parse(releaseQuarantineSchema, req.body ?? {}).force, by(req)));

  app.post('/api/sites/:id/security/clean', async (req) => startClean(idParam(req.params), parse(cleanSiteSchema, req.body ?? {}), by(req)));

  app.put('/api/sites/:id/security/code-lock', async (req) => startCodeLock(idParam(req.params), parse(codeLockSchema, req.body), by(req)));

  app.get('/api/security/settings', async () => securitySettings());

  app.put('/api/security/settings', async (req) => saveSecuritySettings(parse(securitySettingsSchema, req.body)));
}
