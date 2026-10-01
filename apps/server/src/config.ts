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

const env = (key: string, fallback = ''): string => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

const isProd = process.env.NODE_ENV === 'production';
const dataDir = path.resolve(env('TPANEL_DATA_DIR', isProd ? '/var/lib/tpanel' : path.resolve(process.cwd(), 'data')));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

function loadSecret(): string {
  const fromEnv = env('TPANEL_SECRET');
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// Outside Linux (developer laptops) system commands are never executed for real, whatever .env says:
// TPanel would otherwise chown/systemctl/mysql against the developer's own machine.
const dryRun = process.platform !== 'linux' || env('TPANEL_DRY_RUN', '0') === '1';

export const config = {
  isProd,
  port: Number(env('TPANEL_PORT', '8686')),
  host: env('TPANEL_HOST', '0.0.0.0'),
  dataDir,
  secret: loadSecret(),
  jwtExpiresIn: env('TPANEL_JWT_EXPIRES', '12h'),
  /** Serve the panel itself over HTTPS (install.sh generates a self-signed pair). */
  tlsCert: env('TPANEL_TLS_CERT'),
  tlsKey: env('TPANEL_TLS_KEY'),
  adminUser: env('TPANEL_ADMIN_USER', 'admin'),
  adminPassword: env('TPANEL_ADMIN_PASSWORD'),
  dryRun,
  // In dry-run (dev) mode keep site files inside the data dir so nothing touches the real system.
  sitesRoot: env('TPANEL_SITES_ROOT', dryRun ? path.join(dataDir, 'www') : '/var/www'),
  /** Absolute path set by install.sh so a panel-built nginx earlier in PATH is never picked up. */
  nginxBin: env('TPANEL_NGINX_BIN', 'nginx'),
  nginxAvailable: env('TPANEL_NGINX_AVAILABLE', dryRun ? path.join(dataDir, 'nginx/sites-available') : '/etc/nginx/sites-available'),
  nginxEnabled: env('TPANEL_NGINX_ENABLED', dryRun ? path.join(dataDir, 'nginx/sites-enabled') : '/etc/nginx/sites-enabled'),
  phpFpmSocket: env('TPANEL_PHP_FPM_SOCKET', '/run/php/php{version}-fpm.sock'),
  defaultPhp: env('TPANEL_DEFAULT_PHP', '8.2'),
  webUser: env('TPANEL_WEB_USER', 'www-data'),
  /** Per-site logs live outside /var/log/nginx so they don't collide with the distro's nginx logrotate rule. */
  siteLogDir: env('TPANEL_SITE_LOG_DIR', dryRun ? path.join(dataDir, 'logs') : '/var/log/tpanel/sites'),
  /** Shared webroot for ACME http-01 challenges; every vhost (incl. Next.js proxies) serves it. */
  acmeDir: env('TPANEL_ACME_DIR', path.join(dataDir, 'acme')),
  /** Custom (uploaded) certificates. */
  sslDir: env('TPANEL_SSL_DIR', dryRun ? path.join(dataDir, 'ssl') : '/etc/tpanel/ssl'),
  /** Start scripts for Node apps - must be readable by the web user, so not inside dataDir. */
  appsConfDir: env('TPANEL_APPS_CONF_DIR', dryRun ? path.join(dataDir, 'apps') : '/etc/tpanel/apps'),
  systemdDir: env('TPANEL_SYSTEMD_DIR', dryRun ? path.join(dataDir, 'systemd') : '/etc/systemd/system'),
  logrotateFile: env('TPANEL_LOGROTATE_FILE', dryRun ? path.join(dataDir, 'logrotate-tpanel') : '/etc/logrotate.d/tpanel'),
  nginxGlobalConf: env('TPANEL_NGINX_GLOBAL_CONF', dryRun ? path.join(dataDir, 'nginx/tpanel-global.conf') : '/etc/nginx/conf.d/00-tpanel.conf'),
  nodeAppPortStart: Number(env('TPANEL_NODE_PORT_START', '3100')),
  /** Port-based sites (domain "localhost") get public ports from here upward. */
  sitePortStart: Number(env('TPANEL_SITE_PORT_START', '8001')),
  templatesDir: path.resolve(env('TPANEL_TEMPLATES_DIR', path.resolve(process.cwd(), '../../templates'))),
  stagingDir: path.join(dataDir, 'migrations'),
  webDist: path.resolve(env('TPANEL_WEB_DIST', path.resolve(process.cwd(), '../web/dist'))),
  mysql: {
    host: env('TPANEL_MYSQL_HOST', 'localhost'),
    port: Number(env('TPANEL_MYSQL_PORT', '3306')),
    socketPath: env('TPANEL_MYSQL_SOCKET', ''),
    user: env('TPANEL_MYSQL_USER', 'root'),
    password: env('TPANEL_MYSQL_PASSWORD'),
  },
};

fs.mkdirSync(config.stagingDir, { recursive: true, mode: 0o700 });
// The ACME dir is read by nginx workers, so it must be traversable even though dataDir is private.
fs.mkdirSync(config.acmeDir, { recursive: true, mode: 0o755 });
if (config.acmeDir.startsWith(dataDir)) fs.chmodSync(dataDir, 0o711);
