import { z } from 'zod';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// Per-site resource limits (server: services/siteLimits.ts). Only for sites with their own user:
// RAM and CPU are cgroup limits of the site's own systemd unit (PHP-FPM or Node), so an older
// site still on the shared pool has nothing to put them on.
// ---------------------------------------------------------------------------

export const SITE_LIMIT_KEYS = ['memoryMb', 'cpuPercent', 'phpWorkers', 'mysqlConnections'] as const;
export type SiteLimitKey = (typeof SITE_LIMIT_KEYS)[number];

export const SITE_LIMIT_RANGES: Record<SiteLimitKey, { min: number; max: number }> = {
  // below ~64 MB a PHP-FPM master or a Node process does not even start
  memoryMb: { min: 64, max: 262144 },
  // 100 = one full CPU core (systemd CPUQuota=)
  cpuPercent: { min: 5, max: 6400 },
  phpWorkers: { min: 1, max: 200 },
  mysqlConnections: { min: 1, max: 1000 },
};

const limit = (k: SiteLimitKey) =>
  z
    .number({ invalid_type_error: msg('Phải là một số') })
    .int(msg('Phải là số nguyên'))
    .min(SITE_LIMIT_RANGES[k].min, msg('Giá trị nhỏ hơn mức cho phép'))
    .max(SITE_LIMIT_RANGES[k].max, msg('Giá trị lớn hơn mức cho phép'))
    .nullable()
    .default(null);

/** null = no limit (phpWorkers: the panel default). */
export const siteLimitsSchema = z.object({
  memoryMb: limit('memoryMb'),
  cpuPercent: limit('cpuPercent'),
  phpWorkers: limit('phpWorkers'),
  mysqlConnections: limit('mysqlConnections'),
});
export type SiteLimits = z.infer<typeof siteLimitsSchema>;

export const EMPTY_SITE_LIMITS: SiteLimits = { memoryMb: null, cpuPercent: null, phpWorkers: null, mysqlConnections: null };

export interface SiteLimitsView {
  limits: SiteLimits;
  /** Which limits mean something for this site. */
  applies: {
    /** RAM / CPU: the site has its own PHP-FPM or Node unit. */
    process: boolean;
    phpWorkers: boolean;
    /** The site has a database whose MySQL user Lares created. */
    mysql: boolean;
  };
  /** systemd unit the RAM/CPU limits sit on. */
  service: string | null;
  /** pm.max_children when phpWorkers is not set. */
  defaultPhpWorkers: number;
  usage: {
    memoryBytes: number | null;
    /** Processes + threads of the unit. */
    tasks: number | null;
    mysqlConnections: number | null;
  };
  server: { cpuCount: number; memoryMb: number };
}
