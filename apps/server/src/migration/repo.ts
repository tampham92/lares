import {
  MIGRATION_STEPS,
  type CreateMigrationInput,
  type ItemStatus,
  type Migration,
  type MigrationItem,
  type MigrationItemInput,
  type MigrationLog,
  type MigrationOptions,
  type MigrationStatus,
  type MigrationStepId,
  type PanelType,
  type SourceInput,
  type StepState,
} from '@lares/shared';
import { db, nowIso } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { t } from '../i18n/index.js';
import { notFound } from '../lib/errors.js';
import { emitMigration } from './events.js';

interface MigrationRow {
  id: number;
  name: string;
  source_label: string;
  source_enc: string;
  panel: PanelType;
  same_host: number;
  status: MigrationStatus;
  options_json: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface ItemRow {
  id: number;
  migration_id: number;
  source_domain: string;
  target_domain: string;
  source_root: string;
  app_type: MigrationItem['appType'];
  input_enc: string;
  status: ItemStatus;
  current_step: MigrationStepId | null;
  steps_json: string;
  notes_json: string;
  error: string | null;
  site_id: number | null;
}

interface LogRow {
  id: number;
  migration_id: number;
  item_id: number | null;
  level: MigrationLog['level'];
  message: string;
  created_at: string;
}

export const initialSteps = (): Record<MigrationStepId, StepState> =>
  Object.fromEntries(MIGRATION_STEPS.map((s) => [s.id, { status: 'pending' }])) as Record<MigrationStepId, StepState>;

const toItem = (r: ItemRow): MigrationItem => ({
  id: r.id,
  migrationId: r.migration_id,
  sourceDomain: r.source_domain,
  targetDomain: r.target_domain,
  sourceRoot: r.source_root,
  appType: r.app_type,
  status: r.status,
  currentStep: r.current_step,
  steps: JSON.parse(r.steps_json) as Record<MigrationStepId, StepState>,
  notes: JSON.parse(r.notes_json) as string[],
  error: r.error,
  siteId: r.site_id,
});

const toMigration = (r: MigrationRow): Migration => ({
  id: r.id,
  name: r.name,
  sourceLabel: r.source_label,
  panel: r.panel,
  sameHost: r.same_host === 1,
  status: r.status,
  options: JSON.parse(r.options_json) as MigrationOptions,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const toLog = (r: LogRow): MigrationLog => ({
  id: r.id,
  migrationId: r.migration_id,
  itemId: r.item_id,
  level: r.level,
  message: r.message,
  createdAt: r.created_at,
});

export function sourceLabel(source: SourceInput): string {
  const c = source.connection;
  return c.mode === 'local' ? t('localhost (cùng VPS)') : `${c.username}@${c.host}:${c.port}`;
}

export function insertMigration(input: CreateMigrationInput, meta: { sameHost: boolean; panel: PanelType }): number {
  const tx = db.transaction(() => {
    const label = sourceLabel(input.source);
    const info = db
      .prepare('INSERT INTO migrations (name, source_label, source_enc, panel, same_host, options_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        input.name || t('Chuyển {count} site từ {source}', { count: input.items.length, source: label }),
        label,
        encrypt(input.source),
        meta.panel,
        meta.sameHost ? 1 : 0,
        JSON.stringify(input.options),
      );
    const mid = Number(info.lastInsertRowid);
    const stmt = db.prepare(
      `INSERT INTO migration_items (migration_id, source_domain, target_domain, source_root, app_type, input_enc, steps_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of input.items) {
      stmt.run(mid, it.sourceDomain, it.targetDomain, it.sourceRoot, it.appType, encrypt(it), JSON.stringify(initialSteps()));
    }
    return mid;
  });
  return tx();
}

export function listMigrations(): Migration[] {
  const rows = db.prepare('SELECT * FROM migrations ORDER BY id DESC LIMIT 200').all() as MigrationRow[];
  const counts = db.prepare('SELECT migration_id, status, COUNT(*) AS c FROM migration_items GROUP BY migration_id, status').all() as Array<{
    migration_id: number;
    status: ItemStatus;
    c: number;
  }>;
  return rows.map((r) => {
    const m = toMigration(r);
    const mine = counts.filter((c) => c.migration_id === r.id);
    return { ...m, itemCounts: Object.fromEntries(mine.map((c) => [c.status, c.c])) };
  });
}

export function getMigration(id: number, withItems = true): Migration {
  const row = db.prepare('SELECT * FROM migrations WHERE id = ?').get(id) as MigrationRow | undefined;
  if (!row) throw notFound(t('Migration không tồn tại'));
  const m = toMigration(row);
  if (withItems) m.items = (db.prepare('SELECT * FROM migration_items WHERE migration_id = ? ORDER BY id').all(id) as ItemRow[]).map(toItem);
  return m;
}

export function getSourceInput(id: number): SourceInput {
  const row = db.prepare('SELECT source_enc FROM migrations WHERE id = ?').get(id) as { source_enc: string } | undefined;
  if (!row) throw notFound(t('Migration không tồn tại'));
  return decrypt<SourceInput>(row.source_enc);
}

export function getItemInput(itemId: number): MigrationItemInput {
  const row = db.prepare('SELECT input_enc FROM migration_items WHERE id = ?').get(itemId) as { input_enc: string };
  return decrypt<MigrationItemInput>(row.input_enc);
}

export function getItem(itemId: number): MigrationItem {
  const row = db.prepare('SELECT * FROM migration_items WHERE id = ?').get(itemId) as ItemRow | undefined;
  if (!row) throw notFound(t('Item không tồn tại'));
  return toItem(row);
}

export function updateMigration(
  id: number,
  patch: Partial<{ status: MigrationStatus; error: string | null; startedAt: string | null; finishedAt: string | null; sameHost: boolean }>,
) {
  const map: Record<string, string> = { status: 'status', error: 'error', startedAt: 'started_at', finishedAt: 'finished_at', sameHost: 'same_host' };
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  const values = keys.map((k) => (k === 'sameHost' ? (patch[k] ? 1 : 0) : (patch[k] ?? null)));
  db.prepare(`UPDATE migrations SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  emitMigration(id, { type: 'migration', migration: getMigration(id, false) });
}

export function saveItem(item: MigrationItem) {
  db.prepare('UPDATE migration_items SET status = ?, current_step = ?, steps_json = ?, notes_json = ?, error = ?, site_id = ? WHERE id = ?').run(
    item.status,
    item.currentStep,
    JSON.stringify(item.steps),
    JSON.stringify(item.notes),
    item.error,
    item.siteId,
    item.id,
  );
  emitMigration(item.migrationId, { type: 'item', item });
}

export function resetItemsForRetry(migrationId: number): number {
  const info = db
    .prepare(
      `UPDATE migration_items SET status = 'pending', current_step = NULL, error = NULL, site_id = NULL, notes_json = '[]', steps_json = ?
       WHERE migration_id = ? AND status IN ('failed', 'cancelled')`,
    )
    .run(JSON.stringify(initialSteps()), migrationId);
  return info.changes;
}

export function addLog(migrationId: number, itemId: number | null, level: MigrationLog['level'], message: string): MigrationLog {
  const info = db.prepare('INSERT INTO migration_logs (migration_id, item_id, level, message) VALUES (?, ?, ?, ?)').run(migrationId, itemId, level, message);
  const log = toLog(db.prepare('SELECT * FROM migration_logs WHERE id = ?').get(info.lastInsertRowid) as LogRow);
  emitMigration(migrationId, { type: 'log', log });
  return log;
}

export function listLogs(migrationId: number, opts: { afterId?: number; limit?: number; itemId?: number } = {}): MigrationLog[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM migration_logs WHERE migration_id = ? AND id > ? ${opts.itemId ? 'AND item_id = ?' : ''}
         ORDER BY id DESC LIMIT ?
       ) ORDER BY id`,
    )
    .all(...[migrationId, opts.afterId ?? 0, ...(opts.itemId ? [opts.itemId] : []), opts.limit ?? 500]) as LogRow[];
  return rows.map(toLog);
}

export function deleteMigration(id: number) {
  db.prepare('DELETE FROM migrations WHERE id = ?').run(id);
}

/** Jobs cannot survive a restart (open SSH sessions are gone) - mark them failed so the user can retry. */
export function failInterruptedMigrations() {
  const msg = t('Lares bị khởi động lại khi migration đang chạy');
  db.prepare(`UPDATE migration_items SET status = 'failed', error = ? WHERE status = 'running'`).run(msg);
  db.prepare(`UPDATE migrations SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('running', 'pending')`).run(msg, nowIso());
}
