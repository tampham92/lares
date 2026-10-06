import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminerStatus } from '@lares/shared';
import type { SessionClaims } from '../auth/index.js';
import { getUser } from '../auth/twofactor.js';
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db/index.js';
import { t, tDefault } from '../i18n/index.js';
import { conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { getDatabaseCredentials } from './databases.js';
import { host, type HostLogger } from './host.js';
import { testAndReload } from './nginx.js';
import { installedPhpVersions } from './php.js';

/*
 * Adminer (database GUI) behind the panel.
 *
 *   browser ──https──▶ Lares :8686 /adminer/…  ──http──▶ nginx 127.0.0.1:18686 ──fastcgi──▶ PHP-FPM pool "lares-adminer"
 *            (IP allowlist, scoped cookie)        (secret header required)            (own system user, open_basedir)
 *
 * - Reachable only through the panel: nginx listens on 127.0.0.1 and answers 403 unless the request
 *   carries a random secret that only the panel knows (the conf file is root-only, 0600), so neither
 *   the internet nor site code on the same machine (SSRF, PHP running as www-data) can reach it.
 *   No public site vhost ever serves Adminer.
 * - The panel's root onRequest hook applies the IP allowlist to /adminer/ like to every route; the
 *   proxy then requires the `lares_adminer` cookie (HttpOnly, SameSite=Strict, Path=/adminer/),
 *   which maps to an in-memory session bound to the panel login that created it: it dies with that
 *   login (logout, "log out everywhere", password change, JWT expiry), after 30 min idle, 8 h at most,
 *   and on panel restart.
 * - "Mở Adminer": the SPA (with its JWT) asks for a launch link: a random token, valid 60 s, single
 *   use, bound to the caller's IP. Opening it sets the cookie, writes a one-time credential ticket
 *   and redirects to /adminer/?username=<db user>&db=<db>. The database password never appears in a
 *   URL, in browser storage or in the panel's responses.
 * - The ticket is a JSON file in a directory readable only by the pool's user, named by 32 random
 *   bytes. The panel passes only that name, in a header on the next proxied request for that
 *   username; the Adminer customisation in index.php reads the file, deletes it at once (valid or
 *   not), checks the 60 s expiry and feeds Adminer's own login (session id regenerated, password kept
 *   encrypted in the PHP session with a per-browser key). Its login form is disabled: logins only
 *   come from tickets.
 * - Adminer's PHP runs in its own PHP-FPM pool as the system user `lares-adminer`, using a PHP version
 *   already installed (with mysqli). open_basedir keeps it inside its directory; sessions and tickets
 *   are unreadable for the sites' www-data.
 * - The Adminer file is a pinned release downloaded once and verified by SHA-256 (fail closed: a
 *   different checksum is never written or served). It is re-verified each time Adminer is opened.
 * - Opened in a new tab, never in an iframe (Adminer sends X-Frame-Options: deny, the proxy adds
 *   `frame-ancestors 'none'` via Adminer's CSP hook and Referrer-Policy: no-referrer comes from the panel).
 */

export const ADMINER_VERSION = '6.1.1';
export const ADMINER_FILE = `adminer-${ADMINER_VERSION}-mysql.php`;
/** SHA-256 of the official release asset (GitHub digest of adminer-6.1.1-mysql.php). */
export const ADMINER_SHA256 = '2d092e713717c8106ae276ca5780b77970d3378817a792c6bc584651d4039cc6';
export const adminerDownloadUrl = () => process.env.LARES_ADMINER_URL || `https://github.com/vrana/adminer/releases/download/v${ADMINER_VERSION}/${ADMINER_FILE}`;

const POOL_USER = 'lares-adminer';
const COOKIE = 'lares_adminer';
export const ADMINER_PATH = '/adminer/';
const LAUNCH_TTL_MS = 60_000;
const TICKET_TTL_S = 60;
const IDLE_MS = 30 * 60_000;
const MAX_AGE_MS = 8 * 3_600_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export const adminerPort = () => Number(process.env.LARES_ADMINER_PORT || 18686);

export function adminerPaths() {
  const dir = path.resolve(process.env.LARES_ADMINER_DIR || (config.dryRun ? path.join(config.dataDir, 'adminer') : '/var/lib/lares-adminer'));
  const www = path.join(dir, 'www');
  return {
    dir,
    www,
    tickets: path.join(dir, 'tickets'),
    sessions: path.join(dir, 'sessions'),
    tmp: path.join(dir, 'tmp'),
    adminer: path.join(www, ADMINER_FILE),
    index: path.join(www, 'index.php'),
    nginxConf: path.join(path.dirname(config.nginxGlobalConf), 'lares-adminer.conf'),
    socket: process.env.LARES_ADMINER_SOCKET || '/run/php/lares-adminer.sock',
    pool: (v: string) => (config.dryRun ? path.join(dir, `php${v}-fpm-pool.conf`) : `/etc/php/${v}/fpm/pool.d/lares-adminer.conf`),
  };
}

interface AdminerState {
  /** Shared between the panel and the nginx server block (header X-Lares-Adminer-Key). */
  secret: string;
  phpVersion: string | null;
  installedAt: string | null;
}

const SETTING = 'adminer';

function getState(): AdminerState {
  const s = getSetting<Partial<AdminerState>>(SETTING, {});
  if (typeof s.secret === 'string' && /^[a-f0-9]{64}$/.test(s.secret)) return { phpVersion: null, installedAt: null, ...s, secret: s.secret };
  const fresh: AdminerState = { secret: crypto.randomBytes(32).toString('hex'), phpVersion: null, installedAt: null };
  setSetting(SETTING, fresh);
  return fresh;
}

/** The value nginx expects in X-Lares-Adminer-Key (only the proxy uses it). */
export const adminerSecret = () => getState().secret;

const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

// ---- Download + checksum --------------------------------------------------------

type FetchLike = (url: string, init: { redirect: 'follow'; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Download the pinned release and return it only if its SHA-256 is the pinned one. */
export async function downloadAdminer(fetchImpl: FetchLike = fetch, url = adminerDownloadUrl()): Promise<Buffer> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new Error(t('Không tải được Adminer từ {url}: {error}', { url, error: errorMessage(err) }));
  }
  if (!res.ok) throw new Error(t('Không tải được Adminer từ {url}: HTTP {status}', { url, status: res.status }));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error(t('File Adminer tải về lớn bất thường ({bytes} byte) - đã huỷ', { bytes: buf.length }));
  const sum = sha256(buf);
  if (sum !== ADMINER_SHA256) {
    throw new Error(t('SHA-256 của Adminer tải về ({got}) khác giá trị đã ghim ({want}) - đã huỷ, không cài file này.', { got: sum, want: ADMINER_SHA256 }));
  }
  return buf;
}

let verifiedCache: { key: string; ok: boolean } | null = null;

/** Is the installed file exactly the pinned release? (re-hashed whenever its size/mtime/inode change) */
export async function adminerFileVerified(file = adminerPaths().adminer): Promise<boolean> {
  const st = await fs.stat(file).catch(() => null);
  if (!st) return false;
  const key = `${file}:${st.ino}:${st.size}:${st.mtimeMs}`;
  if (verifiedCache?.key === key) return verifiedCache.ok;
  const buf = await fs.readFile(file).catch(() => null);
  const ok = !!buf && sha256(buf) === ADMINER_SHA256;
  verifiedCache = { key, ok };
  return ok;
}

// ---- Generated config -------------------------------------------------------------

const phpStr = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** MySQL server for Adminer's connections (DB users are 'user'@'localhost' → unix socket). */
export const adminerDbServer = () => (config.mysql.socketPath ? `localhost:${config.mysql.socketPath}` : 'localhost');

/**
 * Front controller: health check, ticket login and the Adminer customisation, then the pinned
 * Adminer file. No secret is written here (the file is world-readable).
 */
export function renderIndexPhp(opts: { ticketsDir: string; dbServer: string; adminerFile: string; loginMessage: string }): string {
  return `<?php
// Managed by Lares Panel - rewritten each time Adminer is opened. Do not edit.
// Reachable only through the panel (see apps/server/src/services/adminer.ts in Lares):
// logins come from one-time tickets the panel writes to LARES_TICKETS; the login form is disabled.
const LARES_TICKETS = ${phpStr(opts.ticketsDir)};
const LARES_DB_SERVER = ${phpStr(opts.dbServer)};
const LARES_LOGIN_MESSAGE = ${phpStr(opts.loginMessage)};

// Paths are not rewritten by the proxy (same /adminer/ on both sides): ignore any client-sent prefix.
unset($_SERVER['HTTP_X_FORWARDED_PREFIX']);
// TLS ends at the panel; tell Adminer so its cookies get the Secure flag.
if (isset($_SERVER['HTTP_X_LARES_PROTO']) && $_SERVER['HTTP_X_LARES_PROTO'] === 'https') {
	$_SERVER['HTTPS'] = 'on';
}

if (isset($_GET['lares_health'])) {
	header('Content-Type: text/plain; charset=utf-8');
	header('Cache-Control: no-store');
	echo 'lares-adminer-ok ' . PHP_VERSION . (extension_loaded('mysqli') ? ' mysqli' : ' no-mysqli');
	exit;
}

/** The one-time ticket named in X-Lares-Adminer-Ticket: read, delete (valid or not), check. */
function lares_adminer_ticket() {
	$id = isset($_SERVER['HTTP_X_LARES_ADMINER_TICKET']) ? (string) $_SERVER['HTTP_X_LARES_ADMINER_TICKET'] : '';
	if (!preg_match('/^[a-f0-9]{64}$/', $id)) {
		return null;
	}
	$file = LARES_TICKETS . '/' . $id . '.json';
	$raw = @file_get_contents($file);
	@unlink($file);
	$data = is_string($raw) ? json_decode($raw, true) : null;
	if (!is_array($data) || !isset($data['user'], $data['password'], $data['db'], $data['exp'])) {
		return null;
	}
	if (!is_string($data['user']) || !is_string($data['password']) || !is_string($data['db']) || (int) $data['exp'] < time()) {
		return null;
	}
	// the panel sends the ticket with the request for this username only
	if (!isset($_GET['username']) || $_GET['username'] !== $data['user']) {
		return null;
	}
	return $data;
}

function adminer_object() {
	class LaresAdminer extends \\Adminer\\Adminer {
		public $laresTicketLogin = false;

		function credentials() {
			return array(LARES_DB_SERVER, $_GET['username'], \\Adminer\\get_password());
		}

		// only usernames that arrived with a ticket in this browser session
		function login($login, $password) {
			if (empty($_SESSION['lares_allowed'][$login]) || $password === '') {
				return \\Adminer\\h(LARES_LOGIN_MESSAGE);
			}
			return true;
		}

		// the ticket login is not a form post from a page, so there is no CSRF token to check
		function verifyLoginToken() {
			return !$this->laresTicketLogin;
		}

		function loginForm() {
			echo '<p>' . \\Adminer\\h(LARES_LOGIN_MESSAGE) . "</p>\\n";
		}

		function permanentLogin($create = false) {
			return '';
		}

		function verifyVersion() {
			return false;
		}

		function serviceWorker() {
		}

		function manifest() {
			return array();
		}

		function csp(array $csp) {
			foreach ($csp as $i => $directives) {
				unset($csp[$i]['frame-src']);
				if (isset($directives['connect-src'])) {
					$csp[$i]['connect-src'] = "'self'";
				}
			}
			$csp[0]['frame-ancestors'] = "'none'";
			return $csp;
		}
	}

	$adminer = new LaresAdminer;
	$ticket = lares_adminer_ticket();
	if ($ticket) {
		// Handled exactly like Adminer's own login form: session id regenerated, password stored
		// encrypted with the per-browser adminer_key cookie, redirect to the database.
		if (empty($_COOKIE['adminer_key'])) {
			$_COOKIE['adminer_key'] = \\Adminer\\rand_string();
			\\Adminer\\cookie('adminer_key', $_COOKIE['adminer_key'], 0);
		}
		$_SESSION['lares_allowed'][$ticket['user']] = true;
		$_POST = array('auth' => array('driver' => 'server', 'server' => '', 'username' => $ticket['user'], 'password' => $ticket['password'], 'db' => $ticket['db']));
		$adminer->laresTicketLogin = true;
	}
	return $adminer;
}

include __DIR__ . '/' . ${phpStr(opts.adminerFile)};
`;
}

/** Dedicated, idle-when-unused PHP-FPM pool. */
export function renderPool(opts: { user: string; socket: string; listenOwner: string; dir: string }): string {
  const d = opts.dir.replace(/\/+$/, '');
  return `; Managed by Lares Panel - PHP-FPM pool for Adminer (database GUI). Rewritten by the panel.
[lares-adminer]
user = ${opts.user}
group = ${opts.user}
listen = ${opts.socket}
listen.owner = ${opts.listenOwner}
listen.group = ${opts.listenOwner}
listen.mode = 0660
pm = ondemand
pm.max_children = 4
pm.process_idle_timeout = 60s
pm.max_requests = 200
request_terminate_timeout = 600s
security.limit_extensions = .php
php_admin_value[open_basedir] = ${d}/
php_admin_value[user_ini.filename] =
php_admin_value[session.save_path] = ${d}/sessions
php_admin_value[session.gc_probability] = 1
php_admin_value[session.gc_divisor] = 100
php_admin_value[session.gc_maxlifetime] = 28800
php_admin_value[upload_tmp_dir] = ${d}/tmp
php_admin_value[sys_temp_dir] = ${d}/tmp
php_admin_value[memory_limit] = 256M
php_admin_value[upload_max_filesize] = 256M
php_admin_value[post_max_size] = 256M
php_admin_value[max_input_vars] = 10000
php_admin_value[max_execution_time] = 600
php_admin_value[disable_functions] = exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec
php_admin_flag[allow_url_fopen] = off
php_admin_flag[expose_php] = off
php_admin_flag[display_errors] = off
`;
}

/** Loopback-only server block; nothing is answered without the panel's secret header. */
export function renderAdminerNginx(opts: { port: number; secret: string; index: string; socket: string }): string {
  if (!/^[a-f0-9]{64}$/.test(opts.secret)) throw new Error('invalid Adminer secret');
  return `# Managed by Lares Panel - Adminer (database GUI). Rewritten by the panel, do not edit.
# Loopback only, and nothing is served without the secret header that only the panel sends:
# browsers reach Adminer exclusively through https://<panel>/adminer/ (panel login, IP allowlist,
# one-time launch link). This file is root-only (0600) because it holds that secret.
server {
    listen 127.0.0.1:${opts.port};
    server_name _;
    access_log off;
    client_max_body_size 256m;

    if ($http_x_lares_adminer_key != "${opts.secret}") {
        return 403;
    }

    location = ${ADMINER_PATH} {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME ${opts.index};
        fastcgi_param HTTP_X_LARES_ADMINER_KEY "";
        fastcgi_param HTTP_PROXY "";
        fastcgi_pass unix:${opts.socket};
        fastcgi_read_timeout 600s;
    }

    location / {
        return 404;
    }
}
`;
}

// ---- Install / repair ----------------------------------------------------------------

async function hasMysqli(version: string): Promise<boolean> {
  const files = await fs.readdir(`/etc/php/${version}/fpm/conf.d`).catch(() => [] as string[]);
  return files.some((f) => /mysqli\.ini$/.test(f));
}

/** An installed PHP-FPM version with mysqli: the remembered one, else the newest. */
async function pickPhpVersion(preferred: string | null): Promise<string> {
  const installed = await installedPhpVersions();
  if (config.dryRun) return preferred && installed.includes(preferred) ? preferred : (installed[0] ?? config.defaultPhp);
  const usable: string[] = [];
  for (const v of installed) if (await hasMysqli(v)) usable.push(v);
  if (preferred && usable.includes(preferred)) return preferred;
  if (!usable.length) {
    throw conflict(
      installed.length
        ? t('Không có phiên bản PHP-FPM nào có extension mysqli (cần cho Adminer). Cài ví dụ: apt install php{version}-mysql', { version: installed[0]! })
        : t('Chưa cài PHP-FPM - Adminer cần một phiên bản PHP-FPM có sẵn trên máy chủ.'),
    );
  }
  return usable[0]!;
}

let ids: { uid: number; gid: number } | null = null;

async function poolUserIds(): Promise<{ uid: number; gid: number }> {
  if (ids) return ids;
  const [u, g] = await Promise.all([host.exec(`id -u ${POOL_USER}`), host.exec(`id -g ${POOL_USER}`)]);
  const uid = Number(u.stdout.trim());
  const gid = Number(g.stdout.trim());
  if (u.code !== 0 || g.code !== 0 || !Number.isInteger(uid) || !Number.isInteger(gid)) throw new Error(t('Không tìm thấy user hệ thống {user}', { user: POOL_USER }));
  ids = { uid, gid };
  return ids;
}

/** Write a root-only nginx conf (it holds the secret), test, reload; put the old file back if nginx refuses. */
async function writeSecretNginxConf(file: string, content: string | null, log?: HostLogger) {
  const previous = await fs.readFile(file, 'utf8').catch(() => null);
  if (previous === content) return;
  if (content === null) await fs.rm(file, { force: true });
  else await host.writeFile(file, content, 0o600);
  try {
    await testAndReload(log);
  } catch (err) {
    if (previous === null) await fs.rm(file, { force: true });
    else await host.writeFile(file, previous, 0o600);
    throw err;
  }
}

async function writeIfChanged(file: string, content: string, mode: number): Promise<boolean> {
  if ((await fs.readFile(file, 'utf8').catch(() => null)) === content) return false;
  await host.writeFile(file, content, mode);
  return true;
}

function upstreamRequest(pathAndQuery: string, secret: string, timeoutMs = 5000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: adminerPort(), path: pathAndQuery, method: 'GET', headers: { 'x-lares-adminer-key': secret }, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body.length < 4096 ? (body += c) : undefined));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function healthCheck(secret: string): Promise<void> {
  let last = '';
  for (let i = 0; i < 12; i++) {
    try {
      const r = await upstreamRequest(`${ADMINER_PATH}?lares_health=1`, secret);
      if (r.status === 200 && r.body.startsWith('lares-adminer-ok')) {
        if (!r.body.includes(' mysqli')) throw conflict(t('PHP của Adminer thiếu extension mysqli'));
        return;
      }
      last = `HTTP ${r.status}`;
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err) throw err;
      last = errorMessage(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(t('Adminer chưa phản hồi qua nginx 127.0.0.1:{port} ({status}). Kiểm tra nginx của Lares đang chạy và PHP-FPM đã nạp pool lares-adminer.', { port: adminerPort(), status: last }));
}

let installing: Promise<AdminerStatus> | null = null;

/**
 * Make sure Adminer is downloaded (verified), configured and answering. Idempotent and cheap when
 * everything is in place (one file hash + one loopback request). Concurrent callers share one run.
 */
export function ensureAdminer(log?: HostLogger, fetchImpl?: FetchLike): Promise<AdminerStatus> {
  installing ??= doEnsure(log, fetchImpl).finally(() => {
    installing = null;
  });
  return installing;
}

async function doEnsure(log?: HostLogger, fetchImpl?: FetchLike): Promise<AdminerStatus> {
  const p = adminerPaths();
  const state = getState();
  const phpVersion = await pickPhpVersion(state.phpVersion);

  if (config.dryRun) {
    // Nothing can run here (no PHP-FPM / nginx): write the generated files for inspection only.
    await fs.mkdir(p.www, { recursive: true });
    await writeIfChanged(p.index, renderIndexPhp({ ticketsDir: p.tickets, dbServer: adminerDbServer(), adminerFile: ADMINER_FILE, loginMessage: tDefault('Hãy mở Adminer từ trang Database của Lares Panel.') }), 0o644);
    await writeIfChanged(p.pool(phpVersion), renderPool({ user: POOL_USER, socket: p.socket, listenOwner: config.webUser, dir: p.dir }), 0o644);
    log?.(`[dry-run] ${t('tải {url} và kiểm tra SHA-256 {sha}', { url: adminerDownloadUrl(), sha: ADMINER_SHA256 })}`);
    return adminerStatus();
  }

  // 1. pinned file, verified (fail closed)
  if (!(await adminerFileVerified(p.adminer))) {
    if (await host.exists(p.adminer)) {
      log?.(t('Cảnh báo: file Adminer hiện có không khớp SHA-256 đã ghim - tải lại'));
      await fs.rm(p.adminer, { force: true });
    }
    log?.(t('Đang tải Adminer {version}…', { version: ADMINER_VERSION }));
    const buf = await downloadAdminer(fetchImpl);
    await fs.mkdir(p.www, { recursive: true, mode: 0o755 });
    const tmp = `${p.adminer}.lares-tmp`;
    await fs.writeFile(tmp, buf, { mode: 0o644 });
    await fs.rename(tmp, p.adminer);
    if (!(await adminerFileVerified(p.adminer))) {
      await fs.rm(p.adminer, { force: true });
      throw new Error(t('File Adminer sau khi ghi không khớp SHA-256 - đã xoá'));
    }
  }

  // 2. system user + private directories
  await host.mutate(`id -u ${POOL_USER} >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ${POOL_USER}`, { log });
  ids = null;
  await fs.mkdir(p.www, { recursive: true, mode: 0o755 });
  await fs.chmod(p.dir, 0o755);
  await fs.chmod(p.www, 0o755);
  for (const d of [p.tickets, p.sessions, p.tmp]) await fs.mkdir(d, { recursive: true, mode: 0o700 });
  await host.mutate(`chown root:root ${shq(p.dir)} ${shq(p.www)} && chown ${POOL_USER}:${POOL_USER} ${shq(p.tickets)} ${shq(p.sessions)} ${shq(p.tmp)} && chmod 700 ${shq(p.tickets)} ${shq(p.sessions)} ${shq(p.tmp)}`, { log });
  await writeIfChanged(p.index, renderIndexPhp({ ticketsDir: p.tickets, dbServer: adminerDbServer(), adminerFile: ADMINER_FILE, loginMessage: tDefault('Hãy mở Adminer từ trang Database của Lares Panel.') }), 0o644);

  // 3. PHP-FPM pool (only in the chosen version; a stale copy elsewhere is removed)
  for (const v of await installedPhpVersions()) {
    if (v === phpVersion) continue;
    const stale = p.pool(v);
    if (await host.exists(stale)) {
      await fs.rm(stale, { force: true });
      await host.mutate(`systemctl reload ${shq(`php${v}-fpm`)}`, { log }).catch(() => {});
    }
  }
  const poolFile = p.pool(phpVersion);
  const poolPrevious = await fs.readFile(poolFile, 'utf8').catch(() => null);
  if (await writeIfChanged(poolFile, renderPool({ user: POOL_USER, socket: p.socket, listenOwner: config.webUser, dir: p.dir }), 0o644)) {
    try {
      await host.run(`${shq(`php-fpm${phpVersion}`)} -t`);
    } catch (err) {
      if (poolPrevious === null) await fs.rm(poolFile, { force: true });
      else await host.writeFile(poolFile, poolPrevious, 0o644);
      throw new Error(t('PHP-FPM {version} từ chối pool của Adminer: {error}', { version: phpVersion, error: errorMessage(err) }));
    }
    await host.mutate(`systemctl reload ${shq(`php${phpVersion}-fpm`)}`, { log });
  }

  // 4. nginx server block on 127.0.0.1
  await writeSecretNginxConf(p.nginxConf, renderAdminerNginx({ port: adminerPort(), secret: state.secret, index: p.index, socket: p.socket }), log);

  await healthCheck(state.secret);
  if (state.phpVersion !== phpVersion || !state.installedAt) setSetting(SETTING, { ...state, phpVersion, installedAt: state.installedAt ?? new Date().toISOString() });
  return adminerStatus();
}

export async function adminerStatus(): Promise<AdminerStatus> {
  const state = getSetting<Partial<AdminerState>>(SETTING, {});
  const verified = await adminerFileVerified();
  return {
    version: ADMINER_VERSION,
    sha256: ADMINER_SHA256,
    downloadUrl: adminerDownloadUrl(),
    installed: !config.dryRun && verified && !!state.installedAt,
    phpVersion: state.phpVersion ?? null,
    dryRun: config.dryRun,
  };
}

/** Remove what ensureAdminer created (the system user is kept: harmless, and its uid stays reserved). */
export async function removeAdminer(log?: HostLogger): Promise<AdminerStatus> {
  const p = adminerPaths();
  sessions.clear();
  launches.clear();
  await writeSecretNginxConf(p.nginxConf, null, log).catch((err) => log?.(t('Cảnh báo: {error}', { error: errorMessage(err) })));
  for (const v of await installedPhpVersions()) {
    const file = p.pool(v);
    if (!(await host.exists(file))) continue;
    await fs.rm(file, { force: true });
    if (!config.dryRun) await host.mutate(`systemctl reload ${shq(`php${v}-fpm`)}`, { log }).catch(() => {});
  }
  if (p.dir !== '/' && path.basename(p.dir).includes('adminer')) await fs.rm(p.dir, { recursive: true, force: true });
  const state = getState();
  setSetting(SETTING, { ...state, phpVersion: null, installedAt: null });
  return adminerStatus();
}

// ---- Launch links, sessions, tickets ----------------------------------------------------

interface Launch {
  userId: number;
  tv: number;
  jti: string;
  jwtExp: number;
  ip: string;
  databaseId: number;
  expiresAt: number;
}

export interface AdminerSession {
  userId: number;
  tv: number;
  jti: string;
  /** JWT expiry (seconds): the Adminer session never outlives the panel login. */
  jwtExp: number;
  createdAt: number;
  lastSeen: number;
  /** username → ticket to attach to the next request for that username. */
  pending: Map<string, { ticket: string; expiresAt: number }>;
}

const launches = new Map<string, Launch>();
const sessions = new Map<string, AdminerSession>();
const hashToken = (token: string) => sha256(`lares-adminer:${token}`);
const isRevoked = (jti: string) => !!db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);

/** Still the same, live panel login? */
function loginStillValid(x: { userId: number; tv: number; jti: string; jwtExp: number }, now: number): boolean {
  const user = getUser(x.userId);
  return !!user && user.token_version === x.tv && now < x.jwtExp * 1000 && !isRevoked(x.jti);
}

/** One-time launch token for a database, for the logged-in caller (route has run requireAuth). */
export function createLaunch(claims: Pick<SessionClaims, 'sub' | 'tv' | 'jti' | 'exp'>, ip: string, databaseId: number, now = Date.now()): string {
  getDatabaseCredentials(databaseId); // 404 for an unknown database, before anything is handed out
  const token = crypto.randomBytes(32).toString('base64url');
  launches.set(hashToken(token), { userId: claims.sub, tv: claims.tv, jti: claims.jti, jwtExp: claims.exp, ip, databaseId, expiresAt: now + LAUNCH_TTL_MS });
  return token;
}

/** The launch for `token`, consumed (a token works once, from the IP that asked for it, within 60 s). */
export function consumeLaunch(token: string, ip: string, now = Date.now()): Launch | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const key = hashToken(token);
  const launch = launches.get(key);
  launches.delete(key);
  if (!launch || launch.expiresAt < now || launch.ip !== ip || !loginStillValid(launch, now)) return null;
  return launch;
}

