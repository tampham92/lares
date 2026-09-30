import fs from 'node:fs/promises';
import { config } from '../config.js';

/** PHP-FPM versions installed on this host (Debian/Ubuntu layout: /etc/php/<v>/fpm). */
export async function installedPhpVersions(): Promise<string[]> {
  try {
    const dirs = await fs.readdir('/etc/php');
    const out: string[] = [];
    for (const v of dirs) {
      if (!/^\d\.\d$/.test(v)) continue;
      if (await fs.access(`/etc/php/${v}/fpm`).then(() => true, () => false)) out.push(v);
    }
    return out.sort().reverse();
  } catch {
    return config.dryRun ? ['8.3', '8.2', '8.1', '7.4'] : [];
  }
}

/** Pick the requested version if installed, else the closest installed one, else the default. */
export async function resolvePhpVersion(requested?: string | null): Promise<string> {
  const installed = await installedPhpVersions();
  if (requested && installed.includes(requested)) return requested;
  if (installed.length === 0) return requested || config.defaultPhp;
  if (!requested) return installed.includes(config.defaultPhp) ? config.defaultPhp : installed[0]!;
  const target = Number(requested);
  return [...installed].sort((a, b) => Math.abs(Number(a) - target) - Math.abs(Number(b) - target))[0]!;
}

export const phpSocket = (version: string) => config.phpFpmSocket.replace('{version}', version);
