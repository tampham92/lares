import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { compareVersions, UPGRADE_COMMAND } from '@lares/shared';
import { describe, expect, it } from 'vitest';
import { setSetting } from '../src/db/index.js';
import { releaseRoutes } from '../src/routes/release.js';
import { fetchLatestVersion, releaseTick, telemetryPayload, VERSION, versionInfo } from '../src/services/release.js';

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

  it('GET /api/system/version requires a login', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(releaseRoutes, { jobs: false });
    const res = await app.inject({ url: '/api/system/version' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('update check', () => {
  it('reads and validates the remote version', async () => {
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
    const f = fakeFetch({ version: '99.1.0' });
    const logs: string[] = [];
    const now = Date.now();
    await releaseTick((m) => logs.push(m), f.fn, now);
    await releaseTick((m) => logs.push(m), f.fn, now + 3_600_000);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('package.json');
    expect(logs.join()).toContain('99.1.0');
    await releaseTick(() => {}, f.fn, now + 25 * 3_600_000);
    expect(f.calls).toHaveLength(2);
    setSetting('release.update', { latest: null, checkedAt: null });
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
