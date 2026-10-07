import { t } from '../i18n/index.js';

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
 * Runs shell commands on a machine - either the Lares host itself or a source VPS over SSH.
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
  /** Copy a file from this machine to a local path on the Lares host. */
  download(remotePath: string, localPath: string, opts?: TransferOptions): Promise<void>;
  readFile(path: string, maxBytes?: number): Promise<string | null>;
  close(): Promise<void>;
}

const STACK_FRAME = /^\s*\[?at\s/;
const ERROR_LINE = /\b(error|failed|fatal|cannot|denied|refused|timed? ?out)\b|ERR!/i;

/**
 * The few lines of a failed command worth showing. Usually its last 5 lines; but when the output
 * ends in stack traces (node, next build) those say nothing, so show the error lines instead,
 * e.g. "Failed to fetch Jost from Google Fonts." rather than five "at <unknown>" frames.
 */
export function summarizeOutput(output: string): string {
  const lines = output.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  const tail = lines.slice(-5);
  if (!tail.some((l) => STACK_FRAME.test(l))) return tail.join('\n');
  const meaningful = lines.filter((l) => !STACK_FRAME.test(l));
  const errors = [...new Set(meaningful.filter((l) => ERROR_LINE.test(l) && !/^\s*warn(ing)?\b/i.test(l)).map((l) => l.trim()))];
  return (errors.length ? errors.slice(-5) : meaningful.slice(-5)).join('\n');
}

export class CommandError extends Error {
  constructor(
    public command: string,
    public result: ExecResult,
  ) {
    const output = summarizeOutput((result.stderr || result.stdout).trim());
    super(t('Lệnh thất bại (exit {code}): {output}', { code: result.code, output: output || t('không có output') }));
  }
}

export const wrapBash = (command: string) => `set -o pipefail; ${command}`;
