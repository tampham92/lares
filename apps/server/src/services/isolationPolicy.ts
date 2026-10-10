import path from 'node:path';
import { shq } from '../lib/shell.js';

/*
 * Per-site isolation - the pure part (names, paths, generated files). I/O lives in isolation.ts.
 *
 * Threat model: one site's PHP (or Node) code is hijacked - a vulnerable WordPress plugin is the usual
 * way in. What the attacker must not get from there: the other sites' files and wp-config.php
 * secrets, the other sites' sessions, the machine's RAM/CPU, the panel, and a foothold that survives
 * cleaning the site (cron, dropped binaries). The layers, each closing one path:
 *
 *  - Linux user per site (`lares-s<id>`), site root 0750: other sites cannot even traverse it. nginx's
 *    user joins each site's group to read static files; PHP files and secrets are never read by nginx.
 *  - PHP-FPM master per site, started by systemd as the site user (no root process at all), with its
 *    own OPcache (a shared master shares the cache between pools) and its own cgroup (real limits).
 *  - systemd sandbox around PHP-FPM and Node: read-only system, private /tmp, the other sites' folders
 *    hidden, Lares' own data and secrets inaccessible, no executing files dropped in the site or /tmp.
 *  - nftables rules on the site uids: no direct SMTP (spam), no cloud metadata service (instance
 *    credentials), no panel/Adminer port on loopback (the panel's IP allowlist trusts loopback).
 *  - Site users in cron.deny / at.deny, shell nologin, no password: no way to schedule a comeback.
 *
 * Not covered here: a kernel exploit (root) - that is what OS security updates are for.
 */

/** Linux account of an isolated site. From the id: stable across domain changes, never reused (AUTOINCREMENT). */
export const siteUserName = (siteId: number): string => {
  if (!Number.isSafeInteger(siteId) || siteId < 1) throw new Error(`invalid site id: ${siteId}`);
  return `lares-s${siteId}`;
};

/** The only names Lares ever creates, deletes or writes into deny lists. */
export const SITE_USER_RE = /^lares-s[1-9]\d{0,9}$/;

/** PHP's functions that start another program. Off by default for new sites (php_admin_value, cannot be undone by the site). */
export const EXEC_FUNCTIONS = ['exec', 'passthru', 'shell_exec', 'system', 'proc_open', 'popen', 'pcntl_exec'] as const;

/** Default pm.max_children per site. Debian's single shared `www` pool had 5 for all sites together. */
export const DEFAULT_PHP_MAX_CHILDREN = 8;

export interface SitePhpPaths {
  /** systemd unit name (without .service). */
  unit: string;
  unitFile: string;
  /** php-fpm.conf of the site's master. */
  conf: string;
  /** /run/<runtimeName>: created by systemd (RuntimeDirectory=), owned by the site user, group-readable by nginx. */
  runtimeName: string;
  socket: string;
  pid: string;
  /** /var/lib/<runtimeName> itself: persistent, private to the site user, created by systemd (StateDirectory=). */
  sessions: string;
}

export function sitePhpPaths(siteId: number, dirs: { systemdDir: string; poolDir: string }): SitePhpPaths {
  siteUserName(siteId); // validates the id
  const unit = `lares-php-${siteId}`;
  return {
    unit,
    unitFile: path.join(dirs.systemdDir, `${unit}.service`),
    conf: path.join(dirs.poolDir, `${siteId}.conf`),
    runtimeName: unit,
    socket: `/run/${unit}/php.sock`,
    pid: `/run/${unit}/php-fpm.pid`,
    sessions: `/var/lib/${unit}`,
  };
}

/** Debian/Ubuntu binary of a PHP version's FPM. */
export const fpmBinary = (version: string): string => {
  if (!/^\d\.\d$/.test(version)) throw new Error(`invalid PHP version: ${version}`);
  return `/usr/sbin/php-fpm${version}`;
};

/** A path for a systemd setting: written as is when plain, quoted otherwise (dev checkouts with spaces). */
export function unitPathArg(p: string, prefix = ''): string {
  if (/[\n\r\0]/.test(p)) throw new Error(`invalid path: ${JSON.stringify(p)}`);
  return /^[\w./@:+~-]+$/.test(p) ? `${prefix}${p}` : `"${prefix}${p.replace(/["\\]/g, '\\$&')}"`;
}