export function readCookie(header: string | undefined, name = COOKIE): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The live session behind the request's cookie (refreshes its idle timer), or null. */
export function sessionFromCookie(cookieHeader: string | undefined, now = Date.now()): AdminerSession | null {
  const value = readCookie(cookieHeader);
  if (!value || !/^[A-Za-z0-9_-]{20,100}$/.test(value)) return null;
  const key = hashToken(value);
  const s = sessions.get(key);
  if (!s) return null;
  if (now - s.lastSeen > IDLE_MS || now - s.createdAt > MAX_AGE_MS || !loginStillValid(s, now)) {
    sessions.delete(key);
    return null;
  }
  s.lastSeen = now;
  return s;
}

async function writeTicket(ticket: string, data: { user: string; password: string; db: string; exp: number }) {
  const file = path.join(adminerPaths().tickets, `${ticket}.json`);
  await host.writeFile(file, JSON.stringify(data), 0o600);
  const { uid, gid } = await poolUserIds();
  await fs.chown(file, uid, gid);
}

/**
 * Turn a consumed launch into a browser session: reuse the caller's live session of the same login
 * (several databases in one browser) or start a new one, queue a credential ticket for the database
 * user, and say where to send the browser.
 */
export async function startSession(launch: Launch, cookieHeader: string | undefined, now = Date.now()): Promise<{ cookie: string | null; location: string }> {
  const creds = getDatabaseCredentials(launch.databaseId);
  let session = sessionFromCookie(cookieHeader, now);
  let cookie: string | null = null;
  if (!session || session.userId !== launch.userId || session.jti !== launch.jti) {
    cookie = crypto.randomBytes(32).toString('base64url');
    session = { userId: launch.userId, tv: launch.tv, jti: launch.jti, jwtExp: launch.jwtExp, createdAt: now, lastSeen: now, pending: new Map() };
    sessions.set(hashToken(cookie), session);
  }
  const ticket = crypto.randomBytes(32).toString('hex');
  if (!config.dryRun) await writeTicket(ticket, { user: creds.username, password: creds.password, db: creds.name, exp: Math.floor(now / 1000) + TICKET_TTL_S });
  session.pending.set(creds.username, { ticket, expiresAt: now + TICKET_TTL_S * 1000 });
  return { cookie, location: `${ADMINER_PATH}?username=${encodeURIComponent(creds.username)}&db=${encodeURIComponent(creds.name)}` };
}

