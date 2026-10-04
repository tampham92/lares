import type { TwoFactorSetup, TwoFactorStatus } from '@lares/shared';
import { db } from '../db/index.js';
import { t } from '../i18n/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { conflict, HttpError } from '../lib/errors.js';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from '../lib/totp.js';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  token_version: number;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_last_step: number | null;
  recovery_codes_json: string | null;
}

export const getUser = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
export const getUserByName = (username: string) => db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

/** Signs out every session of the user (all JWTs carry the version they were issued with). */
export function bumpTokenVersion(userId: number): number {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  return getUser(userId)!.token_version;
}

const recoveryHashes = (u: UserRow): string[] => (u.recovery_codes_json ? (JSON.parse(u.recovery_codes_json) as string[]) : []);

export function twoFactorStatus(u: UserRow): TwoFactorStatus {
  return { enabled: !!u.totp_secret_enc, pending: !u.totp_secret_enc && !!u.totp_pending_enc, recoveryCodesLeft: u.totp_secret_enc ? recoveryHashes(u).length : 0 };
}

/** Step 1: a new secret, kept as "pending" until the user proves the app is set up. */
export function startSetup(u: UserRow): TwoFactorSetup {
  if (u.totp_secret_enc) throw conflict(t('Xác thực hai lớp đang bật. Tắt trước khi thiết lập lại.'));
  const secret = generateTotpSecret();
  db.prepare('UPDATE users SET totp_pending_enc = ? WHERE id = ?').run(encrypt(secret), u.id);
  return { secret, otpauthUrl: otpauthUrl(secret, u.username) };
}

function newRecoveryCodes(userId: number): string[] {
  const codes = generateRecoveryCodes(10);
  db.prepare('UPDATE users SET recovery_codes_json = ? WHERE id = ?').run(JSON.stringify(codes.map(hashRecoveryCode)), userId);
  return codes;
}

/** Step 2: confirm with a code from the app; returns the recovery codes (shown once, stored hashed). */
export function confirmSetup(u: UserRow, code: string): string[] {
  if (u.totp_secret_enc) throw conflict(t('Xác thực hai lớp đang bật. Tắt trước khi thiết lập lại.'));
  if (!u.totp_pending_enc) throw new HttpError(400, t('Chưa bắt đầu thiết lập xác thực hai lớp'));
  const step = verifyTotp(decrypt<string>(u.totp_pending_enc), code);
  if (step === null) throw new HttpError(400, t('Mã xác thực không đúng. Kiểm tra giờ trên điện thoại rồi thử lại.'));
  db.prepare('UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_last_step = ? WHERE id = ?').run(step, u.id);
  return newRecoveryCodes(u.id);
}

/**
 * Accepts a current TOTP code (each time step only once) or an unused recovery code (consumed).
 * Returns null when the code is wrong.
 */
export function checkSecondFactor(u: UserRow, code: string): { usedRecovery: boolean; recoveryCodesLeft: number } | null {
  if (!u.totp_secret_enc) return null;
  const c = code.trim();
  const hashes = recoveryHashes(u);
  if (/^\d{6}$/.test(c.replace(/\s/g, ''))) {
    const step = verifyTotp(decrypt<string>(u.totp_secret_enc), c, { lastStep: u.totp_last_step });
    if (step === null) return null;
    db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, u.id);
    return { usedRecovery: false, recoveryCodesLeft: hashes.length };
  }
  const h = hashRecoveryCode(c);
  if (!hashes.includes(h)) return null;
  const left = hashes.filter((x) => x !== h);
  db.prepare('UPDATE users SET recovery_codes_json = ? WHERE id = ?').run(JSON.stringify(left), u.id);
  return { usedRecovery: true, recoveryCodesLeft: left.length };
}

export function regenerateRecoveryCodes(u: UserRow): string[] {
  if (!u.totp_secret_enc) throw new HttpError(400, t('Xác thực hai lớp chưa bật'));
  return newRecoveryCodes(u.id);
}

/** Used by the settings page and by `lares disable-2fa`. */
export function disableTwoFactor(userId: number) {
  db.prepare('UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_step = NULL, recovery_codes_json = NULL WHERE id = ?').run(userId);
}
