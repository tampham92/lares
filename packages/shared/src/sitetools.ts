import { z } from 'zod';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// Site tools: per-site PHP settings, Adminer (database GUI), onboarding checklist
// ---------------------------------------------------------------------------

// ---- Per-site PHP settings -------------------------------------------------

/** The directives a site can override (all PHP_INI_PERDIR or PHP_INI_ALL, so `.user.ini` may set them). */
export const PHP_SETTING_KEYS = ['upload_max_filesize', 'post_max_size', 'memory_limit', 'max_execution_time', 'max_input_vars'] as const;
export type PhpSettingKey = (typeof PHP_SETTING_KEYS)[number];

/** Sizes are whole megabytes ("128M"), the time limit is seconds, max_input_vars a plain count. */
export const PHP_SETTING_LIMITS: Record<PhpSettingKey, { min: number; max: number; unit: 'MB' | 's' | '' }> = {
  upload_max_filesize: { min: 1, max: 4096, unit: 'MB' },
  post_max_size: { min: 1, max: 4096, unit: 'MB' },
  memory_limit: { min: 64, max: 4096, unit: 'MB' },
  // nginx waits 300 s for PHP (fastcgi_read_timeout in every vhost): a longer limit would end in a 504 anyway
  max_execution_time: { min: 10, max: 300, unit: 's' },
  max_input_vars: { min: 1000, max: 100000, unit: '' },
};

const directive = (k: PhpSettingKey) =>
  z
    .number({ invalid_type_error: msg('Phải là một số') })
    .int(msg('Phải là số nguyên'))
    .min(PHP_SETTING_LIMITS[k].min, msg('Giá trị nhỏ hơn mức cho phép'))
    .max(PHP_SETTING_LIMITS[k].max, msg('Giá trị lớn hơn mức cho phép'))
    .nullable()
    .default(null);

/** null = keep the server's value (php.ini / PHP-FPM pool). */
export const phpSettingsSchema = z
  .object({
    upload_max_filesize: directive('upload_max_filesize'),
    post_max_size: directive('post_max_size'),
    memory_limit: directive('memory_limit'),
    max_execution_time: directive('max_execution_time'),
    max_input_vars: directive('max_input_vars'),
  })
  .refine((v) => v.upload_max_filesize === null || v.post_max_size === null || v.post_max_size >= v.upload_max_filesize, {
    message: msg('post_max_size phải lớn hơn hoặc bằng upload_max_filesize'),
    path: ['post_max_size'],
  });
export type PhpSettings = z.infer<typeof phpSettingsSchema>;

export const EMPTY_PHP_SETTINGS: PhpSettings = { upload_max_filesize: null, post_max_size: null, memory_limit: null, max_execution_time: null, max_input_vars: null };

export const PHP_PRESETS: ReadonlyArray<{ id: string; label: string; values: PhpSettings }> = [
  { id: 'server', label: msg('Mặc định máy chủ'), values: EMPTY_PHP_SETTINGS },
  { id: 'basic', label: msg('Cơ bản'), values: { upload_max_filesize: 64, post_max_size: 64, memory_limit: 256, max_execution_time: 60, max_input_vars: 3000 } },
  { id: 'wordpress', label: msg('WordPress / WooCommerce'), values: { upload_max_filesize: 128, post_max_size: 128, memory_limit: 512, max_execution_time: 300, max_input_vars: 5000 } },
  { id: 'large', label: msg('Lớn (import, page builder)'), values: { upload_max_filesize: 1024, post_max_size: 1024, memory_limit: 1024, max_execution_time: 300, max_input_vars: 10000 } },
];

export type PhpValueSource = 'site' | 'user-ini' | 'pool' | 'php.ini' | 'builtin';

export interface PhpDirectiveView {
  key: PhpSettingKey;
  /** Value set in the panel for this site (MB / seconds / count), null = server value. */
  site: number | null;
  /** The server's value as written in its config, e.g. "256M"; "-1" = unlimited. */
  server: string;
  serverSource: Exclude<PhpValueSource, 'site' | 'user-ini'>;
  /** What PHP actually uses for this site. */
  effective: string;
  effectiveSource: PhpValueSource;
  /** php_admin_value in the PHP-FPM pool: `.user.ini` cannot change it. */
  locked: boolean;
}

export interface PhpSettingsView {
  siteId: number;
  phpVersion: string;
  settings: PhpSettings;
  directives: PhpDirectiveView[];
  /** Server values in MB (null = unlimited / unknown) so the form can keep post_max_size >= upload_max_filesize. */
  serverMb: { upload_max_filesize: number | null; post_max_size: number | null };
  /** client_max_body_size of the site's nginx vhost, in MB (0 = unlimited). */
  clientMaxBodyMb: number;
  /** The per-directory ini file Lares manages (PHP's user_ini.filename in the web root). */
  userIniPath: string;
  /** False when user_ini.filename is empty in php.ini: per-site values cannot apply. */
  userIniEnabled: boolean;
  /** user_ini.cache_ttl (Lares reloads PHP-FPM after a change, so it applies at once). */
  userIniCacheTtl: number;
  /** Lines outside Lares' block in the same file that set one of the directives. */
  foreignKeys: PhpSettingKey[];
}

// ---- Adminer ----------------------------------------------------------------

export const adminerOpenSchema = z.object({ databaseId: z.number().int().positive() });

export interface AdminerStatus {
  /** Pinned Adminer release. */
  version: string;
  sha256: string;
  downloadUrl: string;
  /** Downloaded, checksum verified and wired to PHP-FPM + nginx. */
  installed: boolean;
  phpVersion: string | null;
  /** Dry-run (development machine): the flow works but Adminer itself never runs. */
  dryRun: boolean;
}

// ---- Onboarding ---------------------------------------------------------------

export const ONBOARDING_ITEMS = ['allowlist', 'twoFactor', 'panelDomain', 'firstSite', 'backups', 'cloudflare'] as const;
export type OnboardingItemId = (typeof ONBOARDING_ITEMS)[number];

export interface OnboardingItem {
  id: OnboardingItemId;
  done: boolean;
  /** Not counted in the progress (nice to have). */
  optional: boolean;
  /** Undoing it after the card was dismissed brings the card back. */
  security: boolean;
}

export interface OnboardingView {
  items: OnboardingItem[];
  /** Required items done / required items. */
  done: number;
  total: number;
  dismissed: boolean;
  /** Was dismissed, but a security item has been undone since. */
  reappeared: boolean;
}
