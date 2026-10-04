import { db } from '../db/index.js';
import { t } from '../i18n/index.js';
import { HttpError } from '../lib/errors.js';

/**
 * Per-username lockout, on top of the per-IP rate limit: an attacker rotating IPs still only gets
 * MAX_FAILURES guesses (password or 2FA code) per LOCK_MS. Counted for unknown usernames too, so
 * the lockout does not reveal which accounts exist. `lares reset-password` clears it.
 */
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;

interface FailureRow {
  failures: number;
  first_failure_at: number;
  locked_until: number | null;
}

const key = (username: string) => username.trim().toLowerCase();

/** Milliseconds until the account unlocks (0 = not locked). */
export function lockRemaining(username: string, now = Date.now()): number {
  const row = db.prepare('SELECT locked_until FROM login_failures WHERE username = ?').get(key(username)) as Pick<FailureRow, 'locked_until'> | undefined;
  return row?.locked_until && row.locked_until > now ? row.locked_until - now : 0;
}

const lockedError = (ms: number) => new HttpError(429, t('Tài khoản tạm khoá do đăng nhập sai nhiều lần. Thử lại sau {minutes} phút.', { minutes: Math.max(1, Math.ceil(ms / 60_000)) }));

export function assertNotLocked(username: string) {
  const ms = lockRemaining(username);
  if (ms > 0) throw lockedError(ms);
}

/** Counts one failure. Failures older than LOCK_MS are forgotten. Returns the lock error when this one triggered the lock. */
export function recordFailure(username: string, now = Date.now()): HttpError | null {
  const k = key(username);
  const row = db.prepare('SELECT failures, first_failure_at, locked_until FROM login_failures WHERE username = ?').get(k) as FailureRow | undefined;
  const fresh = !row || now - row.first_failure_at > LOCK_MS || (row.locked_until !== null && row.locked_until <= now);
  const failures = fresh ? 1 : row.failures + 1;
  const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_MS : null;
  db.prepare(
    `INSERT INTO login_failures (username, failures, first_failure_at, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, first_failure_at = excluded.first_failure_at, locked_until = excluded.locked_until`,
  ).run(k, failures, fresh ? now : row.first_failure_at, lockedUntil);
  return lockedUntil ? lockedError(LOCK_MS) : null;
}

export function clearFailures(username: string) {
  db.prepare('DELETE FROM login_failures WHERE username = ?').run(key(username));
}
