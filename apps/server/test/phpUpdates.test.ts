import { describe, expect, it } from 'vitest';
import { setSetting } from '../src/db/index.js';
import {
  autoUpdateDue,
  branchesToRestart,
  branchOf,
  groupUpdates,
  packagesToUpgrade,
  parseInstalled,
  parseSimulation,
  phpSupport,
  simulateCommand,
  upgradeCommand,
  upstreamOf,
} from '../src/services/phpUpdatePolicy.js';
import { checkPhpUpdates, getPhpUpdates, startPhpUpgrade } from '../src/services/phpUpdates.js';
import { getTask } from '../src/services/tasks.js';

// `apt-get -s --only-upgrade install ...` on Ubuntu 24.04 with the ondrej PPA, trimmed
const SIMULATION = `NOTE: This is only a simulation!
      apt-get needs root privileges for real execution.
Reading package lists...
Building dependency tree...
The following NEW packages will be installed:
  libonig6
The following packages will be upgraded:
  php-common php8.3-cli php8.3-common php8.3-fpm php7.4-fpm
5 upgraded, 1 newly installed, 0 to remove and 12 not upgraded.
Inst php-common [2:93+ubuntu24.04.1+deb.sury.org+2] (2:94+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [all])
Inst php8.3-common [8.3.12-1+ubuntu24.04.1+deb.sury.org+1] (8.3.14-1+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [amd64])
Inst libonig6:amd64 (6.9.9-1build1 Ubuntu:24.04/noble [amd64])
Inst php8.3-cli [8.3.12-1+ubuntu24.04.1+deb.sury.org+1] (8.3.14-1+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [amd64])
Inst php8.3-fpm [8.3.12-1+ubuntu24.04.1+deb.sury.org+1] (8.3.14-1+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [amd64]) []
Inst php7.4-fpm [7.4.33-20+ubuntu24.04.1+deb.sury.org+1] (7.4.33-21+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [amd64])
Conf php-common (2:94+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [all])
Conf php8.3-fpm (8.3.14-1+ubuntu24.04.1+deb.sury.org+1 ppa.launchpadcontent.net/ondrej/php/ubuntu:24.04/noble [amd64])`;

