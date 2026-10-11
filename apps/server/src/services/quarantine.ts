import fs from 'node:fs/promises';
import path from 'node:path';
import { msg, type CleanSiteInput, type MalwareScan, type Site } from '@lares/shared';
import { config } from '../config.js';
import { t, tDefault } from '../i18n/index.js';
import { randomPassword } from '../lib/crypto.js';
import { conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { isInside } from './backupPolicy.js';
import { startLocked, takeBackup } from './backups.js';
import { findWpConfig } from './clone.js';
import * as databases from './databases.js';
import { host, type HostLogger } from './host.js';
import * as isolation from './isolation.js';
import { broken, probe } from './isolateSites.js';
import { currentMuPlugins, lastResult, readSafe, runScan, wpAdminsOf, wpDbOf } from './malware.js';
import * as policy from './malwarePolicy.js';
import * as mysql from './mysql.js';
import * as nodeapp from './nodeapp.js';
import { notify } from './notifications.js';
import { VERSION } from './release.js';
import * as store from './securityStore.js';
import * as sites from './sites.js';
import type { TaskInfo } from './tasks.js';
import { setWpConfigDefine, shuffleWpSalts } from './wordpress.js';
import { withCodeUnlocked } from './codeLock.js';

/*
 * Emergency quarantine and cleaning (C6).
 *
 * Quarantine stops everything the site's code could do, in this order: nginx answers 503 (no new
 * requests), the site uid loses every outbound connection (firewall), its PHP-FPM / Node service is
 * stopped, any process left under its uid is killed (a coin miner keeps running after PHP stops),
 * its cron/at jobs are removed. Then a backup marked "quarantine" keeps the evidence; it is not offered
 * for a normal restore. While quarantined, nothing that runs the site's code is allowed: enabling the
 * site, WordPress updates, wp-admin login, cloning it, PHP settings.
 *
 * Cleaning replaces code with fresh copies rather than trusting "scan and delete" (scanners miss
 * backdoors): WordPress core, plugins and themes come from wordpress.org (downloaded by the panel,
 * unpacked and moved into place by the site user, never by root), what was there before and every
 * file the scan flagged go to <site>/.lares-quarantine/<time>/ (outside the web root, never deleted),
 * salts and the database password change, unknown admins and application passwords go. The site
 * stays quarantined: it is released after a clean scan, by the owner.
 */

export { assertNotQuarantined } from './securityStore.js';

const ownProcessUnit = (site: Site) => site.sysUser !== null && sites.usesPhp(site.appType);

async function stopSiteProcesses(site: Site, log: HostLogger) {
  if (ownProcessUnit(site)) await isolation.setSitePhpRunning(site, false, log);
  // disabled too, not only stopped: a reboot during the quarantine must not start the app again
  if (site.appType === 'nextjs') await host.mutate(`systemctl disable --now ${shq(nodeapp.serviceName(site.domain))}`, { log }).catch(() => undefined);
  if (config.dryRun || !site.sysUser) return;
  await host.exec(`pkill -KILL -u ${shq(site.sysUser)}`);
  await host.exec(`crontab -r -u ${shq(site.sysUser)} 2>/dev/null`);
  // at jobs: `atq` as root lists every user's jobs, the owner in the last column
  await host.exec(`command -v atq >/dev/null && atq | awk -v u=${shq(site.sysUser)} '$NF == u { print $1 }' | xargs -r atrm`);
}

async function quarantine(site: Site, reason: string, by: string, log: HostLogger) {
  const since = new Date().toISOString();
  store.setQuarantineState(site.id, { active: true, since, by, reason: reason || null, backupId: null });
  try {
    log(t('Bước 1/4: nginx trả trang bảo trì (503)'));
    await sites.applySiteVhost(site, log);
    log(t('Bước 2/4: chặn mọi kết nối ra ngoài của user {user}', { user: site.sysUser! }));
    await isolation.syncSiteFirewall(log);
    log(t('Bước 3/4: dừng PHP/Node, dừng mọi tiến trình còn sót và xoá cron của site'));
    await stopSiteProcesses(site, log);
  } catch (err) {
    // half a quarantine is worse than a clear failure: the owner retries or acts by hand
    log(t('LỖI: {error}', { error: errorMessage(err) }));
  }
  log(t('Bước 4/4: chụp bản sao lưu làm bằng chứng (không hiện trong khôi phục thông thường)'));
  let backupId: string | null = null;
  try {
    backupId = (await takeBackup(site, 'quarantine', log)).id;
  } catch (err) {
    log(t('Cảnh báo: không chụp được bản sao lưu: {error}', { error: errorMessage(err) }));
  }
  store.setQuarantineState(site.id, { active: true, since, by, reason: reason || null, backupId });
  store.addEvent(site.id, 'quarantine', by, reason || null);
  notify({
    kind: 'security',
    tone: 'err',
    title: msg('{domain} đã bị cách ly khẩn'),
    body: msg('Site trả trang bảo trì, không kết nối ra ngoài được và không còn tiến trình nào chạy. Dọn site rồi quét lại trước khi gỡ cách ly.'),
    params: { domain: site.domain },
    actions: [{ label: msg('Mở site'), href: `/sites/${site.id}?tab=security` }],
    dedupeKey: `quarantine:${site.id}`,
  });
  log(t('Đã cách ly {domain}', { domain: site.domain }));
}

export function startQuarantine(siteId: number, reason: string, by: string): TaskInfo {
  const site = sites.getSite(siteId);
  if (!site.sysUser) throw conflict(t('Cách ly khẩn cần site có user riêng: bấm "Cách ly ngay" ở tab Tổng quan trước'));
  store.assertNotQuarantined(site);
  return startLocked(site, 'quarantine', t('Cách ly khẩn {domain}', { domain: site.domain }), (log) => quarantine(site, reason, by, log));
}

/**
 * Lift the quarantine. Needs a scan finished after the quarantine started with nothing critical,
 * unless `force` (the owner checked the site by hand) - recorded either way.
 */
async function release(site: Site, force: boolean, by: string, log: HostLogger) {
  const q = store.quarantineState(site.id);
  if (!q.active) throw conflict(t('Site không bị cách ly'));
  store.setQuarantineState(site.id, { ...q, active: false });
  await isolation.syncSiteFirewall(log);
  const running = site.status === 'active';
  if (ownProcessUnit(site) && running) await isolation.applySitePhp(site, log);
  if (site.appType === 'nextjs') {
    const unit = shq(nodeapp.serviceName(site.domain));
    await host.mutate(running ? `systemctl enable --now ${unit}` : `systemctl enable ${unit}`, { log }).catch((e) => log(t('Cảnh báo: {error}', { error: errorMessage(e) })));
  }
  await sites.applySiteVhost(site, log);
  if (running && !config.dryRun) {
    // nginx reload returns before the old workers are gone (see isolateSites.ts)
    await new Promise((r) => setTimeout(r, site.appType === 'nextjs' ? 6_000 : 3_000));
    const code = await probe(site);
    if (broken(code)) log(t('Cảnh báo: site trả HTTP {code} sau khi gỡ cách ly - xem log lỗi của site (file bị thiếu sau khi dọn?)', { code }));
    else log(t('Site trả HTTP {code}', { code }));
  }
  store.addEvent(site.id, 'release', by, force ? tDefault('Gỡ khi chưa có lần quét sạch (người quản trị xác nhận đã tự kiểm tra)') : null);
  log(t('Đã gỡ cách ly {domain}', { domain: site.domain }));
}

export function startRelease(siteId: number, force: boolean, by: string): TaskInfo {
  const site = sites.getSite(siteId);
  const q = store.quarantineState(site.id);
  if (!q.active) throw conflict(t('Site không bị cách ly'));
  if (!force) {
    const scan = lastResult(site.id);
    if (!scan || !q.since || scan.startedAt < q.since) throw conflict(t('Chưa có lần quét nào sau khi cách ly: dọn site và quét lại trước'));
    if (scan.status === 'infected') throw conflict(t('Lần quét gần nhất vẫn còn dấu hiệu nhiễm mã độc'));
  }
  return startLocked(site, 'quarantine', t('Gỡ cách ly {domain}', { domain: site.domain }), (log) => release(site, force, by, log));
}

// ---- Cleaning ------------------------------------------------------------------------------

const DOWNLOAD_LIMIT = 200 * 1024 * 1024;
const WP_DOWNLOAD_HOSTS = new Set(['downloads.wordpress.org']);

interface CleanCtx {
  site: Site;
  user: string;
  webRoot: string;
  /** <site>/.lares-quarantine/<time>: where replaced and flagged files go. */
  qdir: string;
  /** <site>/.lares-clean/<time>: unpacked downloads. */
  staging: string;
  /** Root-owned folder of the downloaded zip files (readable by the site user). */
  downloads: string;
  manual: string[];
  /** Paths (relative to the site folder) the reinstall replaced: files, or folders ending in '/'. */
  replaced: string[];
  log: HostLogger;
}

/** As the site user: nothing root does here follows a symlink the site's code may have planted. */
const asSite = (c: CleanCtx, cmd: string, timeoutMs = 10 * 60_000) => host.mutate(isolation.asUser(c.user, cmd), { log: c.log, timeoutMs });

async function download(c: CleanCtx, url: string, name: string): Promise<string | null> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !WP_DOWNLOAD_HOSTS.has(u.hostname)) throw new Error(`refusing to download ${url}`);
  const file = path.join(c.downloads, name);
  if (config.dryRun) {
    c.log(`[dry-run] download ${url}`);
    return null;
  }
  const res = await fetch(url, { headers: { 'User-Agent': `Lares-Panel/${VERSION}` }, signal: AbortSignal.timeout(5 * 60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > DOWNLOAD_LIMIT) throw new Error(`${url}: too large`);
  await fs.writeFile(file, buf, { mode: 0o644 });
  return file;
}

async function apiJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': `Lares-Panel/${VERSION}` }, signal: AbortSignal.timeout(30_000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Unpack `zip` into staging/<name> and return the folder holding `top`. */
async function unpack(c: CleanCtx, zip: string, name: string, top: string): Promise<string | null> {
  const dest = path.join(c.staging, name);
  await asSite(c, `mkdir -p ${shq(dest)} && unzip -q -o ${shq(zip)} -d ${shq(dest)}`);
  const dir = path.join(dest, top);
  return config.dryRun || (await host.exists(dir)) ? dir : null;
}

/** Move `rel` (relative to the web root) into the quarantine folder, then the fresh copy in its place. */
const swapIn = (c: CleanCtx, fresh: string, rel: string) => {
  const target = path.join(c.webRoot, rel);
  const parked = path.join(c.qdir, path.relative(c.site.rootPath, target));
  c.replaced.push(path.relative(c.site.rootPath, target).split(path.sep).join('/'));
  return asSite(c, `if [ -e ${shq(target)} ] || [ -L ${shq(target)} ]; then mkdir -p ${shq(path.dirname(parked))} && mv -- ${shq(target)} ${shq(parked)}; fi && mv -- ${shq(fresh)} ${shq(target)}`);
};

async function reinstallCore(c: CleanCtx, latest: boolean) {
  const src = await readSafe(path.join(c.webRoot, 'wp-includes', 'version.php'), 1024 * 1024);
  const cur = src ? policy.parseWpVersion(src.toString('latin1')) : null;
  let version = cur?.version ?? null;
  if (latest || !version) {
    const offers = (await apiJson('https://api.wordpress.org/core/version-check/1.7/'))?.offers as Array<{ version?: string }> | undefined;
    version = offers?.[0]?.version ?? version;
  }
  if (!version || !policy.VERSION_RE.test(version)) {
    c.manual.push(tDefault('WordPress core (không xác định được phiên bản)'));
    return;
  }
  const locale = cur?.locale && cur.locale !== 'en_US' && /^[A-Za-z_]{2,10}$/.test(cur.locale) ? cur.locale : null;
  c.log(t('Tải WordPress {version}{locale}...', { version, locale: locale ? ` (${locale})` : '' }));
  let zip = locale ? await download(c, `https://downloads.wordpress.org/release/${locale}/wordpress-${version}.zip`, 'core.zip') : null;
  zip ??= await download(c, `https://downloads.wordpress.org/release/wordpress-${version}.zip`, 'core.zip');
  if (!zip) {
    if (!config.dryRun) c.manual.push(tDefault('WordPress core {version} (không tải được)', { version }));
    return;
  }
  const dir = await unpack(c, zip, 'core', 'wordpress');
  if (!dir) throw new Error(t('Gói WordPress không có thư mục wordpress/'));
  // wp-admin, wp-includes and every root file of the release; wp-content and wp-config.php stay
  const entries = config.dryRun ? ['wp-admin', 'wp-includes', 'index.php'] : (await fs.readdir(dir)).filter((n) => n !== 'wp-content');
  for (const name of entries) await swapIn(c, path.join(dir, name), name);
  c.log(t('Đã thay WordPress core bằng bản {version} sạch', { version }));
}

/** Folder name → version, for plugins (main file header) or themes (style.css). */
async function installed(c: CleanCtx, kind: 'plugins' | 'themes'): Promise<Array<{ slug: string; version: string | null; child: boolean }>> {
  const base = path.join(c.webRoot, 'wp-content', kind);
  const out: Array<{ slug: string; version: string | null; child: boolean }> = [];
  for (const d of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.isSymbolicLink()) continue;
    let version: string | null = null;
    let child = false;
    if (kind === 'themes') {
      const css = (await readSafe(path.join(base, d.name, 'style.css'), 64 * 1024))?.toString('utf8') ?? '';
      version = /^[ \t/*#@]*Version:\s*([0-9A-Za-z.+_-]{1,40})/im.exec(css)?.[1] ?? null;
      child = /^[ \t/*#@]*Template:\s*\S+/im.test(css);
    } else {
      for (const f of await fs.readdir(path.join(base, d.name)).catch(() => [] as string[])) {
        if (!f.endsWith('.php')) continue;
        const head = (await readSafe(path.join(base, d.name, f), 2 * 1024 * 1024))?.toString('latin1').slice(0, 8192);
        const h = head ? policy.parsePluginHeader(head) : null;
        if (h) {
          version = h.version;
          break;
        }
      }
    }
    out.push({ slug: d.name, version, child });
  }
  return out;
}

async function reinstallExtensions(c: CleanCtx, kind: 'plugins' | 'themes', latest: boolean) {
  const single = kind === 'plugins' ? 'plugin' : 'theme';
  for (const ext of await installed(c, kind)) {
    const label = `${single} ${ext.slug}`;
    if (!policy.SLUG_RE.test(ext.slug) || ext.child) {
      c.manual.push(ext.child ? tDefault('{label} (theme con / tự viết)', { label }) : label);
      continue;
    }
    let url: string | null = null;
    let version = ext.version;
    if (latest || !version) {
      const info = await apiJson(`https://api.wordpress.org/${kind}/info/1.2/?action=${single}_information&request[slug]=${encodeURIComponent(ext.slug)}`);
      if (info && typeof info.download_link === 'string') {
        url = info.download_link;
        version = typeof info.version === 'string' ? info.version : version;
      }
    } else if (policy.VERSION_RE.test(version)) {
      url = `https://downloads.wordpress.org/${single}/${ext.slug}.${version}.zip`;
    }
    const zip = url && new URL(url).hostname === 'downloads.wordpress.org' ? await download(c, url, `${single}-${ext.slug}.zip`) : null;
    if (!zip) {
      if (!config.dryRun) c.manual.push(tDefault('{label} {version} (không có trên wordpress.org: tải lại bản sạch từ nơi bạn mua)', { label, version: ext.version ?? '' }));
      continue;
    }
    const dir = await unpack(c, zip, `${single}-${ext.slug}`, ext.slug);
    if (!dir) {
      c.manual.push(label);
      continue;
    }
    await swapIn(c, dir, `wp-content/${kind}/${ext.slug}`);
    c.log(t('Đã cài lại {label} {version}', { label, version: version ?? '' }));
  }
}

/** Move the flagged files that are still there (reinstalled code replaced the others). */
async function parkFlagged(c: CleanCtx, scan: MalwareScan) {
  const moved: string[] = [];
  const replaced = (rel: string) => c.replaced.some((r) => rel === r || rel.startsWith(`${r}/`));
  for (const rel of policy.filesToQuarantine(scan.findings, replaced)) {
    const abs = path.join(c.site.rootPath, rel);
    if (!isInside(c.site.rootPath, abs) || !(await host.exists(abs))) continue;
    const parked = path.join(c.qdir, rel);
    await asSite(c, `mkdir -p ${shq(path.dirname(parked))} && mv -- ${shq(abs)} ${shq(parked)}`);
    moved.push(rel);
  }
  for (const f of scan.findings.filter((x) => x.check === 'user-ini' && x.severity === 'critical' && x.path)) {
    const abs = path.join(c.site.rootPath, f.path!);
    if (!isInside(c.site.rootPath, abs)) continue;
    await asSite(c, `sed -i -E '/^[[:space:]]*auto_(prepend|append)_file[[:space:]]*=/d' ${shq(abs)}`);
    c.log(t('Đã xoá auto_prepend_file/auto_append_file khỏi {file}', { file: f.path! }));
  }
  if (moved.length) c.log(t('Đã chuyển {n} file bị đánh dấu vào {dir}', { n: moved.length, dir: c.qdir }));
}

async function cleanDatabase(c: CleanCtx, input: CleanSiteInput) {
  const d = await wpDbOf(c.site);
  if (!d) {
    c.log(t('Bỏ qua bước database: không đọc được wp-config.php hoặc database không nằm trên máy chủ này'));
    return;
  }
  const tbl = (table: string) => `\`${d.name}\`.\`${d.prefix}${table}\``;
  const admins = await wpAdminsOf(d);
  const remove = admins.filter((a) => input.deleteUserIds.includes(a.id));
  const keep = admins.filter((a) => !input.deleteUserIds.includes(a.id));
  if (remove.length && !keep.length) throw conflict(t('Phải giữ lại ít nhất một tài khoản quản trị'));
  for (const a of remove) {
    await mysql.query(`UPDATE ${tbl('posts')} SET post_author = ? WHERE post_author = ?`, [keep[0]!.id, a.id]);
    await mysql.query(`DELETE FROM ${tbl('usermeta')} WHERE user_id = ?`, [a.id]);
    await mysql.query(`DELETE FROM ${tbl('users')} WHERE ID = ?`, [a.id]);
    c.log(t('Đã xoá tài khoản quản trị {login} (bài viết chuyển cho {to})', { login: a.login, to: keep[0]!.login }));
  }
  if (input.revokeAppPasswords) {
    await mysql.query(`DELETE FROM ${tbl('usermeta')} WHERE meta_key IN ('_application_passwords', 'session_tokens')`);
    c.log(t('Đã thu hồi mọi application password và phiên đăng nhập'));
  }

  const configFile = await findWpConfig(c.site);
  if (!configFile || (!input.shuffleSalts && !input.rotateDbPassword)) return;
  const src = (await readSafe(configFile, 1024 * 1024))?.toString('utf8');
  if (!src) return;
  if (policy.matchPatterns(src).length) c.manual.push(tDefault('wp-config.php có đoạn mã đáng ngờ: mở file và xoá phần lạ bằng tay'));
  let next = input.shuffleSalts ? shuffleWpSalts(src) : src;
  const record = input.rotateDbPassword ? databases.managedDatabase(d.name) : null;
  const newPassword = record ? randomPassword(24) : null;
  if (input.rotateDbPassword && !record) c.log(t('Bỏ qua đổi mật khẩu database: database không do Lares tạo'));
  if (record && newPassword) {
    await databases.setDatabasePassword(record.id, newPassword, c.log);
    next = setWpConfigDefine(next, 'DB_PASSWORD', newPassword);
  }
  try {
    await isolation.writeAsUser(c.site, configFile, next, c.log);
  } catch (err) {
    // the site cannot connect with a new password it does not know: put the old one back
    if (record) await databases.setDatabasePassword(record.id, record.password, c.log).catch(() => undefined);
    throw err;
  }
  if (input.shuffleSalts) c.log(t('Đã đổi salt trong wp-config.php: mọi phiên đăng nhập cũ (kể cả của kẻ tấn công) hết hiệu lực'));
  if (record) c.log(t('Đã đổi mật khẩu database {name}', { name: d.name }));
}

async function clean(site: Site, input: CleanSiteInput, by: string, log: HostLogger): Promise<MalwareScan> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const webRoot = path.resolve(site.webRoot);
  if (!isInside(site.rootPath, webRoot)) throw conflict(t('Thư mục web phải nằm trong thư mục site để dọn tự động'));
  const c: CleanCtx = {
    site,
    user: site.sysUser!,
    webRoot,
    qdir: path.join(site.rootPath, policy.QUARANTINE_DIR, stamp),
    staging: path.join(site.rootPath, policy.STAGING_DIR, stamp),
    downloads: '',
    manual: [],
    replaced: [],
    log,
  };
  log(t('Bước 1: quét để biết file nào cần xử lý'));
  const before = await runScan(site, 'clean', log);
  log(t('Bước 2: bản sao lưu an toàn trước khi dọn'));
  await takeBackup(site, 'safety', log);

  c.downloads = config.dryRun ? path.join(config.dataDir, 'clean-downloads') : await fs.mkdtemp(path.join('/var/tmp', `lares-clean-${site.id}-`));
  await fs.mkdir(c.downloads, { recursive: true });
  await fs.chmod(c.downloads, 0o755);
  try {
    await withCodeUnlocked(site, log, async () => {
      await asSite(c, `mkdir -p ${shq(c.qdir)} ${shq(c.staging)} && chmod 700 ${shq(path.join(site.rootPath, policy.QUARANTINE_DIR))} ${shq(path.join(site.rootPath, policy.STAGING_DIR))}`);
      if (site.appType === 'wordpress') {
        if (input.reinstallCore) {
          log(t('Bước 3: cài lại WordPress core'));
          await reinstallCore(c, input.updateToLatest);
        }
        if (input.reinstallPlugins) {
          log(t('Bước 4: cài lại plugin từ wordpress.org'));
          await reinstallExtensions(c, 'plugins', input.updateToLatest);
        }
        if (input.reinstallThemes) {
          log(t('Bước 5: cài lại theme từ wordpress.org'));
          await reinstallExtensions(c, 'themes', input.updateToLatest);
        }
      }
      if (input.quarantineFiles) {
        log(t('Bước 6: chuyển các file bị đánh dấu ra khỏi thư mục web'));
        await parkFlagged(c, before);
      }
      if (site.appType === 'wordpress') {
        log(t('Bước 7: database và wp-config.php'));
        await cleanDatabase(c, input);
      }
      await asSite(c, `rm -rf ${shq(path.join(site.rootPath, policy.STAGING_DIR))}`).catch(() => undefined);
      await sites.fixPermissions(site, log);
    });
  } finally {
    if (!config.dryRun) await fs.rm(c.downloads, { recursive: true, force: true }).catch(() => undefined);
  }

  log(t('Bước 8: quét lại'));
  const after = await runScan(site, 'clean', log);
  if (site.appType === 'wordpress') {
    const d = await wpDbOf(site);
    if (d) store.setKnownAdmins(site.id, (await wpAdminsOf(d)).map((a) => a.id));
    // what is left in mu-plugins after cleaning is what the owner keeps
    store.setKnownMuPlugins(site.id, await currentMuPlugins(site));
  }
  if (c.manual.length) {
    log(t('CẦN LÀM TAY:'));
    for (const m of c.manual) log(`  - ${m}`);
  }
  log(t('File cũ được giữ ở {dir} (ngoài thư mục web). Xoá khi chắc chắn không cần.', { dir: c.qdir }));
  log(after.status === 'infected' ? t('Vẫn còn dấu hiệu nhiễm: xem kết quả quét, xử lý tay rồi quét lại') : t('Quét lại không còn dấu hiệu nghiêm trọng: có thể gỡ cách ly'));
  store.addEvent(site.id, 'clean', by, c.manual.length ? c.manual.join('; ').slice(0, 1000) : null);
  return after;
}

export function startClean(siteId: number, input: CleanSiteInput, by: string): TaskInfo {
  const site = sites.getSite(siteId);
  if (!store.isQuarantined(site.id)) throw conflict(t('Cách ly khẩn site trước khi dọn: code của site không được chạy trong lúc dọn'));
  if (!site.sysUser || !sites.usesPhp(site.appType)) throw conflict(t('Dọn tự động chỉ áp dụng cho site PHP có user riêng'));
  return startLocked(site, 'clean', t('Dọn site {domain}', { domain: site.domain }), (log) => clean(site, input, by, log));
}
