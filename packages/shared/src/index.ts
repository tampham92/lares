import { z } from 'zod';

export * from './i18n.js';
export { SHARED_EN } from './i18n-en.js';
export * from './network.js';

// ---------------------------------------------------------------------------
// Primitive validators (shared by server & web so both reject the same input)
// ---------------------------------------------------------------------------

export const DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;
export const DB_IDENT_RE = /^[A-Za-z0-9_]{1,64}$/;
export const PHP_VERSION_RE = /^\d\.\d$/;

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(DOMAIN_RE, 'Tên miền không hợp lệ');

/** Absolute POSIX path without `..`, NUL or newlines - safe to shell-quote. */
export const absPathSchema = z
  .string()
  .trim()
  .regex(/^\/[^\0\r\n]*$/, 'Đường dẫn phải là đường dẫn tuyệt đối')
  .refine((p) => !p.split('/').includes('..'), 'Đường dẫn không được chứa ".."')
  .transform((p) => (p.length > 1 ? p.replace(/\/+$/, '') : p));

export const excludePatternSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[\w.\-*/@+ ]+$/, 'Mẫu loại trừ chỉ gồm chữ, số và . - * / _ @ +')
  .refine((p) => !p.split('/').includes('..'), 'Mẫu loại trừ không được chứa ".."');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Sites & databases
// ---------------------------------------------------------------------------

/** App types Lares understands (creation + migration detection). */
export const APP_TYPES = ['wordpress', 'nextjs', 'laravel', 'php', 'static', 'unknown'] as const;
export type AppType = (typeof APP_TYPES)[number];

/** Types that can be created from the "Add site" form. */
export const SITE_TYPES = ['wordpress', 'nextjs', 'php', 'static'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const APP_LABELS: Record<AppType, string> = {
  wordpress: 'WordPress',
  nextjs: 'Next.js',
  laravel: 'Laravel',
  php: 'PHP',
  static: 'HTML tĩnh',
  unknown: 'Không rõ',
};

export const PACKAGE_MANAGERS = ['auto', 'npm', 'yarn', 'pnpm'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** A single-line shell command supplied by the admin (build/start). */
const shellCommandSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^[^\0\r\n]*$/, 'Lệnh chỉ được nằm trên 1 dòng');

const envKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Tên biến môi trường không hợp lệ');

export const nextjsConfigSchema = z.object({
  gitUrl: z
    .string()
    .trim()
    .regex(/^(https:\/\/|git@)[^\s'"`$;&|<>]+$/, 'Git URL phải bắt đầu bằng https:// hoặc git@')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  branch: z.string().trim().regex(/^[\w.\-/]+$/).default('main'),
  packageManager: z.enum(PACKAGE_MANAGERS).default('auto'),
  installCommand: shellCommandSchema.optional(),
  buildCommand: shellCommandSchema.optional(),
  startCommand: shellCommandSchema.optional(),
  port: z.coerce.number().int().min(1024).max(65535).optional(),
  env: z.record(envKeySchema, z.string().max(4096).regex(/^[^\0\r\n]*$/)).default({}),
});
export type NextjsConfig = z.infer<typeof nextjsConfigSchema>;

export const wordpressConfigSchema = z.object({
  title: z.string().trim().max(200).optional(),
  adminUser: z.string().trim().regex(/^[A-Za-z0-9_.@-]{3,60}$/).optional().or(z.literal('').transform(() => undefined)),
  adminPassword: z.string().min(8).max(128).optional().or(z.literal('').transform(() => undefined)),
  adminEmail: z.string().trim().email().optional().or(z.literal('').transform(() => undefined)),
  locale: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('vi'),
});
export type WordpressConfig = z.infer<typeof wordpressConfigSchema>;

/**
 * "localhost" (or an empty value) means: no domain yet - Lares assigns a port and the site is
 * reachable at http://<server-ip>:<port>.
 */
export const LOCALHOST = 'localhost';
export const siteDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === '' ? LOCALHOST : v))
  .refine((v) => v === LOCALHOST || DOMAIN_RE.test(v), 'Tên miền không hợp lệ (hoặc nhập localhost để chạy theo port)');

/** Hostname/IP the browser used to reach the panel - becomes the site URL of port-based sites. */
export const publicHostSchema = z
  .string()
  .trim()
  .max(253)
  .regex(/^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[?[0-9a-f:.]+\]?$/i, 'Host không hợp lệ');

const oneLine = (max: number) => z.string().trim().max(max).regex(/^[^\r\n<>]*$/, 'Không được chứa xuống dòng hoặc < >');

/** Values substituted into a template ({{SITE_NAME}}, {{PHONE}}...). Empty = template defaults. */
export const brandingSchema = z.object({
  siteName: oneLine(80).optional(),
  tagline: oneLine(200).optional(),
  phone: z.string().trim().max(30).regex(/^[0-9+().\s-]*$/, 'Số điện thoại không hợp lệ').optional(),
  email: z.string().trim().email('Email không hợp lệ').optional().or(z.literal('').transform(() => undefined)),
  address: oneLine(200).optional(),
});
export type Branding = z.infer<typeof brandingSchema>;

export const templateIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Template không hợp lệ');

const siteBase = {
  domain: siteDomainSchema,
  aliases: z.array(domainSchema).default([]),
  /** Port-based sites only: choose the port (otherwise Lares picks a free one). */
  listenPort: z.coerce.number().int().min(1024).max(65535).optional(),
  publicHost: publicHostSchema.optional(),
};
const templateFields = {
  template: templateIdSchema.optional(),
  branding: brandingSchema.default({}),
};
const phpVersionSchema = z.string().regex(PHP_VERSION_RE).optional();

export const createSiteSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wordpress'), ...siteBase, ...templateFields, phpVersion: phpVersionSchema, wordpress: wordpressConfigSchema.default({}) }),
  z.object({ type: z.literal('nextjs'), ...siteBase, nextjs: nextjsConfigSchema.default({}) }),
  z.object({ type: z.literal('php'), ...siteBase, phpVersion: phpVersionSchema, createDatabase: z.boolean().default(false) }),
  z.object({ type: z.literal('static'), ...siteBase, ...templateFields }),
]);
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