/** systemd unit names, file names and descriptions must never carry a newline (it would add a setting). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

// ---- PHP-FPM ----------------------------------------------------------------------

export interface SitePoolOptions {
  siteId: number;
  domain: string;
  paths: SitePhpPaths;
  maxChildren: number;
  /** false = exec(), shell_exec()... disabled (EXEC_FUNCTIONS). */
  execAllowed: boolean;
}

/**
 * php-fpm.conf of a site's own master. No user/group lines: the master already runs as the site
 * user (systemd User=), so there is no root process and nothing to drop privileges from.
 * PHP errors still reach the site's nginx error log over FastCGI (no catch_workers_output), as before.
 * No open_basedir: the sandbox already hides the other sites, and open_basedir costs the realpath cache.
 */
export function renderSitePool(o: SitePoolOptions): string {
  const n = Math.trunc(o.maxChildren);
  if (!(n >= 1 && n <= 500)) throw new Error(`invalid pm.max_children: ${o.maxChildren}`);
  const lines = [
    `; Managed by Lares Panel - PHP-FPM for ${oneLine(o.domain)} (site ${o.siteId}). Rewritten by the panel, do not edit.`,
    '[global]',
    `pid = ${o.paths.pid}`,
    'error_log = syslog',
    `syslog.ident = ${o.paths.unit}`,
    // a worker crashing in a loop restarts the master instead of leaving the site down
    'emergency_restart_threshold = 10',
    'emergency_restart_interval = 1m',
    'process_control_timeout = 10s',
    '',
    `[${siteUserName(o.siteId)}]`,
    `listen = ${o.paths.socket}`,
    // owner = the site user, group = its group, which nginx's user belongs to
    'listen.mode = 0660',
    // idle sites keep no worker at all: only the master (~15 MB) stays in memory
    'pm = ondemand',
    `pm.max_children = ${n}`,
    'pm.process_idle_timeout = 30s',
    'pm.max_requests = 500',
    // same as fastcgi_read_timeout in the vhost
    'request_terminate_timeout = 300s',
    'security.limit_extensions = .php',
    `php_admin_value[session.save_path] = ${o.paths.sessions}`,
    // Debian's php.ini sets gc_probability = 0 and cleans /var/lib/php/sessions from cron; this folder is not in that cron
    'php_admin_value[session.gc_probability] = 1',
    'php_admin_value[session.gc_divisor] = 1000',
    // /tmp is the unit's private /tmp (PrivateTmp=)
    'php_admin_value[upload_tmp_dir] = /tmp',
    'php_admin_value[sys_temp_dir] = /tmp',
    'php_admin_flag[expose_php] = off',
  ];
  if (!o.execAllowed) lines.push(`php_admin_value[disable_functions] = ${EXEC_FUNCTIONS.join(',')}`);
  return `${lines.join('\n')}\n`;
}

/** What else the sandbox must allow or hide - found on the machine by isolation.ts. */
export interface SandboxOptions {
  rootPath: string;
  /** Parent of every site folder: hidden behind an empty tmpfs, only this site's folder is mounted back. */
  sitesRoot: string;
  /** Lares' data, secrets and backups (InaccessiblePaths=, ignored when missing). */
  hidden: string[];
  /**
   * A local MTA's sendmail needs its setgid/setuid helper (postdrop, exim) and a writable spool:
   * NoNewPrivileges= would make PHP's mail() fail. null = no such MTA, keep NoNewPrivileges=yes.
   */
  mta: { spool: string[] } | null;
  /** Forbid executing files from the site folder too (PHP-FPM yes; Node runs node_modules/.bin scripts). */
  noExecSite: boolean;
}

