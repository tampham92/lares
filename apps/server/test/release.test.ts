import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { compareVersions, pickLatestTag, UPGRADE_COMMAND } from '@lares/shared';
import { describe, expect, it } from 'vitest';
import { setSetting } from '../src/db/index.js';
import { releaseRoutes } from '../src/routes/release.js';
import { fetchLatestVersion, releaseTick, setUpdateCheck, telemetryPayload, VERSION, versionInfo } from '../src/services/release.js';
import { startUpgrade } from '../src/services/upgrade.js';
import { exitCodeOf, upgradeCommand, upgradeStatus } from '../src/services/upgradePolicy.js';

const ROOT = path.resolve(__dirname, '../../..');
const rootVersion = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

/** fetch stand-in that records the URLs it was asked for. */
function fakeFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('compareVersions', () => {
  it('follows semver precedence, prereleases included', () => {
    expect(compareVersions('0.2.0', '0.2.0-beta')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0-beta', '0.2.0-alpha')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('0.2.0-beta', '0.2.0-beta.1')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0);
  });
  it('treats garbage as "no update"', () => {
    expect(compareVersions('<script>', '0.2.0')).toBe(0);
    expect(compareVersions('', '0.2.0')).toBe(0);
  });
});

describe('version', () => {
  it('reports the version from the root package.json', () => {
    expect(VERSION).toBe(rootVersion);
    const info = versionInfo();
    expect(info.version).toBe(rootVersion);
    expect(info.upgradeCommand).toBe(UPGRADE_COMMAND);
  });

  it('flags an update only when the remote version is newer', () => {
    setSetting('release.update', { latest: '99.0.0', checkedAt: new Date().toISOString() });
    expect(versionInfo()).toMatchObject({ latest: '99.0.0', updateAvailable: true });
    setSetting('release.update', { latest: VERSION, checkedAt: new Date().toISOString() });
    expect(versionInfo().updateAvailable).toBe(false);
    setSetting('release.update', { latest: null, checkedAt: null });
  });

  it('never reports a newest release older than the running version', () => {
    // checked before the release was tagged, then upgraded: "running 0.3.0, newest 0.2.0" was shown
    setSetting('release.update', { latest: '0.0.1', checkedAt: new Date().toISOString() });
    expect(versionInfo()).toMatchObject({ latest: VERSION, updateAvailable: false });
    setSetting('release.update', { latest: null, checkedAt: null });
  });

  it('GET /api/system/version requires a login', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(releaseRoutes, { jobs: false });
    const res = await app.inject({ url: '/api/system/version' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('release tags', () => {
  it('picks the newest vX.Y.Z tag in semver order', () => {
    expect(pickLatestTag(['v0.2.0-beta', 'v0.10.0', 'v0.9.1', 'main', 'v1.0'])).toBe('0.10.0');
    expect(pickLatestTag(['v0.3.0-beta', 'v0.3.0'])).toBe('0.3.0');
    expect(pickLatestTag(['v0.3.0-beta', 'v0.2.9'])).toBe('0.3.0-beta');
    expect(pickLatestTag(['latest', 'v1.0.0;rm -rf /', '--upload-pack=x', 'v1.0.0/../x'])).toBeNull();
    expect(pickLatestTag([])).toBeNull();
  });
});

describe('update check', () => {
  it('reads the newest release from the GitHub tags API', async () => {
    const f = fakeFetch([{ name: 'v0.2.0-beta' }, { name: 'v0.3.0' }, { name: 'nightly' }, null, { name: 7 }]);
    expect(await fetchLatestVersion(f.fn)).toBe('0.3.0');
    expect(f.calls[0]).toContain('api.github.com/repos/tampham92/lares/tags');
    expect(await fetchLatestVersion(fakeFetch([]).fn)).toBeNull();
  });

  it('still reads a package.json given as LARES_UPDATE_URL', async () => {
    expect(await fetchLatestVersion(fakeFetch({ version: '0.3.0' }).fn)).toBe('0.3.0');
    expect(await fetchLatestVersion(fakeFetch({ version: 'v0.3; rm -rf /' }).fn)).toBeNull();
    expect(await fetchLatestVersion(fakeFetch({ version: '0.3.0' }, false).fn)).toBeNull();
    const failing = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await fetchLatestVersion(failing)).toBeNull();
  });

  it('checks at most once a day and never sends a heartbeat outside production', async () => {
    setSetting('release.update', { latest: null, checkedAt: null });
    setSetting('release.heartbeatAt', null);
    const f = fakeFetch([{ name: 'v99.1.0' }]);
    const logs: string[] = [];
    const now = Date.now();
    await releaseTick((m) => logs.push(m), f.fn, now);
    await releaseTick((m) => logs.push(m), f.fn, now + 3_600_000);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('/tags');
    expect(logs.join()).toContain('99.1.0');
    await releaseTick(() => {}, f.fn, now + 25 * 3_600_000);
    expect(f.calls).toHaveLength(2);
    setSetting('release.update', { latest: null, checkedAt: null });
  });
});

describe('update check after an upgrade', () => {
  it('checks again at the next tick when the answer came from another panel version', async () => {
    const now = Date.now();
    setSetting('release.update', { latest: '0.0.1', checkedAt: new Date(now).toISOString(), checkedFor: '0.0.1' });
    const f = fakeFetch([{ name: `v${VERSION}` }]);
    await releaseTick(() => {}, f.fn, now + 60_000);
    expect(f.calls).toHaveLength(1);
    await releaseTick(() => {}, f.fn, now + 3_600_000);
    expect(f.calls).toHaveLength(1);
    expect(versionInfo()).toMatchObject({ latest: VERSION, updateAvailable: false });
    setSetting('release.update', { latest: null, checkedAt: null });
  });
});

describe('update check toggle', () => {
  it('turning the check off stops the daily check and clears the known release', async () => {
    setSetting('release.update', { latest: '99.0.0', checkedAt: new Date().toISOString() });
    expect(setUpdateCheck(false)).toMatchObject({ updateCheck: false, latest: null, updateAvailable: false });
    const f = fakeFetch([{ name: 'v99.2.0' }]);
    await releaseTick(() => {}, f.fn, Date.now() + 48 * 3_600_000);
    expect(f.calls).toHaveLength(0);
    expect(setUpdateCheck(true).updateCheck).toBe(true);
    setSetting('release.update', { latest: null, checkedAt: null });
  });
});

describe('one-click upgrade', () => {
  it('runs the installer of the release tag in its own unit, with validated arguments', () => {
    const c = upgradeCommand('tampham92/lares', 'v0.3.0', '/var/lib/lares/upgrade.log');
    expect(c).toMatch(/^systemd-run --unit=lares-upgrade --collect /);
    expect(c).toContain('https://raw.githubusercontent.com/tampham92/lares/v0.3.0/install.sh');
    expect(c).toContain("--branch '\\''v0.3.0'\\''");
    expect(() => upgradeCommand('tampham92/lares', 'main', '/x')).toThrow();
    expect(() => upgradeCommand('tampham92/lares', "v1.0.0'; rm -rf /", '/x')).toThrow();
    expect(() => upgradeCommand('evil/repo; id', 'v1.0.0', '/x')).toThrow();
  });

  it('reads the status from the log file and the unit', () => {
    const meta = { target: '0.3.0', from: '0.2.0', startedAt: new Date(0).toISOString() };
    expect(upgradeStatus(null, null, false).state).toBe('idle');
    expect(upgradeStatus(meta, 'building\n', true).state).toBe('running');
    expect(upgradeStatus(meta, 'ok\n__LARES_UPGRADE_EXIT__ 0\n', false)).toMatchObject({ state: 'done', exitCode: 0, log: ['ok'] });
    expect(upgradeStatus(meta, 'npm ERR\n__LARES_UPGRADE_EXIT__ 1\n', false)).toMatchObject({ state: 'failed', exitCode: 1 });
    // no exit line and no unit long after the start: interrupted
    expect(upgradeStatus(meta, 'building\n', false)).toMatchObject({ state: 'failed', exitCode: null });
    // just started: the unit may not be visible yet
    expect(upgradeStatus({ ...meta, startedAt: new Date().toISOString() }, '', false).state).toBe('running');
    expect(upgradeStatus(meta, '\x1b[0;32m✔\x1b[0m done\n', true).log).toEqual(['✔ done']);
    expect(exitCodeOf('x\n__LARES_UPGRADE_EXIT__ 97\n')).toBe(97);
  });

  it('only upgrades to the newer release the last check found', async () => {
    setSetting('release.update', { latest: VERSION, checkedAt: new Date().toISOString() });
    await expect(startUpgrade(VERSION, () => {})).rejects.toThrow();
    setSetting('release.update', { latest: '99.0.0', checkedAt: new Date().toISOString() });
    await expect(startUpgrade('98.0.0', () => {})).rejects.toThrow();
    const logs: string[] = [];
    const status = await startUpgrade('99.0.0', (m) => logs.push(m));
    // tests run in dry-run: the command is only logged and the run is recorded as finished
    expect(logs.join('\n')).toContain('[dry-run] systemd-run');
    expect(status).toMatchObject({ state: 'done', target: '99.0.0', from: VERSION });
    setSetting('release.update', { latest: null, checkedAt: null });
    setSetting('release.upgrade', null);
  });
});

describe('telemetry payload', () => {
  it('contains exactly the documented fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lares-os-'));
    const file = path.join(dir, 'os-release');
    fs.writeFileSync(file, 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nHOSTNAME=secret-box\n');
    const p = telemetryPayload('heartbeat', '0b5c3f9e-2f4b-4e7a-9d2a-6c1f0e8a7b3d', file);
    expect(Object.keys(p).sort()).toEqual(['arch', 'event', 'install_id', 'lang', 'os', 'os_version', 'version']);
    expect(p).toMatchObject({ install_id: '0b5c3f9e-2f4b-4e7a-9d2a-6c1f0e8a7b3d', event: 'heartbeat', os: 'ubuntu', os_version: '24.04', version: VERSION });
    expect(JSON.stringify(p)).not.toContain('secret-box');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
