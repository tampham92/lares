import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Site } from '@lares/shared';
import type { HealthSnapshot, PageProbe } from '../src/services/wpUpdatePolicy.js';

/*
 * End-to-end run in dry-run mode (wp-cli commands are only logged, backups and restores are real
 * on the dry-run sites directory). The health check is mocked: `health.after` decides what the
 * site looks like after the update, and can change files the way a bad update would.
 */
const health = vi.hoisted(() => ({
  after: null as null | ((site: Site) => Partial<HealthSnapshot>),
  gate: null as null | Promise<void>,
  calls: [] as string[],
}));

vi.mock('../src/services/wpHealth.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/services/wpHealth.js')>();
  const page = (over: Partial<PageProbe> = {}): PageProbe => ({ url: 'http://x/', status: 200, title: 'Shop', markers: [], bodyBytes: 40_000, ...over });
  return {
    ...orig,
    markLogs: vi.fn(async () => []),
    takeHealth: vi.fn(async (site: Site, since?: unknown[]) => {
      const healthy: HealthSnapshot = { at: new Date().toISOString(), home: page(), login: page({ title: 'Log In' }), recentFatals: [], newFatals: [] };
      if (!since) {
        health.calls.push('plain');
        if (health.gate) await health.gate;
        return healthy;
      }
      health.calls.push('after-update');
      return { ...healthy, ...(health.after?.(site) ?? {}) };
    }),
  };
});

const { config } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');
const backups = await import('../src/services/backups.js');
const wpUpdates = await import('../src/services/wpUpdates.js');
const { getTask } = await import('../src/services/tasks.js');

