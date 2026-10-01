import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextjsConfig, NodeAppStatus, PackageManager } from '@tpanel/shared';
import { config } from '../config.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';

type PM = Exclude<PackageManager, 'auto'>;
export type NodeAppConfig = Omit<NextjsConfig, 'gitUrl' | 'branch'> & { gitUrl?: string; branch?: string };

export const serviceName = (domain: string) => `tpanel-app-${domain.replace(/[^a-z0-9.-]/gi, '-')}`;
const unitPath = (domain: string) => path.join(config.systemdDir, `${serviceName(domain)}.service`);
const startScriptPath = (domain: string) => path.join(config.appsConfDir, `${domain}.start.sh`);

export async function detectPackageManager(appDir: string, preferred: PackageManager = 'auto'): Promise<PM> {
  if (preferred !== 'auto') return preferred;
  if (await host.exists(path.join(appDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await host.exists(path.join(appDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export async function defaultCommands(appDir: string, pm: PM) {
  const hasNpmLock = await host.exists(path.join(appDir, 'package-lock.json'));
  const install = {
    npm: hasNpmLock ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund',
    yarn: 'yarn install --frozen-lockfile',
    pnpm: 'pnpm install --frozen-lockfile',
  }[pm];
  const build = `${pm} run build`;
  // `next start` honours $PORT; binding to 127.0.0.1 keeps the app reachable only through nginx.
  const start = { npm: 'npx --no-install next start -H 127.0.0.1 -p "$PORT"', yarn: 'yarn next start -H 127.0.0.1 -p "$PORT"', pnpm: 'pnpm exec next start -H 127.0.0.1 -p "$PORT"' }[pm];
  return { install, build, start };
}

/** Run a command inside the app dir as the unprivileged web user. */
async function runAsWebUser(appDir: string, homeDir: string, command: string, log: HostLogger, signal?: AbortSignal) {
  const full = host.asWebUser(command, { cwd: appDir, home: homeDir });
  log(`$ ${command}`);
  let pending = '';
  await host.mutate(full, {
    signal,
    log,
    timeoutMs: 30 * 60_000,
    onOutput: (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) log(l);
    },
  });
  if (pending.trim()) log(pending);
}

/** Values are written for dotenv: quoted, with `$` escaped so dotenv-expand does not mangle secrets. */
export function renderEnvFile(env: Record<string, string>): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
  return (
    '# Managed by TPanel\n' +
    Object.entries(env)
      .map(([k, v]) => `${k}="${esc(v)}"`)
      .join('\n') +
    '\n'
  );
}

export function renderUnit(domain: string, appDir: string, homeDir: string, port: number): string {
  return `# Managed by TPanel
[Unit]
Description=TPanel Next.js app ${domain}
After=network.target

[Service]
Type=simple
User=${config.webUser}
Group=${config.webUser}
WorkingDirectory=${appDir}
Environment=NODE_ENV=production
Environment=PORT=${port}
Environment=HOSTNAME=127.0.0.1
Environment=HOME=${homeDir}
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=/bin/bash ${startScriptPath(domain)}
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`;
}

export async function writeServiceFiles(domain: string, appDir: string, homeDir: string, port: number, cfg: NodeAppConfig, log: HostLogger) {
  const pm = await detectPackageManager(appDir, cfg.packageManager);
  const defaults = await defaultCommands(appDir, pm);
  const start = cfg.startCommand || defaults.start;
  await host.writeFile(startScriptPath(domain), `#!/bin/bash\n# Managed by TPanel\ncd ${shq(appDir)} || exit 1\nexec ${start}\n`, 0o755);
  await host.writeFile(unitPath(domain), renderUnit(domain, appDir, homeDir, port));
  if (Object.keys(cfg.env ?? {}).length) {
    await host.writeFile(path.join(appDir, '.env.production.local'), renderEnvFile(cfg.env), 0o640);
  }
  await host.mutate('systemctl daemon-reload', { log });
  await host.mutate(`systemctl enable ${shq(serviceName(domain))}`, { log });
}

/** install -> build -> (re)start. Used on site creation, "Deploy" and after migration. */
export async function buildAndRestart(
  site: { domain: string; rootPath: string; webRoot: string; appPort: number },
  cfg: NodeAppConfig,
  log: HostLogger,
  signal?: AbortSignal,
) {
  const appDir = site.webRoot;
  if (!(await host.exists(path.join(appDir, 'package.json')))) {
    throw new Error(`Không tìm thấy package.json trong ${appDir}. Hãy upload mã nguồn hoặc cấu hình Git URL.`);
  }
  const pm = await detectPackageManager(appDir, cfg.packageManager);
  const defaults = await defaultCommands(appDir, pm);
  if (pm !== 'npm') await host.mutate(`corepack enable >/dev/null 2>&1 || true`, { log });
  await host.mutate(`chown -R ${shq(`${config.webUser}:${config.webUser}`)} ${shq(site.rootPath)}`, { log });
  await writeServiceFiles(site.domain, appDir, site.rootPath, site.appPort, cfg, log);
  await runAsWebUser(appDir, site.rootPath, cfg.installCommand || defaults.install, log, signal);
  await runAsWebUser(appDir, site.rootPath, `NODE_ENV=production ${cfg.buildCommand || defaults.build}`, log, signal);
  await host.mutate(`systemctl restart ${shq(serviceName(site.domain))}`, { log });
  log(`Đã khởi động ${serviceName(site.domain)} trên 127.0.0.1:${site.appPort}`);
}

export async function gitCloneOrPull(appDir: string, homeDir: string, gitUrl: string, branch: string, log: HostLogger, signal?: AbortSignal) {
  if (await host.exists(path.join(appDir, '.git'))) {
    await runAsWebUser(appDir, homeDir, `git fetch --depth 1 origin ${shq(branch)} && git reset --hard FETCH_HEAD`, log, signal);
    return;
  }
  if (!(await host.isEmptyDir(appDir))) throw new Error(`${appDir} không trống, không thể git clone`);
  await fs.mkdir(appDir, { recursive: true });
  await host.mutate(`chown -R ${shq(`${config.webUser}:${config.webUser}`)} ${shq(homeDir)}`, { log });
  await runAsWebUser(appDir, homeDir, `git clone --depth 1 --branch ${shq(branch)} ${shq(gitUrl)} .`, log, signal);
}

export async function serviceAction(domain: string, action: 'start' | 'stop' | 'restart', log?: HostLogger) {
  await host.mutate(`systemctl ${action} ${shq(serviceName(domain))}`, { log });
}

export async function serviceStatus(domain: string, port: number | null, appDir: string): Promise<NodeAppStatus> {
  const name = serviceName(domain);
  const r = config.dryRun ? { stdout: 'unknown' } : await host.exec(`systemctl is-active ${shq(name)}`);
  const state = r.stdout.trim();
  const known = ['active', 'inactive', 'failed', 'activating'] as const;
  return {
    service: name,
    active: (known as readonly string[]).includes(state) ? (state as NodeAppStatus['active']) : 'unknown',
    port,
    packageManager: (await host.exists(path.join(appDir, 'package.json'))) ? await detectPackageManager(appDir) : null,
  };
}

export async function removeService(domain: string, log?: HostLogger) {
  await host.mutate(`systemctl disable --now ${shq(serviceName(domain))} 2>/dev/null || true`, { log });
  await Promise.all([fs.rm(unitPath(domain), { force: true }), fs.rm(startScriptPath(domain), { force: true })]);
  await host.mutate('systemctl daemon-reload', { log });
}

export async function appJournal(domain: string, lines: number): Promise<string[]> {
  if (config.dryRun) return ['[dry-run] journalctl không khả dụng'];
  const r = await host.exec(`journalctl -u ${shq(serviceName(domain))} -n ${Math.min(lines, 5000)} --no-pager -o short-iso`);
  return r.stdout.split('\n').filter(Boolean);
}
