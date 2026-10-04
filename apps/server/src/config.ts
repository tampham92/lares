import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const envFile = path.resolve(process.cwd(), '.env');
const rootEnvFile = path.resolve(process.cwd(), '../../.env');
for (const f of [envFile, rootEnvFile]) {
  if (fs.existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

// Installs from before the rename to Lares use TPANEL_* names. install.sh renames them; a local .env may not.
const env = (key: string, fallback = ''): string => {
  const v = process.env[key] ?? process.env[key.replace(/^LARES_/, 'TPANEL_')];
  return v === undefined || v === '' ? fallback : v;
};

const isProd = process.env.NODE_ENV === 'production';
const dataDir = path.resolve(env('LARES_DATA_DIR', isProd ? '/var/lib/lares' : path.resolve(process.cwd(), 'data')));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

function loadSecret(): string {
  const fromEnv = env('LARES_SECRET');
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// Outside Linux (developer laptops) system commands are never executed for real, whatever .env says:
// Lares would otherwise chown/systemctl/mysql against the developer's own machine.
const dryRun = process.platform !== 'linux' || env('LARES_DRY_RUN', '0') === '1';

export const config = {
  isProd,
  port: Number(env('LARES_PORT', '8686')),
  host: env('LARES_HOST', '0.0.0.0'),
  dataDir,
  secret: loadSecret(),
  jwtExpiresIn: env('LARES_JWT_EXPIRES', '12h'),
  /** Serve the panel itself over HTTPS (install.sh generates a self-signed pair). */
  tlsCert: env('LARES_TLS_CERT'),
  tlsKey: env('LARES_TLS_KEY'),
  adminUser: env('LARES_ADMIN_USER', 'admin'),
  adminPassword: env('LARES_ADMIN_PASSWORD'),
  dryRun,
  // In dry-run (dev) mode keep site files inside the data dir so nothing touches the real system.
  sitesRoot: env('LARES_SITES_ROOT', dryRun ? path.join(dataDir, 'www') : '/var/www'),
  /** Absolute path set by install.sh so a panel-built nginx earlier in PATH is never picked up. */
  nginxBin: env('LARES_NGINX_BIN', 'nginx'),
  nginxAvailable: env('LARES_NGINX_AVAILABLE', dryRun ? path.join(dataDir, 'nginx/sites-available') : '/etc/nginx/sites-available'),
  nginxEnabled: env('LARES_NGINX_ENABLED', dryRun ? path.join(dataDir, 'nginx/sites-enabled') : '/etc/nginx/sites-enabled'),
  phpFpmSocket: env('LARES_PHP_FPM_SOCKET', '/run/php/php{version}-fpm.sock'),
  defaultPhp: env('LARES_DEFAULT_PHP', '8.2'),
  webUser: env('LARES_WEB_USER', 'www-data'),
  /** Per-site logs live outside /var/log/nginx so they don't collide with the distro's nginx logrotate rule. */
  siteLogDir: env('LARES_SITE_LOG_DIR', dryRun ? path.join(dataDir, 'logs') : '/var/log/lares/sites'),
  /** Shared webroot for ACME http-01 challenges; every vhost (incl. Next.js proxies) serves it. */
  acmeDir: env('LARES_ACME_DIR', path.join(dataDir, 'acme')),
  /** Custom (uploaded) certificates. */
  sslDir: env('LARES_SSL_DIR', dryRun ? path.join(dataDir, 'ssl') : '/etc/lares/ssl'),
  /** Start scripts for Node apps - must be readable by the web user, so not inside dataDir. */
  appsConfDir: env('LARES_APPS_CONF_DIR', dryRun ? path.join(dataDir, 'apps') : '/etc/lares/apps'),
  systemdDir: env('LARES_SYSTEMD_DIR', dryRun ? path.join(dataDir, 'systemd') : '/etc/systemd/system'),
  logrotateFile: env('LARES_LOGROTATE_FILE', dryRun ? path.join(dataDir, 'logrotate-lares') : '/etc/logrotate.d/lares'),
  nginxGlobalConf: env('LARES_NGINX_GLOBAL_CONF', dryRun ? path.join(dataDir, 'nginx/lares-global.conf') : '/etc/nginx/conf.d/00-lares.conf'),
  nodeAppPortStart: Number(env('LARES_NODE_PORT_START', '3100')),
  /** Port-based sites (domain "localhost") get public ports from here upward. */
  sitePortStart: Number(env('LARES_SITE_PORT_START', '8001')),
  /** Built-in templates shipped with Lares (replaced on every upgrade). */
  templatesDir: path.resolve(env('LARES_TEMPLATES_DIR', path.resolve(process.cwd(), '../../templates'))),
  /** Your own templates - survive upgrades; a template here overrides a built-in one with the same id. */
  customTemplatesDir: path.resolve(env('LARES_CUSTOM_TEMPLATES_DIR', path.join(dataDir, 'templates'))),
  stagingDir: path.join(dataDir, 'migrations'),
  webDist: path.resolve(env('LARES_WEB_DIST', path.resolve(process.cwd(), '../web/dist'))),
  mysql: {
    host: env('LARES_MYSQL_HOST', 'localhost'),
    port: Number(env('LARES_MYSQL_PORT', '3306')),
    socketPath: env('LARES_MYSQL_SOCKET', ''),
    user: env('LARES_MYSQL_USER', 'root'),
    password: env('LARES_MYSQL_PASSWORD'),
  },
};

fs.mkdirSync(config.stagingDir, { recursive: true, mode: 0o700 });
// The ACME dir is read by nginx workers, so it must be traversable even though dataDir is private.
fs.mkdirSync(config.acmeDir, { recursive: true, mode: 0o755 });
if (config.acmeDir.startsWith(dataDir)) fs.chmodSync(dataDir, 0o711);
