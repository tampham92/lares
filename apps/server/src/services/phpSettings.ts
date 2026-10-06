import fs from 'node:fs/promises';
import path from 'node:path';
import { PHP_SETTING_KEYS, phpSettingsSchema, type PhpSettingKey, type PhpSettings } from '@lares/shared';
import { db, nowIso } from '../db/index.js';

/*
 * Per-site PHP settings - the pure part (ini parsing / rendering) and the stored values.
 *
 * Why `.user.ini` and not a PHP-FPM pool per site: every site of a PHP version shares that
 * version's pool (README: "chưa tách user/PHP-FPM pool riêng"), and the five directives Lares
 * manages are PHP_INI_PERDIR (upload_max_filesize, post_max_size, max_input_vars) or PHP_INI_ALL
 * (memory_limit, max_execution_time), which PHP-FPM reads from the `.user.ini` of the script's
 * directory up to the document root. A file in the web root therefore covers the whole site,
 * costs nothing when idle (a pool per site keeps its own workers), and needs no root-owned
 * config per site. Limits: values set with php_admin_value in the pool win (shown as "locked"),
 * user_ini.filename must not be empty, and PHP CLI (wp-cli, cron) ignores the file.
 *
 * Lares owns only the block between its markers and appends it at the end of the file, so lines
 * written by others (e.g. Wordfence's auto_prepend_file) survive and Lares' values win over them.
 */

export const BLOCK_BEGIN = '; BEGIN Lares PHP settings - managed by Lares Panel, edit them in the panel';
export const BLOCK_END = '; END Lares PHP settings';

/** PHP's compiled-in defaults, used when no php.ini can be read (dry-run, unusual layouts). */
export const PHP_BUILTIN: Record<PhpSettingKey, string> = {
  upload_max_filesize: '2M',
  post_max_size: '8M',
  memory_limit: '128M',
  max_execution_time: '30',
  max_input_vars: '1000',
};

export const SIZE_KEYS: ReadonlySet<PhpSettingKey> = new Set(['upload_max_filesize', 'post_max_size', 'memory_limit']);

/** nginx default when a site has no upload override (unchanged from earlier Lares versions). */
export const DEFAULT_CLIENT_MAX_BODY_MB = 256;

/**
 * "256M" / "1G" / "512K" / "1048576" → MB. Negative = unlimited (Infinity); post_max_size 0 also
 * means unlimited. Returns null for values PHP would not understand either.
 */
export function iniSizeToMb(value: string, key?: PhpSettingKey): number | null {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*([kmg])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 0 || (n === 0 && key === 'post_max_size')) return Infinity;
  const unit = (m[2] ?? '').toLowerCase();
  return unit === 'g' ? n * 1024 : unit === 'm' ? n : unit === 'k' ? n / 1024 : n / 1048576;
}

/** The text written to the ini file for a panel value. */
export const formatDirective = (key: PhpSettingKey, value: number) => (SIZE_KEYS.has(key) ? `${value}M` : String(value));

/** Strip quotes and a trailing `; comment` from an ini value. */
function iniValue(raw: string): string {
  const v = raw.trim();
  const q = v.match(/^(["'])(.*)\1/);
  if (q) return q[2]!;
  return v.replace(/\s;.*$/, '').trim();
}

/** key → value of an ini file (last occurrence wins, like PHP). Sections are ignored. */
export function parseIni(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.]+)\s*=(.*)$/);
    if (m) out.set(m[1]!, iniValue(m[2]!));
  }
  return out;
}

/** php_admin_value[...] / php_value[...] (and *_flag) of one pool section. */
export interface PoolOverrides {
  admin: Map<string, string>;
  value: Map<string, string>;
}

/**
 * Pool sections of a php-fpm pool.d file: name → { listen, overrides }.
 * (One file may define several pools; `[global]` is not a pool.)
 */