export function sandboxLines(o: SandboxOptions): string[] {
  const root = path.resolve(o.rootPath);
  const sitesRoot = path.resolve(o.sitesRoot);
  const insideSitesRoot = root.startsWith(sitesRoot + path.sep);
  const lines = [
    '# Sandbox: a hijacked site keeps to its own folder (services/isolationPolicy.ts)',
    `NoNewPrivileges=${o.mta ? 'no' : 'yes'}`,
    'RestrictSUIDSGID=yes',
    'PrivateTmp=yes',
    'PrivateDevices=yes',
    'ProtectSystem=strict',
    'ProtectHome=yes',
    'ProtectProc=invisible',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectKernelLogs=yes',
    'ProtectControlGroups=yes',
    'ProtectClock=yes',
    'ProtectHostname=yes',
    'RestrictRealtime=yes',
    'RestrictNamespaces=yes',
    'LockPersonality=yes',
    `ReadWritePaths=${unitPathArg(root)}`,
  ];
  if (insideSitesRoot) lines.push(`TemporaryFileSystem=${unitPathArg(sitesRoot)}:ro`, `BindPaths=${unitPathArg(root)}`);
  if (o.mta) lines.push(...o.mta.spool.map((p) => `ReadWritePaths=${unitPathArg(p, '-')}`));
  const hidden = [...new Set(o.hidden.map((p) => path.resolve(p)))].filter((p) => p !== root && !root.startsWith(p + path.sep));
  if (hidden.length) lines.push(`InaccessiblePaths=${hidden.map((p) => unitPathArg(p, '-')).join(' ')}`);
  // a binary dropped by an exploit cannot be started from where it can be written
  const noExec = ['/tmp', '/var/tmp', '/dev/shm', ...(o.noExecSite ? [root] : [])];
  lines.push(`NoExecPaths=${noExec.map((p) => unitPathArg(p)).join(' ')}`);
  return lines;
}

export interface SitePhpUnitOptions {
  siteId: number;
  domain: string;
  phpVersion: string;
  user: string;
  paths: SitePhpPaths;
  sandbox: Omit<SandboxOptions, 'noExecSite'>;
  tasksMax: number;
}

export function renderSitePhpUnit(o: SitePhpUnitOptions): string {
  if (!SITE_USER_RE.test(o.user)) throw new Error(`invalid site user: ${o.user}`);
  const bin = fpmBinary(o.phpVersion);
  return `# Managed by Lares Panel - PHP-FPM ${o.phpVersion} for ${oneLine(o.domain)} (site ${o.siteId}). Rewritten by the panel, do not edit.
[Unit]
Description=Lares PHP-FPM ${o.phpVersion} for ${oneLine(o.domain)}
After=network.target lares-site-firewall.service
Wants=lares-site-firewall.service

[Service]
Type=notify
User=${o.user}
Group=${o.user}
UMask=0027
ExecStart=${bin} --nodaemonize --fpm-config ${unitPathArg(o.paths.conf)}
ExecReload=/bin/kill -USR2 $MAINPID
Restart=on-failure
RestartSec=3
RuntimeDirectory=${o.paths.runtimeName}
RuntimeDirectoryMode=0750
StateDirectory=${o.paths.runtimeName}
StateDirectoryMode=0700
TasksMax=${Math.trunc(o.tasksMax)}
${sandboxLines({ ...o.sandbox, noExecSite: true }).join('\n')}

[Install]
WantedBy=multi-user.target
`;
}

// ---- Outbound firewall (nftables) ---------------------------------------------------

export const FIREWALL_TABLE = 'lares_sites';
export const FIREWALL_UNIT = 'lares-site-firewall';

/**
 * Rules for the isolated sites' uids. The file replaces the whole table in one transaction (the
 * `table` line first makes the `delete` valid when the table does not exist yet); with no uid it
 * only removes the table. Rules match outgoing traffic of the site processes only: nginx, the panel
 * and everything else on the machine are untouched.
 */