/** Copy of an existing site (files, databases, settings) under a new domain or port. */
export const cloneSiteSchema = z.object(siteBase);
export type CloneSiteInput = z.infer<typeof cloneSiteSchema>;

export const deleteSiteSchema = z.object({
  removeFiles: z.boolean().default(false),
  removeDatabases: z.boolean().default(false),
  removeLogs: z.boolean().default(false),
  revokeSsl: z.boolean().default(true),
});

export interface SslState {
  enabled: boolean;
  type: 'letsencrypt' | 'custom' | null;
  domains: string[];
  issuer: string | null;
  expiresAt: string | null;
  forceHttps: boolean;
}

export interface Site {
  id: number;
  domain: string;
  aliases: string[];
  rootPath: string;
  /** Directory served by nginx (PHP/static) or application dir (Next.js). */
  webRoot: string;
  phpVersion: string | null;
  appType: AppType;
  appPort: number | null;
  /** Port-based site (no domain): nginx listens on this port. */
  listenPort: number | null;
  status: 'active' | 'disabled';
  ssl: SslState;
  accessLog: boolean;
  migrationId: number | null;
  createdAt: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  types: Array<'wordpress' | 'static'>;
  colors: { primary: string; accent: string };
  previewImage: string | null;
  defaults: Required<Pick<Branding, 'siteName' | 'tagline' | 'phone' | 'email' | 'address'>>;
  /** Lives in the custom templates folder (kept across upgrades). */
  custom?: boolean;
}

export interface CreateSiteResult {
  site: Site;
  url: string;
  database: { name: string; username: string; password: string } | null;
  wordpressAdmin: { url: string; user: string; password: string } | null;
}

export interface NodeAppStatus {
  service: string;
  active: 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
  port: number | null;
  packageManager: Exclude<PackageManager, 'auto'> | null;
}

