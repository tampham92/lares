import type { ZodType, ZodTypeDef } from 'zod';
import { HttpError } from './errors.js';
import { t } from '../i18n/index.js';

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    // Schema messages live in @lares/shared as Vietnamese source text; translate them here.
    throw new HttpError(400, `${where}${first ? t(first.message) : t('Dữ liệu không hợp lệ')}`);
  }
  return r.data;
}

export function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, t('ID không hợp lệ'));
  return id;
}