/** The queued ticket for `username`, removed from the session (attached to exactly one request). */
export function takeTicket(session: AdminerSession, username: string | null, now = Date.now()): string | null {
  if (!username) return null;
  const p = session.pending.get(username);
  if (!p) return null;
  session.pending.delete(username);
  return p.expiresAt >= now ? p.ticket : null;
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  return `${COOKIE}=${value}; Path=${ADMINER_PATH}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export const clearCookieHeader = (secure: boolean) => `${COOKIE}=; Path=${ADMINER_PATH}; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

/** Forget expired launches/sessions and delete ticket files nobody consumed. */
export async function sweepAdminer(now = Date.now()) {
  for (const [k, l] of launches) if (l.expiresAt < now) launches.delete(k);
  for (const [k, s] of sessions) {
    if (now - s.lastSeen > IDLE_MS || now - s.createdAt > MAX_AGE_MS || now >= s.jwtExp * 1000) sessions.delete(k);
    else for (const [u, p] of s.pending) if (p.expiresAt < now) s.pending.delete(u);
  }
  const dir = adminerPaths().tickets;
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{64}\.json$/.test(f)) continue;
    const st = await fs.stat(path.join(dir, f)).catch(() => null);
    if (st && now - st.mtimeMs > 2 * TICKET_TTL_S * 1000) await fs.rm(path.join(dir, f), { force: true });
  }
}

