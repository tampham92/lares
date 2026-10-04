import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BackupManifest } from '@lares/shared';
import {
  backupDir,
  backupRootProblem,
  isDue,
  isInside,
  isSafeDomainSegment,
  isSafeSiteRoot,
  localDate,
  newBackupId,
  parseManifest,
  selectExpired,
  signDownload,
  verifyDownload,
} from '../src/services/backupPolicy.js';

const manifest = (over: Partial<BackupManifest> = {}): BackupManifest => ({
  format: 1,
  laresVersion: '0.1.0',
  createdAt: '2026-10-04T03:00:00.000Z',
  trigger: 'scheduled',
  site: { id: 3, domain: 'shop.example.com', appType: 'wordpress', rootPath: '/var/www/shop.example.com', webRoot: '/var/www/shop.example.com/public_html' },
  files: { file: 'files.tar.gz', bytes: 1000, sourceBytes: 5000, excludes: ['.npm'] },
  databases: [{ name: 'shop_example_com_ab12', file: 'db-shop_example_com_ab12.sql.gz', bytes: 200 }],
  totalBytes: 1200,
  ...over,
});

describe('backup ids', () => {
  it('uses the local time and avoids collisions', () => {
    const now = new Date(2026, 9, 4, 3, 5, 9);
    expect(newBackupId(now, [])).toBe('20261004-030509');
    expect(newBackupId(now, ['20261004-030509'])).toBe('20261004-030509-2');
    expect(newBackupId(now, ['20261004-030509', '20261004-030509-2'])).toBe('20261004-030509-3');
    expect(localDate(now)).toBe('2026-10-04');
  });
});

describe('schedule', () => {
  const at = (h: number, m: number, day = 4) => new Date(2026, 9, day, h, m);
  it('is not due before the configured time', () => {
    expect(isDue(at(2, 59), '03:00', null)).toBe(false);
  });
  it('is due at / after the time when today has not run yet', () => {
    expect(isDue(at(3, 0), '03:00', null)).toBe(true);
    expect(isDue(at(3, 0), '03:00', '2026-10-03')).toBe(true);
    // panel was down at 03:00: catch up later the same day
    expect(isDue(at(14, 30), '03:00', '2026-10-03')).toBe(true);
  });
  it('never runs twice the same day (also after a restart)', () => {
    expect(isDue(at(3, 1), '03:00', '2026-10-04')).toBe(false);
    expect(isDue(at(23, 59), '03:00', '2026-10-04')).toBe(false);
  });
  it('runs again the next day', () => {
    expect(isDue(at(3, 0, 5), '03:00', '2026-10-04')).toBe(true);
    expect(isDue(at(0, 10, 5), '03:00', '2026-10-04')).toBe(false);
  });
  it('rejects malformed times', () => {
    expect(isDue(at(12, 0), '25:00', null)).toBe(false);
    expect(isDue(at(12, 0), '3:00', null)).toBe(false);
  });
});

describe('retention', () => {
  const b = (id: string, trigger: 'manual' | 'scheduled' | 'safety', createdAt: string) => ({ id, trigger, createdAt });
  const list = [
    b('20261001-030000', 'scheduled', '2026-10-01T03:00:00Z'),
    b('20261002-030000', 'scheduled', '2026-10-02T03:00:00Z'),
    b('20261003-030000', 'scheduled', '2026-10-03T03:00:00Z'),
    b('20261004-030000', 'scheduled', '2026-10-04T03:00:00Z'),
    b('20261002-120000', 'manual', '2026-10-02T12:00:00Z'),
    b('20261003-120000', 'safety', '2026-10-03T12:00:00Z'),
  ];
  it('keeps the N newest of the trigger and returns the rest, oldest last', () => {
    expect(selectExpired(list, 'scheduled', 2).map((x) => x.id)).toEqual(['20261002-030000', '20261001-030000']);
  });
  it('returns nothing when under the limit', () => {
    expect(selectExpired(list, 'scheduled', 7)).toEqual([]);
    expect(selectExpired(list, 'safety', 3)).toEqual([]);
  });
  it('never prunes manual backups and leaves other triggers alone', () => {
    expect(selectExpired(list, 'manual', 0)).toEqual([]);
    expect(selectExpired(list, 'scheduled', 0).every((x) => x.trigger === 'scheduled')).toBe(true);
  });
  it('breaks createdAt ties by id (numeric suffix aware)', () => {
    const same = [b('20261004-030000-10', 'safety', 'x'), b('20261004-030000-9', 'safety', 'x'), b('20261004-030000', 'safety', 'x')];
    expect(selectExpired(same, 'safety', 1).map((x) => x.id)).toEqual(['20261004-030000-9', '20261004-030000']);
  });
});

