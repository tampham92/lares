import fs from 'node:fs/promises';
import path from 'node:path';
import { LOCALHOST, type CloneSiteInput, type CreateSiteResult, type Site } from '@lares/shared';
import { config } from '../config.js';
import { localExecutor } from '../executors/index.js';
import { t } from '../i18n/index.js';
import { conflict, errorMessage } from '../lib/errors.js';
import { duKb, shq, tarCreate, tarExcludes } from '../lib/shell.js';
import { UndoStack } from '../lib/undo.js';
import { parseDotEnv, parseWpConfig, rewriteDotEnv } from '../migration/appDetect.js';
import { freeBytes, mysqldumpFlags } from '../migration/source.js';
import * as databases from './databases.js';
import { host, type HostLogger } from './host.js';
import * as mysql from './mysql.js';
import * as nodeapp from './nodeapp.js';
import * as ports from './ports.js';
import * as sites from './sites.js';
import { ensurePortHostFix, rewriteWpConfig, wordpressReplaceUrl } from './wordpress.js';

/** Caches in the site's home dir (HOME of the web user) and Next.js build cache: rebuilt on demand. */
const CLONE_EXCLUDES = ['.npm', '.cache', '.pnpm-store', 'app/.next/cache', '.lares-sso.json'];

type DbTarget = { name: string; user: string; password: string; host: string };

const fmtGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** wp-config.php sits in the web root, or one level above it (WordPress looks there too). */
export async function findWpConfig(site: Site): Promise<string | null> {
  for (const dir of [site.webRoot, path.dirname(site.webRoot)]) {
    if (dir !== site.rootPath && !dir.startsWith(site.rootPath + path.sep)) continue;
    const file = path.join(dir, 'wp-config.php');
    if (await host.exists(file)) return file;
  }
  return null;
}

export async function databasesSize(names: string[]): Promise<number> {
  if (!names.length) return 0;
  const rows = await mysql
    .query<Array<{ size: number | string | null }>>(
      `SELECT SUM(data_length + index_length) AS size FROM information_schema.TABLES WHERE table_schema IN (${names.map(() => '?').join(', ')})`,
      names,
    )
    .catch(() => []);
  return Number(rows[0]?.size ?? 0) || 0;
}

/**
 * Duplicate a site under a new domain (or a free port): the whole site directory, a fresh copy of
 * every database it uses, its settings and - for WordPress - every stored URL moved to the new address.
 * The source site is only read, never modified. A failure rolls the new site back completely.
 */