describe('PHP update rules', () => {
  it('reads apt dry runs, new dependencies included', () => {
    const p = parseSimulation(SIMULATION);
    expect(p.map((x) => x.name)).toEqual(['php-common', 'php8.3-common', 'libonig6', 'php8.3-cli', 'php8.3-fpm', 'php7.4-fpm']);
    expect(p.find((x) => x.name === 'libonig6')).toEqual({ name: 'libonig6', from: null, to: '6.9.9-1build1' });
    expect(p.find((x) => x.name === 'php8.3-fpm')).toEqual({ name: 'php8.3-fpm', from: '8.3.12-1+ubuntu24.04.1+deb.sury.org+1', to: '8.3.14-1+ubuntu24.04.1+deb.sury.org+1' });
  });

  it('reads installed packages, skipping removed ones and odd names', () => {
    const m = parseInstalled(['ii \tphp8.3-fpm\t8.3.12-1', 'rc \tphp8.0-fpm\t8.0.30-1', "ii \tphp8.3-x';rm -rf /\t1", 'ii \tphp-common\t2:93', ''].join('\n'));
    expect([...m]).toEqual([
      ['php8.3-fpm', '8.3.12-1'],
      ['php-common', '2:93'],
    ]);
  });

  it('takes the upstream version and the branch from package data', () => {
    expect(upstreamOf('8.3.14-1+ubuntu24.04.1+deb.sury.org+1')).toBe('8.3.14');
    expect(upstreamOf('2:93+ubuntu24.04.1+deb.sury.org+2')).toBe('93');
    expect(branchOf('php8.3-fpm')).toBe('8.3');
    expect(branchOf('php7.4')).toBe('7.4');
    expect(branchOf('php-common')).toBeNull();
    expect(branchOf('php-imagick')).toBeNull();
  });

  it("knows php.net's support dates", () => {
    const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
    expect(phpSupport('7.4', at('2026-10-22'))).toEqual({ support: 'eol', eolDate: '2022-11-28' });
    expect(phpSupport('8.1', at('2026-10-22')).support).toBe('eol');
    expect(phpSupport('8.2', at('2026-10-22'))).toEqual({ support: 'ending', eolDate: '2026-12-31' });
    expect(phpSupport('8.2', at('2026-12-31')).support).toBe('ending');
    expect(phpSupport('8.2', at('2027-01-01')).support).toBe('eol');
    expect(phpSupport('8.3', at('2026-10-22')).support).toBe('supported');
    expect(phpSupport('9.0').support).toBe('supported');
    expect(phpSupport('5.4').support).toBe('unknown');
  });

  it('groups pending updates per installed branch with the sites using it', () => {
    const installed = new Map([
      ['php8.3-fpm', '8.3.12-1+ubuntu24.04.1+deb.sury.org+1'],
      ['php7.4-fpm', '7.4.33-20+ubuntu24.04.1+deb.sury.org+1'],
      ['php8.2-fpm', '8.2.29-1'],
    ]);
    const g = groupUpdates(['7.4', '8.3', '8.2'], installed, parseSimulation(SIMULATION), new Map([['7.4', 2]]), Date.parse('2026-10-22'));
    expect(g.branches.map((b) => [b.branch, b.installed, b.available, b.packages.length, b.support, b.sites])).toEqual([
      ['8.3', '8.3.12', '8.3.14', 3, 'supported', 0],
      ['8.2', '8.2.29', null, 0, 'ending', 0],
      // a rebuilt package: same upstream version, new packaging revision
      ['7.4', '7.4.33', '7.4.33', 1, 'eol', 2],
    ]);
    expect(g.others.map((p) => p.name)).toEqual(['php-common', 'libonig6']);
  });

  it('upgrades PHP packages only, by branch when asked', () => {
    const pending = parseSimulation(SIMULATION);
    expect(packagesToUpgrade(pending)).toEqual(['php-common', 'php8.3-common', 'php8.3-cli', 'php8.3-fpm', 'php7.4-fpm']);
    expect(packagesToUpgrade(pending, ['7.4'])).toEqual(['php-common', 'php7.4-fpm']);
    expect(packagesToUpgrade(pending, ['8.0'])).toEqual(['php-common']);
  });

  it('restarts the touched branches, or all of them when a library changes', () => {
    const phpOnly = parseSimulation(SIMULATION).filter((p) => p.name !== 'libonig6');
    expect(branchesToRestart(['php7.4-fpm', 'php-common'], phpOnly, ['8.3', '8.2', '7.4'])).toEqual(['7.4']);
    expect(branchesToRestart(['php-common'], phpOnly, ['8.3', '7.4'])).toEqual([]);
    expect(branchesToRestart(['php7.4-fpm'], parseSimulation(SIMULATION), ['8.3', '7.4'])).toEqual(['8.3', '7.4']);
  });

  it('builds apt commands that keep config files and refuse odd package names', () => {
    const cmd = upgradeCommand(['php8.3-fpm', 'php-common']);
    expect(cmd).toContain("--only-upgrade install 'php8.3-fpm' 'php-common'");
    expect(cmd).toContain('--force-confold');
    expect(cmd).toContain('NEEDRESTART_SUSPEND=1');
    expect(simulateCommand(['php8.3-fpm'])).toContain('apt-get -s ');
    expect(() => upgradeCommand(['php8.3-fpm', '-o APT::x'])).toThrow();
    expect(() => upgradeCommand(['nginx'])).toThrow();
    expect(() => simulateCommand(["php'; reboot"])).toThrow();
    expect(() => upgradeCommand([])).toThrow();
  });

  it('runs the automatic update at night, once a day, only when there is something to install', () => {
    const night = new Date(2026, 9, 22, 3, 10);
    const base = { autoUpdate: true, pending: 3, lastAutoAt: null, now: night };
    expect(autoUpdateDue(base)).toBe(true);
    expect(autoUpdateDue({ ...base, autoUpdate: false })).toBe(false);
    expect(autoUpdateDue({ ...base, pending: 0 })).toBe(false);
    expect(autoUpdateDue({ ...base, now: new Date(2026, 9, 22, 14, 0) })).toBe(false);
    expect(autoUpdateDue({ ...base, now: new Date(2026, 9, 22, 6, 0) })).toBe(false);
    expect(autoUpdateDue({ ...base, lastAutoAt: new Date(2026, 9, 22, 2, 5).toISOString() })).toBe(false);
    expect(autoUpdateDue({ ...base, lastAutoAt: new Date(2026, 9, 21, 2, 5).toISOString() })).toBe(true);
  });
});

describe('PHP updates (dry-run)', () => {
  it('checks, installs and records the run', async () => {
    setSetting('php.updates', { checkedAt: null, error: null, pending: [] });
    setSetting('php.lastRun', null);
    expect(() => startPhpUpgrade()).toThrow(/Kiểm tra ngay/);

    const checked = await checkPhpUpdates();
    expect(checked.checkedAt).not.toBeNull();
    // which branches show depends on the machine running the tests (/etc/php); the packages do not
    const all = (v: typeof checked) => [...v.branches.flatMap((b) => b.packages), ...v.others].map((p) => p.name);
    expect(all(checked)).toContain('php8.3-fpm');

    const task = startPhpUpgrade({ branches: ['8.3'] });
    expect((await getPhpUpdates()).running).toBe(task.id);
    expect(() => startPhpUpgrade()).toThrow();
    for (let i = 0; i < 100 && getTask(task.id)!.status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    const done = getTask(task.id)!;
    expect(done.status).toBe('completed');
    expect(done.logs.map((l) => l.msg).join('\n')).toMatch(/\[dry-run\] .*apt-get .*--force-confold --only-upgrade install 'php8\.3-fpm' 'php8\.3-cli' 'php8\.3-common' 'php-common'$/m);

    const after = await getPhpUpdates();
    expect(after.running).toBeNull();
    expect(after.lastRun).toMatchObject({ ok: true, auto: false, branches: ['8.3'] });
    expect(all(after)).toEqual([]);
  });
});
