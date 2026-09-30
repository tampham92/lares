import os from 'node:os';
import type { SystemStats } from '@tpanel/shared';
import { config } from '../config.js';
import { host } from './host.js';
import { installedPhpVersions } from './php.js';

export async function systemStats(): Promise<SystemStats> {
  const php = await installedPhpVersions();
  const services = ['nginx', 'mariadb', 'mysql', ...php.map((v) => `php${v}-fpm`)];
  const status: SystemStats['services'] = {};
  if (config.dryRun) services.forEach((s) => (status[s] = 'unknown'));
  else {
    const r = await host.exec(`for s in ${services.join(' ')}; do echo "$s $(systemctl is-active "$s" 2>/dev/null)"; done`);
    for (const line of r.stdout.split('\n')) {
      const [name, state] = line.trim().split(/\s+/);
      if (name) status[name] = state === 'active' ? 'active' : state === 'inactive' || state === 'failed' ? 'inactive' : 'unknown';
    }
    // only one of mariadb/mysql exists on a given host
    if (status.mariadb === 'unknown' || status.mariadb === undefined) delete status.mariadb;
    else if (status.mysql !== 'active') delete status.mysql;
  }
  const df = await host.exec(`df -Pk ${config.sitesRoot} 2>/dev/null | tail -1`);
  const cols = df.stdout.trim().split(/\s+/);
  const disk = cols.length >= 4 ? { total: Number(cols[1]) * 1024, used: Number(cols[2]) * 1024, free: Number(cols[3]) * 1024 } : null;
  let osName = `${os.type()} ${os.release()}`;
  const rel = await host.exec(`. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"`);
  if (rel.code === 0 && rel.stdout.trim()) osName = rel.stdout.trim();
  return {
    hostname: os.hostname(),
    os: osName,
    uptimeSec: os.uptime(),
    loadavg: os.loadavg(),
    cpuCount: os.cpus().length,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    disk,
    services: status,
    phpVersions: php,
    dryRun: config.dryRun,
  };
}
