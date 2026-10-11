import path from 'node:path';
import type { SecuritySettings, SiteSecurityView } from '@lares/shared';
import { runningJob } from './backups.js';
import { codeLockState, codeLockSupported } from './codeLock.js';
import { latestScan, scanHistory, scanSupported } from './malware.js';
import { QUARANTINE_DIR } from './malwarePolicy.js';
import * as store from './securityStore.js';
import * as sites from './sites.js';

/** Everything the site's Security tab shows (malware.ts, quarantine.ts, codeLock.ts). */
export function securityView(siteId: number): SiteSecurityView {
  const site = sites.getSite(siteId);
  return {
    supported: {
      scan: scanSupported(site),
      clean: site.sysUser !== null && sites.usesPhp(site.appType),
      codeLock: codeLockSupported(site),
    },
    lastScan: latestScan(site.id),
    history: scanHistory(site.id),
    running: runningJob(site.id),
    settings: store.getSecuritySettings(),
    adminsAcknowledgedAt: store.adminsAcknowledgedAt(site.id),
    quarantine: store.quarantineState(site.id),
    events: store.events(site.id),
    codeLock: codeLockState(site),
    quarantineDir: path.join(site.rootPath, QUARANTINE_DIR),
  };
}

export const securitySettings = (): SecuritySettings => store.getSecuritySettings();
export function saveSecuritySettings(s: SecuritySettings): SecuritySettings {
  store.saveSecuritySettings(s);
  return store.getSecuritySettings();
}