export const siteSettingsSchema = z.object({
  aliases: z.array(domainSchema).optional(),
  phpVersion: z.string().regex(PHP_VERSION_RE).optional(),
  accessLog: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

// ---------------------------------------------------------------------------
// SSL
// ---------------------------------------------------------------------------

export const issueSslSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('letsencrypt'),
    email: z.string().trim().email('Email không hợp lệ'),
    /** Include aliases (e.g. www.) in the certificate. */
    includeAliases: z.boolean().default(true),
    forceHttps: z.boolean().default(true),
    staging: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('custom'),
    certificate: z.string().trim().includes('BEGIN CERTIFICATE', { message: 'Certificate PEM không hợp lệ' }),
    privateKey: z.string().trim().regex(/BEGIN (RSA |EC )?PRIVATE KEY/, 'Private key PEM không hợp lệ'),
    forceHttps: z.boolean().default(true),
  }),
]);
export type IssueSslInput = z.infer<typeof issueSslSchema>;

// ---------------------------------------------------------------------------
// Traffic logs
// ---------------------------------------------------------------------------

/** access/error = nginx logs, app = Next.js process output (journald). */
export const LOG_TYPES = ['access', 'error', 'app'] as const;
export type LogType = (typeof LOG_TYPES)[number];

export interface LogTail {
  file: string;
  sizeBytes: number;
  lines: string[];
  truncated: boolean;
}

export interface TrafficStats {
  from: string;
  to: string;
  totalRequests: number;
  uniqueIps: number;
  bytesSent: number;
  avgResponseMs: number | null;
  statusClasses: Record<'2xx' | '3xx' | '4xx' | '5xx' | 'other', number>;
  topPaths: Array<{ key: string; count: number }>;
  topIps: Array<{ key: string; count: number }>;
  topReferrers: Array<{ key: string; count: number }>;
  topUserAgents: Array<{ key: string; count: number }>;
  topStatus: Array<{ key: string; count: number }>;
  timeline: Array<{ t: string; requests: number; bytes: number; errors: number }>;
  parsedLines: number;
  skippedLines: number;
}

export const logrotateSchema = z.object({
  retentionDays: z.coerce.number().int().min(1).max(365),
  compress: z.boolean().default(true),
  maxSizeMb: z.coerce.number().int().min(1).max(10240).optional(),
});
export type LogrotateSettings = z.infer<typeof logrotateSchema>;

// ---------------------------------------------------------------------------
// AI writing (WordPress posts)
// ---------------------------------------------------------------------------

export const AI_PROVIDERS = ['anthropic', 'gemini', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
  openai: 'OpenAI / API tương thích OpenAI',
};

export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (khuyên dùng)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (chất lượng cao nhất)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (nhanh, rẻ)' },
] as const;

export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (khuyên dùng)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (chất lượng cao nhất)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (nhanh, rẻ)' },
] as const;

