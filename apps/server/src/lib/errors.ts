export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