export function renderSiteFirewall(o: { uids: number[]; localPorts: number[] }): string {
  const uids = [...new Set(o.uids)].filter((u) => Number.isSafeInteger(u) && u > 0).sort((a, b) => a - b);
  const ports = [...new Set(o.localPorts)].filter((p) => Number.isInteger(p) && p > 0 && p < 65536).sort((a, b) => a - b);
  const head = `# Managed by Lares Panel - outbound rules for isolated sites. Rewritten by the panel, do not edit.\ntable inet ${FIREWALL_TABLE}\ndelete table inet ${FIREWALL_TABLE}\n`;
  if (!uids.length) return head;
  const who = `meta skuid { ${uids.join(', ')} }`;
  const rules = [
    // Direct-to-MX mail from a hijacked site is spam sent under this server's IP. Sites that send
    // mail authenticate on a submission port (587/465) of their mail provider, which stays open.
    `${who} tcp dport 25 counter drop`,
    // The cloud metadata service hands out the instance's credentials to any local process.
    `${who} ip daddr 169.254.169.254 counter drop`,
    `${who} ip6 daddr fd00:ec2::254 counter drop`,
  ];
  // The panel trusts loopback in its IP allowlist (SSH tunnel escape hatch); Adminer listens on loopback.
  if (ports.length) {
    const set = `{ ${ports.join(', ')} }`;
    rules.push(`${who} ip daddr 127.0.0.0/8 tcp dport ${set} counter drop`, `${who} ip6 daddr ::1 tcp dport ${set} counter drop`);
  }
  return `${head}table inet ${FIREWALL_TABLE} {
    chain output {
        type filter hook output priority 0; policy accept;
${rules.map((r) => `        ${r}`).join('\n')}
    }
}
`;
}

/** Loads the rules at boot, before the sites' PHP-FPM (ordered after nftables.service, which flushes the ruleset). */
export function renderFirewallUnit(nftBin: string, rulesFile: string): string {
  return `# Managed by Lares Panel - outbound rules for isolated sites. Rewritten by the panel, do not edit.
[Unit]
Description=Lares Panel - outbound firewall for isolated sites
After=nftables.service ufw.service
Before=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${unitPathArg(nftBin)} -f ${unitPathArg(rulesFile)}

[Install]
WantedBy=multi-user.target
`;
}

// ---- cron.deny / at.deny ---------------------------------------------------------------

/**
 * New content of a deny list (one user per line) with `user` added or removed. Other lines are
 * kept as they are. null = no change needed.
 */
export function editDenyList(content: string | null, user: string, present: boolean): string | null {
  if (!SITE_USER_RE.test(user)) throw new Error(`invalid site user: ${user}`);
  const lines = (content ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const has = lines.some((l) => l.trim() === user);
  if (has === present) return null;
  const next = present ? [...lines, user] : lines.filter((l) => l.trim() !== user);
  return next.length ? `${next.join('\n')}\n` : '';
}

// ---- File ownership and modes ---------------------------------------------------------

/**
 * Shell commands that give a site folder to its owner. `asOwner(cmd)` wraps a command to run as that
 * owner (runuser).
 *
 * Isolated sites: root only chowns (chown -R never follows symlinks); the chmods then run AS THE
 * SITE USER, who owns every file by then. A file swapped for a symlink to /etc/... between `find`
 * and `chmod` (the site's code may be hostile) can then only hit files the site user could change
 * anyway. Folders 0750 / files 0640: nginx reads through the group, other sites see nothing.
 * wp-config.php and .env* 0600: nginx never needs them, so not even a symlink trick serves them.
 *
 * Legacy (shared www-data) sites keep the historical 755/644 layout.
 */
export function permissionCommands(rootPath: string, owner: string, isolated: boolean, asOwner: (cmd: string) => string): string[] {
  const root = shq(rootPath);
  const stripSetid = `find ${root} -type f -perm /6000 -exec chmod ug-s {} +`;
  if (!isolated) {
    return [
      `chown -R ${shq(`${owner}:${owner}`)} ${root}`,
      `find ${root} -type d -exec chmod 755 {} +`,
      `find ${root} -type f -not -perm -u+x -exec chmod 644 {} +`,
      // never keep setuid/setgid binaries that arrived inside a migrated archive
      stripSetid,
    ];
  }
  if (!SITE_USER_RE.test(owner)) throw new Error(`invalid site user: ${owner}`);
  return [
    `chown -R -h ${shq(`${owner}:${owner}`)} ${root}`,
    asOwner(
      [
        `find ${root} -type d -exec chmod 750 {} +`,
        `find ${root} -type f -not -perm -u+x -exec chmod 640 {} +`,
        `find ${root} -type f \\( -name wp-config.php -o -name .env -o -name '.env.*' \\) -exec chmod 600 {} +`,
        stripSetid,
      ].join(' && '),
    ),
  ];
}