let sweeper: NodeJS.Timeout | null = null;
export function startAdminerSweeper() {
  sweeper ??= setInterval(() => void sweepAdminer().catch(() => {}), 60_000);
  sweeper.unref();
}

// ---- Reverse proxy ---------------------------------------------------------------------

/** Request headers Adminer needs; everything else (Authorization, X-Forwarded-*, X-Lares-*...) is dropped. */
const FORWARD_REQUEST = ['accept', 'accept-encoding', 'accept-language', 'content-type', 'content-length', 'user-agent', 'x-requested-with', 'if-modified-since', 'if-none-match', 'cache-control', 'pragma'];

export function upstreamHeaders(incoming: IncomingHttpHeaders, opts: { secret: string; ticket?: string | null; https: boolean; port: number }): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const h of FORWARD_REQUEST) if (incoming[h] !== undefined) out[h] = incoming[h];
  // Adminer's own cookies only; the panel's session cookie stays with the panel
  const cookies = (incoming.cookie ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.toLowerCase().startsWith('lares_'));
  if (cookies.length) out.cookie = cookies.join('; ');
  out.host = `127.0.0.1:${opts.port}`;
  out['x-lares-adminer-key'] = opts.secret;
  out['x-lares-proto'] = opts.https ? 'https' : 'http';
  if (opts.ticket) out['x-lares-adminer-ticket'] = opts.ticket;
  return out;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'server', 'x-powered-by']);