export function parsePoolFile(content: string): Map<string, { listen: string | null; overrides: PoolOverrides }> {
  const pools = new Map<string, { listen: string | null; overrides: PoolOverrides }>();
  let current: { listen: string | null; overrides: PoolOverrides } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      current = section[1] === 'global' ? null : { listen: null, overrides: { admin: new Map(), value: new Map() } };
      if (current) pools.set(section[1]!, current);
      continue;
    }
    if (!current || /^\s*[;#]/.test(line)) continue;
    const listen = line.match(/^\s*listen\s*=\s*(.+)$/);
    if (listen) current.listen = iniValue(listen[1]!);
    const ov = line.match(/^\s*php_(admin_)?(?:value|flag)\[([A-Za-z0-9_.]+)\]\s*=(.*)$/);
    if (ov) (ov[1] ? current.overrides.admin : current.overrides.value).set(ov[2]!, iniValue(ov[3]!));
  }
  return pools;
}

/** Lares' block for these settings, or null when nothing is overridden. */
export function renderBlock(settings: PhpSettings): string | null {
  const lines = PHP_SETTING_KEYS.filter((k) => settings[k] !== null).map((k) => `${k} = ${formatDirective(k, settings[k]!)}`);
  return lines.length ? [BLOCK_BEGIN, ...lines, BLOCK_END].join('\n') : null;
}

const blockRe = () => new RegExp(`(?:^|\\n)${escapeRe(BLOCK_BEGIN)}\\n[\\s\\S]*?\\n${escapeRe(BLOCK_END)}[^\\n]*`, 'g');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The file without Lares' block (other people's lines untouched). */
export function stripBlock(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(blockRe(), '').replace(/^\n+/, '');
}

/**
 * New content of the ini file: the current one without Lares' old block, plus the new block at
 * the end (so it wins over earlier lines). null = nothing left, delete the file.
 */
export function mergeUserIni(current: string | null, block: string | null): string | null {
  const rest = stripBlock(current ?? '').replace(/\s+$/, '');
  const out = [rest, block].filter(Boolean).join('\n\n');
  return out ? `${out}\n` : null;
}

