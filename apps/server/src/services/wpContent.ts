import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PublishArticleInput, PublishedPost, Site, WpCategory } from '@lares/shared';
import { config } from '../config.js';
import { t, tDefault } from '../i18n/index.js';
import { conflict } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import type { SiteContext } from './ai.js';
import { host, type HostLogger } from './host.js';
import { runAsOf, siteOwner } from './isolation.js';
import { wpCliAsWebUser } from './wordpress.js';

/*
 * Talking to a WordPress install goes through `wp eval-file` as the web user: one PHP process per
 * operation, untrusted values passed as a JSON file (never interpolated into code or a shell line).
 */

export const CONTEXT_PHP = `<?php
// Lares: site facts for AI writing (name, categories, posts to link to).
$cats  = get_terms( array( 'taxonomy' => 'category', 'hide_empty' => false ) );
$posts = get_posts( array( 'numberposts' => 40, 'post_status' => 'publish', 'post_type' => array( 'post', 'page' ) ) );
echo "\\n" . wp_json_encode( array(
	'name'       => html_entity_decode( get_option( 'blogname' ) ),
	'tagline'    => html_entity_decode( get_option( 'blogdescription' ) ),
	'categories' => is_wp_error( $cats ) ? array() : array_map( function ( $t ) {
		return array( 'id' => (int) $t->term_id, 'name' => html_entity_decode( $t->name ), 'count' => (int) $t->count );
	}, $cats ),
	'posts'      => array_map( function ( $p ) {
		return array( 'title' => html_entity_decode( get_the_title( $p ) ), 'url' => get_permalink( $p ) );
	}, $posts ),
) ) . "\\n";
`;

export const PUBLISH_PHP = `<?php
// Lares: create a post from the JSON payload in $args[0].
$p      = json_decode( file_get_contents( $args[0] ), true );
$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ID' ) );
$cats   = array_values( array_filter( array_map( 'intval', $p['categories'] ), function ( $id ) { return (bool) term_exists( $id, 'category' ); } ) );
$id     = wp_insert_post( wp_slash( array(
	'post_type'     => 'post',
	'post_status'   => $p['status'],
	'post_title'    => $p['title'],
	'post_name'     => $p['slug'],
	'post_content'  => $p['content'],
	'post_excerpt'  => $p['excerpt'],
	'post_author'   => $admins ? (int) $admins[0] : 0,
	'post_category' => $cats,
	'tags_input'    => $p['tags'],
) ), true );
if ( is_wp_error( $id ) ) {
	WP_CLI::error( $id->get_error_message() );
}
foreach ( $p['meta'] as $k => $v ) {
	if ( '' !== $v ) {
		update_post_meta( $id, $k, wp_slash( $v ) );
	}
}
echo "\\n" . wp_json_encode( array(
	'id'      => $id,
	'url'     => get_permalink( $id ),
	'editUrl' => admin_url( 'post.php?post=' . $id . '&action=edit' ),
	'status'  => get_post_status( $id ),
) ) . "\\n";
`;

function assertWordpress(site: Site) {
  if (site.appType !== 'wordpress') throw conflict(t('Chỉ áp dụng cho site WordPress'));
  // helper files live in the site dir, which must not be the served web root
  if (path.resolve(site.webRoot) === path.resolve(site.rootPath)) throw conflict(t('Web root trùng thư mục site - không hỗ trợ'));
}

async function requireWpCli() {
  if (!(await host.has('wp'))) throw conflict(t('Cần cài wp-cli trên máy chủ (installer của Lares tự cài - chạy lại install.sh)'));
}