/** Model choices offered in Settings; OpenAI-compatible endpoints take a free-form model name. */
export const AI_MODELS: Partial<Record<AiProvider, ReadonlyArray<{ id: string; label: string }>>> = { anthropic: ANTHROPIC_MODELS, gemini: GEMINI_MODELS };

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  /** Empty = keep the stored key. */
  apiKey: z
    .string()
    .trim()
    .max(500)
    .regex(/^[^\s]*$/, 'API key không được chứa khoảng trắng')
    .optional(),
  model: z.string().trim().regex(/^[\w.:\-/]{1,100}$/, 'Tên model không hợp lệ'),
  /** OpenAI-compatible endpoint (DeepSeek, OpenRouter, Gemini...). Empty = api.openai.com */
  baseUrl: z
    .string()
    .trim()
    .regex(/^https:\/\/[^\s'"`<>]+$/, 'Base URL phải bắt đầu bằng https://')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

/** What the browser gets back: never the key itself. */
export interface AiSettingsView {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
}

export const ARTICLE_TONES = {
  'chuyen-nghiep': 'Chuyên nghiệp',
  'than-thien': 'Thân thiện, gần gũi',
  'thuyet-phuc': 'Thuyết phục (bán hàng)',
  'chuyen-gia': 'Chuyên gia, chuyên sâu',
} as const;
export type ArticleTone = keyof typeof ARTICLE_TONES;

export const articleRequestSchema = z.object({
  topic: z.string().trim().min(3, 'Nhập chủ đề bài viết').max(500),
  keyword: z.string().trim().min(2, 'Nhập từ khoá chính').max(100),
  secondaryKeywords: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  language: z.enum(['vi', 'en']).default('vi'),
  tone: z.enum(Object.keys(ARTICLE_TONES) as [ArticleTone, ...ArticleTone[]]).default('chuyen-nghiep'),
  words: z.coerce.number().int().min(300).max(4000).default(1200),
  audience: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(2000).optional(),
  includeFaq: z.boolean().default(true),
});
export type ArticleRequest = z.infer<typeof articleRequestSchema>;

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const articleSchema = z.object({
  title: z.string().trim().min(1, 'Thiếu tiêu đề').max(200),
  slug: z.string().trim().max(190).regex(SLUG_RE, 'Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang').or(z.literal('')),
  metaDescription: z.string().trim().max(320).default(''),
  focusKeyword: z.string().trim().max(100).default(''),
  excerpt: z.string().trim().max(1000).default(''),
  contentHtml: z.string().trim().min(1, 'Thiếu nội dung').max(300_000),
  tags: z.array(z.string().trim().min(1).max(60).regex(/^[^,<>]+$/)).max(20).default([]),
});
export type Article = z.infer<typeof articleSchema>;

export const publishArticleSchema = articleSchema.extend({
  categoryIds: z.array(z.number().int().positive()).max(20).default([]),
  status: z.enum(['draft', 'publish']).default('draft'),
});
export type PublishArticleInput = z.infer<typeof publishArticleSchema>;

export interface WpCategory {
  id: number;
  name: string;
  count: number;
}

export interface PublishedPost {
  id: number;
  url: string;
  editUrl: string;
  status: string;
}

/** wp-admin page to land on after a one-click login, relative to /wp-admin/ (e.g. "post.php?post=5&action=edit"). */
export const wpAdminTargetSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^[\w.\-]*(\?[\w.\-=&%]*)?$/, 'Trang quản trị không hợp lệ')
  .default('');

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

export const createDatabaseSchema = z.object({
  name: z.string().regex(DB_IDENT_RE, 'Tên database chỉ gồm chữ, số, gạch dưới'),
  username: z.string().regex(/^[A-Za-z0-9_]{1,32}$/, 'Username tối đa 32 ký tự chữ/số/_'),
  password: z.string().min(8).max(128).optional(),
  siteId: z.number().int().positive().optional(),
});
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;

export interface DatabaseRecord {
  id: number;
  name: string;
  username: string;
  siteId: number | null;
  siteDomain: string | null;
  managed: boolean; // false = reused database that Lares should not drop
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Migration: source connection
// ---------------------------------------------------------------------------

export const PANEL_TYPES = [
  'auto',
  'aapanel',
  'cyberpanel',
  'hestiacp',
  'cpanel',
  'directadmin',
  'cloudpanel',
  'plesk',
  'webinoly',
  'generic',
  'manual',
] as const;
export type PanelType = (typeof PANEL_TYPES)[number];

export const PANEL_LABELS: Record<PanelType, string> = {
  auto: 'Tự động nhận diện',
  aapanel: 'aaPanel / BT Panel',
  cyberpanel: 'CyberPanel (OpenLiteSpeed)',
  hestiacp: 'HestiaCP / VestaCP',
  cpanel: 'cPanel / WHM',
  directadmin: 'DirectAdmin',
  cloudpanel: 'CloudPanel',
  plesk: 'Plesk',
  webinoly: 'Webinoly',
  generic: 'VPS thuần (Nginx/Apache, không panel)',
  manual: 'Nhập thủ công',
};

export const sourceConnectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local') }),
  z.object({
    mode: z.literal('ssh'),
    host: z.string().trim().min(1, 'Nhập IP/hostname VPS nguồn'),
    port: z.coerce.number().int().min(1).max(65535).default(22),
    username: z.string().trim().min(1).default('root'),
    authType: z.enum(['password', 'key']),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
    /** Run commands via `sudo -n` when the SSH user is not root. */
    useSudo: z.boolean().default(false),
    /** SHA256 host key fingerprint pinned after the first successful connection test (TOFU). */
    hostFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]+$/).optional(),
  }),
]);
export type SourceConnection = z.infer<typeof sourceConnectionSchema>;