/** Values inside Lares' block of an existing file (a cloned / restored site that has no stored row). */
export function blockSettings(content: string): PhpSettings | null {
  const m = content.replace(/\r\n/g, '\n').match(new RegExp(`${escapeRe(BLOCK_BEGIN)}\\n([\\s\\S]*?)\\n${escapeRe(BLOCK_END)}`));
  if (!m) return null;
  const ini = parseIni(m[1]!);
  const raw: Record<string, number | null> = {};
  for (const k of PHP_SETTING_KEYS) {
    const v = ini.get(k);
    const n = v === undefined ? null : SIZE_KEYS.has(k) ? iniSizeToMb(v, k) : Number(v);
    raw[k] = n !== null && Number.isFinite(n) ? Math.round(n) : null;
  }
  const r = phpSettingsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Keys set by lines outside Lares' block. */
export function foreignKeys(content: string | null): PhpSettingKey[] {
  if (!content) return [];
  const ini = parseIni(stripBlock(content));
  return PHP_SETTING_KEYS.filter((k) => ini.has(k));
}

// ---- What the server gives PHP for a site ------------------------------------

export interface ServerPhp {
  /** Value per directive and where it came from. */
  values: Record<PhpSettingKey, { value: string; source: 'pool' | 'php.ini' | 'builtin' }>;
  /** Directives fixed with php_admin_value in the site's pool. */
  locked: Set<PhpSettingKey>;
  userIniFilename: string;
  userIniCacheTtl: number;
}

/**
 * Read /etc/php/<v>/fpm: php.ini, then conf.d/*.ini (later files win, like PHP's scan order), then
 * the pool serving `socket` (php_value / php_admin_value). Missing files fall back to PHP defaults.
 */
export async function readServerPhp(version: string, socket: string, etcPhp = '/etc/php'): Promise<ServerPhp> {
  const fpm = path.join(etcPhp, version, 'fpm');
  const read = (f: string) => fs.readFile(f, 'utf8').catch(() => '');
  const ini = parseIni(await read(path.join(fpm, 'php.ini')));
  const confd = (await fs.readdir(path.join(fpm, 'conf.d')).catch(() => [] as string[])).filter((f) => f.endsWith('.ini')).sort();
  for (const f of confd) for (const [k, v] of parseIni(await read(path.join(fpm, 'conf.d', f)))) ini.set(k, v);

  let pool: PoolOverrides = { admin: new Map(), value: new Map() };
  const poolFiles = (await fs.readdir(path.join(fpm, 'pool.d')).catch(() => [] as string[])).filter((f) => f.endsWith('.conf')).sort();
  let fallback: PoolOverrides | null = null;
  for (const f of poolFiles) {
    for (const [name, p] of parsePoolFile(await read(path.join(fpm, 'pool.d', f)))) {
      if (p.listen && path.resolve(p.listen) === path.resolve(socket)) pool = p.overrides;
      if (name === 'www') fallback = p.overrides;
    }
  }
  if (!pool.admin.size && !pool.value.size && fallback) pool = fallback;

  const values = {} as ServerPhp['values'];
  const locked = new Set<PhpSettingKey>();
  for (const k of PHP_SETTING_KEYS) {
    const admin = pool.admin.get(k);
    if (admin !== undefined) {
      values[k] = { value: admin, source: 'pool' };
      locked.add(k);
    } else if (pool.value.has(k)) values[k] = { value: pool.value.get(k)!, source: 'pool' };
    else if (ini.has(k)) values[k] = { value: ini.get(k)!, source: 'php.ini' };
    else values[k] = { value: PHP_BUILTIN[k], source: 'builtin' };
  }
  // user_ini.* are PHP_INI_SYSTEM: php.ini or php_admin_value only
  const filename = pool.admin.get('user_ini.filename') ?? ini.get('user_ini.filename') ?? '.user.ini';
  const ttl = Number(pool.admin.get('user_ini.cache_ttl') ?? ini.get('user_ini.cache_ttl') ?? 300);
  return { values, locked, userIniFilename: filename, userIniCacheTtl: Number.isFinite(ttl) ? ttl : 300 };
}

/** A directive's value in MB / seconds / count (sizes: Infinity = unlimited). */
export function numericValue(key: PhpSettingKey, value: string): number | null {
  if (SIZE_KEYS.has(key)) return iniSizeToMb(value, key);
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * client_max_body_size for the vhost: follows the larger of the effective upload/post limits as
 * soon as the site overrides either of them, otherwise the historical default (null).
 * An unlimited PHP side falls back to the other value, then to the default.
 */
export function clientMaxBodyFor(settings: PhpSettings, effectiveUploadMb: number | null, effectivePostMb: number | null): number | null {
  if (settings.upload_max_filesize === null && settings.post_max_size === null) return null;
  const finite = [effectiveUploadMb, effectivePostMb].filter((n): n is number => n !== null && Number.isFinite(n));
  return finite.length ? Math.max(1, Math.ceil(Math.max(...finite))) : DEFAULT_CLIENT_MAX_BODY_MB;
}

// ---- Stored values -------------------------------------------------------------

interface Row {
  settings_json: string;
  client_max_body_mb: number | null;
}

export function getStoredPhpSettings(siteId: number): PhpSettings | null {
  const row = db.prepare('SELECT settings_json, client_max_body_mb FROM site_php_settings WHERE site_id = ?').get(siteId) as Row | undefined;
  if (!row) return null;
  const r = phpSettingsSchema.safeParse(JSON.parse(row.settings_json));
  return r.success ? r.data : null;
}

/** Saves the overrides (or forgets them when everything is back to the server value). */
export function storePhpSettings(siteId: number, settings: PhpSettings, clientMaxBodyMb: number | null) {
  if (PHP_SETTING_KEYS.every((k) => settings[k] === null)) {
    db.prepare('DELETE FROM site_php_settings WHERE site_id = ?').run(siteId);
    return;
  }
  db.prepare(
    `INSERT INTO site_php_settings (site_id, settings_json, client_max_body_mb, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET settings_json = excluded.settings_json, client_max_body_mb = excluded.client_max_body_mb, updated_at = excluded.updated_at`,
  ).run(siteId, JSON.stringify(settings), clientMaxBodyMb, nowIso());
}

/** client_max_body_size (MB) the site's vhost must use, null = default. Read by sites.vhostSpecFor. */
export function siteClientMaxBodyMb(siteId: number): number | null {
  const row = db.prepare('SELECT client_max_body_mb FROM site_php_settings WHERE site_id = ?').get(siteId) as Pick<Row, 'client_max_body_mb'> | undefined;
  return row?.client_max_body_mb ?? null;
}
