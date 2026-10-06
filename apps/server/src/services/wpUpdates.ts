import fs from 'node:fs/promises';
import path from 'node:path';
import {
  WP_MARKER_LABELS,
  wpPendingCount,
  type Site,
  type WpHealthProblem,
  type WpInventory,
  type WpUpdateItem,
  type WpUpdateRequest,
  type WpUpdateRun,
  type WpUpdateRunStatus,
  type WpUpdatesResponse,
  type WpUpdatesSummaryItem,
} from '@lares/shared';
import { config } from '../config.js';
import { db, nowIso } from '../db/index.js';
import { t } from '../i18n/index.js';
import { badRequest, conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import * as backups from './backups.js';
import { host, type HostLogger } from './host.js';
import * as sites from './sites.js';
import type { TaskInfo } from './tasks.js';
import { wpCliAsWebUser } from './wordpress.js';
import { markLogs, takeHealth } from './wpHealth.js';
import * as policy from './wpUpdatePolicy.js';

/*
 * WordPress updates with automatic rollback. A run, holding the site's backup/restore lock:
 *   1. health baseline (home page, wp-login.php, error logs)   2. pre-update backup (abort on failure)
 *   3. wp core update + update-db, plugin update, theme update  4. health check again
 *   5. on a regression: restore the backup, check again, say which item broke the site.
 * `.maintenance` is removed on every path. Inventory (versions + available updates) is cached.
 */

const INTERRUPTED = '__interrupted__';
const WP_TIMEOUT = 120_000;
const UPDATE_TIMEOUT = 20 * 60_000;
const pause = (ms: number) => (config.dryRun ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

function assertWordpress(site: Site) {
  if (site.appType !== 'wordpress') throw conflict(t('Chỉ áp dụng cho site WordPress'));
}

async function requireWpCli() {
  if (!config.dryRun && !(await host.has('wp'))) throw conflict(t('Cần cài wp-cli trên máy chủ (installer của Lares tự cài - chạy lại install.sh)'));
}

/** wp-cli as the web user (site code is untrusted), plugins and themes not loaded. */
const wp = (site: Site, args: string, opts: { timeoutMs?: number; log?: HostLogger } = {}) => {
  let partial = '';
  return host.exec(wpCliAsWebUser(site.webRoot, site.rootPath, args), {
    timeoutMs: opts.timeoutMs ?? WP_TIMEOUT,
    // stream wp-cli progress ("Downloading update...") into the task log, without the JSON summary
    onOutput: opts.log
      ? (chunk) => {
          const lines = (partial + chunk).split('\n');
          partial = lines.pop() ?? '';
          for (const l of lines.map((x) => x.trim())) if (l && !l.startsWith('[') && !l.startsWith('{')) opts.log!(`  ${l}`);
        }
      : undefined,
  });
};

const tail = (r: { stdout: string; stderr: string; code: number }) =>
  (r.stderr.trim() || r.stdout.trim()).split('\n').filter((l) => !l.trim().startsWith('[')).slice(-3).join(' ').slice(0, 500) || `exit ${r.code}`;

// ---- Dry-run stand-in ---------------------------------------------------------------------

/** Per-site fake WordPress for development on a laptop: updates change it, a rollback puts it back. */
const dryState = new Map<number, WpInventory>();

function dryInventory(site: Site): WpInventory {
  if (!dryState.has(site.id)) {
    dryState.set(site.id, {
      core: { version: '6.6.2', update: '6.7.1' },
      plugins: [
        { slug: 'akismet', title: 'Akismet Anti-spam: Spam Protection', status: 'active', version: '5.3', update: '5.3.5', autoUpdate: false },
        { slug: 'classic-editor', title: 'Classic Editor', status: 'inactive', version: '1.6.5', update: null, autoUpdate: true },
        { slug: 'woocommerce', title: 'WooCommerce', status: 'active', version: '9.2.3', update: '9.3.1', autoUpdate: false },
      ],
      themes: [
        { slug: 'twentytwentyfour', title: 'Twenty Twenty-Four', status: 'active', version: '1.2', update: '1.3', autoUpdate: false },
        { slug: 'twentytwentythree', title: 'Twenty Twenty-Three', status: 'inactive', version: '1.5', update: null, autoUpdate: false },
      ],
    });
  }
  return structuredClone(dryState.get(site.id)!);
}

function dryApply(site: Site, item: WpUpdateItem) {
  const inv = dryInventory(site);
  if (item.type === 'core') inv.core = { version: item.to ?? inv.core.version, update: null };
  for (const x of item.type === 'plugin' ? inv.plugins : item.type === 'theme' ? inv.themes : []) {
    if (x.slug === item.slug) Object.assign(x, { version: item.to ?? x.version, update: null });
  }
  dryState.set(site.id, inv);
}

// ---- Inventory ----------------------------------------------------------------------------

const LIST_FIELDS = '--fields=name,title,status,version,update,update_version,auto_update';
const LIST_FIELDS_OLD = '--fields=name,status,version,update,update_version';

async function listExtensions(site: Site, kind: 'plugin' | 'theme', skipCheck: boolean) {
  const extra = skipCheck ? ' --skip-update-check' : '';
  let r = await wp(site, `${kind} list --format=json ${LIST_FIELDS}${extra}`);
  // wp-cli < 2.5 has no auto_update field (and no --skip-update-check)
  if (r.code !== 0) r = await wp(site, `${kind} list --format=json ${LIST_FIELDS_OLD}`);
  const list = r.code === 0 ? policy.parseExtensionList(r.stdout) : null;
  if (!list) throw new Error(t('wp-cli không đọc được danh sách {kind}: {error}', { kind, error: tail(r) }));
  return list;
}

/**
 * Versions and available updates, read with wp-cli. `skipCheck` uses WordPress' cached update data
 * instead of asking wordpress.org again (right after an update, which refreshed it).
 */
async function readInventory(site: Site, opts: { skipCheck?: boolean } = {}): Promise<WpInventory> {
  if (config.dryRun) return dryInventory(site);
  await requireWpCli();
  const coreCheck = async () => {
    if (opts.skipCheck) return wp(site, 'core check-update --format=json');
    const r = await wp(site, 'core check-update --force-check --format=json');
    return r.code === 0 ? r : wp(site, 'core check-update --format=json');
  };
  const [ver, check, plugins, themes] = await Promise.all([
    wp(site, 'core version'),
    coreCheck(),
    listExtensions(site, 'plugin', !!opts.skipCheck),
    listExtensions(site, 'theme', !!opts.skipCheck),
  ]);
  const version = ver.code === 0 ? policy.parseCoreVersion(ver.stdout) : null;
  if (!version) throw new Error(t('wp-cli không đọc được phiên bản WordPress: {error}', { error: tail(ver) }));
  const update = check.code === 0 ? policy.parseCoreCheckUpdate(check.stdout) : null;
  return { core: { version, update: update && policy.compareVersions(update, version) > 0 ? update : null }, plugins, themes };
}

function saveInventory(siteId: number, inv: WpInventory | null, error: string | null) {
  db.prepare(
    `INSERT INTO wp_update_inventory (site_id, data_json, checked_at, error) VALUES (?, ?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET data_json = COALESCE(excluded.data_json, data_json), checked_at = excluded.checked_at, error = excluded.error`,
  ).run(siteId, inv ? JSON.stringify(inv) : null, nowIso(), error);
}

function cachedInventory(siteId: number): { inventory: WpInventory | null; checkedAt: string | null; error: string | null } {
  const row = db.prepare('SELECT data_json, checked_at, error FROM wp_update_inventory WHERE site_id = ?').get(siteId) as
    | { data_json: string | null; checked_at: string; error: string | null }
    | undefined;
  if (!row) return { inventory: null, checkedAt: null, error: null };
  let inventory: WpInventory | null = null;
  try {
    inventory = row.data_json ? (JSON.parse(row.data_json) as WpInventory) : null;
  } catch {
    /* unreadable cache: treated as never checked */
  }
  return { inventory, checkedAt: row.checked_at, error: row.error };
}

const checking = new Map<number, Promise<void>>();

/** Read the inventory now and cache it (or the error). Concurrent calls for one site share the work. */
async function refreshInventory(site: Site): Promise<void> {
  const current = checking.get(site.id);
  if (current) return current;
  const job = readInventory(site)
    .then((inv) => saveInventory(site.id, inv, null))
    .catch((err) => saveInventory(site.id, null, errorMessage(err)))
    .finally(() => checking.delete(site.id));
  checking.set(site.id, job);
  return job;
}

export async function checkInventory(siteId: number): Promise<WpUpdatesResponse> {
  const site = sites.getSite(siteId);
  assertWordpress(site);
  if (backups.runningJob(site.id)?.kind === 'update') throw conflict(t('{domain} đang cập nhật WordPress - hãy đợi nó xong', { domain: site.domain }));
  await requireWpCli();
  await refreshInventory(site);
  return siteUpdates(siteId);
}

// ---- History ------------------------------------------------------------------------------

interface RunRow {
  id: number;
  task_id: string | null;
  status: WpUpdateRunStatus;
  items_json: string;
  backup_id: string | null;
  error: string | null;
  details_json: string;
  started_at: string;
  finished_at: string | null;
}

interface RunDetails {
  problems?: WpHealthProblem[];
  culprit?: WpUpdateRun['culprit'];
  stillBroken?: boolean;
}

function toRun(r: RunRow): WpUpdateRun {
  const details = JSON.parse(r.details_json || '{}') as RunDetails;
  return {
    id: r.id,
    taskId: r.task_id,
    status: r.status,
    items: JSON.parse(r.items_json) as WpUpdateItem[],
    backupId: r.backup_id,
    error:
      r.error === INTERRUPTED
        ? r.backup_id
          ? t('Bị gián đoạn vì panel khởi động lại - hãy kiểm tra site. Bản sao lưu {id} có ở tab Sao lưu.', { id: r.backup_id })
          : t('Bị gián đoạn vì panel khởi động lại trước khi cập nhật')
        : r.error,
    problems: details.problems ?? [],
    culprit: details.culprit ?? null,
    stillBroken: details.stillBroken ?? false,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function updateHistory(siteId: number, limit = 30): WpUpdateRun[] {
  return (db.prepare('SELECT * FROM wp_update_runs WHERE site_id = ? ORDER BY started_at DESC, id DESC LIMIT ?').all(siteId, limit) as RunRow[]).map(toRun);
}

function createRun(siteId: number, taskId: string | null, items: WpUpdateItem[]): number {
  return Number(
    db.prepare("INSERT INTO wp_update_runs (site_id, task_id, status, items_json, started_at) VALUES (?, ?, 'running', ?, ?)").run(siteId, taskId, JSON.stringify(items), nowIso()).lastInsertRowid,
  );
}

function saveRun(id: number, s: { status: WpUpdateRunStatus; items: WpUpdateItem[]; backupId: string | null; error?: string | null; details?: RunDetails }) {
  db.prepare('UPDATE wp_update_runs SET status = ?, items_json = ?, backup_id = ?, error = ?, details_json = ?, finished_at = ? WHERE id = ?').run(
    s.status,
    JSON.stringify(s.items),
    s.backupId,
    s.error ?? null,
    JSON.stringify(s.details ?? {}),
    s.status === 'running' ? null : nowIso(),
    id,
  );
}

const getRun = (id: number) => toRun(db.prepare('SELECT * FROM wp_update_runs WHERE id = ?').get(id) as RunRow);

export function siteUpdates(siteId: number): WpUpdatesResponse {
  const site = sites.getSite(siteId);
  assertWordpress(site);
  const cache = cachedInventory(site.id);
  return {
    inventory: cache.inventory,
    checkedAt: cache.checkedAt,
    checkError: cache.error,
    pending: wpPendingCount(cache.inventory),
    running: backups.runningJob(site.id),
    history: updateHistory(site.id),
  };
}

/** Pending update counts of every WordPress site (badges in the site list). */
export function updatesSummary(): WpUpdatesSummaryItem[] {
  const rows = db
    .prepare("SELECT s.id AS site_id, i.data_json, i.checked_at FROM sites s LEFT JOIN wp_update_inventory i ON i.site_id = s.id WHERE s.app_type = 'wordpress'")
    .all() as Array<{ site_id: number; data_json: string | null; checked_at: string | null }>;
  return rows.map((r) => {
    let pending = 0;
    try {
      pending = r.data_json ? wpPendingCount(JSON.parse(r.data_json) as WpInventory) : 0;
    } catch {
      /* unreadable cache */
    }
    return { siteId: r.site_id, pending, checkedAt: r.checked_at };
  });
}

// ---- Messages -----------------------------------------------------------------------------

const pageName = (page: 'home' | 'login') => (page === 'home' ? t('Trang chủ') : 'wp-login.php');
const statusText = (s: number | null) => (s === null ? t('không phản hồi') : `HTTP ${s}`);

export function describeProblem(p: WpHealthProblem, baseline = false): string {
  switch (p.code) {
    case 'status':
      return baseline
        ? t('{page}: {status}', { page: pageName(p.page), status: statusText(p.after) })
        : t('{page}: {after} (trước khi cập nhật: {before})', { page: pageName(p.page), after: statusText(p.after), before: statusText(p.before) });
    case 'marker':
      return t('{page} hiện {marker}', { page: pageName(p.page), marker: t(WP_MARKER_LABELS[p.marker] ?? p.marker) });
    case 'title':
      return baseline ? t('{page}: tiêu đề "{title}"', { page: pageName(p.page), title: p.after }) : t('{page}: tiêu đề đổi thành "{after}" (trước đó "{before}")', { page: pageName(p.page), after: p.after, before: p.before });
    case 'blank':
      return t('{page} trả về trang trắng', { page: pageName(p.page) });
    case 'fatal':
      return t('Lỗi PHP mới trong log: {line}', { line: p.line });
    case 'deactivated':
      return p.itemType === 'plugin' ? t('Plugin {slug} không còn được kích hoạt', { slug: p.slug }) : t('Theme {slug} không còn là theme đang dùng', { slug: p.slug });
  }
}

function describeCulprit(c: WpUpdateRun['culprit'], items: WpUpdateItem[]): string {
  if (!c) return t('Cập nhật làm site lỗi - đã khôi phục lại như trước.');
  const names = c.items.join(', ');
  if (c.kind === 'single') return t('Bản cập nhật {name} làm site lỗi - đã khôi phục lại như trước.', { name: names });
  const count = items.filter((i) => i.status === 'updated' || i.status === 'failed').length;
  if (c.kind === 'suspects') return t('Đã cập nhật {count} mục cùng lúc; log lỗi PHP chỉ ra {names}. Site đã được khôi phục - hãy cập nhật từng mục một để xác nhận.', { count, names });
  return t('Đã cập nhật {count} mục cùng lúc nên chưa rõ mục nào gây lỗi ({names}). Site đã được khôi phục - hãy cập nhật từng mục một.', { count, names });
}

const itemLabel = (i: WpUpdateItem) => `${i.type === 'core' ? 'WordPress' : `${i.type === 'plugin' ? 'Plugin' : 'Theme'} ${i.name}`} ${i.from} → ${i.to ?? '?'}`;

function logHealth(h: policy.HealthSnapshot, log: HostLogger) {
  for (const page of ['home', 'login'] as const) {
    const p = h[page];
    log(t('{page}: {status}{title}', { page: pageName(page), status: p.status === null ? `${statusText(null)} (${p.error ?? ''})` : statusText(p.status), title: p.title ? ` · "${p.title}"` : '' }));
  }
}

// ---- Maintenance mode ---------------------------------------------------------------------

/** WordPress shows "Briefly unavailable for scheduled maintenance" while `.maintenance` exists. */
async function clearMaintenance(site: Site, log?: HostLogger) {
  const file = path.join(site.webRoot, '.maintenance');
  if (!(await fs.lstat(file).then(() => true, () => false))) return;
  await fs.rm(file, { force: true });
  log?.(t('Đã gỡ chế độ bảo trì (.maintenance)'));
}

// ---- Applying updates ---------------------------------------------------------------------

async function wpUpdate(site: Site, args: string, log: HostLogger) {
  if (config.dryRun) {
    log(`[dry-run] wp ${args}`);
    return { stdout: '', stderr: '', code: 0 };
  }
  return wp(site, args, { timeoutMs: UPDATE_TIMEOUT, log });
}

/** core (+ update-db), then plugins, then themes. Item statuses are filled in; never throws for a failed item. */
async function applyUpdates(site: Site, items: WpUpdateItem[], log: HostLogger) {
  const core = items.find((i) => i.type === 'core');
  if (core) {
    log(t('Cập nhật WordPress {from} → {to}...', { from: core.from, to: core.to ?? '?' }));
    const r = await wpUpdate(site, 'core update', log);
    if (r.code === 0) {
      core.status = 'updated';
      if (config.dryRun) dryApply(site, core);
      const multisite = !config.dryRun && (await wp(site, 'core is-installed --network')).code === 0;
      const db = await wpUpdate(site, `core update-db${multisite ? ' --network' : ''}`, log);
      if (db.code !== 0) log(t('Cảnh báo: wp core update-db thất bại: {error}', { error: tail(db) }));
    } else {
      core.status = 'failed';
      core.error = tail(r);
      log(t('LỖI: cập nhật WordPress thất bại: {error}', { error: core.error }));
    }
  }

  for (const type of ['plugin', 'theme'] as const) {
    const list = items.filter((i) => i.type === type);
    if (!list.length) continue;
    log(type === 'plugin' ? t('Cập nhật {count} plugin: {names}', { count: list.length, names: list.map((i) => i.slug).join(', ') }) : t('Cập nhật {count} theme: {names}', { count: list.length, names: list.map((i) => i.slug).join(', ') }));
    const r = await wpUpdate(site, `${type} update ${list.map((i) => shq(i.slug)).join(' ')} --format=json`, log);
    const results = new Map(policy.parseUpdateResults(r.stdout).map((x) => [x.slug, x]));
    for (const item of list) {
      const res = results.get(item.slug);
      if (config.dryRun) {
        item.status = 'updated';
        dryApply(site, item);
      } else if (res?.status === 'updated') {
        item.status = 'updated';
        if (res.to) item.to = res.to;
      } else if ((!res || res.status === 'unchanged') && r.code === 0) {
        item.status = 'skipped';
      } else {
        item.status = 'failed';
        item.error = tail(r);
        log(t('LỖI: cập nhật {name} thất bại: {error}', { name: item.name, error: item.error }));
      }
    }
  }
}

/** Fill in the versions really installed now (wp-cli's own summary can be missing after an error). */
function reconcile(items: WpUpdateItem[], after: WpInventory) {
  for (const item of items) {
    const now = item.type === 'core' ? after.core.version : (item.type === 'plugin' ? after.plugins : after.themes).find((x) => x.slug === item.slug)?.version;
    if (!now) continue;
    if (now !== item.from) {
      item.to = now;
      if (item.status !== 'updated') item.status = 'updated';
    } else if (item.status === 'updated') {
      item.status = 'failed';
      item.error = t('phiên bản vẫn là {version}', { version: now });
    }
  }
}

interface Verdict {
  problems: WpHealthProblem[];
  inventory: WpInventory | null;
}

/** Health after the update, compared with the baseline; a failing check is repeated once to rule out a blip. */
async function verify(site: Site, baseline: policy.HealthSnapshot, before: WpInventory, items: WpUpdateItem[], log: HostLogger): Promise<Verdict> {
  // fresh PHP code: drop opcache entries of the replaced files (graceful reload)
  if (site.phpVersion) await host.mutate(`systemctl reload ${shq(`php${site.phpVersion}-fpm`)}`, { log }).catch(() => undefined);
  await pause(3000);
  let inventory: WpInventory | null = null;
  try {
    inventory = await readInventory(site, { skipCheck: true });
    reconcile(items, inventory);
  } catch (err) {
    log(t('Cảnh báo: không đọc được phiên bản sau khi cập nhật: {error}', { error: errorMessage(err) }));
  }
  const lost = inventory ? policy.lostItems(before, inventory) : [];
  const marks = await markLogs(site);
  let after = await takeHealth(site, marks);
  logHealth(after, log);
  let problems = [...lost, ...policy.compareHealth(baseline, after)];
  if (problems.length && problems.some((p) => p.code !== 'deactivated')) {
    log(t('Phát hiện bất thường - kiểm tra lại sau {seconds} giây để loại trừ lỗi thoáng qua...', { seconds: 5 }));
    await pause(5000);
    after = await takeHealth(site, marks);
    logHealth(after, log);
    problems = [...lost, ...policy.compareHealth(baseline, after)];
  }
  return { problems, inventory };
}

// ---- A run --------------------------------------------------------------------------------

async function runUpdate(site: Site, req: WpUpdateRequest, log: HostLogger): Promise<WpUpdateRun> {
  log(t('Đọc phiên bản hiện tại và các bản cập nhật...'));
  const before = await readInventory(site);
  saveInventory(site.id, before, null);
  const { items, missing } = policy.selectItems(before, req);
  for (const name of missing) log(t('Bỏ qua {name}: không có bản cập nhật', { name }));
  if (!items.length) throw conflict(t('Không có mục nào cần cập nhật'));

  const runId = createRun(site.id, backups.runningJob(site.id)?.taskId ?? null, items);
  let backupId: string | null = null;
  const done = (status: WpUpdateRunStatus, error: string | null, details: RunDetails = {}) => {
    saveRun(runId, { status, items, backupId, error, details });
    return getRun(runId);
  };
  log(t('Sẽ cập nhật {count} mục:', { count: items.length }));
  for (const i of items) log(`  • ${itemLabel(i)}`);

  let touched = false;
  let baseline: policy.HealthSnapshot | null = null;
  try {
    // 1. baseline
    log(t('Bước 1/5: ghi nhận tình trạng site trước khi cập nhật...'));
    baseline = await takeHealth(site);
    logHealth(baseline, log);
    const already = policy.baselineIssues(baseline);
    if (already.length) {
      log(t('Cảnh báo: site đã có lỗi trước khi cập nhật ({issues}) - chỉ những lỗi mới phát sinh mới bị coi là do cập nhật', { issues: already.map((p) => describeProblem(p, true)).join('; ') }));
    }

    // 2. backup
    log(t('Bước 2/5: sao lưu site (file + database) trước khi cập nhật...'));
    try {
      backupId = (await backups.takeBackup(site, 'pre-update', log)).id;
    } catch (err) {
      const error = t('Không tạo được bản sao lưu nên đã huỷ cập nhật (site không bị thay đổi): {error}', { error: errorMessage(err) });
      done('failed', error);
      throw new Error(error);
    }
    saveRun(runId, { status: 'running', items, backupId });

    // 3. updates
    log(t('Bước 3/5: cập nhật...'));
    touched = true;
    try {
      await applyUpdates(site, items, log);
    } finally {
      await clearMaintenance(site, log);
    }
    saveRun(runId, { status: 'running', items, backupId });

    // 4. check again
    log(t('Bước 4/5: kiểm tra lại site sau khi cập nhật...'));
    const verdict = await verify(site, baseline, before, items, log);

    if (!verdict.problems.length) {
      const updated = items.filter((i) => i.status === 'updated');
      const failed = items.filter((i) => i.status === 'failed');
      if (verdict.inventory) saveInventory(site.id, verdict.inventory, null);
      for (const i of updated) log(t('Đã cập nhật {item}', { item: itemLabel(i) }));
      for (const i of failed) log(t('Cảnh báo: không cập nhật được {name}: {error}', { name: i.name, error: i.error ?? '' }));
      if (!updated.length) {
        const error = t('Không cập nhật được mục nào - site vẫn chạy như trước');
        done('failed', error);
        throw new Error(error);
      }
      log(t('Site vẫn hoạt động bình thường. Hoàn tất cập nhật {count} mục.', { count: updated.length }));
      return done('success', failed.length ? t('{count} mục không cập nhật được', { count: failed.length }) : null);
    }

    // 5. roll back
    return await rollBack(site, { runId, items, backupId, baseline, before, problems: verdict.problems, log, done });
  } catch (err) {
    if (!touched || getRun(runId).status !== 'running') throw err;
    // something unexpected after the files were touched: put the backup back as well
    log(t('LỖI: {error}', { error: errorMessage(err) }));
    if (!backupId) throw err;
    return rollBack(site, { runId, items, backupId, baseline, before, problems: [], log, done, cause: errorMessage(err) });
  } finally {
    await clearMaintenance(site, log).catch(() => undefined);
  }
}

async function rollBack(
  site: Site,
  s: {
    runId: number;
    items: WpUpdateItem[];
    backupId: string;
    baseline: policy.HealthSnapshot | null;
    before: WpInventory;
    problems: WpHealthProblem[];
    log: HostLogger;
    done: (status: WpUpdateRunStatus, error: string | null, details?: RunDetails) => WpUpdateRun;
    /** Unexpected error that triggered the rollback (instead of a failed health check). */
    cause?: string;
  },
): Promise<WpUpdateRun> {
  const { items, backupId, log } = s;
  for (const p of s.problems) log(t('LỖI: {problem}', { problem: describeProblem(p) }));
  const culprit = s.cause ? null : policy.findCulprit(items, s.problems);
  log(t('Bước 5/5: khôi phục bản sao lưu {id}...', { id: backupId }));
  try {
    await backups.restoreFromBackup(site, backupId, log, { safety: false });
  } catch (err) {
    const error = t('Cập nhật làm site lỗi và khôi phục tự động thất bại: {error}. Bản sao lưu {id} vẫn còn - hãy khôi phục ở tab Sao lưu.', { error: errorMessage(err), id: backupId });
    s.done('failed', error, { problems: s.problems, culprit });
    throw new Error(error);
  } finally {
    await clearMaintenance(site, log).catch(() => undefined);
  }
  if (config.dryRun) dryState.set(site.id, structuredClone(s.before));

  // is the site back to how it was? (the restore is done: nothing below may undo it again)
  let stillBroken = false;
  try {
    if (s.baseline) {
      const restored = await takeHealth(site);
      logHealth(restored, log);
      const remaining = policy.compareHealth(s.baseline, restored);
      stillBroken = remaining.length > 0;
      if (stillBroken) log(t('Cảnh báo: site vẫn lỗi sau khi khôi phục ({issues}) - lỗi có thể không do bản cập nhật, hãy kiểm tra site', { issues: remaining.map((p) => describeProblem(p)).join('; ') }));
      else log(t('Site đã hoạt động lại như trước khi cập nhật'));
    }
    await refreshInventory(site);
  } catch (err) {
    log(t('Cảnh báo: {error}', { error: errorMessage(err) }));
  }

  const summary = s.cause ? t('Cập nhật bị lỗi ({error}) - đã khôi phục bản sao lưu {id}.', { error: s.cause, id: backupId }) : describeCulprit(culprit, items);
  s.done('rolled_back', s.cause ? summary : null, { problems: s.problems, culprit, stillBroken });
  // the task ends as failed so the log shows the rollback in red
  throw new Error(summary);
}

/** Start a safe update as a background task holding the site's backup/restore lock. */
export async function startUpdate(siteId: number, req: WpUpdateRequest): Promise<TaskInfo> {
  const site = sites.getSite(siteId);
  assertWordpress(site);
  if (!req.all && !req.core && !req.plugins.length && !req.themes.length) throw badRequest(t('Chưa chọn mục nào để cập nhật'));
  await requireWpCli();
  return backups.startLocked(site, 'update', t('Cập nhật WordPress {domain}', { domain: site.domain }), (log) => runUpdate(site, req, log));
}

// ---- Startup / background -----------------------------------------------------------------

/** Runs left 'running' by a panel restart: mark them interrupted and take the sites out of maintenance mode. */
export async function recoverInterruptedRuns(log: HostLogger) {
  const rows = db.prepare("SELECT id, site_id FROM wp_update_runs WHERE status = 'running'").all() as Array<{ id: number; site_id: number }>;
  for (const r of rows) {
    db.prepare("UPDATE wp_update_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(INTERRUPTED, nowIso(), r.id);
    try {
      await clearMaintenance(sites.getSite(r.site_id), log);
    } catch {
      /* site deleted meanwhile */
    }
    log(t('Lần cập nhật WordPress #{id} bị gián đoạn khi panel khởi động lại', { id: r.id }));
  }
}

const STALE_MS = 24 * 3_600_000;

/** Refresh the oldest inventory (one site per tick) so the site list badges stay current. */
export async function checkerTick(now = Date.now()) {
  const stale = updatesSummary()
    .filter((s) => !s.checkedAt || now - Date.parse(s.checkedAt) > STALE_MS)
    .sort((a, b) => (a.checkedAt ?? '').localeCompare(b.checkedAt ?? ''));
  for (const s of stale) {
    if (backups.runningJob(s.siteId)) continue;
    const site = sites.getSite(s.siteId);
    if (site.status !== 'active') continue;
    if (!config.dryRun && !(await host.has('wp'))) return;
    await refreshInventory(site);
    return;
  }
}

export function startWpUpdateChecker(log: HostLogger) {
  setInterval(() => void checkerTick().catch((err) => log(`wp update checker: ${errorMessage(err)}`)), 10 * 60_000).unref();
}
