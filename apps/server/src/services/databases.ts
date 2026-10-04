import type { DatabaseRecord } from '@lares/shared';
import { db } from '../db/index.js';
import { t } from '../i18n/index.js';
import { decrypt, encrypt, randomPassword, randomSuffix } from '../lib/crypto.js';
import { conflict, notFound } from '../lib/errors.js';
import type { HostLogger } from './host.js';
import * as mysql from './mysql.js';

interface DbRow {
  id: number;
  name: string;
  username: string;
  password_enc: string;
  site_id: number | null;
  managed: number;
  created_at: string;
  site_domain?: string | null;
}

const toRecord = (r: DbRow): DatabaseRecord => ({
  id: r.id,
  name: r.name,
  username: r.username,
  siteId: r.site_id,
  siteDomain: r.site_domain ?? null,
  managed: r.managed === 1,
  createdAt: r.created_at,
});

const SELECT = 'SELECT d.*, s.domain AS site_domain FROM databases d LEFT JOIN sites s ON s.id = d.site_id';

export function listDatabases(): DatabaseRecord[] {
  return (db.prepare(`${SELECT} ORDER BY d.id DESC`).all() as DbRow[]).map(toRecord);
}

export function databasesForSite(siteId: number): DatabaseRecord[] {
  return (db.prepare(`${SELECT} WHERE d.site_id = ?`).all(siteId) as DbRow[]).map(toRecord);
}

export function getDatabaseCredentials(id: number) {
  const row = db.prepare('SELECT * FROM databases WHERE id = ?').get(id) as DbRow | undefined;
  if (!row) throw notFound(t('Database không tồn tại'));
  return { name: row.name, username: row.username, password: decrypt<string>(row.password_enc) };
}

/** Name derived from the domain, e.g. shop.example.com -> shop_example_com_3fa1 (<= 32 chars for MySQL users). */
export function deriveDbName(domain: string): string {
  const base = domain.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(0, 26).replace(/_$/, '');
  return `${base}_${randomSuffix(4)}`;
}

export async function createDatabase(
  input: { name: string; username: string; password?: string; siteId?: number | null },
  log?: HostLogger,
): Promise<{ record: DatabaseRecord; password: string }> {
  if (db.prepare('SELECT 1 FROM databases WHERE name = ?').get(input.name) || (await mysql.databaseExists(input.name))) {
    throw conflict(t('Database {name} đã tồn tại', { name: input.name }));
  }
  const password = input.password ?? randomPassword();
  await mysql.createDatabase(input.name, input.username, password, log);
  const info = db
    .prepare('INSERT INTO databases (name, username, password_enc, site_id, managed) VALUES (?, ?, ?, ?, 1)')
    .run(input.name, input.username, encrypt(password), input.siteId ?? null);
  const row = db.prepare(`${SELECT} WHERE d.id = ?`).get(info.lastInsertRowid) as DbRow;
  return { record: toRecord(row), password };
}

/** Register a database Lares did not create (reused from a co-located panel). It is never dropped. */
export function registerExternalDatabase(name: string, username: string, password: string, siteId: number) {
  db.prepare(
    `INSERT INTO databases (name, username, password_enc, site_id, managed) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(name) DO UPDATE SET site_id = excluded.site_id`,
  ).run(name, username, encrypt(password), siteId);
}

export function attachDatabaseToSite(name: string, siteId: number) {
  db.prepare('UPDATE databases SET site_id = ? WHERE name = ?').run(siteId, name);
}

export async function deleteDatabase(id: number, log?: HostLogger) {
  const row = db.prepare('SELECT * FROM databases WHERE id = ?').get(id) as DbRow | undefined;
  if (!row) throw notFound(t('Database không tồn tại'));
  if (row.managed) await mysql.dropDatabase(row.name, row.username, log);
  db.prepare('DELETE FROM databases WHERE id = ?').run(id);
}
