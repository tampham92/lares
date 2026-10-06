import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from '../config.js';

export const db = new Database(path.join(config.dataDir, 'lares.db'));
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

// ---- Panel security: sessions, login lockout, two-factor auth ------------------------------
// token_version is embedded in every JWT; bumping it revokes all of a user's sessions.
ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
// TOTP secret (encrypted with lib/crypto). NULL = 2FA off. The pending secret waits for the first code.
ensureColumn('users', 'totp_secret_enc', 'TEXT');
ensureColumn('users', 'totp_pending_enc', 'TEXT');
ensureColumn('users', 'totp_last_step', 'INTEGER');
// JSON array of SHA-256 hashes of the unused recovery codes.
ensureColumn('users', 'recovery_codes_json', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS login_failures (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at INTEGER NOT NULL,
  locked_until INTEGER
);
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`);

// ---- Site backups (services/backups.ts) ------------------------------------
// Per-site schedule override and the last scheduled run. `last_run_date` (local YYYY-MM-DD) is
// written before a scheduled backup starts, so a restart never runs the same site twice a day.
db.exec(`
CREATE TABLE IF NOT EXISTS site_backups (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  scheduled INTEGER NOT NULL DEFAULT 1,
  last_run_date TEXT,
  last_status TEXT,
  last_error TEXT,
  last_run_at TEXT
);
`);

// ---- WordPress updates (services/wpUpdates.ts) ------------------------------
// Cached inventory (core/plugin/theme versions and available updates) per site, and the history of
// update runs. A run still 'running' at startup was interrupted by a panel restart.
db.exec(`
CREATE TABLE IF NOT EXISTS wp_update_inventory (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  data_json TEXT,
  checked_at TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS wp_update_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  task_id TEXT,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  backup_id TEXT,
  error TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wp_update_runs_site ON wp_update_runs(site_id, id);
`);

// ---- Lead capture: contact form submissions + notifications (services/leads.ts, leadNotify.ts) ----
// Leads hold personal data: they live only here and are purged after the retention period.
// site_id is nulled when a site is deleted; site_domain keeps the lead readable until it expires.
// Notifications are a durable queue (one row per lead and channel) so retries survive restarts.
// site_lead_settings.config_enc: per-site notification override (encrypted JSON, secrets inside).
db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  site_domain TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_site ON leads(site_id, id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS lead_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at INTEGER,
  sent_at TEXT,
  updated_at TEXT,
  UNIQUE(lead_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_lead_notifications_due ON lead_notifications(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS site_lead_settings (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'inherit',
  config_enc TEXT
);
`);

// ---- Site tools: per-site PHP settings (services/phpSettings.ts) -----------
// The values a site overrides (JSON, see phpSettingsSchema) and the nginx client_max_body_size
// derived from them when they were saved (MB), so rendering a vhost needs no php.ini lookup.
// Adminer state and the onboarding dismissal live in the settings table (keys `adminer`, `onboarding.<userId>`).
db.exec(`
CREATE TABLE IF NOT EXISTS site_php_settings (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  client_max_body_mb INTEGER,
  updated_at TEXT NOT NULL
);
`);
