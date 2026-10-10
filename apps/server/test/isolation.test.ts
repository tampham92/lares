import { describe, expect, it } from 'vitest';
import {
  EXEC_FUNCTIONS,
  editDenyList,
  permissionCommands,
  renderFirewallUnit,
  renderSiteFirewall,
  renderSitePhpUnit,
  renderSitePool,
  sandboxLines,
  siteUserName,
  sitePhpPaths,
  unitPathArg,
} from '../src/services/isolationPolicy.js';
import { parsePoolFile } from '../src/services/phpSettings.js';
import { renderVhost, type VhostSpec } from '../src/services/nginx.js';

const paths = sitePhpPaths(12, { systemdDir: '/etc/systemd/system', poolDir: '/etc/lares/php' });
const sandbox = { rootPath: '/var/www/example.com', sitesRoot: '/var/www', hidden: ['/var/lib/lares', '/etc/lares/ssl', '/etc/lares/lares.env'], mta: null };

describe('site user', () => {
  it('derives a stable name from the id and refuses anything else', () => {
    expect(siteUserName(12)).toBe('lares-s12');
    expect(() => siteUserName(0)).toThrow();
    expect(() => siteUserName(1.5)).toThrow();
    expect(paths).toMatchObject({
      unit: 'lares-php-12',
      unitFile: '/etc/systemd/system/lares-php-12.service',
      conf: '/etc/lares/php/12.conf',
      socket: '/run/lares-php-12/php.sock',
      sessions: '/var/lib/lares-php-12',
    });
  });
});

describe('site PHP-FPM pool', () => {
  const base = { siteId: 12, domain: 'example.com', paths, maxChildren: 8 };

  it('runs without user/group lines (the master already is the site user) and keeps sessions private', () => {
    const conf = renderSitePool({ ...base, execAllowed: true });
    expect(conf).not.toMatch(/^\s*(user|group)\s*=/m);
    expect(conf).toContain('listen = /run/lares-php-12/php.sock');
    expect(conf).toContain('php_admin_value[session.save_path] = /var/lib/lares-php-12');
    expect(conf).toContain('pm = ondemand');
    expect(conf).toContain('pm.max_children = 8');
    expect(conf).not.toContain('disable_functions');
  });

  it('disables exec & co. with php_admin_value when asked', () => {
    const conf = renderSitePool({ ...base, execAllowed: false });
    expect(conf).toContain(`php_admin_value[disable_functions] = ${EXEC_FUNCTIONS.join(',')}`);
  });

  it('is read back by the PHP settings tab as the pool serving the site socket', () => {
    const pools = parsePoolFile(renderSitePool({ ...base, execAllowed: false }));
    expect([...pools.keys()]).toEqual(['lares-s12']);
    expect(pools.get('lares-s12')!.listen).toBe(paths.socket);
  });

  it('rejects absurd worker counts and keeps a domain on one comment line', () => {
    expect(() => renderSitePool({ ...base, maxChildren: 0, execAllowed: false })).toThrow();
    const conf = renderSitePool({ ...base, domain: 'a.com\nuser = root', execAllowed: false });
    expect(conf).not.toMatch(/^user = root/m);
  });
});

describe('site PHP-FPM unit', () => {
  const unit = renderSitePhpUnit({ siteId: 12, domain: 'example.com', phpVersion: '8.3', user: 'lares-s12', paths, sandbox, tasksMax: 256 });

  it('starts the version binary as the site user, with its own runtime and state dirs', () => {
    expect(unit).toContain('User=lares-s12\nGroup=lares-s12');
    expect(unit).toContain('ExecStart=/usr/sbin/php-fpm8.3 --nodaemonize --fpm-config /etc/lares/php/12.conf');
    expect(unit).toContain('Type=notify');
    expect(unit).toContain('RuntimeDirectory=lares-php-12\nRuntimeDirectoryMode=0750');
    expect(unit).toContain('StateDirectory=lares-php-12');
  });

  it('sandboxes it: read-only system, other sites hidden, no exec from writable places', () => {
    for (const line of ['NoNewPrivileges=yes', 'ProtectSystem=strict', 'PrivateTmp=yes', 'ProtectHome=yes', 'ProtectProc=invisible', 'ReadWritePaths=/var/www/example.com', 'TemporaryFileSystem=/var/www:ro', 'BindPaths=/var/www/example.com']) {
      expect(unit).toContain(line);
    }
    expect(unit).toContain('InaccessiblePaths=-/var/lib/lares -/etc/lares/ssl -/etc/lares/lares.env');
    expect(unit).toContain('NoExecPaths=/tmp /var/tmp /dev/shm /var/www/example.com');
  });

  it('refuses users it did not create and unknown PHP versions', () => {
    expect(() => renderSitePhpUnit({ siteId: 12, domain: 'x', phpVersion: '8.3', user: 'root', paths, sandbox, tasksMax: 256 })).toThrow();
    expect(() => renderSitePhpUnit({ siteId: 12, domain: 'x', phpVersion: '8.3; rm -rf /', user: 'lares-s12', paths, sandbox, tasksMax: 256 })).toThrow();
  });
});

