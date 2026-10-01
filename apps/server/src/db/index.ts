import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from '../config.js';

export const db = new Database(path.join(config.dataDir, 'tpanel.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_enc TEXT NOT NULL,
  panel TEXT NOT NULL,
  same_host INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  options_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  root_path TEXT NOT NULL,
  web_root TEXT NOT NULL,
  php_version TEXT,
  app_type TEXT NOT NULL DEFAULT 'php',
  app_port INTEGER UNIQUE,
  app_config_enc TEXT,
  ssl_json TEXT NOT NULL DEFAULT '{}',
  access_log INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  migration_id INTEGER REFERENCES migrations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS databases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  managed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migration_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id INTEGER NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
  source_domain TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  source_root TEXT NOT NULL,
  app_type TEXT NOT NULL,
  input_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,
  steps_json TEXT NOT NULL,
  notes_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS migration_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id INTEGER NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
  item_id INTEGER,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_migration_logs_mid ON migration_logs(migration_id, id);
`);

/** Additive schema migrations for databases created by older versions. */
function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('sites', 'listen_port', 'INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_listen_port ON sites(listen_port) WHERE listen_port IS NOT NULL');

export const nowIso = () => new Date().toISOString();

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}
