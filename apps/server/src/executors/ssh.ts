import crypto from 'node:crypto';
import fs from 'node:fs';
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { SourceConnection } from '@lares/shared';
import { shq } from '../lib/shell.js';
import { t } from '../i18n/index.js';
import { BaseExecutor, appendCapped } from './base.js';
import { CommandError, wrapBash, type ExecOptions, type ExecResult, type StreamOptions, type TransferOptions } from './types.js';

type SshConnection = Extract<SourceConnection, { mode: 'ssh' }>;

export class SshExecutor extends BaseExecutor {
  readonly kind = 'ssh' as const;
  readonly label: string;
  private client = new Client();
  private sftpPromise: Promise<SFTPWrapper> | null = null;
  /** Host key fingerprint seen during the handshake. */
  fingerprint: string | null = null;

  private constructor(private conn: SshConnection) {
    super();
    this.label = `${conn.username}@${conn.host}:${conn.port}`;
  }

  static async connect(conn: SshConnection): Promise<SshExecutor> {
    const ex = new SshExecutor(conn);
    const cfg: ConnectConfig = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 8,
      hostVerifier: (key: Buffer) => {
        ex.fingerprint = `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
        return !conn.hostFingerprint || conn.hostFingerprint === ex.fingerprint;
      },
    };
    if (conn.authType === 'password') cfg.password = conn.password ?? '';
    else {
      cfg.privateKey = conn.privateKey ?? '';
      if (conn.passphrase) cfg.passphrase = conn.passphrase;
    }
    await new Promise<void>((resolve, reject) => {
      ex.client
        .once('ready', () => resolve())
        .once('error', (err) => {
          if (conn.hostFingerprint && ex.fingerprint && ex.fingerprint !== conn.hostFingerprint) {
            reject(
              new Error(
                t('Host key của {host} đã thay đổi ({fingerprint}, trước đó {previous}). Có thể VPS đã cài lại hoặc kết nối bị giả mạo - kiểm tra lại trước khi tiếp tục.', {
                  host: conn.host,
                  fingerprint: ex.fingerprint,
                  previous: conn.hostFingerprint,
                }),
              ),
            );
          } else reject(new Error(t('Không kết nối được SSH tới {label}: {error}', { label: ex.label, error: err.message })));
        })
        .connect(cfg);
    });
    return ex;
  }

  /** Wrap in bash (the remote login shell may be sh/zsh) and optionally in passwordless sudo. */
  private wrap(command: string): string {
    const bash = `bash -c ${shq(wrapBash(command))}`;
    return this.conn.useSudo && this.conn.username !== 'root' ? `sudo -n ${bash}` : bash;
  }

  private openExec(command: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.client.exec(this.wrap(command), (err, ch) => (err ? reject(err) : resolve(ch)));
    });
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const ch = await this.openExec(command);
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const abort = () => {
        ch.signal('KILL');
        ch.close();
        reject(new Error(t('Đã huỷ')));
      };
      opts.signal?.addEventListener('abort', abort, { once: true });
      const timer = opts.timeoutMs ? setTimeout(() => ch.close(), opts.timeoutMs) : null;
      ch.on('data', (d: Buffer) => {
        const s = d.toString();
        stdout = appendCapped(stdout, s);
        opts.onOutput?.(s, 'stdout');
      });
      ch.stderr.on('data', (d: Buffer) => {
        const s = d.toString();
        stderr = appendCapped(stderr, s);
        opts.onOutput?.(s, 'stderr');
      });
      ch.on('close', (code: number | null) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', abort);
        resolve({ stdout, stderr, code: code ?? 1 });
      });
    });
  }

  async execToFile(command: string, localPath: string, opts: StreamOptions = {}): Promise<void> {
    const ch = await this.openExec(command);
    const out = fs.createWriteStream(localPath, { mode: 0o600 });
    let stderr = '';
    let bytes = 0;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        ch.signal('KILL');
        ch.close();
        reject(new Error(t('Đã huỷ')));
      };
      opts.signal?.addEventListener('abort', abort, { once: true });
      ch.stderr.on('data', (d: Buffer) => (stderr = appendCapped(stderr, d.toString(), 100_000)));
      ch.on('data', (d: Buffer) => {
        bytes += d.length;
        opts.onProgress?.(bytes);
        if (!out.write(d)) {
          ch.pause();
          out.once('drain', () => ch.resume());
        }
      });
      ch.on('close', (code: number | null) => {
        opts.signal?.removeEventListener('abort', abort);
        out.end(() => {
          if ((code ?? 1) !== 0) reject(new CommandError(command, { stdout: '', stderr, code: code ?? 1 }));
          else resolve();
        });
      });
      out.on('error', reject);
    });
  }

  private sftp(): Promise<SFTPWrapper> {
    this.sftpPromise ??= new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });
    return this.sftpPromise;
  }

  async download(remotePath: string, localPath: string, opts: TransferOptions = {}): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error(t('Đã huỷ')));
      opts.signal?.addEventListener('abort', abort, { once: true });
      sftp.fastGet(
        remotePath,
        localPath,
        {
          concurrency: 64,
          chunkSize: 256 * 1024,
          step: (transferred, _chunk, total) => opts.onProgress?.(transferred, total),
        },
        (err) => {
          opts.signal?.removeEventListener('abort', abort);
          if (err) reject(new Error(t('SFTP tải {path} thất bại: {error}', { path: remotePath, error: err.message })));
          else resolve();
        },
      );
    });
  }

  async close(): Promise<void> {
    this.client.end();
  }
}