/** Response headers passed back to the browser (hop-by-hop dropped, upstream-absolute redirects made relative). */
export function downstreamHeaders(headers: IncomingHttpHeaders, port: number): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    out[k] = v;
  }
  const loc = out.location;
  if (typeof loc === 'string') {
    const m = loc.match(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::(\d+))?(\/.*)?$/i);
    if (m && (!m[1] || Number(m[1]) === port)) out.location = m[2] || ADMINER_PATH;
  }
  return out;
}

/** Stream one request to Adminer's nginx and its answer back. */
export function proxyToAdminer(req: FastifyRequest, reply: FastifyReply, target: { port: number; secret: string; ticket?: string | null }): Promise<FastifyReply> {
  return new Promise((resolve) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: target.port,
        method: req.method,
        path: req.url,
        headers: upstreamHeaders(req.headers, { ...target, https: req.protocol === 'https' }),
        timeout: 600_000,
      },
      (res) => {
        reply.code(res.statusCode ?? 502);
        const headers = downstreamHeaders(res.headers, target.port);
        for (const [k, v] of Object.entries(headers)) reply.header(k, v);
        if (String(res.headers['content-type'] ?? '').startsWith('text/html')) {
          // pages show table data: never kept in a cache, never framed
          reply.header('Cache-Control', 'no-store');
          reply.header('X-Frame-Options', 'DENY');
        }
        resolve(reply.send(res));
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', (err) => {
      if (reply.sent) return;
      req.log.warn({ err: err.message }, 'adminer upstream error');
      resolve(reply.code(502).type('text/html; charset=utf-8').send(adminerPage(t('Không kết nối được Adminer'), t('nginx/PHP-FPM của Adminer không phản hồi ({error}). Mở lại Adminer từ trang Database để Lares kiểm tra và sửa cấu hình.', { error: err.message }))));
    });
    // browser went away (closed tab, cancelled export): stop the PHP side too
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) upstream.destroy();
    });
    const body = req.body as NodeJS.ReadableStream | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && body && typeof body.pipe === 'function') body.pipe(upstream);
    else upstream.end();
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal standalone page (no raw colours: system colours follow the browser's light/dark scheme). */
export function adminerPage(title: string, message: string, extra = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} - Lares</title>
<style>:root{color-scheme:light dark}body{font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:Canvas;color:CanvasText;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{max-width:560px;border:1px solid GrayText;border-radius:12px;padding:24px;overflow-wrap:anywhere}h1{font-size:18px;margin:0 0 8px}p{margin:8px 0}code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12.5px}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${extra}</main></body></html>`;
}

export const dryRunPage = (username: string | null, dbName: string | null) =>
  adminerPage(
    t('Adminer (chế độ dry-run)'),
    t('Máy này chạy Lares ở chế độ dry-run (không phải Linux hoặc LARES_DRY_RUN=1) nên Adminer không chạy: cần nginx và PHP-FPM trên VPS. Đăng nhập panel, liên kết một lần và cookie đã hoạt động; trên VPS thật, trang này là Adminer đã đăng nhập sẵn.'),
    username ? `<p>${esc(t('Database: {db} · user: {user}', { db: dbName ?? '—', user: username }))}</p>` : '',
  );