describe('path safety', () => {
  it('isInside is strict and not fooled by prefixes or ..', () => {
    expect(isInside('/var/www', '/var/www/a.com')).toBe(true);
    expect(isInside('/var/www', '/var/www')).toBe(false);
    expect(isInside('/var/www', '/var/www2/a.com')).toBe(false);
    expect(isInside('/var/www', '/var/www/../etc')).toBe(false);
    expect(isInside('/var/www', '/var/www/..foo')).toBe(true);
  });
  it('accepts only clean site roots inside the sites root', () => {
    expect(isSafeSiteRoot('/var/www/a.com', '/var/www')).toBe(true);
    expect(isSafeSiteRoot('/var/www', '/var/www')).toBe(false);
    expect(isSafeSiteRoot('/', '/var/www')).toBe(false);
    expect(isSafeSiteRoot('/etc', '/var/www')).toBe(false);
    expect(isSafeSiteRoot('/var/www/a.com/../../etc', '/var/www')).toBe(false);
    expect(isSafeSiteRoot('var/www/a.com', '/var/www')).toBe(false);
    expect(isSafeSiteRoot('/var/www/a\n.com', '/var/www')).toBe(false);
  });
  it('validates domain directory names and backup ids', () => {
    expect(isSafeDomainSegment('shop.example.com')).toBe(true);
    expect(isSafeDomainSegment('site8001.localhost')).toBe(true);
    for (const bad of ['..', '.', '', 'a/b', 'a..b', '-a.com', 'a.com/', '../etc']) expect(isSafeDomainSegment(bad)).toBe(false);
    expect(backupDir('/var/backups/lares', 'a.com', '20261004-030000')).toBe('/var/backups/lares/a.com/20261004-030000');
    expect(() => backupDir('/var/backups/lares', 'a.com', '../../etc')).toThrow();
    expect(() => backupDir('/var/backups/lares', '..', '20261004-030000')).toThrow();
    expect(() => backupDir('/var/backups/lares', 'a.com', '20261004-030000/../..')).toThrow();
  });
  it('refuses dangerous backup roots', () => {
    expect(backupRootProblem('/var/backups/lares', '/var/www')).toBeNull();
    expect(backupRootProblem('/', '/var/www')).toBe('not-absolute');
    expect(backupRootProblem('/backups', '/var/www')).toBe('too-shallow');
    expect(backupRootProblem('/etc/lares', '/var/www')).toBe('system-dir');
    expect(backupRootProblem('/usr/local/backups', '/var/www')).toBe('system-dir');
    expect(backupRootProblem('/var/www/backups', '/var/www')).toBe('sites-root');
    expect(backupRootProblem('/var/www', '/var/www')).toBe('sites-root');
    expect(backupRootProblem('/var', '/var/www')).toBe('too-shallow');
    expect(backupRootProblem('relative/dir', '/var/www')).toBe('not-absolute');
  });
});

describe('manifest', () => {
  it('parses a valid manifest', () => {
    const m = manifest();
    expect(parseManifest(JSON.stringify(m))).toEqual(m);
  });
  it('rejects garbage, unknown formats and missing fields', () => {
    expect(parseManifest('')).toBeNull();
    expect(parseManifest('{not json')).toBeNull();
    expect(parseManifest(JSON.stringify({ ...manifest(), format: 2 }))).toBeNull();
    const { files: _files, ...noFiles } = manifest();
    expect(parseManifest(JSON.stringify(noFiles))).toBeNull();
  });
  it('rejects file names that could escape the backup directory', () => {
    expect(parseManifest(JSON.stringify(manifest({ files: { ...manifest().files, file: '../x.tar.gz' as 'files.tar.gz' } })))).toBeNull();
    expect(parseManifest(JSON.stringify(manifest({ databases: [{ name: 'x', file: '../../etc/passwd', bytes: 1 }] })))).toBeNull();
    // file must match its database name, and appear once
    expect(parseManifest(JSON.stringify(manifest({ databases: [{ name: 'a', file: 'db-b.sql.gz', bytes: 1 }] })))).toBeNull();
    expect(parseManifest(JSON.stringify(manifest({ databases: [{ name: 'a', file: 'db-a.sql.gz', bytes: 1 }, { name: 'a', file: 'db-a.sql.gz', bytes: 1 }] })))).toBeNull();
    expect(parseManifest(JSON.stringify(manifest({ databases: [{ name: 'a;drop', file: 'db-a;drop.sql.gz', bytes: 1 }] })))).toBeNull();
  });
});