describe('sandbox lines', () => {
  it('lets a local MTA work (setgid helper + spool) and never hides the site itself', () => {
    const lines = sandboxLines({ ...sandbox, hidden: ['/var/www/example.com', '/var', '/var/lib/lares'], mta: { spool: ['/var/spool/postfix/maildrop'] }, noExecSite: false });
    expect(lines).toContain('NoNewPrivileges=no');
    expect(lines).toContain('ReadWritePaths=-/var/spool/postfix/maildrop');
    expect(lines).toContain('InaccessiblePaths=-/var/lib/lares');
    expect(lines).toContain('NoExecPaths=/tmp /var/tmp /dev/shm');
  });

  it('skips the tmpfs over the sites folder when the site lives elsewhere', () => {
    const lines = sandboxLines({ ...sandbox, rootPath: '/srv/legacy/site', noExecSite: true });
    expect(lines.some((l) => l.startsWith('TemporaryFileSystem='))).toBe(false);
    expect(lines).toContain('ReadWritePaths=/srv/legacy/site');
  });

  it('quotes paths systemd would split', () => {
    expect(unitPathArg('/Users/me/My Projects/data')).toBe('"/Users/me/My Projects/data"');
    expect(unitPathArg('/var/lib/lares', '-')).toBe('-/var/lib/lares');
    expect(() => unitPathArg('/a\nExecStart=/bin/sh')).toThrow();
  });
});

describe('outbound firewall', () => {
  it('drops SMTP, cloud metadata and the panel/Adminer ports for the site uids only', () => {
    const rules = renderSiteFirewall({ uids: [1002, 1001, 1001], localPorts: [8686, 18686] });
    expect(rules).toContain('table inet lares_sites\ndelete table inet lares_sites\n');
    expect(rules).toContain('meta skuid { 1001, 1002 } tcp dport 25 counter drop');
    expect(rules).toContain('meta skuid { 1001, 1002 } ip daddr 169.254.169.254 counter drop');
    expect(rules).toContain('meta skuid { 1001, 1002 } ip daddr 127.0.0.0/8 tcp dport { 8686, 18686 } counter drop');
    expect(rules).toContain('policy accept;');
    expect(rules).not.toMatch(/dport (587|465)/);
  });

  it('only removes the table when no site is isolated', () => {
    const rules = renderSiteFirewall({ uids: [], localPorts: [8686] });
    expect(rules).not.toContain('chain');
    expect(rules.trim().split('\n').slice(1)).toEqual(['table inet lares_sites', 'delete table inet lares_sites']);
  });

  it('boots after nftables.service, which flushes the whole ruleset', () => {
    expect(renderFirewallUnit('/usr/sbin/nft', '/etc/lares/site-firewall.nft')).toMatch(/After=nftables\.service[\s\S]*ExecStart=\/usr\/sbin\/nft -f \/etc\/lares\/site-firewall\.nft/);
  });
});

describe('deny lists', () => {
  it('adds and removes only the site user line', () => {
    expect(editDenyList(null, 'lares-s3', true)).toBe('lares-s3\n');
    expect(editDenyList('bob\n', 'lares-s3', true)).toBe('bob\nlares-s3\n');
    expect(editDenyList('bob\nlares-s3\n', 'lares-s3', true)).toBeNull();
    expect(editDenyList('bob\nlares-s3\n', 'lares-s3', false)).toBe('bob\n');
    expect(editDenyList('bob\n', 'lares-s3', false)).toBeNull();
    expect(() => editDenyList('', 'root', true)).toThrow();
  });
});

describe('permissions', () => {
  const asOwner = (c: string) => `AS(${c})`;

  it('keeps the historical layout for sites on the shared web user', () => {
    const cmds = permissionCommands('/var/www/a.com', 'www-data', false, asOwner);
    expect(cmds[0]).toBe("chown -R 'www-data:www-data' '/var/www/a.com'");
    expect(cmds.join('\n')).toContain('chmod 755');
    expect(cmds.join('\n')).not.toContain('AS(');
  });

  it('chowns as root without following links, then chmods as the site user', () => {
    const [chown, rest] = permissionCommands('/var/www/a.com', 'lares-s4', true, asOwner);
    expect(chown).toBe("chown -R -h 'lares-s4:lares-s4' '/var/www/a.com'");
    expect(rest).toMatch(/^AS\(/);
    for (const part of ['chmod 750', 'chmod 640', '-name wp-config.php', 'chmod 600', 'chmod ug-s']) expect(rest).toContain(part);
    expect(() => permissionCommands('/var/www/a.com', 'root', true, asOwner)).toThrow();
  });
});

describe('vhost of an isolated site', () => {
  const spec: VhostSpec = {
    domain: 'example.com',
    aliases: [],
    appType: 'wordpress',
    webRoot: '/var/www/example.com/public_html',
    phpVersion: '8.3',
    phpSocket: '/run/lares-php-12/php.sock',
    appPort: null,
    accessLog: true,
    disabled: false,
    ssl: null,
  };

  it("sends PHP to the site's own socket and refuses foreign symlinks", () => {
    const conf = renderVhost(spec);
    expect(conf).toContain('fastcgi_pass unix:/run/lares-php-12/php.sock;');
    expect(conf).toContain('disable_symlinks if_not_owner from=$document_root;');
  });

  it('keeps the shared pool for older sites', () => {
    expect(renderVhost({ ...spec, phpSocket: null })).toContain('fastcgi_pass unix:/run/php/php8.3-fpm.sock;');
  });
});
