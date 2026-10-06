import fs from 'node:fs/promises';
import path from 'node:path';
import { EMPTY_PHP_SETTINGS, PHP_SETTING_KEYS, type PhpDirectiveView, type PhpSettings, type PhpSettingsView, type Site } from '@lares/shared';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { badRequest, conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';
import { phpSocket } from './php.js';
import {
  blockSettings,
  clientMaxBodyFor,
  DEFAULT_CLIENT_MAX_BODY_MB,
  foreignKeys,
  formatDirective,
  getStoredPhpSettings,
  mergeUserIni,
  numericValue,
  parseIni,
  readServerPhp,
  renderBlock,
  siteClientMaxBodyMb,
  storePhpSettings,
  type ServerPhp,
} from './phpSettings.js';
import { applySiteVhost, getSite, usesPhp } from './sites.js';

/** Applying per-site PHP settings: `.user.ini` in the web root + nginx client_max_body_size. See phpSettings.ts. */

function phpSite(id: number): Site & { phpVersion: string } {
  const site = getSite(id);
  if (!usesPhp(site.appType)) throw badRequest(t('Chỉ áp dụng cho site PHP, WordPress và Laravel'));
  return { ...site, phpVersion: site.phpVersion ?? config.defaultPhp };
}

const serverPhpFor = (site: { phpVersion: string }) => readServerPhp(site.phpVersion, phpSocket(site.phpVersion), process.env.LARES_PHP_ETC_DIR || '/etc/php');

const userIniPath = (site: Site, server: ServerPhp) => path.join(site.webRoot, server.userIniFilename || '.user.ini');

const readFile = (file: string) => fs.readFile(file, 'utf8').catch(() => null);

function view(site: Site & { phpVersion: string }, server: ServerPhp, settings: PhpSettings, fileContent: string | null): PhpSettingsView {
  const fileIni = server.userIniFilename ? parseIni(fileContent ?? '') : new Map<string, string>();
  const ownKeys = new Set(PHP_SETTING_KEYS.filter((k) => settings[k] !== null));
  const directives: PhpDirectiveView[] = PHP_SETTING_KEYS.map((key) => {
    const srv = server.values[key];
    const locked = server.locked.has(key);
    const fromFile = fileIni.get(key);
    // the whole file counts (last line wins), so foreign lines written after Lares' block show up here
    const useFile = !locked && fromFile !== undefined;
    const fromOwnBlock = useFile && ownKeys.has(key) && fromFile === formatDirective(key, settings[key]!);
    return {
      key,
      site: settings[key],
      server: srv.value,
      serverSource: srv.source,
      effective: useFile ? fromFile! : srv.value,
      effectiveSource: useFile ? (fromOwnBlock ? 'site' : 'user-ini') : srv.source,
      locked,
    };
  });
  const mb = (key: 'upload_max_filesize' | 'post_max_size') => {
    const n = numericValue(key, server.values[key].value);
    return n === null || !Number.isFinite(n) ? null : n;
  };
  return {
    siteId: site.id,
    phpVersion: site.phpVersion,
    settings,
    directives,
    serverMb: { upload_max_filesize: mb('upload_max_filesize'), post_max_size: mb('post_max_size') },
    clientMaxBodyMb: siteClientMaxBodyMb(site.id) ?? DEFAULT_CLIENT_MAX_BODY_MB,
    userIniPath: userIniPath(site, server),
    userIniEnabled: server.userIniFilename !== '',
    userIniCacheTtl: server.userIniCacheTtl,
    foreignKeys: foreignKeys(fileContent),
  };
}

export async function getPhpSettingsView(siteId: number): Promise<PhpSettingsView> {
  const site = phpSite(siteId);
  const server = await serverPhpFor(site);
  const content = server.userIniFilename ? await readFile(userIniPath(site, server)) : null;
  // A clone or a restored backup carries the file but not the stored row: show what the file says.
  const settings = getStoredPhpSettings(siteId) ?? (content ? blockSettings(content) : null) ?? EMPTY_PHP_SETTINGS;
  return view(site, server, settings, content);
}

/** Write the site's overrides, follow them in nginx, then reload PHP-FPM so they apply at once. */
export async function savePhpSettings(siteId: number, settings: PhpSettings, log?: HostLogger): Promise<PhpSettingsView> {
  const site = phpSite(siteId);
  const server = await serverPhpFor(site);
  if (!server.userIniFilename) {
    throw conflict(t('user_ini.filename đang để trống trong php.ini của PHP {version} nên PHP không đọc file cấu hình theo thư mục. Đặt lại user_ini.filename = .user.ini rồi thử lại.', { version: site.phpVersion }));
  }
  const locked = PHP_SETTING_KEYS.filter((k) => settings[k] !== null && server.locked.has(k));
  if (locked.length) {
    throw conflict(t('PHP-FPM pool của PHP {version} cố định {keys} bằng php_admin_value, site không thể đổi. Bỏ dòng đó trong pool.d rồi thử lại.', { version: site.phpVersion, keys: locked.join(', ') }));
  }

  // post_max_size >= upload_max_filesize for the values PHP will really use, server ones included
  const eff = (key: 'upload_max_filesize' | 'post_max_size') => settings[key] ?? numericValue(key, server.values[key].value);
  const upload = eff('upload_max_filesize');
  const post = eff('post_max_size');
  if (upload !== null && post !== null && post < upload) {
    throw badRequest(t('post_max_size ({post} MB) phải lớn hơn hoặc bằng upload_max_filesize ({upload} MB), nếu không file lớn vẫn bị từ chối.', { post, upload }));
  }

  const file = userIniPath(site, server);
  const previous = await readFile(file);
  const next = mergeUserIni(previous, renderBlock(settings));
  const previousStored = getStoredPhpSettings(siteId);
  const previousBody = siteClientMaxBodyMb(siteId);

  const writeIni = async (content: string | null) => {
    if (content === null) await fs.rm(file, { force: true });
    else {
      await host.writeFile(file, content, 0o644);
      // the site's own tools (Wordfence...) append their lines to this file, so it belongs to the web user like the rest
      await host.mutate(`chown ${shq(`${config.webUser}:${config.webUser}`)} ${shq(file)}`, { log });
    }
  };

  await writeIni(next);
  storePhpSettings(siteId, settings, clientMaxBodyFor(settings, upload, post));
  try {
    await applySiteVhost(getSite(siteId), log);
  } catch (err) {
    await writeIni(previous).catch(() => {});
    storePhpSettings(siteId, previousStored ?? EMPTY_PHP_SETTINGS, previousBody);
    throw err;
  }
  // user_ini.cache_ttl (300 s by default) would delay the change: a graceful reload starts fresh workers
  await host
    .mutate(`systemctl reload ${shq(`php${site.phpVersion}-fpm`)}`, { log })
    .catch((err) => log?.(t('Cảnh báo: không reload được PHP-FPM ({error}) - giá trị mới có hiệu lực sau tối đa {ttl} giây', { error: errorMessage(err), ttl: server.userIniCacheTtl })));
  return view(site, server, settings, next);
}
