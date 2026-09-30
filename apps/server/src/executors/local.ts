import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { BaseExecutor, appendCapped } from './base.js';
import { CommandError, wrapBash, type ExecOptions, type ExecResult, type StreamOptions, type TransferOptions } from './types.js';

export class LocalExecutor extends BaseExecutor {
  readonly kind = 'local' as const;
  readonly label = 'localhost';

  exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', wrapBash(command)], { signal: opts.signal, env: { ...process.env, LC_ALL: 'C' } });
      let stdout = '';
      let stderr = '';
      const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
      child.stdout.on('data', (d: Buffer) => {
        const s = d.toString();
        stdout = appendCapped(stdout, s);
        opts.onOutput?.(s, 'stdout');
      });
      child.stderr.on('data', (d: Buffer) => {
        const s = d.toString();
        stderr = appendCapped(stderr, s);
        opts.onOutput?.(s, 'stderr');
      });
      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 1 });
      });
    });
  }

  async execToFile(command: string, localPath: string, opts: StreamOptions = {}): Promise<void> {
    const child = spawn('bash', ['-c', wrapBash(command)], { signal: opts.signal });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr = appendCapped(stderr, d.toString(), 100_000)));
    const exit = new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        opts.onProgress?.(bytes);
        cb(null, chunk);
      },
    });
    await pipeline(child.stdout, counter, fs.createWriteStream(localPath, { mode: 0o600 }));
    const code = await exit;
    if (code !== 0) throw new CommandError(command, { stdout: '', stderr, code });
  }

  async download(remotePath: string, localPath: string, opts: TransferOptions = {}): Promise<void> {
    if (remotePath === localPath) return;
    const total = (await fs.promises.stat(remotePath)).size;
    await fs.promises.copyFile(remotePath, localPath);
    opts.onProgress?.(total, total);
  }

  async close(): Promise<void> {}
}

export const localExecutor = new LocalExecutor();