describe('download tokens', () => {
  const secret = 'test-secret';
  it('round-trips and expires', () => {
    const tok = signDownload(secret, { siteId: 7, id: '20261004-030000' }, 1000, 60_000);
    expect(verifyDownload(secret, tok, 2000)).toEqual({ siteId: 7, id: '20261004-030000' });
    expect(verifyDownload(secret, tok, 1000 + 60_001)).toBeNull();
  });
  it('rejects tampering and other secrets', () => {
    const tok = signDownload(secret, { siteId: 7, id: '20261004-030000' }, 1000);
    const [body, mac] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 8, b: '20261004-030000', e: 9e15 })).toString('base64url');
    expect(verifyDownload(secret, `${forged}.${mac}`, 2000)).toBeNull();
    expect(verifyDownload('other', tok, 2000)).toBeNull();
    expect(verifyDownload(secret, `${body}`, 2000)).toBeNull();
    expect(verifyDownload(secret, `${tok}.x`, 2000)).toBeNull();
  });
});

// End-to-end in dry-run mode: real tar of a site inside the test data dir, databases simulated.
describe('backup and restore (dry-run)', () => {
  it('backs up a static site, restores it, and keeps a safety backup', async () => {
    const { config } = await import('../src/config.js');
    const { db } = await import('../src/db/index.js');
    const backups = await import('../src/services/backups.js');
    const { getTask } = await import('../src/services/tasks.js');
    const domain = `bk${Date.now()}.example.com`;
    const root = path.join(config.sitesRoot, domain);
    const web = path.join(root, 'public_html');
    fs.mkdirSync(path.join(root, '.npm'), { recursive: true });
    fs.mkdirSync(web, { recursive: true });
    fs.writeFileSync(path.join(web, 'index.html'), 'v1');
    fs.writeFileSync(path.join(web, '.env.local'), 'SECRET=1');
    fs.writeFileSync(path.join(root, '.npm', 'cache.bin'), 'cache');
    const siteId = Number(db.prepare("INSERT INTO sites (domain, root_path, web_root, app_type) VALUES (?, ?, ?, 'static')").run(domain, root, web).lastInsertRowid);

    const wait = async (taskId: string) => {
      for (let i = 0; i < 200; i++) {
        const task = getTask(taskId)!;
        if (task.status !== 'running') return task;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('task timeout');
    };

    const first = await wait(backups.startBackup(siteId).id);
    expect(first.status, first.error).toBe('completed');
    const list1 = await backups.siteBackups(siteId);
    expect(list1.backups).toHaveLength(1);
    const backupId = list1.backups[0]!.id;
    const dir = path.join(list1.root, domain, backupId);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, 'files.tar.gz')).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    // a second backup of the same site cannot start while one runs
    const running = backups.startBackup(siteId);
    expect(() => backups.startBackup(siteId)).toThrow();
    await wait(running.id);

    fs.writeFileSync(path.join(web, 'index.html'), 'v2');
    fs.writeFileSync(path.join(web, 'new.html'), 'added later');
    expect(() => backups.startRestore(siteId, backupId)).not.toThrow();
    const restored = await wait((await backups.siteBackups(siteId)).running!.taskId);
    expect(restored.status, restored.error).toBe('completed');
    expect(fs.readFileSync(path.join(web, 'index.html'), 'utf8')).toBe('v1');
    expect(fs.readFileSync(path.join(web, '.env.local'), 'utf8')).toBe('SECRET=1');
    expect(fs.existsSync(path.join(web, 'new.html'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.npm'))).toBe(false); // caches are not part of a backup
    expect(fs.readdirSync(config.sitesRoot).filter((n) => n.includes(domain) && n.startsWith('.lares-'))).toEqual([]);

    const list2 = await backups.siteBackups(siteId);
    const safety = list2.backups.find((b) => b.trigger === 'safety');
    expect(safety).toBeTruthy();
    expect((restored.result as { safetyId: string }).safetyId).toBe(safety!.id);

    await backups.deleteBackup(siteId, safety!.id);
    expect((await backups.siteBackups(siteId)).backups.some((b) => b.id === safety!.id)).toBe(false);
    await expect(backups.deleteBackup(siteId, '20000101-000000')).rejects.toThrow();

    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(list1.root, domain), { recursive: true, force: true });
    // restore re-applies the vhost (dry-run writes it into the test data dir)
    for (const dir of [config.nginxAvailable, config.nginxEnabled]) fs.rmSync(path.join(dir, `${domain}.conf`), { force: true });
    fs.rmSync(path.join(config.siteLogDir, domain), { recursive: true, force: true });
  }, 30_000);
});