export async function cloneSite(sourceId: number, input: CloneSiteInput, log: HostLogger): Promise<CreateSiteResult> {
  const src = sites.getSite(sourceId);
  const srcAppDir = path.join(src.rootPath, src.appType === 'nextjs' ? 'app' : 'public_html');
  const webRootSubdir = path.relative(srcAppDir, src.webRoot);
  if (webRootSubdir.startsWith('..') || path.isAbsolute(webRootSubdir)) {
    throw conflict(t('Web root {webRoot} nằm ngoài thư mục site {rootPath} - không nhân bản được', { webRoot: src.webRoot, rootPath: src.rootPath }));
  }

  // Databases to copy: the ones attached to the site, plus the one wp-config.php really points at.
  const wpConfig = src.appType === 'wordpress' ? await findWpConfig(src) : null;
  const wpDb = wpConfig ? parseWpConfig(await fs.readFile(wpConfig, 'utf8')) : null;
  if (src.appType === 'wordpress' && !wpDb) throw conflict(t('Không đọc được thông tin database trong wp-config.php của {domain}', { domain: src.domain }));
  const dbNames: string[] = [];
  for (const name of new Set([...databases.databasesForSite(src.id).map((d) => d.name), ...(wpDb ? [wpDb.name] : [])])) {
    if (config.dryRun || (await mysql.databaseExists(name))) dbNames.push(name);
    // Without its own copy the clone would write into the source's database (URL replace) - refuse.
    else if (name === wpDb?.name) throw conflict(t('Database {name} của {domain} không nằm trên MySQL của Lares - không nhân bản được', { name, domain: src.domain }));
    else log(t('Bỏ qua database {name}: không tồn tại trên MySQL của Lares', { name }));
  }

  const [sizeKb, free, dbBytes] = await Promise.all([
    host.exec(duKb(src.rootPath)).then((r) => Number(r.stdout.trim()) || 0),
    freeBytes(localExecutor, config.sitesRoot),
    databasesSize(dbNames),
  ]);
  const needed = sizeKb * 1024 + dbBytes;
  if (free !== null && needed > free * 0.95) throw conflict(t('Không đủ dung lượng: cần khoảng {needed}, còn trống {free}', { needed: fmtGb(needed), free: fmtGb(free) }));

  const undo = new UndoStack();
  try {
    let listenPort: number | null = null;
    if (input.domain === LOCALHOST) {
      if (input.listenPort && !(await ports.isPortFree(input.listenPort))) throw conflict(t('Port {port} đang được sử dụng', { port: input.listenPort }));
      listenPort = input.listenPort ?? (await ports.allocatePort(config.sitePortStart));
    }
    const domain = listenPort ? sites.portSiteDomain(listenPort) : input.domain;
    // the source keeps its internal port; the clone gets a free one
    const nodeConfig = src.appType === 'nextjs' ? { ...sites.getNodeConfig(src.id), port: undefined } : undefined;
    const site = await sites.provisionSite(
      { domain, aliases: listenPort ? [] : input.aliases, appType: src.appType, phpVersion: src.phpVersion, webRootSubdir, nodeConfig, listenPort },
      log,
      undo,
    );
    const url = sites.siteUrl(site, input.publicHost);
    const appDir = sites.siteLayout(domain, src.appType, webRootSubdir).appDir;
    const inClone = (p: string) => path.join(site.rootPath, path.relative(src.rootPath, p));

    log(t('Đang sao chép file {from} → {to} ({size})...', { from: src.rootPath, to: site.rootPath, size: fmtGb(sizeKb * 1024) }));
    await host.run(`${tarCreate(src.rootPath, tarExcludes(CLONE_EXCLUDES))} | tar -C ${shq(site.rootPath)} -xpf -`, { timeoutMs: 12 * 3_600_000 });
    log(t('Đã sao chép file'));

    const copies = new Map<string, DbTarget>();
    const flags = dbNames.length && !config.dryRun ? await mysqldumpFlags(localExecutor) : [];
    for (const name of dbNames) {
      const newName = databases.deriveDbName(domain);
      const created = await databases.createDatabase({ name: newName, username: newName, siteId: site.id }, log);
      undo.push(t('xoá database {name}', { name: newName }), () => databases.deleteDatabase(created.record.id, log));
      log(t('Đang sao chép database {from} → {to}...', { from: name, to: newName }));
      await mysql.copyDatabase(name, newName, { user: newName, password: created.password }, flags, log);
      copies.set(name, { name: newName, user: newName, password: created.password, host: 'localhost' });
      log(t('Đã sao chép database {from} → {to}', { from: name, to: newName }));
    }

    switch (src.appType) {
      case 'wordpress': {
        const cfgFile = inClone(wpConfig!);
        await host.writeFile(cfgFile, rewriteWpConfig(await fs.readFile(cfgFile, 'utf8'), copies.get(wpDb!.name)!), 0o640);
        log(t('wp-config.php: trỏ sang database mới'));
        if (listenPort) await ensurePortHostFix(site.webRoot, log);
        // wp-cli runs as the web user and must be able to read the copied files
        await sites.fixPermissions(site.rootPath, log);
        await wordpressReplaceUrl(site.webRoot, site.rootPath, url, log);
        break;
      }
      case 'laravel':
      case 'php':
      case 'unknown': {
        const envFile = path.join(appDir, '.env');
        const env = (await host.exists(envFile)) ? await fs.readFile(envFile, 'utf8') : null;
        const current = env ? parseDotEnv(env) : {};
        const target = current.DB_DATABASE ? copies.get(current.DB_DATABASE) : undefined;
        if (env) {
          const values: Record<string, string> = {};
          if (target) Object.assign(values, { DB_DATABASE: target.name, DB_USERNAME: target.user, DB_PASSWORD: target.password });
          if (current.APP_URL) values.APP_URL = url;
          if (Object.keys(values).length) {
            await host.writeFile(envFile, rewriteDotEnv(env, values), 0o640);
            log(t('.env: cập nhật {keys}', { keys: Object.keys(values).join(', ') }));
          }
        }
        for (const [from, to] of copies) {
          if (to !== target) log(t('CẦN KIỂM TRA: cấu hình của site vẫn có thể trỏ tới database {from} - hãy đổi sang {to} (mật khẩu xem ở mục Database)', { from, to: to.name }));
        }
        if (src.appType === 'laravel' && (await host.has('php'))) {
          await sites.fixPermissions(site.rootPath, log);
          await host
            .mutate(host.asWebUser('php artisan config:clear && php artisan cache:clear', { cwd: appDir, home: site.rootPath }), { log })
            .catch((err) => log(`artisan: ${errorMessage(err)}`));
        }
        break;
      }
      case 'nextjs': {
        undo.push(t('xoá service {name}', { name: nodeapp.serviceName(domain) }), () => nodeapp.removeService(domain, log));
        await nodeapp.writeServiceFiles(domain, site.webRoot, site.rootPath, site.appPort!, nodeConfig!, log);
        if (await host.exists(path.join(site.webRoot, '.next'))) {
          await sites.fixPermissions(site.rootPath, log);
          await nodeapp.serviceAction(domain, 'restart', log);
          log(t('Đã khởi động {service} trên 127.0.0.1:{port} (dùng bản build của site nguồn)', { service: nodeapp.serviceName(domain), port: String(site.appPort) }));
          log(t('Lưu ý: biến NEXT_PUBLIC_* được đóng gói lúc build - nếu có giá trị chứa tên miền cũ, sửa ở tab Next.js rồi build lại.'));
        } else {
          log(t('Site nguồn chưa được build: bấm "Build & khởi động" trong trang site mới.'));
        }
        break;
      }
      case 'static':
        break;
    }

    await sites.fixPermissions(site.rootPath, log);
    undo.clear();
    log(t('Hoàn tất nhân bản {domain} - truy cập: {url}', { domain: src.domain, url }));
    const first = [...copies.values()][0];
    return { site: sites.getSite(site.id), url, database: first ? { name: first.name, username: first.user, password: first.password } : null, wordpressAdmin: null };
  } catch (err) {
    await undo.run(log);
    throw err;
  }
}
