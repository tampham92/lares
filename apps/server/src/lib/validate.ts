import type { ZodType, ZodTypeDef } from 'zod';
import { HttpError } from './errors.js';

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw new HttpError(400, `${where}${first?.message ?? 'Dữ liệu không hợp lệ'}`);
  }
  return r.data;
}

export function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID không hợp lệ');
  return id;
}
