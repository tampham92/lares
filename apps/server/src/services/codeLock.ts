import type { CodeLockInput, CodeLockState, Site } from '@lares/shared';
import { t } from '../i18n/index.js';
import { conflict } from '../lib/errors.js';
import { startLocked } from './backups.js';
import type { HostLogger } from './host.js';
import * as isolation from './isolation.js';
import { defaultWritableDirs, resolveWritableDir } from './isolationPolicy.js';
import * as store from './securityStore.js';
import * as sites from './sites.js';
import type { TaskInfo } from './tasks.js';

/*
 * Code lock (C7, per site, optional). PHP runs as the site user; with the lock the code belongs to
 * root instead (group = the site's group, read-only for PHP and nginx) and only the writable folders
 * (uploads, caches) stay the site user's. A hijacked plugin then cannot modify the site's own code -
 * no backdoor in wp-config.php or a theme, no re-infection from inside. Updates go through the panel
 * (tab Updates), which lifts the lock for the job and puts it back (withCodeUnlocked). WordPress'
 * own updater and plugin installer in wp-admin stop working on purpose. Layout: lockCommands.
 */

export const codeLockSupported = (site: Site) => site.sysUser !== null && sites.usesPhp(site.appType);

export function codeLockState(site: Site): CodeLockState {
  const s = store.codeLock(site.id);
  const defaults = defaultWritableDirs(site);
  return { locked: s.locked, writableDirs: s.writableDirs ?? defaults, defaultWritableDirs: defaults };
}

async function apply(site: Site, input: CodeLockInput, by: string, log: HostLogger): Promise<CodeLockState> {
  const dirs = input.writableDirs?.length ? input.writableDirs : null;
  for (const d of dirs ?? []) if (!resolveWritableDir(site.rootPath, d)) throw conflict(t('Thư mục không hợp lệ: {dir}', { dir: d }));
  const prev = store.codeLock(site.id);
  store.setCodeLock(site.id, input.locked, dirs);
  try {
    log(input.locked ? t('Chuyển code của {domain} cho root, chỉ để PHP ghi vào: {dirs}', { domain: site.domain, dirs: isolation.writableDirsOf(site).join(', ') || '-' }) : t('Trả code của {domain} cho user {user}', { domain: site.domain, user: site.sysUser! }));
    await isolation.fixPermissions(site, log);
  } catch (err) {
    store.setCodeLock(site.id, prev.locked, prev.writableDirs);
    await isolation.fixPermissions(site, log).catch(() => undefined);
    throw err;
  }
  if (input.locked !== prev.locked) store.addEvent(site.id, input.locked ? 'code-lock' : 'code-unlock', by);
  log(input.locked ? t('Đã khoá code của {domain}', { domain: site.domain }) : t('Đã mở khoá code của {domain}', { domain: site.domain }));
  return codeLockState(sites.getSite(site.id));
}

export function startCodeLock(siteId: number, input: CodeLockInput, by: string): TaskInfo {
  const site = sites.getSite(siteId);
  if (!codeLockSupported(site)) throw conflict(t('Khoá code chỉ áp dụng cho site PHP có user riêng'));
  return startLocked(site, 'codelock', input.locked ? t('Khoá code {domain}', { domain: site.domain }) : t('Mở khoá code {domain}', { domain: site.domain }), (log) => apply(site, input, by, log));
}

/**
 * Run a panel job that writes code (WordPress update, cleaning) on a locked site: the tree goes back
 * to the site user for the job and is locked again afterwards, whatever happened.
 */
export async function withCodeUnlocked<T>(site: Site, log: HostLogger, fn: () => Promise<T>): Promise<T> {
  if (!store.codeLock(site.id).locked || !site.sysUser || store.unlockedForJob.has(site.id)) return fn();
  store.unlockedForJob.add(site.id);
  try {
    log(t('Tạm mở khoá code trong lúc chạy tác vụ'));
    await isolation.fixPermissions(site, log);
    return await fn();
  } finally {
    store.unlockedForJob.delete(site.id);
    log(t('Khoá code lại'));
    await isolation.fixPermissions(site, log).catch((e) => log(t('Cảnh báo: không khoá lại được code: {error}', { error: e instanceof Error ? e.message : String(e) })));
  }
}
