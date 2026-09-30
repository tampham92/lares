export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called for each stdout/stderr chunk (live log streaming). */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface StreamOptions {
  signal?: AbortSignal;
  onProgress?: (bytes: number) => void;
}

export interface TransferOptions {
  signal?: AbortSignal;
  onProgress?: (transferred: number, total: number) => void;
}

/**
 * Runs shell commands on a machine - either the TPanel host itself or a source VPS over SSH.
 * Every command is executed through `bash -c` with `set -o pipefail` so pipelines
 * (mysqldump | gzip) fail loudly instead of producing a truncated archive.
 */
export interface Executor {
  readonly kind: 'local' | 'ssh';
  readonly label: string;
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Like exec but throws on a non-zero exit code; returns trimmed stdout. */
  run(command: string, opts?: ExecOptions): Promise<string>;
  /** Stream the command's stdout into a local file (used for streaming transfers). */
  execToFile(command: string, localPath: string, opts?: StreamOptions): Promise<void>;
  /** Copy a file from this machine to a local path on the TPanel host. */
  download(remotePath: string, localPath: string, opts?: TransferOptions): Promise<void>;
  readFile(path: string, maxBytes?: number): Promise<string | null>;
  close(): Promise<void>;
}

export class CommandError extends Error {
  constructor(
    public command: string,
    public result: ExecResult,
  ) {
    const tail = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
    super(`Lệnh thất bại (exit ${result.code}): ${tail || 'không có output'}`);
  }
}

export const wrapBash = (command: string) => `set -o pipefail; ${command}`;
