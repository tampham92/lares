import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { localExecutor, type ExecOptions } from '../executors/index.js';
import { shq } from '../lib/shell.js';

export type HostLogger = (msg: string) => void;

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

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
   * Wrap a command so it runs as the site's unprivileged user (`runAsOf(site)` in isolation.ts: its
   * own user, or the shared web user for older sites). Anything that executes site code (wp-cli,
   * artisan, npm scripts) must go through this: migrated code is not trusted with root.
   */
  asWebUser(command: string, opts: { cwd: string; home: string; user: string; env?: Record<string, string> }): string {
    // `env -i`: site code must not inherit the panel's environment. It holds LARES_SECRET and the
    // admin/MySQL passwords, and its NODE_ENV=production makes `npm ci` skip the devDependencies
    // (tailwind, typescript...) that `next build` needs.
    // Proxy settings are the one thing passed through: a server that reaches the internet only via
    // a proxy (set in the panel's env file) still needs it for npm, git and next/font downloads.
    const proxy = Object.fromEntries(PROXY_VARS.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
    const env = Object.entries({ CI: '1', NEXT_TELEMETRY_DISABLED: '1', LANG: 'C.UTF-8', ...proxy, ...opts.env })
      .map(([k, v]) => `${k}=${shq(v)}`)
      .join(' ');
    const inner = `cd ${shq(opts.cwd)} && ${command}`;
    const user = shq(opts.user);
    return process.getuid?.() === 0
      ? `runuser -u ${user} -- env -i HOME=${shq(opts.home)} USER=${user} LOGNAME=${user} PATH="$PATH" ${env} bash -c ${shq(inner)}`
      : `env -i HOME="$HOME" PATH="$PATH" ${env} bash -c ${shq(inner)}`;
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
