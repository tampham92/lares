import { shq } from '../lib/shell.js';
import { CommandError, type ExecOptions, type ExecResult, type Executor, type StreamOptions, type TransferOptions } from './types.js';

export abstract class BaseExecutor implements Executor {
  abstract readonly kind: 'local' | 'ssh';
  abstract readonly label: string;
  abstract exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  abstract execToFile(command: string, localPath: string, opts?: StreamOptions): Promise<void>;
  abstract download(remotePath: string, localPath: string, opts?: TransferOptions): Promise<void>;
  abstract close(): Promise<void>;

  async run(command: string, opts?: ExecOptions): Promise<string> {
    const r = await this.exec(command, opts);
    if (r.code !== 0) throw new CommandError(command, r);
    return r.stdout.trim();
  }

  async readFile(path: string, maxBytes = 2_000_000): Promise<string | null> {
    const r = await this.exec(`[ -f ${shq(path)} ] && head -c ${maxBytes} ${shq(path)}`);
    return r.code === 0 ? r.stdout : null;
  }
}

/** Keep only the last `limit` characters of a growing buffer. */
export function appendCapped(buf: string, chunk: string, limit = 4_000_000): string {
  const next = buf + chunk;
  return next.length > limit ? next.slice(next.length - limit) : next;
}
