import crypto from 'node:crypto';
import path from 'node:path';
import { BACKUP_ID_RE, HHMM_RE, backupManifestSchema, type BackupManifest, type BackupTrigger } from '@lares/shared';

/*
 * Pure rules of the backup feature (no I/O): ids, retention, schedule, path safety,
 * manifest parsing and download tokens. Kept separate so they are easy to unit test.
 */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** YYYY-MM-DD of `d` in the server's local time zone. */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** New backup id from the local time, e.g. 20261004-031500; `-2`, `-3`... when the second is taken. */
export function newBackupId(now: Date, existing: Iterable<string>): string {
  const base = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  throw new Error('backup id space exhausted');
}

/**
 * Daily schedule: due once the local clock has passed HH:MM and no run was recorded for today.
 * The date is recorded before a run starts, so a restart never runs the same day twice; a panel
 * that was down at HH:MM catches up as soon as it is back the same day.
 */
export function isDue(now: Date, time: string, lastRunDate: string | null): boolean {
  if (!HHMM_RE.test(time)) return false;
  const [h, m] = time.split(':').map(Number) as [number, number];
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
  return lastRunDate !== localDate(now);
}

/** How many backups of each trigger are kept automatically. Manual backups are never pruned. */
export const SAFETY_KEEP = 3;

/**
 * Backups to delete so that only the `keep` newest of `trigger` remain (others are untouched).
 * Newest = latest createdAt, then highest id.
 */
export function selectExpired<T extends { id: string; trigger: BackupTrigger; createdAt: string }>(backups: T[], trigger: BackupTrigger, keep: number): T[] {
  if (trigger === 'manual') return [];
  return backups
    .filter((b) => b.trigger === trigger)
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id, 'en', { numeric: true }) : b.createdAt < a.createdAt ? -1 : 1))
    .slice(Math.max(0, keep));
}

// ---- Path safety -------------------------------------------------------------

/** `child` strictly inside `parent` (both resolved; equal paths are NOT inside). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

const cleanAbs = (p: string) => typeof p === 'string' && path.isAbsolute(p) && !/[\0\r\n]/.test(p) && path.resolve(p) === p.replace(/\/+$/, '');

/** A site root taken from the database must be a plain absolute path inside the sites root. */
export function isSafeSiteRoot(rootPath: string, sitesRoot: string): boolean {
  return cleanAbs(rootPath) && isInside(sitesRoot, rootPath);
}

/** One path segment used as a directory name under the backup root. */
export const isSafeDomainSegment = (domain: string) => /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(domain) && !domain.includes('..');

export const isBackupId = (id: string) => BACKUP_ID_RE.test(id);

const SYSTEM_DIRS = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var/lib/mysql', '/var/run'];

/** Reasons a backup root is refused (null = fine): not `/`, not system dirs, not under the sites root. */
export function backupRootProblem(root: string, sitesRoot: string): string | null {
  if (!cleanAbs(root)) return 'not-absolute';
  if (root.split('/').filter(Boolean).length < 2) return 'too-shallow';
  if (SYSTEM_DIRS.some((d) => root === d || isInside(d, root))) return 'system-dir';
  if (root === sitesRoot || isInside(sitesRoot, root) || isInside(root, sitesRoot)) return 'sites-root';
  return null;
}

/** Directory of one backup: <root>/<domain>/<id>, refusing anything that would escape the root. */
export function backupDir(root: string, domain: string, id: string): string {
  if (!isSafeDomainSegment(domain) || !isBackupId(id)) throw new Error(`unsafe backup path: ${domain}/${id}`);
  const dir = path.join(root, domain, id);
  if (!isInside(root, dir)) throw new Error(`unsafe backup path: ${dir}`);
  return dir;
}

// ---- Manifest ----------------------------------------------------------------

/** Parse and validate manifest.json; null when it is missing pieces or names unsafe files. */
export function parseManifest(text: string): BackupManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = backupManifestSchema.safeParse(raw);
  if (!r.success) return null;
  // every database file must belong to its database (db-<name>.sql.gz) and appear once
  const files = new Set<string>();
  for (const d of r.data.databases) {
    if (d.file !== `db-${d.name}.sql.gz` || files.has(d.file)) return null;
    files.add(d.file);
  }
  return r.data;
}

// ---- Download tokens ----------------------------------------------------------

/**
 * Short-lived signed link so the browser can download a (large) backup directly instead of
 * buffering it through fetch: the API normally wants the JWT in a header a plain link cannot send.
 */
export function signDownload(secret: string, payload: { siteId: number; id: string }, now = Date.now(), ttlMs = 5 * 60_000): string {
  const body = Buffer.from(JSON.stringify({ s: payload.siteId, b: payload.id, e: now + ttlMs })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(`backup-dl.${body}`).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyDownload(secret: string, token: string, now = Date.now()): { siteId: number; id: string } | null {
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = crypto.createHmac('sha256', secret).update(`backup-dl.${body}`).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { s?: unknown; b?: unknown; e?: unknown };
    if (typeof p.s !== 'number' || typeof p.b !== 'string' || typeof p.e !== 'number' || p.e < now || !isBackupId(p.b)) return null;
    return { siteId: p.s, id: p.b };
  } catch {
    return null;
  }
}