const wait = async (taskId: string) => {
  for (let i = 0; i < 400; i++) {
    const task = getTask(taskId)!;
    if (task.status !== 'running') return task;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('task timeout');
};

function makeSite(tag: string, root?: string) {
  const domain = `${tag}${Date.now()}.example.com`;
  const rootPath = root ?? path.join(config.sitesRoot, domain);
  const web = path.join(rootPath, 'public_html');
  fs.mkdirSync(path.join(web, 'wp-content', 'plugins', 'woocommerce'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.php'), '<?php // v1');
  fs.writeFileSync(path.join(web, 'wp-content', 'plugins', 'woocommerce', 'woocommerce.php'), '<?php // 9.2.3');
  // a stale maintenance file: must be gone whatever happens
  fs.writeFileSync(path.join(web, '.maintenance'), '<?php $upgrading = 0;');
  const siteId = Number(db.prepare("INSERT INTO sites (domain, root_path, web_root, app_type) VALUES (?, ?, ?, 'wordpress')").run(domain, rootPath, web).lastInsertRowid);
  const cleanup = async () => {
    const { root: backupRoot } = await backups.siteBackups(siteId).catch(() => ({ root: '' }));
    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
    fs.rmSync(rootPath, { recursive: true, force: true });
    if (backupRoot) fs.rmSync(path.join(backupRoot, domain), { recursive: true, force: true });
    for (const dir of [config.nginxAvailable, config.nginxEnabled]) fs.rmSync(path.join(dir, `${domain}.conf`), { force: true });
    fs.rmSync(path.join(config.siteLogDir, domain), { recursive: true, force: true });
  };
  return { domain, rootPath, web, siteId, cleanup };
}

const leftovers = (domain: string) => fs.readdirSync(config.sitesRoot).filter((n) => n.includes(domain) && n.startsWith('.lares-'));

describe('WordPress safe update (dry-run)', () => {
  it('rolls back automatically when the site breaks after the update', async () => {
    const s = makeSite('wpbad');
    const broken = path.join(s.web, 'wp-content', 'plugins', 'woocommerce', 'broken.php');
    health.calls = [];
    health.after = () => {
      // what a bad update leaves behind
      fs.writeFileSync(broken, '<?php syntax error');
      return {
        home: { url: 'http://x/', status: 500, title: 'WordPress › Error', markers: ['critical'], bodyBytes: 900 },
        newFatals: [`PHP Fatal error: Uncaught Error: Call to undefined function wc_x() in ${s.web}/wp-content/plugins/woocommerce/woocommerce.php:12`],
      };
    };
    expect(wpUpdates.siteUpdates(s.siteId).pending).toBe(0); // never checked yet
    await wpUpdates.checkInventory(s.siteId);
    expect(wpUpdates.siteUpdates(s.siteId).pending).toBe(4);

    const task = await wait((await wpUpdates.startUpdate(s.siteId, { all: true, core: false, plugins: [], themes: [] })).id);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('WooCommerce');

    const [run] = wpUpdates.updateHistory(s.siteId);
    expect(run!.status).toBe('rolled_back');
    expect(run!.items.map((i) => `${i.slug}:${i.from}->${i.to}:${i.status}`)).toEqual([
      'wordpress:6.6.2->6.7.1:updated',
      'akismet:5.3->5.3.5:updated',
      'woocommerce:9.2.3->9.3.1:updated',
      'twentytwentyfour:1.2->1.3:updated',
    ]);
    expect(run!.problems).toEqual(
      expect.arrayContaining([
        { code: 'status', page: 'home', before: 200, after: 500 },
        { code: 'marker', page: 'home', marker: 'critical' },
        expect.objectContaining({ code: 'fatal' }),
      ]),
    );
    expect(run!.culprit).toEqual({ kind: 'suspects', items: ['WooCommerce'] });
    expect(run!.stillBroken).toBe(false);
    // baseline, the check after the update (repeated once), and the check after the restore
    expect(health.calls).toEqual(['plain', 'after-update', 'after-update', 'plain']);

    // the pre-update backup was restored: the broken file is gone, the original files are back
    const { backups: list } = await backups.siteBackups(s.siteId);
    expect(list.find((b) => b.id === run!.backupId)?.trigger).toBe('pre-update');
    expect(list.some((b) => b.trigger === 'safety')).toBe(false);
    expect(fs.existsSync(broken)).toBe(false);
    expect(fs.readFileSync(path.join(s.web, 'index.php'), 'utf8')).toBe('<?php // v1');
    expect(fs.existsSync(path.join(s.web, '.maintenance'))).toBe(false);
    expect(leftovers(s.domain)).toEqual([]);
    // the (fake) WordPress is back to the old versions, the lock is released
    expect(wpUpdates.siteUpdates(s.siteId)).toMatchObject({ pending: 4, running: null });
    await s.cleanup();
  }, 60_000);

  it('names the single updated item that broke the site', async () => {
    const s = makeSite('wpone');
    health.calls = [];
    health.after = () => ({ home: { url: 'http://x/', status: 200, title: 'Shop', markers: [], bodyBytes: 0 } });
    const task = await wait((await wpUpdates.startUpdate(s.siteId, { all: false, core: false, plugins: ['akismet'], themes: [] })).id);
    expect(task.status).toBe('failed');
    const [run] = wpUpdates.updateHistory(s.siteId);
    expect(run).toMatchObject({ status: 'rolled_back', culprit: { kind: 'single', items: ['Akismet Anti-spam: Spam Protection'] }, problems: [{ code: 'blank', page: 'home' }] });
    expect(run!.items).toHaveLength(1);
    await s.cleanup();
  }, 60_000);

  it('keeps the update when the site is still healthy, and holds the site lock meanwhile', async () => {
    const s = makeSite('wpok');
    health.calls = [];
    health.after = null;
    let release!: () => void;
    health.gate = new Promise<void>((r) => (release = r));
    const started = await wpUpdates.startUpdate(s.siteId, { all: false, core: true, plugins: ['woocommerce'], themes: [] });
    // one backup/restore/update per site
    await vi.waitFor(() => expect(health.calls).toContain('plain'));
    expect(() => backups.startBackup(s.siteId)).toThrow(/WordPress/);
    await expect(wpUpdates.startUpdate(s.siteId, { all: true, core: false, plugins: [], themes: [] })).rejects.toThrow(/WordPress/);
    expect(wpUpdates.siteUpdates(s.siteId).running).toMatchObject({ kind: 'update', taskId: started.id });
    health.gate = null;
    release();

    const task = await wait(started.id);
    expect(task.status).toBe('completed');
    expect(task.logs.map((l) => l.msg).join('\n')).toMatch(/WooCommerce 9\.2\.3 → 9\.3\.1/);
    const [run] = wpUpdates.updateHistory(s.siteId);
    expect(run).toMatchObject({ status: 'success', error: null, problems: [], culprit: null });
    expect(run!.items.map((i) => i.slug)).toEqual(['wordpress', 'woocommerce']);
    expect(fs.existsSync(path.join(s.web, '.maintenance'))).toBe(false);
    // two items left: akismet and the theme
    expect(wpUpdates.siteUpdates(s.siteId)).toMatchObject({ pending: 2, running: null });
    expect(wpUpdates.updatesSummary().find((x) => x.siteId === s.siteId)?.pending).toBe(2);
    await s.cleanup();
  }, 60_000);

  it('does not touch the site when the backup fails', async () => {
    // a site root outside the sites directory is refused by the backup service
    const outside = path.join(config.dataDir, 'outside-sites', `wpnobk${Date.now()}`);
    const s = makeSite('wpnobk', outside);
    health.calls = [];
    health.after = null;
    const task = await wait((await wpUpdates.startUpdate(s.siteId, { all: true, core: false, plugins: [], themes: [] })).id);
    expect(task.status).toBe('failed');
    const [run] = wpUpdates.updateHistory(s.siteId);
    expect(run!.status).toBe('failed');
    expect(run!.backupId).toBeNull();
    expect(run!.items.every((i) => i.status === 'pending')).toBe(true);
    expect(health.calls).toEqual(['plain']);
    expect(fs.existsSync(path.join(s.web, '.maintenance'))).toBe(false);
    expect(wpUpdates.siteUpdates(s.siteId).pending).toBe(4);
    await s.cleanup();
    fs.rmSync(path.dirname(outside), { recursive: true, force: true });
  }, 60_000);

  it('refuses sites that are not WordPress and empty requests', async () => {
    const s = makeSite('wpnot');
    db.prepare("UPDATE sites SET app_type = 'php' WHERE id = ?").run(s.siteId);
    await expect(wpUpdates.startUpdate(s.siteId, { all: true, core: false, plugins: [], themes: [] })).rejects.toThrow();
    db.prepare("UPDATE sites SET app_type = 'wordpress' WHERE id = ?").run(s.siteId);
    await expect(wpUpdates.startUpdate(s.siteId, { all: false, core: false, plugins: [], themes: [] })).rejects.toThrow();
    await s.cleanup();
  });

  it('marks runs interrupted by a restart as failed and clears maintenance mode', async () => {
    const s = makeSite('wpint');
    db.prepare("INSERT INTO wp_update_runs (site_id, status, items_json, backup_id, started_at) VALUES (?, 'running', '[]', '20261005-030000', ?)").run(s.siteId, new Date().toISOString());
    await wpUpdates.recoverInterruptedRuns(() => {});
    const [run] = wpUpdates.updateHistory(s.siteId);
    expect(run!.status).toBe('failed');
    expect(run!.error).toContain('20261005-030000');
    expect(fs.existsSync(path.join(s.web, '.maintenance'))).toBe(false);
    await s.cleanup();
  });
});
