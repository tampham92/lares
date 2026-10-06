import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  DB_IDENT_RE,
  backupSettingsSchema,
  type BackupEntry,
  type BackupManifest,
  type BackupSettings,
  type BackupSettingsView,
  type BackupTrigger,
  type Site,
  type SiteBackupsResponse,
} from '@lares/shared';
import { config } from '../config.js';
import { db, getSetting, nowIso, setSetting } from '../db/index.js';
import { localExecutor } from '../executors/index.js';
import { t } from '../i18n/index.js';
import { badRequest, conflict, errorMessage, notFound } from '../lib/errors.js';
import { duKb, shq, tarCreate, tarExcludes } from '../lib/shell.js';
import { parseWpConfig } from '../migration/appDetect.js';
import { freeBytes, mysqldumpFlags } from '../migration/source.js';
import { PRE_UPDATE_KEEP, SAFETY_KEEP, backupRootProblem, isDue, isInside, isSafeDomainSegment, isSafeSiteRoot, localDate, newBackupId, selectExpired } from './backupPolicy.js';
import { LocalBackupStorage, MANIFEST_FILE, type BackupStorage } from './backupStorage.js';
import { databasesSize, findWpConfig } from './clone.js';
import * as databases from './databases.js';
import { host, type HostLogger } from './host.js';
import * as mysql from './mysql.js';
import * as nodeapp from './nodeapp.js';
import * as sites from './sites.js';
import { startTask, type TaskInfo } from './tasks.js';

/*
 * Site backups: files.tar.gz (the site directory) + db-<name>.sql.gz per database + manifest.json,
 * written through a BackupStorage (local disk today). Manual, scheduled (daily) and "safety"
 * backups taken automatically before a restore; "pre-update" ones before a WordPress update.
 * One backup/restore/update per site at a time.
 */