export const sourceInputSchema = z.object({
  connection: sourceConnectionSchema,
  panel: z.enum(PANEL_TYPES).default('auto'),
});
export type SourceInput = z.infer<typeof sourceInputSchema>;

export interface ToolAvailability {
  mysqldump: boolean;
  mysql: boolean;
  tar: boolean;
  gzip: boolean;
  pigz: boolean;
  rsync: boolean;
  sha256sum: boolean;
  wpcli: boolean;
}

export interface ConnectionReport {
  ok: boolean;
  sameHost: boolean;
  sameHostReason?: string;
  hostname: string;
  os: string;
  user: string;
  detectedPanel: PanelType;
  hostFingerprint: string | null;
  tools: ToolAvailability;
  tmpFreeBytes: number | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Migration: discovery
// ---------------------------------------------------------------------------

export const dbCredentialsSchema = z.object({
  host: z.string().trim().min(1).default('localhost'),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  socket: absPathSchema.optional(),
  // Source databases may use characters Lares itself never generates (e.g. '-'), but never backticks/control chars.
  name: z.string().regex(/^[^\0\r\n`/\\]{1,64}$/, 'Tên database không hợp lệ'),
  user: z.string().min(1).max(80),
  password: z.string().max(256).default(''),
  prefix: z.string().regex(/^[A-Za-z0-9_]*$/).optional(),
});
export type DbCredentials = z.infer<typeof dbCredentialsSchema>;

export interface DiscoveredSite {
  domain: string;
  aliases: string[];
  /** Directory that will be copied (application root). */
  rootPath: string;
  /** Web root relative to rootPath ('' or e.g. 'public' for Laravel). */
  webRootSubdir: string;
  /**
   * App config file (wp-config.php, .env) when it lives OUTSIDE rootPath
   * (Webinoly keeps wp-config.php one level above htdocs). It is copied into the target root.
   */
  configPath: string | null;
  /** nginx proxies this vhost to a local port (Next.js/Node) - app directory must be confirmed manually. */
  proxyPass: string | null;
  phpVersion: string | null;
  appType: AppType;
  db: DbCredentials | null;
  sizeBytes: number | null;
  owner: string | null;
  /** Other discovered sites nested inside this root (relative paths) - suggested excludes. */
  nestedPaths: string[];
  /** Domain already exists on Lares. */
  existsOnTarget: boolean;
  discoveredBy: string;
}

export interface DiscoveryResult {
  panel: PanelType;
  sites: DiscoveredSite[];
  warnings: string[];
}

export const inspectPathSchema = z.object({
  source: sourceInputSchema,
  path: absPathSchema,
});

// ---------------------------------------------------------------------------
// Migration: jobs
// ---------------------------------------------------------------------------

export const DB_STRATEGIES = ['import', 'reuse', 'skip'] as const;
export type DbStrategy = (typeof DB_STRATEGIES)[number];

export const migrationItemInputSchema = z.object({
  sourceDomain: domainSchema,
  targetDomain: domainSchema,
  aliases: z.array(domainSchema).default([]),
  sourceRoot: absPathSchema,
  webRootSubdir: z
    .string()
    .regex(/^[\w.\-/]*$/)
    .refine((p) => !p.split('/').includes('..'))
    .default(''),
  appType: z.enum(APP_TYPES).default('unknown'),
  configPath: absPathSchema.optional(),
  phpVersion: z.string().regex(PHP_VERSION_RE).optional(),
  /** Next.js: build/start settings used when re-installing on Lares. */
  nextjs: nextjsConfigSchema.omit({ gitUrl: true, branch: true }).optional(),
  db: z.object({
    strategy: z.enum(DB_STRATEGIES).default('import'),
    source: dbCredentialsSchema.optional(),
  }),
  excludes: z.array(excludePatternSchema).default([]),
  /** WordPress: search-replace old domain -> new domain when they differ. */
  searchReplace: z.boolean().default(true),
  /** Overwrite existing target directory / site. */
  overwrite: z.boolean().default(false),
});
export type MigrationItemInput = z.infer<typeof migrationItemInputSchema>;

export const TRANSFER_MODES = ['auto', 'archive', 'stream'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const migrationOptionsSchema = z.object({
  /**
   * archive: compress on source into temp dir, verify sha256, download via SFTP.
   * stream:  pipe `tar | gzip` over SSH straight into Lares (no temp space needed on source).
   * auto:    archive when source has enough free space, otherwise stream.
   */
  transferMode: z.enum(TRANSFER_MODES).default('auto'),
  cleanupSource: z.boolean().default(true),
  keepLocalArchives: z.boolean().default(false),
  rollbackOnFailure: z.boolean().default(true),
});
export type MigrationOptions = z.infer<typeof migrationOptionsSchema>;

export const createMigrationSchema = z.object({
  name: z.string().trim().max(100).optional(),
  source: sourceInputSchema,
  items: z.array(migrationItemInputSchema).min(1, 'Chọn ít nhất 1 site'),
  options: migrationOptionsSchema.default({}),
});
export type CreateMigrationInput = z.infer<typeof createMigrationSchema>;

export const MIGRATION_STEPS = [
  { id: 'prepare', label: 'Chuẩn bị & kiểm tra' },
  { id: 'dump_db', label: 'Dump & nén database' },
  { id: 'archive_files', label: 'Nén mã nguồn' },
  { id: 'transfer', label: 'Đồng bộ về Lares' },
  { id: 'verify', label: 'Kiểm tra toàn vẹn' },
  { id: 'create_site', label: 'Tạo site trên Lares' },
  { id: 'restore_files', label: 'Khôi phục mã nguồn' },
  { id: 'restore_db', label: 'Khôi phục database' },
  { id: 'configure', label: 'Cập nhật cấu hình ứng dụng' },
  { id: 'finalize', label: 'Nginx, phân quyền' },
  { id: 'cleanup', label: 'Dọn dẹp file tạm' },
] as const;
export type MigrationStepId = (typeof MIGRATION_STEPS)[number]['id'];

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export type MigrationStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type ItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface StepState {
  status: StepStatus;
  detail?: string;
  progress?: number; // 0..1
  startedAt?: string;
  finishedAt?: string;
}

export interface MigrationItem {
  id: number;
  migrationId: number;
  sourceDomain: string;
  targetDomain: string;
  sourceRoot: string;
  appType: AppType;
  status: ItemStatus;
  currentStep: MigrationStepId | null;
  steps: Record<MigrationStepId, StepState>;
  error: string | null;
  siteId: number | null;
  notes: string[];
}

export interface Migration {
  id: number;
  name: string;
  sourceLabel: string;
  panel: PanelType;
  sameHost: boolean;
  status: MigrationStatus;
  options: MigrationOptions;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  items?: MigrationItem[];
  itemCounts?: Partial<Record<ItemStatus, number>>;
}

export interface MigrationLog {
  id: number;
  migrationId: number;
  itemId: number | null;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  createdAt: string;
}

export type MigrationEvent =
  | { type: 'snapshot'; migration: Migration; logs: MigrationLog[] }
  | { type: 'migration'; migration: Migration }
  | { type: 'item'; item: MigrationItem }
  | { type: 'log'; log: MigrationLog };

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export interface SystemStats {
  hostname: string;
  os: string;
  uptimeSec: number;
  loadavg: number[];
  cpuCount: number;
  memTotal: number;
  memFree: number;
  disk: { total: number; used: number; free: number } | null;
  services: Record<string, 'active' | 'inactive' | 'unknown'>;
  phpVersions: string[];
  dryRun: boolean;
}
