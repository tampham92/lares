import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { config } from '../config.js';

const key = crypto.scryptSync(config.secret, 'lares-credential-store', 32);

/** AES-256-GCM encrypt a JSON-serialisable value. Output: base64(iv|tag|ciphertext). */
export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt<T>(payload: string): T {
  const buf = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const out = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T;
}

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Alphanumeric only on purpose: generated passwords end up inside PHP strings,
 * .env files and shell commands, so avoiding metacharacters removes a whole class of escaping bugs.
 */
export function randomPassword(length = 24): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALNUM[b % ALNUM.length];
  return out;
}

export function randomSuffix(length = 4): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')));
  });
}
