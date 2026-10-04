import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Database imports are simulated: the first one (the restore) fails, later ones (the rollback) work.
const imports: string[] = [];
vi.mock('../src/services/mysql.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/services/mysql.js')>();
  return {
    ...orig,
    importGzipDump: vi.fn(async (name: string, file: string) => {
      imports.push(path.basename(path.dirname(file)));
      if (imports.length === 1) throw new Error(`simulated import failure for ${name}`);
    }),
  };
});

const { config } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');
const { encrypt } = await import('../src/lib/crypto.js');
const backups = await import('../src/services/backups.js');
const { getTask } = await import('../src/services/tasks.js');

const wait = async (taskId: string) => {
  for (let i = 0; i < 200; i++) {
    const task = getTask(taskId)!;
    if (task.status !== 'running') return task;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('task timeout');
};

function makeSite(tag: string) {
  const domain = `${tag}${Date.now()}.example.com`;
  const root = path.join(config.sitesRoot, domain);
  const web = path.join(root, 'public_html');
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), 'v1');
  const siteId = Number(db.prepare("INSERT INTO sites (domain, root_path, web_root, app_type) VALUES (?, ?, ?, 'static')").run(domain, root, web).lastInsertRowid);
  const dbName = `${tag}_${Date.now()}`;
  db.prepare('INSERT INTO databases (name, username, password_enc, site_id, managed) VALUES (?, ?, ?, ?, 1)').run(dbName, dbName, encrypt('pw'), siteId);
  const cleanup = (backupRoot: string) => {
    db.prepare('DELETE FROM databases WHERE name = ?').run(dbName);
    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(backupRoot, domain), { recursive: true, force: true });
    for (const dir of [config.nginxAvailable, config.nginxEnabled]) fs.rmSync(path.join(dir, `${domain}.conf`), { force: true });
    fs.rmSync(path.join(config.siteLogDir, domain), { recursive: true, force: true });
  };
  return { domain, root, web, siteId, cleanup };
}

describe('restore failures (dry-run)', () => {
  it('rolls files and databases back when a database import fails', async () => {
    const s = makeSite('rb');
    expect((await wait(backups.startBackup(s.siteId).id)).status).toBe('completed');
    const { backups: [first], root: backupRoot } = await backups.siteBackups(s.siteId);
    fs.writeFileSync(path.join(s.web, 'index.html'), 'v2');

    const task = await wait(backups.startRestore(s.siteId, first!.id).id);
    expect(task.status).toBe('failed');
    expect(task.error).toMatch(/simulated import failure/);
    // the current state is back: files of v2, database re-imported from the safety backup
    expect(fs.readFileSync(path.join(s.web, 'index.html'), 'utf8')).toBe('v2');
    const safety = (await backups.siteBackups(s.siteId)).backups.find((b) => b.trigger === 'safety')!;
    expect(task.error).toContain(safety.id);
    expect(imports).toEqual([first!.id, safety.id]);
    expect(fs.readdirSync(config.sitesRoot).filter((n) => n.includes(s.domain) && n.startsWith('.lares-'))).toEqual([]);
    s.cleanup(backupRoot);
  }, 30_000);

  it('leaves the site untouched when the archive is corrupted', async () => {
    const s = makeSite('cr');
    expect((await wait(backups.startBackup(s.siteId).id)).status).toBe('completed');
    const { backups: [first], root: backupRoot } = await backups.siteBackups(s.siteId);
    fs.writeFileSync(path.join(backupRoot, s.domain, first!.id, 'files.tar.gz'), 'not a gzip file');
    fs.writeFileSync(path.join(s.web, 'index.html'), 'v2');
    imports.length = 0;

    const task = await wait(backups.startRestore(s.siteId, first!.id).id);
    expect(task.status).toBe('failed');
    expect(fs.readFileSync(path.join(s.web, 'index.html'), 'utf8')).toBe('v2');
    expect(imports).toEqual([]);
    expect(fs.readdirSync(config.sitesRoot).filter((n) => n.includes(s.domain) && n.startsWith('.lares-'))).toEqual([]);
    s.cleanup(backupRoot);
  }, 30_000);
});
