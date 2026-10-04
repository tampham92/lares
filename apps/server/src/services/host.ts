import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { localExecutor, type ExecOptions } from '../executors/index.js';
import { shq } from '../lib/shell.js';

export type HostLogger = (msg: string) => void;

/**
 * Operations against the Lares machine itself.
 * `mutate` is for commands that change the system (nginx reload, chown, mysql import, certbot...):
 * in dry-run mode they are only logged, so the panel can be developed on a laptop.
 */
export const host = {
  exec: (command: string, opts?: ExecOptions) => localExecutor.exec(command, opts),
  run: (command: string, opts?: ExecOptions) => localExecutor.run(command, opts),

  async mutate(command: string, opts?: ExecOptions & { log?: HostLogger }): Promise<string> {
    if (config.dryRun) {
      opts?.log?.(`[dry-run] ${command}`);
      return '';
    }
    return localExecutor.run(command, opts);
  },

  /**
   * Wrap a command so it runs as the unprivileged web user. Anything that executes site code
   * (wp-cli, artisan, npm scripts) must go through this: migrated code is not trusted with root.
   */
  asWebUser(command: string, opts: { cwd: string; home: string; env?: Record<string, string> }): string {
    const env = Object.entries({ CI: '1', NEXT_TELEMETRY_DISABLED: '1', ...opts.env })
      .map(([k, v]) => `${k}=${shq(v)}`)
      .join(' ');
    const inner = `cd ${shq(opts.cwd)} && ${command}`;
    return process.getuid?.() === 0
      ? `runuser -u ${shq(config.webUser)} -- env HOME=${shq(opts.home)} PATH="$PATH" ${env} bash -c ${shq(inner)}`
      : `env ${env} bash -c ${shq(inner)}`;
  },

  async has(bin: string): Promise<boolean> {
    return (await localExecutor.exec(`command -v ${bin} >/dev/null 2>&1`)).code === 0;
  },

  async writeFile(file: string, content: string, mode = 0o644) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.lares-tmp`;
    await fs.writeFile(tmp, content, { mode });
    await fs.rename(tmp, file);
  },

  async exists(p: string): Promise<boolean> {
    return fs
      .access(p)
      .then(() => true)
      .catch(() => false);
  },

  async isEmptyDir(p: string): Promise<boolean> {
    try {
      return (await fs.readdir(p)).length === 0;
    } catch {
      return true;
    }
  },
};
