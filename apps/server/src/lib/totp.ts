import crypto from 'node:crypto';

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s) - the variant every authenticator app supports -
 * plus one-time recovery codes. Pure functions; storage lives in auth/twofactor.ts.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

export const totpStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / TOTP_PERIOD);

/**
 * Checks `code` against the current step ± `window` steps (clock drift). Returns the matched
 * step, or null. Steps at or before `lastStep` are refused so a code cannot be replayed.
 */
export function verifyTotp(secret: string, code: string, opts: { nowMs?: number; window?: number; lastStep?: number | null } = {}): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const now = totpStep(opts.nowMs);
  const w = opts.window ?? 1;
  for (let step = now - w; step <= now + w; step++) {
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return null;
}

/** otpauth:// URI that authenticator apps read from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer = 'Lares Panel'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// 32 symbols (no l/o/0/1) so every character carries exactly 5 random bits.
const RC_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** `count` codes like "k3f9q-x2mzt" (50 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(10);
    const s = [...bytes].map((b) => RC_ALPHABET[b & 31]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Recovery codes are high-entropy random strings, so a plain SHA-256 is enough (no need for bcrypt). */
export const hashRecoveryCode = (code: string) => crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
