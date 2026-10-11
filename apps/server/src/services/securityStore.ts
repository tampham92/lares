import fs from 'node:fs/promises';
import path from 'node:path';
import {
  securitySettingsSchema,
  type QuarantineState,
  type SecurityEvent,
  type SecurityEventAction,
  type SecuritySettings,
} from '@lares/shared';
import { config } from '../config.js';
import { db, getSetting, nowIso, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { conflict } from '../lib/errors.js';

/** Storage of the security tab: settings, per-site state (site_security), the event history. */

const SETTINGS_KEY = 'security';

export function getSecuritySettings(): SecuritySettings {
  const r = securitySettingsSchema.safeParse(getSetting<unknown>(SETTINGS_KEY, {}));
  return r.success ? r.data : securitySettingsSchema.parse({});
}

export const saveSecuritySettings = (s: SecuritySettings) => setSetting(SETTINGS_KEY, s);

interface Row {
  site_id: number;
  admins_json: string | null;
  admins_ack_at: string | null;
  quarantine_json: string | null;
  code_locked: number;
  writable_dirs_json: string | null;
  mu_plugins_json: string | null;
}

const EMPTY_QUARANTINE: QuarantineState = { active: false, since: null, by: null, reason: null, backupId: null };

function row(siteId: number): Row {
  return (
    (db.prepare('SELECT * FROM site_security WHERE site_id = ?').get(siteId) as Row | undefined) ?? {
      site_id: siteId,
      admins_json: null,
      admins_ack_at: null,
      quarantine_json: null,
      code_locked: 0,
      writable_dirs_json: null,
      mu_plugins_json: null,
    }
  );
}

function update(siteId: number, patch: Partial<Omit<Row, 'site_id'>>) {
  const next = { ...row(siteId), ...patch };
  db.prepare(
    `INSERT INTO site_security (site_id, admins_json, admins_ack_at, quarantine_json, code_locked, writable_dirs_json, mu_plugins_json) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET admins_json = excluded.admins_json, admins_ack_at = excluded.admins_ack_at,
       quarantine_json = excluded.quarantine_json, code_locked = excluded.code_locked, writable_dirs_json = excluded.writable_dirs_json,
       mu_plugins_json = excluded.mu_plugins_json`,
  ).run(siteId, next.admins_json, next.admins_ack_at, next.quarantine_json, next.code_locked, next.writable_dirs_json, next.mu_plugins_json);
}

const parse = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

/** Administrator ids known as legitimate (null = never recorded: the next scan records them). */
export const knownAdmins = (siteId: number): number[] | null => parse<number[] | null>(row(siteId).admins_json, null);
export const adminsAcknowledgedAt = (siteId: number) => row(siteId).admins_ack_at;
export const setKnownAdmins = (siteId: number, ids: number[]) => update(siteId, { admins_json: JSON.stringify([...new Set(ids)].sort((a, b) => a - b)), admins_ack_at: nowIso() });

/** mu-plugins known as legitimate: relative path -> sha256 (null = never recorded: the next scan records them). */
export const knownMuPlugins = (siteId: number): Record<string, string> | null => parse<Record<string, string> | null>(row(siteId).mu_plugins_json, null);
export const setKnownMuPlugins = (siteId: number, files: Record<string, string>) => update(siteId, { mu_plugins_json: JSON.stringify(files) });

export const quarantineState = (siteId: number): QuarantineState => ({ ...EMPTY_QUARANTINE, ...parse<Partial<QuarantineState>>(row(siteId).quarantine_json, {}) });
export const setQuarantineState = (siteId: number, q: QuarantineState) => update(siteId, { quarantine_json: q.active ? JSON.stringify(q) : null });
export const isQuarantined = (siteId: number) => quarantineState(siteId).active;

/** Refuse anything that would run a quarantined site's code (enable, update, wp-cli, clone, PHP settings...). */
export function assertNotQuarantined(site: { id: number; domain: string }) {
  if (isQuarantined(site.id)) throw conflict(t('{domain} đang bị cách ly khẩn: gỡ cách ly trước (sau khi dọn và quét lại sạch)', { domain: site.domain }));
}
/** Sites in quarantine (firewall rule). */
export function quarantinedSiteIds(): number[] {
  return (db.prepare('SELECT site_id FROM site_security WHERE quarantine_json IS NOT NULL').all() as Array<{ site_id: number }>).map((r) => r.site_id).filter(isQuarantined);
}

/** Sites whose lock is lifted for a panel job right now (withCodeUnlocked): fixPermissions must not re-lock them halfway. */
export const unlockedForJob = new Set<number>();

/** Is the code lock in force right now (set, and not lifted for a running panel job)? */
export const codeLockActive = (siteId: number) => codeLock(siteId).locked && !unlockedForJob.has(siteId);

export const codeLock = (siteId: number) => {
  const r = row(siteId);
  return { locked: r.code_locked === 1, writableDirs: parse<string[] | null>(r.writable_dirs_json, null) };
};
export const setCodeLock = (siteId: number, locked: boolean, writableDirs: string[] | null) =>
  update(siteId, { code_locked: locked ? 1 : 0, writable_dirs_json: writableDirs ? JSON.stringify(writableDirs) : null });

export function addEvent(siteId: number, action: SecurityEventAction, by: string | null, detail: string | null = null) {
  db.prepare('INSERT INTO security_events (site_id, at, action, by, detail) VALUES (?, ?, ?, ?, ?)').run(siteId, nowIso(), action, by, detail);
  db.prepare('DELETE FROM security_events WHERE site_id = ? AND id NOT IN (SELECT id FROM security_events WHERE site_id = ? ORDER BY id DESC LIMIT 100)').run(siteId, siteId);
}

export function events(siteId: number, limit = 30): SecurityEvent[] {
  return db.prepare('SELECT at, action, by, detail FROM security_events WHERE site_id = ? ORDER BY id DESC LIMIT ?').all(siteId, limit) as SecurityEvent[];
}

/** A deleted site leaves nothing behind (its id is never reused, but the baseline file can be large). */
export async function forgetSite(siteId: number) {
  db.prepare('DELETE FROM site_security WHERE site_id = ?').run(siteId);
  db.prepare('DELETE FROM security_events WHERE site_id = ?').run(siteId);
  db.prepare('DELETE FROM malware_scans WHERE site_id = ?').run(siteId);
  await fs.rm(baselineFile(siteId), { force: true });
}

// ---- File-hash baseline of the previous scan --------------------------------------------

export const securityDir = () => path.join(config.dataDir, 'security');
export const baselineFile = (siteId: number) => path.join(securityDir(), `${siteId}-baseline.json`);

export async function readBaseline(siteId: number): Promise<Record<string, string> | null> {
  const raw = await fs.readFile(baselineFile(siteId), 'utf8').catch(() => null);
  return raw ? parse<Record<string, string> | null>(raw, null) : null;
}

export async function writeBaseline(siteId: number, hashes: Record<string, string>) {
  await fs.mkdir(securityDir(), { recursive: true, mode: 0o700 });
  const tmp = `${baselineFile(siteId)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(hashes), { mode: 0o600 });
  await fs.rename(tmp, baselineFile(siteId));
}