/** Last JSON line of wp-cli output (PHP notices from plugins/themes may precede it). */
function lastJson<T>(stdout: string): T {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{') || l.startsWith('['));
  if (!line) throw new Error(t('wp-cli không trả về dữ liệu: {output}', { output: stdout.trim().slice(-300) }));
  return JSON.parse(line) as T;
}

/** Run a PHP snippet inside the site's WordPress, with an optional JSON payload. */
async function wpEval<T>(site: Site, php: string, payload?: unknown): Promise<T> {
  const tag = crypto.randomBytes(8).toString('hex');
  const script = path.join(site.rootPath, `.lares-${tag}.php`);
  const data = path.join(site.rootPath, `.lares-${tag}.json`);
  try {
    await host.writeFile(script, php, 0o640);
    if (payload !== undefined) await host.writeFile(data, JSON.stringify(payload), 0o640);
    const owner = siteOwner(site);
    await host.mutate(`chown ${shq(`${owner}:${owner}`)} ${shq(script)}${payload !== undefined ? ` ${shq(data)}` : ''}`);
    const out = await host.run(wpCliAsWebUser(site.webRoot, runAsOf(site), `eval-file ${shq(script)}${payload !== undefined ? ` ${shq(data)}` : ''}`), { timeoutMs: 120_000 });
    return lastJson<T>(out);
  } finally {
    await Promise.all([fs.rm(script, { force: true }), fs.rm(data, { force: true })]);
  }
}

interface RawContext {
  name: string;
  tagline: string;
  categories: WpCategory[];
  posts: Array<{ title: string; url: string }>;
}

export async function wpSiteInfo(site: Site): Promise<RawContext> {
  assertWordpress(site);
  if (config.dryRun) return { name: site.domain, tagline: '', categories: [{ id: 1, name: 'Chưa phân loại', count: 0 }], posts: [] }; // i18n-ignore - dry-run stand-in for WordPress data
  await requireWpCli();
  return wpEval<RawContext>(site, CONTEXT_PHP);
}

export async function aiSiteContext(site: Site, log: HostLogger): Promise<SiteContext> {
  try {
    const info = await wpSiteInfo(site);
    return { siteName: info.name, tagline: info.tagline, categories: info.categories.map((c) => c.name), posts: info.posts.slice(0, 40) };
  } catch (err) {
    log(t('Không đọc được thông tin site ({error}) - viết bài không kèm liên kết nội bộ', { error: err instanceof Error ? err.message : String(err) }));
    return { categories: [], posts: [] };
  }
}

export async function publishArticle(site: Site, input: PublishArticleInput, log?: HostLogger): Promise<PublishedPost> {
  assertWordpress(site);
  const meta = {
    // Yoast SEO and Rank Math read these; harmless when the plugin is not installed
    _yoast_wpseo_metadesc: input.metaDescription,
    _yoast_wpseo_focuskw: input.focusKeyword,
    rank_math_description: input.metaDescription,
    rank_math_focus_keyword: input.focusKeyword,
  };
  const payload = {
    status: input.status,
    title: input.title,
    slug: input.slug,
    content: input.contentHtml,
    excerpt: input.excerpt || input.metaDescription,
    categories: input.categoryIds,
    tags: input.tags,
    meta,
  };
  if (config.dryRun) {
    log?.(`[dry-run] wp eval-file publish "${input.title}" (${input.status})`);
    return { id: 0, url: `http://${site.domain}/?p=0`, editUrl: `http://${site.domain}/wp-admin/post.php?post=0&action=edit`, status: input.status };
  }
  await requireWpCli();
  return wpEval<PublishedPost>(site, PUBLISH_PHP, payload);
}

// ---------------------------------------------------------------------------
// One-click wp-admin login
// ---------------------------------------------------------------------------

const SSO_TTL_SECONDS = 60;
const SSO_PLUGIN = 'lares-sso.php';

/** Identifies one site's copy of the plugin, so a health check cannot be answered by another WordPress. */
const ssoMarker = (tokenFile: string) => `lares-sso:${crypto.createHash('md5').update(tokenFile).digest('hex')}`;

/**
 * mu-plugin that turns a one-time token into a login as the first administrator.
 * The token itself is never stored: the file next to the site (outside the web root) holds its
 * SHA-256, an expiry and the admin page to open; it is deleted on first use, valid or not.
 * It acts on `plugins_loaded` (priority 0): before security / custom-login plugins can redirect
 * the request, yet late enough for the pluggable auth functions to exist.
 */
export function renderSsoPlugin(tokenFile: string): string {
  const file = `'${tokenFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `<?php
/**
 * Plugin Name: Lares one-click login
 * Description: One-time login links from the Lares dashboard. Managed by Lares - rewritten on every use.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
// Health check: Lares requests ?lares_sso_ping before handing out a link.
if ( isset( $_GET['lares_sso_ping'] ) ) {
	header( 'Content-Type: text/plain; charset=utf-8' );
	header( 'Cache-Control: no-store' );
	echo '${ssoMarker(tokenFile)}';
	exit;
}
if ( empty( $_GET['lares_sso'] ) || ! is_string( $_GET['lares_sso'] ) ) {
	return;
}
add_action( 'plugins_loaded', function () {
	nocache_headers();
	$token = preg_replace( '/[^a-f0-9]/', '', strtolower( wp_unslash( $_GET['lares_sso'] ) ) );
	// The auth cookie belongs to the host wp-admin lives on: hop there first (token not consumed yet).
	$site    = wp_parse_url( site_url() );
	$current = ( is_ssl() ? 'https' : 'http' ) . '://' . strtolower( $_SERVER['HTTP_HOST'] ?? '' );
	$wanted  = ( $site['scheme'] ?? 'http' ) . '://' . strtolower( ( $site['host'] ?? '' ) . ( isset( $site['port'] ) ? ':' . $site['port'] : '' ) );
	if ( $current !== $wanted && empty( $_GET['lares_hop'] ) ) {
		wp_redirect( site_url( '/?lares_hop=1&lares_sso=' . $token ) );
		exit;
	}
	$file = ${file};
	$data = is_readable( $file ) ? json_decode( (string) file_get_contents( $file ), true ) : null;
	@unlink( $file );
	if ( ! is_array( $data ) || empty( $data['hash'] ) || (int) ( $data['exp'] ?? 0 ) < time() || ! hash_equals( (string) $data['hash'], hash( 'sha256', $token ) ) ) {
		wp_die( '${tDefault('Link đăng nhập không hợp lệ hoặc đã hết hạn. Hãy bấm lại nút trong Lares.')}', 'Lares', array( 'response' => 403 ) );
	}
	$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ID' ) );
	if ( ! $admins ) {
		wp_die( '${tDefault('Site chưa có tài khoản administrator.')}', 'Lares', array( 'response' => 404 ) );
	}
	wp_set_current_user( (int) $admins[0] );
	wp_set_auth_cookie( (int) $admins[0], false, is_ssl() );
	wp_safe_redirect( admin_url( (string) ( $data['to'] ?? '' ) ) );
	exit;
}, 0 );
`;
}

/** Fetch `<base>/?lares_sso_ping` like a browser would, or through this machine's own web server (`local`). */
async function probeSso(base: string, marker: string, local: boolean): Promise<{ ok: boolean; status: string }> {
  const url = new URL(`${base}/`);
  url.searchParams.set('lares_sso_ping', '1');
  const ports = new Set([url.port || (url.protocol === 'https:' ? '443' : '80'), '80', '443']);
  const resolve = local ? [...ports].map((p) => `--resolve ${shq(`${url.hostname}:${p}:127.0.0.1`)}`).join(' ') : '';
  const r = await host.exec(`curl -sS -k -L --max-redirs 3 -m 10 ${resolve} -o - -w '\\n%{http_code}' ${shq(url.toString())}`);
  const lines = r.stdout.replace(/\s+$/, '').split('\n');
  const code = lines.pop() ?? '';
  const body = lines.join('\n');
  if (body.includes(marker)) return { ok: true, status: `HTTP ${code}` };
  if (r.code !== 0) return { ok: false, status: r.stderr.trim().split('\n').pop() || t('curl lỗi {code}', { code: r.code }) };
  return { ok: false, status: `HTTP ${code}${body.includes('lares-sso:') ? ` (${t('trả lời từ một site WordPress khác')})` : ''}` };
}

async function portOwner(port: string): Promise<string | null> {
  const r = await host.exec(`ss -ltnpH 'sport = :${Number(port)}' 2>/dev/null | head -n 3`);
  return r.stdout.match(/users:\(\("([^"]+)"/)?.[1] ?? null;
}

/** WPMU_PLUGIN_DIR as WordPress itself sees it (sites with a custom wp-content location). */
async function realMuPluginDir(site: Site): Promise<string | null> {
  if (!(await host.has('wp'))) return null;
  const r = await host.exec(wpCliAsWebUser(site.webRoot, runAsOf(site), `eval ${shq('echo "\\n" . WPMU_PLUGIN_DIR;')}`), { timeoutMs: 60_000 });
  const dir = r.stdout.trim().split('\n').pop()?.trim() ?? '';
  return r.code === 0 && dir.startsWith('/') ? dir : null;
}

async function installSsoPlugin(muDir: string, tokenFile: string, owner: string, log?: HostLogger) {
  const existed = await host.exists(muDir);
  const plugin = path.join(muDir, SSO_PLUGIN);
  await host.writeFile(plugin, renderSsoPlugin(tokenFile), 0o640);
  await host.mutate(`chown ${shq(`${owner}:${owner}`)} ${shq(plugin)}${existed ? '' : ` ${shq(muDir)}`}`, { log });
}

/**
 * Fresh one-time login link (valid 60s) opening `target` (relative to /wp-admin/).
 * Before handing it out, Lares checks that `baseUrl` really reaches this site's WordPress with the
 * plugin loaded - otherwise the browser would just show the home page - and says why when it does not.
 */
export async function wpLoginUrl(site: Site, baseUrl: string, target: string, log?: HostLogger): Promise<string> {
  assertWordpress(site);
  const base = baseUrl.replace(/\/+$/, '');
  const content = path.join(site.webRoot, 'wp-content');
  if (!(await host.exists(content))) throw conflict(t('Không tìm thấy {path} - site chưa cài WordPress xong?', { path: content }));
  const tokenFile = path.join(site.rootPath, '.lares-sso.json');
  const marker = ssoMarker(tokenFile);
  await installSsoPlugin(path.join(content, 'mu-plugins'), tokenFile, siteOwner(site), log);

  if (!config.dryRun) {
    let pub = await probeSso(base, marker, false);
    if (!pub.ok) {
      let local = await probeSso(base, marker, true);
      if (!local.ok) {
        // wp-content moved by wp-config (WP_CONTENT_DIR / WPMU_PLUGIN_DIR): ask WordPress where mu-plugins live
        const dir = await realMuPluginDir(site);
        if (dir && path.resolve(dir) !== path.resolve(content, 'mu-plugins')) {
          await installSsoPlugin(dir, tokenFile, siteOwner(site), log);
          [pub, local] = await Promise.all([probeSso(base, marker, false), probeSso(base, marker, true)]);
        }
      }
      if (!pub.ok) {
        const url = new URL(`${base}/`);
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        const owner = await portOwner(port);
        if (owner && owner !== 'nginx') {
          throw conflict(
            t('Port {port} đang do "{owner}" giữ chứ không phải nginx của Lares, nên {base} mở ra site của web server/panel khác ({status}). Dừng web server đó (hoặc gỡ tên miền khỏi panel cũ) rồi thử lại.', { port, owner, base, status: pub.status }),
          );
        }
        if (local.ok) {
          throw conflict(
            t('{base} không tới được WordPress của site này ({status}), trong khi nginx của Lares phục vụ đúng. Kiểm tra DNS của tên miền đã trỏ về IP VPS này chưa, hoặc CDN/proxy (Cloudflare...) đang trỏ nơi khác.', { base, status: pub.status }),
          );
        }
        throw conflict(
          t('WordPress không nạp được plugin đăng nhập nhanh ({status}). Kiểm tra site có chạy được không (lỗi PHP?) và thư mục {dir} - hoặc đăng nhập thường tại {base}/wp-admin/', { status: local.status, dir: path.join(content, 'mu-plugins'), base }),
        );
      }
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const record = { hash: crypto.createHash('sha256').update(token).digest('hex'), exp: Math.floor(Date.now() / 1000) + SSO_TTL_SECONDS, to: target };
  await host.writeFile(tokenFile, JSON.stringify(record), 0o600);
  // PHP runs as the site's user: it must read (and delete) the token file
  await host.mutate(`chown ${shq(`${siteOwner(site)}:${siteOwner(site)}`)} ${shq(tokenFile)}`, { log });
  return `${base}/?lares_sso=${token}`;
}