const fmtSize = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`);
const LONG = 12 * 3_600_000;

/** Caches (rebuilt on demand) and transient files; .env* files are always kept. */
function backupExcludes(site: Site): string[] {
  const list = ['.npm', '.cache', '.pnpm-store', '.yarn/cache', '.lares-sso.json', '*/wp-content/cache'];
  const rel = path.relative(site.rootPath, site.webRoot);
  if (site.appType === 'nextjs' && rel && isInside(site.rootPath, site.webRoot)) list.push(`${rel}/node_modules`, `${rel}/.next/cache`);
  return list;
}

let version: string | null = null;
function laresVersion(): string {
  if (version) return version;
  version = 'unknown';
  for (const file of [path.resolve(process.cwd(), '../../package.json'), path.resolve(process.cwd(), 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'lares' && pkg.version) return (version = pkg.version);
    } catch {
      /* try the next one */
    }
  }
  return version;
}

// ---- Settings ------------------------------------------------------------------

const SETTINGS_KEY = 'backup';

export const defaultBackupRoot = () => path.resolve(process.env.LARES_BACKUP_DIR || (config.dryRun ? path.join(config.dataDir, 'site-backups') : '/var/backups/lares'));

export function getBackupSettings(): BackupSettings {
  const r = backupSettingsSchema.safeParse(getSetting<unknown>(SETTINGS_KEY, {}));
  return r.success ? r.data : backupSettingsSchema.parse({});
}

const effectiveRoot = (s: BackupSettings) => (s.root ? path.resolve(s.root) : defaultBackupRoot());

function assertBackupRoot(root: string) {
  const problem = backupRootProblem(root, path.resolve(config.sitesRoot));
  if (!problem) return;
  const why: Record<string, string> = {
    'not-absolute': t('phải là đường dẫn tuyệt đối'),
    'too-shallow': t('cần ít nhất 2 cấp thư mục, ví dụ /var/backups/lares'),
    'system-dir': t('không được nằm trong thư mục hệ thống'),
    'sites-root': t('không được trùng hoặc nằm trong thư mục website {root}', { root: config.sitesRoot }),
  };
  throw badRequest(t('Thư mục sao lưu {path} không hợp lệ: {reason}', { path: root, reason: why[problem] ?? problem }));
}

export function backupSettingsView(): BackupSettingsView {
  const s = getBackupSettings();
  return { ...s, effectiveRoot: effectiveRoot(s), defaultRoot: defaultBackupRoot() };
}

export async function saveBackupSettings(input: BackupSettings): Promise<BackupSettingsView> {
  const next = { ...input, root: input.root ? path.resolve(input.root) : '' };
  const root = effectiveRoot(next);
  assertBackupRoot(root);
  // create it now so a typo or a read-only mount shows up immediately
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700);
  setSetting(SETTINGS_KEY, next);
  return backupSettingsView();
}

/** Only local storage exists today; a remote destination would be chosen here from the settings. */
function storage(): LocalBackupStorage {
  const root = effectiveRoot(getBackupSettings());
  assertBackupRoot(root);
  return new LocalBackupStorage(root);
}

// ---- Per-site schedule state -------------------------------------------------------

interface PrefRow {
  scheduled: number;
  last_run_date: string | null;
  last_status: 'ok' | 'failed' | null;
  last_error: string | null;
  last_run_at: string | null;
}

function sitePrefs(siteId: number): PrefRow {
  return (
    (db.prepare('SELECT scheduled, last_run_date, last_status, last_error, last_run_at FROM site_backups WHERE site_id = ?').get(siteId) as PrefRow | undefined) ?? {
      scheduled: 1,
      last_run_date: null,
      last_status: null,
      last_error: null,
      last_run_at: null,
    }
  );
}

const upsertPref = (siteId: number, column: 'scheduled' | 'last_run_date', value: unknown) =>
  db.prepare(`INSERT INTO site_backups (site_id, ${column}) VALUES (?, ?) ON CONFLICT(site_id) DO UPDATE SET ${column} = excluded.${column}`).run(siteId, value);

export function setSiteScheduled(siteId: number, scheduled: boolean) {
  sites.getSite(siteId);
  upsertPref(siteId, 'scheduled', scheduled ? 1 : 0);
}

function recordResult(siteId: number, status: 'ok' | 'failed', error: string | null) {
  db.prepare('UPDATE site_backups SET last_status = ?, last_error = ?, last_run_at = ? WHERE site_id = ?').run(status, error, nowIso(), siteId);
}

// ---- Locks ------------------------------------------------------------------------

export type SiteJobKind = 'backup' | 'restore' | 'update';

const running = new Map<number, { taskId: string; kind: SiteJobKind }>();

/** Backup/restore/update currently holding the site's lock. */
export const runningJob = (siteId: number) => running.get(siteId) ?? null;

function busy(site: Site) {
  return running.get(site.id)?.kind === 'update'
    ? conflict(t('{domain} đang cập nhật WordPress - hãy đợi nó xong', { domain: site.domain }))
    : conflict(t('{domain} đang có tác vụ sao lưu/khôi phục chạy - hãy đợi nó xong', { domain: site.domain }));
}

/**
 * Start `fn` as a background task holding the site's lock (one backup/restore/update per site).
 * Exported for other site jobs (WordPress updates), which call takeBackup / restoreFromBackup inside it.
 */
export function startLocked<T>(site: Site, kind: SiteJobKind, label: string, fn: (log: HostLogger) => Promise<T>): TaskInfo {
  if (running.has(site.id)) throw busy(site);
  const lock = { taskId: '', kind };
  running.set(site.id, lock);
  try {
    const task = startTask(label, (log) => fn(log).finally(() => running.delete(site.id)));
    lock.taskId = task.id;
    return task;
  } catch (err) {
    running.delete(site.id);
    throw err;
  }
}

// ---- Listing ------------------------------------------------------------------------

function toEntry(id: string, m: BackupManifest | null): BackupEntry {
  if (!m) return { id, createdAt: '', trigger: 'manual', totalBytes: 0, filesBytes: 0, databases: [], laresVersion: '', damaged: true };
  return {
    id,
    createdAt: m.createdAt,
    trigger: m.trigger,
    totalBytes: m.totalBytes,
    filesBytes: m.files.bytes,
    databases: m.databases.map((d) => ({ name: d.name, bytes: d.bytes })),
    laresVersion: m.laresVersion,
  };
}

export async function siteBackups(siteId: number): Promise<SiteBackupsResponse> {
  const site = sites.getSite(siteId);
  const store = storage();
  const settings = getBackupSettings();
  const prefs = sitePrefs(site.id);
  const list = isSafeDomainSegment(site.domain) ? await store.list(site.domain) : [];
  return {
    backups: list.map((b) => toEntry(b.id, b.manifest)),
    schedule: { globalEnabled: settings.enabled, siteEnabled: prefs.scheduled === 1, time: settings.time, keep: settings.keep },
    last: { date: prefs.last_run_date, status: prefs.last_status, error: prefs.last_error, at: prefs.last_run_at },
    running: running.get(site.id) ?? null,
    root: store.location,
  };
}

// ---- Safety checks ------------------------------------------------------------------

/** The site root from the DB must stay inside the sites root, also after resolving symlinks. */
async function assertSiteRoot(site: Site, mustExist: boolean) {
  const sitesRoot = path.resolve(config.sitesRoot);
  const refuse = () => conflict(t('Thư mục site {path} nằm ngoài {root} - từ chối sao lưu/khôi phục', { path: site.rootPath, root: sitesRoot }));
  if (!isSafeSiteRoot(site.rootPath, sitesRoot)) throw refuse();
  if (!isSafeDomainSegment(site.domain)) throw conflict(t('Tên miền {domain} không dùng được làm thư mục sao lưu', { domain: site.domain }));
  const real = await fs.realpath(site.rootPath).catch(() => null);
  if (!real) {
    if (mustExist) throw conflict(t('Thư mục site {path} không tồn tại', { path: site.rootPath }));
    return;
  }
  if (!isInside(await fs.realpath(sitesRoot).catch(() => sitesRoot), real)) throw refuse();
}

/** wp-config.php of a WordPress tree rooted at `base` (the live site root or an extracted copy). */
async function wpConfigIn(site: Site, base: string): Promise<string | null> {
  if (base === site.rootPath) return findWpConfig(site);
  for (const dir of [site.webRoot, path.dirname(site.webRoot)]) {
    if (dir !== site.rootPath && !isInside(site.rootPath, dir)) continue;
    const file = path.join(base, path.relative(site.rootPath, dir), 'wp-config.php');
    if (await host.exists(file)) return file;
  }
  return null;
}

async function readWpDb(file: string | null) {
  if (!file) return null;
  const parsed = parseWpConfig(await fs.readFile(file, 'utf8').catch(() => ''));
  return parsed && DB_IDENT_RE.test(parsed.name) ? parsed : null;
}

/** Databases of a site: the ones attached to it, plus the one its wp-config.php uses. */
async function siteDatabaseNames(site: Site, log: HostLogger): Promise<string[]> {
  const names = new Set(databases.databasesForSite(site.id).map((d) => d.name));
  if (site.appType === 'wordpress') {
    const wp = await readWpDb(await findWpConfig(site));
    if (wp) names.add(wp.name);
  }
  const out: string[] = [];
  for (const name of names) {
    if (!DB_IDENT_RE.test(name)) continue;
    if (config.dryRun || (await mysql.databaseExists(name))) out.push(name);
    else log(t('Cảnh báo: bỏ qua database {name} - không tồn tại trên MySQL của Lares', { name }));
  }
  return out;
}

async function sizeOf(dir: string): Promise<number> {
  if (!(await host.exists(dir))) return 0;
  return (Number((await host.exec(duKb(dir))).stdout.trim()) || 0) * 1024;
}

// ---- Backup ---------------------------------------------------------------------------

/** Run with lowered CPU / IO priority so a backup does not slow the sites down. */
const LOW_PRIORITY = 'renice -n 10 -p $$ >/dev/null 2>&1; command -v ionice >/dev/null 2>&1 && ionice -c2 -n7 -p $$ >/dev/null 2>&1;';

async function createBackup(site: Site, trigger: BackupTrigger, log: HostLogger, opts: { protect?: string } = {}): Promise<BackupEntry> {
  await assertSiteRoot(site, true);
  const store = storage();
  const settings = getBackupSettings();
  await fs.mkdir(store.location, { recursive: true, mode: 0o700 });

  const dbNames = await siteDatabaseNames(site, log);
  const excludes = backupExcludes(site);
  const plainExcludes = excludes.filter((e) => !e.includes('*')).map((e) => path.join(site.rootPath, e));
  const [total, excluded, dbBytes, free] = await Promise.all([
    sizeOf(site.rootPath),
    Promise.all(plainExcludes.map(sizeOf)).then((s) => s.reduce((a, b) => a + b, 0)),
    databasesSize(dbNames),
    freeBytes(localExecutor, store.location),
  ]);
  const sourceBytes = Math.max(0, total - excluded);
  // worst case: nothing compresses (images, video, zip files)
  const needed = sourceBytes + dbBytes;
  if (free !== null && needed > free * 0.95) {
    throw conflict(t('Không đủ dung lượng để sao lưu {domain}: cần khoảng {needed}, còn trống {free} tại {path}', { domain: site.domain, needed: fmtSize(needed), free: fmtSize(free), path: store.location }));
  }

  const id = newBackupId(new Date(), (await store.list(site.domain)).map((b) => b.id));
  log(t('Sao lưu {domain} → {path}', { domain: site.domain, path: path.join(store.location, site.domain, id) }));
  const staging = await store.prepare(site.domain, id);
  try {
    const gz = (await host.has('pigz')) ? 'pigz' : 'gzip';
    const filesOut = path.join(staging, 'files.tar.gz');
    log(t('Đang nén thư mục {path} (khoảng {size})...', { path: site.rootPath, size: fmtSize(sourceBytes) }));
    log(t('Loại trừ: {list}', { list: excludes.join(', ') }));
    await host.run(`${LOW_PRIORITY} umask 077; ${tarCreate(site.rootPath, tarExcludes(excludes))} | ${gz} -c -6 > ${shq(filesOut)}`, { timeoutMs: LONG });
    const filesBytes = (await fs.stat(filesOut)).size;
    log(t('Đã nén file: {size}', { size: fmtSize(filesBytes) }));

    const dbEntries: BackupManifest['databases'] = [];
    const flags = dbNames.length && !config.dryRun ? await mysqldumpFlags(localExecutor) : [];
    for (const name of dbNames) {
      const file = `db-${name}.sql.gz`;
      const out = path.join(staging, file);
      log(t('Đang dump database {name}...', { name }));
      if (config.dryRun) {
        log(`[dry-run] mysqldump ${name} | gzip > ${out}`);
        await fs.writeFile(out, zlib.gzipSync(`-- [dry-run] ${name}\n-- Dump completed\n`), { mode: 0o600 });
      } else {
        await mysql.dumpDatabaseGz(name, out, flags, { compressor: gz, log });
      }
      const bytes = (await fs.stat(out)).size;
      dbEntries.push({ name, file, bytes });
      log(t('Đã dump database {name}: {size}', { name, size: fmtSize(bytes) }));
    }

    const manifest: BackupManifest = {
      format: 1,
      laresVersion: laresVersion(),
      createdAt: nowIso(),
      trigger,
      site: { id: site.id, domain: site.domain, appType: site.appType, rootPath: site.rootPath, webRoot: site.webRoot },
      files: { file: 'files.tar.gz', bytes: filesBytes, sourceBytes, excludes },
      databases: dbEntries,
      totalBytes: filesBytes + dbEntries.reduce((a, d) => a + d.bytes, 0),
    };
    await fs.writeFile(path.join(staging, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    await store.commit(site.domain, id, staging);
    log(t('Đã tạo bản sao lưu {id} ({size})', { id, size: fmtSize(manifest.totalBytes) }));
    await prune(store, site.domain, trigger, settings.keep, log, opts.protect);
    return toEntry(id, manifest);
  } catch (err) {
    await store.discard(staging).catch(() => {});
    throw err;
  }
}

/** Retention: keep the newest `keep` scheduled backups (SAFETY_KEEP safety ones); manual ones stay. */
async function prune(store: BackupStorage, domain: string, trigger: BackupTrigger, keep: number, log: HostLogger, protect?: string) {
  const all = (await store.list(domain)).flatMap((b) => (b.manifest ? [{ id: b.id, trigger: b.manifest.trigger, createdAt: b.manifest.createdAt }] : []));
  const n = trigger === 'safety' ? SAFETY_KEEP : trigger === 'pre-update' ? PRE_UPDATE_KEEP : keep;
  for (const b of selectExpired(all, trigger, n)) {
    if (b.id === protect) continue; // the backup being restored from
    await store.remove(domain, b.id);
    log(t('Đã xoá bản sao lưu cũ {id} (giữ {keep} bản gần nhất)', { id: b.id, keep: n }));
  }
}

export function startBackup(siteId: number): TaskInfo {
  const site = sites.getSite(siteId);
  return startLocked(site, 'backup', t('Sao lưu {domain}', { domain: site.domain }), (log) => createBackup(site, 'manual', log));
}

const notFoundIfMissing = (err: unknown): never => {
  throw (err as NodeJS.ErrnoException).code === 'ENOENT' ? notFound(t('Bản sao lưu không tồn tại')) : err;
};

export async function deleteBackup(siteId: number, id: string) {
  const site = sites.getSite(siteId);
  if (running.has(site.id)) throw busy(site);
  await storage().remove(site.domain, id).catch(notFoundIfMissing);
}

export async function downloadBackup(siteId: number, id: string) {
  const site = sites.getSite(siteId);
  const stream = await storage().download(site.domain, id).catch(notFoundIfMissing);
  return { stream, filename: `lares-${site.domain}-${id}.tar` };
}

// ---- Restore ----------------------------------------------------------------------------

interface DbTarget {
  name: string;
  file: string;
  user: string;
  password: string;
  /** Created by Lares: emptied (DROP + CREATE) before the import. Otherwise only overwritten. */
  managed: boolean;
}

/**
 * Which databases of the backup may be written, and with which credentials: a database attached
 * to this site, or the one the restored wp-config.php points at when no other site owns it.
 * Anything else (e.g. a database now attached to another site) is skipped.
 */
async function resolveDbTargets(site: Site, m: BackupManifest, restoredRoot: string, log: HostLogger): Promise<DbTarget[]> {
  const records = new Map(databases.listDatabases().map((d) => [d.name, d]));
  const wp = site.appType === 'wordpress' ? await readWpDb(await wpConfigIn(site, restoredRoot)) : null;
  const out: DbTarget[] = [];
  for (const d of m.databases) {
    const rec = records.get(d.name);
    if (rec && (rec.siteId === site.id || (rec.siteId === null && wp?.name === d.name))) {
      const creds = databases.getDatabaseCredentials(rec.id);
      out.push({ name: d.name, file: d.file, user: creds.username, password: creds.password, managed: rec.managed });
    } else if (!rec && wp?.name === d.name && ['localhost', '127.0.0.1'].includes(wp.host)) {
      out.push({ name: d.name, file: d.file, user: wp.user, password: wp.password, managed: false });
    } else {
      log(t('Cảnh báo: bỏ qua database {name} - không thuộc site này trong Lares', { name: d.name }));
    }
  }
  return out;
}

async function importDb(tg: DbTarget, dumpFile: string, log: HostLogger) {
  if (tg.managed) await mysql.recreateDatabase(tg.name, tg.user, tg.password, log);
  await mysql.importGzipDump(tg.name, dumpFile, { user: tg.user, password: tg.password }, { log });
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([fs.readFile(a).catch(() => null), fs.readFile(b).catch(() => null)]);
  return x === null || y === null ? x === y : x.equals(y);
}

/** node_modules can be reused when the restored app declares exactly the same dependencies. */
async function sameDependencies(currentApp: string, restoredApp: string): Promise<boolean> {
  for (const f of ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    if (!(await sameFile(path.join(currentApp, f), path.join(restoredApp, f)))) return false;
  }
  return true;
}

/**
 * Restore files + databases from a backup. A safety backup of the current state is taken first;
 * files are extracted next to the site and swapped in by rename; databases are emptied and
 * re-imported. If the swap or an import fails, files and databases are put back from the old
 * tree / the safety backup.
 */
async function restoreBackup(site: Site, id: string, log: HostLogger, opts: { safety?: boolean } = {}): Promise<{ safetyId: string }> {
  await assertSiteRoot(site, false);
  const store = storage();
  const src = await store.open(site.domain, id);
  try {
    const m = src.manifest;
    if (!m) throw conflict(t('Bản sao lưu {id} bị hỏng (manifest.json không hợp lệ)', { id }));
    if (m.site.domain !== site.domain && m.site.id !== site.id) throw conflict(t('Bản sao lưu {id} thuộc site {domain}, không phải site này', { id, domain: m.site.domain }));
    const archive = path.join(src.dir, m.files.file);
    for (const f of [m.files.file, ...m.databases.map((d) => d.file)]) {
      if (!(await host.exists(path.join(src.dir, f)))) throw conflict(t('Bản sao lưu {id} thiếu file {file}', { id, file: f }));
    }
    log(t('Kiểm tra bản sao lưu {id}...', { id }));
    for (const d of m.databases) {
      const r = await host.exec(`gzip -t ${shq(path.join(src.dir, d.file))}`);
      if (r.code !== 0) throw conflict(t('File {file} bị hỏng (gzip -t thất bại)', { file: d.file }));
    }

    const parent = path.dirname(site.rootPath);
    await fs.mkdir(parent, { recursive: true });
    const free = await freeBytes(localExecutor, parent);
    if (free !== null && m.files.sourceBytes > free * 0.95) {
      throw conflict(t('Không đủ dung lượng để giải nén bản sao lưu: cần khoảng {needed}, còn trống {free} tại {path}', { needed: fmtSize(m.files.sourceBytes), free: fmtSize(free), path: parent }));
    }

    // 1. safety backup of the current state (skipped when the site directory is gone)
    let safetyId = '';
    if (opts.safety === false) {
      log(t('Bước 1/4: bỏ qua bản sao lưu an toàn (trạng thái hiện tại là bản cập nhật lỗi)'));
    } else if (await host.exists(site.rootPath)) {
      log(t('Bước 1/4: tạo bản sao lưu an toàn của trạng thái hiện tại...'));
      safetyId = (await createBackup(site, 'safety', log, { protect: id })).id;
    } else {
      log(t('Cảnh báo: thư mục site không tồn tại - bỏ qua bản sao lưu an toàn'));
    }

    // 2. extract next to the site (same filesystem, so the swap is a rename)
    const tag = `${site.domain}-${randomBytes(4).toString('hex')}`;
    const tmp = path.join(parent, `.lares-restore-${tag}`);
    const old = path.join(parent, `.lares-old-${tag}`);
    const relWeb = path.relative(site.rootPath, site.webRoot);
    let swapped = false;
    let hadRoot = false;
    let movedNodeModules = false;
    let stopped = false;
    const touched: DbTarget[] = [];
    try {
      log(t('Bước 2/4: giải nén file ({size})...', { size: fmtSize(m.files.bytes) }));
      await fs.mkdir(tmp, { mode: 0o700 });
      await host.run(`tar -xzpf ${shq(archive)} --no-same-owner -C ${shq(tmp)}`, { timeoutMs: LONG });
      const targets = await resolveDbTargets(site, m, tmp, log);

      const reuseNodeModules =
        site.appType === 'nextjs' &&
        isInside(site.rootPath, site.webRoot) &&
        (await host.exists(path.join(site.webRoot, 'node_modules'))) &&
        !(await host.exists(path.join(tmp, relWeb, 'node_modules'))) &&
        (await sameDependencies(site.webRoot, path.join(tmp, relWeb)));

      // 3. swap the directories
      log(t('Bước 3/4: thay thư mục site bằng bản khôi phục...'));
      if (site.appType === 'nextjs') stopped = await nodeapp.serviceAction(site.domain, 'stop', log).then(() => true, () => false);
      hadRoot = await host.exists(site.rootPath);
      if (hadRoot) await fs.rename(site.rootPath, old);
      try {
        await fs.rename(tmp, site.rootPath);
      } catch (err) {
        if (hadRoot) await fs.rename(old, site.rootPath);
        throw err;
      }
      swapped = true;
      if (reuseNodeModules) {
        await fs.rename(path.join(old, relWeb, 'node_modules'), path.join(site.webRoot, 'node_modules'));
        movedNodeModules = true;
        log(t('Dùng lại node_modules hiện có (dependencies không đổi)'));
      }

      // 4. databases
      log(t('Bước 4/4: khôi phục database...'));
      if (!targets.length) log(t('Không có database cần khôi phục'));
      for (const tg of targets) {
        if (!tg.managed) log(t('Cảnh báo: database {name} không do Lares tạo - chỉ ghi đè các bảng có trong bản sao lưu, bảng khác được giữ nguyên', { name: tg.name }));
        log(t('Đang import database {name}...', { name: tg.name }));
        touched.push(tg);
        await importDb(tg, path.join(src.dir, tg.file), log);
        log(t('Đã khôi phục database {name}', { name: tg.name }));
      }
    } catch (err) {
      log(t('LỖI: {error}', { error: errorMessage(err) }));
      await rollback({ site, parent, tag, old, relWeb, swapped, hadRoot, movedNodeModules, stopped, touched, safetyId, store, log });
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        safetyId
          ? t('Khôi phục thất bại: {error}. Bản sao lưu an toàn {id} được giữ lại.', { error: errorMessage(err), id: safetyId })
          : t('Khôi phục thất bại: {error}', { error: errorMessage(err) }),
      );
    }

    // Files and data are back. What follows only restarts things: failures are reported, not rolled back.
    const warn = (what: string, err: unknown) => log(t('Cảnh báo: {what} thất bại: {error}', { what, error: errorMessage(err) }));
    await sites.fixPermissions(site.rootPath, log).catch((e) => warn(t('phân quyền'), e));
    if (hadRoot) await fs.rm(old, { recursive: true, force: true }).catch((e) => warn(t('xoá thư mục cũ'), e));
    if (site.appType === 'nextjs' && site.appPort) {
      const ready = (await host.exists(path.join(site.webRoot, 'node_modules'))) && (await host.exists(path.join(site.webRoot, '.next')));
      if (ready) await nodeapp.serviceAction(site.domain, 'restart', log).catch((e) => warn(t('khởi động lại {service}', { service: nodeapp.serviceName(site.domain) }), e));
      else {
        log(t('Cài dependencies và build lại ứng dụng Next.js...'));
        await nodeapp.buildAndRestart({ ...site, appPort: site.appPort }, sites.getNodeConfig(site.id), log).catch((e) => warn('build', e));
      }
    }
    if (site.phpVersion) await host.mutate(`systemctl reload ${shq(`php${site.phpVersion}-fpm`)}`, { log }).catch((e) => warn('php-fpm reload', e));
    await sites.applySiteVhost(sites.getSite(site.id), log).catch((e) => warn('nginx', e));
    log(t('Đã khôi phục {domain} từ bản sao lưu {id}', { domain: site.domain, id }));
    return { safetyId };
  } finally {
    await src.release();
  }
}

/** Put the previous tree back and re-import the databases from the safety backup. */
async function rollback(s: {
  site: Site;
  parent: string;
  tag: string;
  old: string;
  relWeb: string;
  swapped: boolean;
  hadRoot: boolean;
  movedNodeModules: boolean;
  /** the Next.js service was stopped for the swap */
  stopped: boolean;
  touched: DbTarget[];
  safetyId: string;
  store: BackupStorage;
  log: HostLogger;
}) {
  const { site, log } = s;
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      log(t('Hoàn tác: {label}', { label }));
    } catch (err) {
      log(t('LỖI: hoàn tác "{label}" thất bại: {error}', { label, error: errorMessage(err) }));
    }
  };
  if (s.swapped) {
    if (s.movedNodeModules) await step('node_modules', () => fs.rename(path.join(site.webRoot, 'node_modules'), path.join(s.old, s.relWeb, 'node_modules')));
    const failed = path.join(s.parent, `.lares-failed-${s.tag}`);
    await step(t('đặt lại thư mục site cũ'), async () => {
      await fs.rename(site.rootPath, failed);
      if (s.hadRoot) await fs.rename(s.old, site.rootPath);
      await fs.rm(failed, { recursive: true, force: true });
    });
  }
  if (s.touched.length) {
    if (!s.safetyId) {
      log(t('LỖI: không có bản sao lưu an toàn để hoàn tác database'));
    } else {
      const safety = await s.store.open(site.domain, s.safetyId).catch(() => null);
      try {
        for (const tg of s.touched) {
          const d = safety?.manifest?.databases.find((x) => x.name === tg.name);
          if (!safety || !d) {
            log(t('LỖI: bản sao lưu an toàn không có database {name} - hãy kiểm tra thủ công', { name: tg.name }));
            continue;
          }
          await step(t('database {name}', { name: tg.name }), () => importDb(tg, path.join(safety.dir, d.file), log));
        }
      } finally {
        await safety?.release();
      }
    }
  }
  if (s.stopped) await step(t('khởi động lại {service}', { service: nodeapp.serviceName(site.domain) }), () => nodeapp.serviceAction(site.domain, 'restart', log));
}

export function startRestore(siteId: number, id: string): TaskInfo {
  const site = sites.getSite(siteId);
  return startLocked(site, 'restore', t('Khôi phục {domain} từ {id}', { domain: site.domain, id }), (log) => restoreBackup(site, id, log));
}

// ---- API for other site jobs (call inside startLocked) ------------------------------------

/** Take a backup while already holding the site's lock. */
export const takeBackup = (site: Site, trigger: BackupTrigger, log: HostLogger) => createBackup(site, trigger, log);

/**
 * Restore while already holding the site's lock. `safety: false` skips the safety backup of the
 * current state (used to undo a failed WordPress update: that state is the broken one).
 */
export const restoreFromBackup = (site: Site, id: string, log: HostLogger, opts: { safety?: boolean } = {}) => restoreBackup(site, id, log, opts);

// ---- Scheduler --------------------------------------------------------------------------

let ticking = false;

/** One scheduled backup as a regular task (so its log can be followed in the UI); resolves when done. */
function runScheduled(site: Site): Promise<void> {
  return new Promise((resolve) => {
    try {
      startLocked(site, 'backup', t('Sao lưu tự động {domain}', { domain: site.domain }), async (log) => {
        try {
          const entry = await createBackup(site, 'scheduled', log);
          recordResult(site.id, 'ok', null);
          return entry;
        } catch (err) {
          recordResult(site.id, 'failed', errorMessage(err));
          throw err;
        } finally {
          resolve();
        }
      });
    } catch {
      resolve();
    }
  });
}

/** Run every due site, one after another. Exported for tests / manual triggering. */
export async function schedulerTick(now = new Date()) {
  if (ticking) return;
  ticking = true;
  try {
    for (const site of sites.listSites()) {
      const settings = getBackupSettings();
      if (!settings.enabled) return;
      const prefs = sitePrefs(site.id);
      if (!prefs.scheduled || running.has(site.id) || !isDue(now, settings.time, prefs.last_run_date)) continue;
      upsertPref(site.id, 'last_run_date', localDate(now));
      await runScheduled(site);
    }
  } finally {
    ticking = false;
  }
}

export async function startBackupScheduler(log: HostLogger) {
  try {
    const removed = await storage().cleanupPartials();
    if (removed) log(t('Đã dọn {count} bản sao lưu dang dở', { count: removed }));
  } catch (err) {
    log(t('Cảnh báo: thư mục sao lưu: {error}', { error: errorMessage(err) }));
  }
  setInterval(() => void schedulerTick().catch((err) => log(`backup scheduler: ${errorMessage(err)}`)), 60_000).unref();
}
