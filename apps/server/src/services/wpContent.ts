import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PublishArticleInput, PublishedPost, Site, WpCategory } from '@tpanel/shared';
import { config } from '../config.js';
import { conflict } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import type { SiteContext } from './ai.js';
import { host, type HostLogger } from './host.js';
import { wpCliAsWebUser } from './wordpress.js';

/*
 * Talking to a WordPress install goes through `wp eval-file` as the web user: one PHP process per
 * operation, untrusted values passed as a JSON file (never interpolated into code or a shell line).
 */

export const CONTEXT_PHP = `<?php
// TPanel: site facts for AI writing (name, categories, posts to link to).
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
// TPanel: create a post from the JSON payload in $args[0].
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
  if (site.appType !== 'wordpress') throw conflict('Chỉ áp dụng cho site WordPress');
  // helper files live in the site dir, which must not be the served web root
  if (path.resolve(site.webRoot) === path.resolve(site.rootPath)) throw conflict('Web root trùng thư mục site - không hỗ trợ');
}

async function requireWpCli() {
  if (!(await host.has('wp'))) throw conflict('Cần cài wp-cli trên máy chủ (installer của TPanel tự cài - chạy lại install.sh)');
}

/** Last JSON line of wp-cli output (PHP notices from plugins/themes may precede it). */
function lastJson<T>(stdout: string): T {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{') || l.startsWith('['));
  if (!line) throw new Error(`wp-cli không trả về dữ liệu: ${stdout.trim().slice(-300)}`);
  return JSON.parse(line) as T;
}

/** Run a PHP snippet inside the site's WordPress, with an optional JSON payload. */
async function wpEval<T>(site: Site, php: string, payload?: unknown): Promise<T> {
  const tag = crypto.randomBytes(8).toString('hex');
  const script = path.join(site.rootPath, `.tpanel-${tag}.php`);
  const data = path.join(site.rootPath, `.tpanel-${tag}.json`);
  try {
    await host.writeFile(script, php, 0o640);
    if (payload !== undefined) await host.writeFile(data, JSON.stringify(payload), 0o640);
    await host.mutate(`chown ${shq(`${config.webUser}:${config.webUser}`)} ${shq(script)}${payload !== undefined ? ` ${shq(data)}` : ''}`);
    const out = await host.run(wpCliAsWebUser(site.webRoot, site.rootPath, `eval-file ${shq(script)}${payload !== undefined ? ` ${shq(data)}` : ''}`), { timeoutMs: 120_000 });
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
  if (config.dryRun) return { name: site.domain, tagline: '', categories: [{ id: 1, name: 'Chưa phân loại', count: 0 }], posts: [] };
  await requireWpCli();
  return wpEval<RawContext>(site, CONTEXT_PHP);
}

export async function aiSiteContext(site: Site, log: HostLogger): Promise<SiteContext> {
  try {
    const info = await wpSiteInfo(site);
    return { siteName: info.name, tagline: info.tagline, categories: info.categories.map((c) => c.name), posts: info.posts.slice(0, 40) };
  } catch (err) {
    log(`Không đọc được thông tin site (${err instanceof Error ? err.message : err}) - viết bài không kèm liên kết nội bộ`);
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

/**
 * mu-plugin that turns a one-time token into a login as the first administrator.
 * The token itself is never stored: the file next to the site (outside the web root) holds its
 * SHA-256, an expiry and the admin page to open; it is deleted on first use, valid or not.
 */
export function renderSsoPlugin(tokenFile: string): string {
  const file = `'${tokenFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `<?php
/**
 * Plugin Name: TPanel one-click login
 * Description: One-time login links from the TPanel dashboard. Managed by TPanel - rewritten on every use.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
add_action( 'init', function () {
	if ( empty( $_GET['tpanel_sso'] ) || ! is_string( $_GET['tpanel_sso'] ) ) {
		return;
	}
	$token = sanitize_text_field( wp_unslash( $_GET['tpanel_sso'] ) );
	// The auth cookie belongs to the host WordPress lives on: hop there first (token not consumed yet).
	$home    = wp_parse_url( home_url() );
	$current = ( is_ssl() ? 'https' : 'http' ) . '://' . strtolower( $_SERVER['HTTP_HOST'] ?? '' );
	$wanted  = ( $home['scheme'] ?? 'http' ) . '://' . strtolower( ( $home['host'] ?? '' ) . ( isset( $home['port'] ) ? ':' . $home['port'] : '' ) );
	if ( $current !== $wanted && empty( $_GET['tpanel_hop'] ) ) {
		wp_redirect( home_url( '/?tpanel_hop=1&tpanel_sso=' . rawurlencode( $token ) ) );
		exit;
	}
	$file = ${file};
	$data = is_readable( $file ) ? json_decode( (string) file_get_contents( $file ), true ) : null;
	@unlink( $file );
	if ( ! is_array( $data ) || empty( $data['hash'] ) || (int) ( $data['exp'] ?? 0 ) < time() || ! hash_equals( (string) $data['hash'], hash( 'sha256', $token ) ) ) {
		wp_die( 'Link đăng nhập không hợp lệ hoặc đã hết hạn. Hãy bấm lại nút trong TPanel.', 'TPanel', array( 'response' => 403 ) );
	}
	$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ID' ) );
	if ( ! $admins ) {
		wp_die( 'Site chưa có tài khoản administrator.', 'TPanel', array( 'response' => 404 ) );
	}
	wp_set_current_user( (int) $admins[0] );
	wp_set_auth_cookie( (int) $admins[0], false, is_ssl() );
	wp_safe_redirect( admin_url( (string) ( $data['to'] ?? '' ) ) );
	exit;
}, 1 );
`;
}

/** Fresh one-time login link (valid 60s) opening `target` (relative to /wp-admin/). */
export async function wpLoginUrl(site: Site, baseUrl: string, target: string, log?: HostLogger): Promise<string> {
  assertWordpress(site);
  const content = path.join(site.webRoot, 'wp-content');
  if (!(await host.exists(content))) throw conflict(`Không tìm thấy ${content} - site chưa cài WordPress xong?`);
  const muDir = path.join(content, 'mu-plugins');
  const plugin = path.join(muDir, 'tpanel-sso.php');
  const tokenFile = path.join(site.rootPath, '.tpanel-sso.json');
  const muExisted = await host.exists(muDir);
  await host.writeFile(plugin, renderSsoPlugin(tokenFile), 0o644);

  const token = crypto.randomBytes(32).toString('hex');
  const record = { hash: crypto.createHash('sha256').update(token).digest('hex'), exp: Math.floor(Date.now() / 1000) + SSO_TTL_SECONDS, to: target };
  await host.writeFile(tokenFile, JSON.stringify(record), 0o600);
  // PHP runs as the web user: it must read (and delete) the token file
  const owner = shq(`${config.webUser}:${config.webUser}`);
  await host.mutate(`chown ${owner} ${shq(tokenFile)} ${shq(plugin)}${muExisted ? '' : ` ${shq(muDir)}`}`, { log });
  return `${baseUrl.replace(/\/+$/, '')}/?tpanel_sso=${token}`;
}
