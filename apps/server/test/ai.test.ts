import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArticleRequest } from '@lares/shared';
import { describe, expect, it } from 'vitest';
import { sanitizeArticleHtml, slugify } from '../src/services/article.js';
import { CONTEXT_PHP, PUBLISH_PHP, renderSsoPlugin } from '../src/services/wpContent.js';

describe('AI article sanitizer', () => {
  it('keeps the allowed structure and drops attributes', () => {
    expect(sanitizeArticleHtml('<h2 class="x" style="color:red">Tiêu đề</h2><p onclick="x()">Đoạn <strong>đậm</strong></p>')).toBe(
      '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong></p>',
    );
  });
  it('removes scripts, event handlers and dangerous links', () => {
    const out = sanitizeArticleHtml('<p>a</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><a href="//evil.com">y</a><iframe src="x"></iframe>');
    expect(out).toBe('<p>a</p><a>x</a><a>y</a>');
  });
  it('keeps safe links', () => {
    expect(sanitizeArticleHtml('<a href="https://site.vn/bai-viet/" target="_blank">x</a> <a href=\'/lien-he/\'>y</a>')).toBe('<a href="https://site.vn/bai-viet/">x</a> <a href="/lien-he/">y</a>');
  });
  it('escapes malformed tags instead of letting them through', () => {
    expect(sanitizeArticleHtml('<p>x</p><img src=x onerror=alert(1)//')).toBe('<p>x</p>&lt;img src=x onerror=alert(1)//');
    expect(sanitizeArticleHtml('<p>1 < 2 and 3 > 2</p>')).toBe('<p>1 &lt; 2 and 3 &gt; 2</p>');
  });
  it('turns H1 into H2 (the post title is the H1)', () => {
    expect(sanitizeArticleHtml('<h1>A</h1>')).toBe('<h2>A</h2>');
  });
});

describe('slugify', () => {
  it('handles Vietnamese', () => {
    expect(slugify('Hướng dẫn chọn Đất nền 2025!')).toBe('huong-dan-chon-dat-nen-2025');
    expect(slugify('  --Căn hộ   cao cấp-- ')).toBe('can-ho-cao-cap');
  });
});

const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPhp)('generated PHP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lares-php-'));
  const lint = (code: string) => {
    const f = path.join(dir, `${crypto.randomBytes(4).toString('hex')}.php`);
    fs.writeFileSync(f, code);
    return execFileSync('php', ['-l', f], { encoding: 'utf8' });
  };

  it('eval-file scripts are valid PHP', () => {
    expect(lint(CONTEXT_PHP)).toContain('No syntax errors');
    expect(lint(PUBLISH_PHP)).toContain('No syntax errors');
  });

  /** Run the SSO mu-plugin against stubbed WordPress functions; returns what it did. */
  function runSso(opts: { token: string; host: string; record?: object | null }) {
    const tokenFile = path.join(dir, `sso-${crypto.randomBytes(4).toString('hex')}.json`);
    if (opts.record) fs.writeFileSync(tokenFile, JSON.stringify(opts.record));
    const plugin = path.join(dir, 'lares-sso.php');
    fs.writeFileSync(plugin, renderSsoPlugin(tokenFile));
    const harness = path.join(dir, 'harness.php');
    fs.writeFileSync(
      harness,
      `<?php
define( 'ABSPATH', '/' );
$GLOBALS['hooks'] = array();
function add_action( $h, $cb ) { $GLOBALS['hooks'][] = $cb; }
function home_url( $p = '' ) { return 'http://site.vn' . $p; }
function site_url( $p = '' ) { return 'http://site.vn' . $p; }
function nocache_headers() {}
function wp_parse_url( $u ) { return parse_url( $u ); }
function is_ssl() { return false; }
function sanitize_text_field( $s ) { return trim( $s ); }
function wp_unslash( $s ) { return $s; }
function get_users( $a ) { return array( 7 ); }
function wp_set_current_user( $id ) {}
function wp_set_auth_cookie( $id ) { echo "LOGIN:$id\\n"; }
function admin_url( $p = '' ) { return 'http://site.vn/wp-admin/' . $p; }
function wp_redirect( $u ) { echo "REDIRECT:$u\\n"; }
function wp_safe_redirect( $u ) { echo "REDIRECT:$u\\n"; }
function wp_die( $m, $t = '', $a = array() ) { echo 'DIE:' . $a['response'] . "\\n"; exit; }
$_GET = $argv[1] === 'PING' ? array( 'lares_sso_ping' => '1' ) : array( 'lares_sso' => $argv[1] );
$_SERVER['HTTP_HOST'] = $argv[2];
require '${plugin}';
foreach ( $GLOBALS['hooks'] as $cb ) { $cb(); }
`,
    );
    const out = execFileSync('php', [harness, opts.token, opts.host], { encoding: 'utf8' });
    return { out: out.trim(), consumed: !fs.existsSync(tokenFile) };
  }

  const token = 'a'.repeat(64);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const future = () => Math.floor(Date.now() / 1000) + 60;

  it('mu-plugin is valid PHP', () => {
    expect(lint(renderSsoPlugin("/var/www/it's/.lares-sso.json"))).toContain('No syntax errors');
  });
  it('valid token logs in the first admin and opens the requested page, once', () => {
    const r = runSso({ token, host: 'site.vn', record: { hash, exp: future(), to: 'post.php?post=5&action=edit' } });
    expect(r.out).toBe('LOGIN:7\nREDIRECT:http://site.vn/wp-admin/post.php?post=5&action=edit');
    expect(r.consumed).toBe(true);
  });
  it('rejects wrong, expired and missing tokens', () => {
    expect(runSso({ token: 'b'.repeat(64), host: 'site.vn', record: { hash, exp: future() } }).out).toBe('DIE:403');
    expect(runSso({ token, host: 'site.vn', record: { hash, exp: 1 } }).out).toBe('DIE:403');
    expect(runSso({ token, host: 'site.vn', record: null }).out).toBe('DIE:403');
  });
  it('answers the health check with the site marker only', () => {
    const r = runSso({ token: 'PING', host: 'site.vn', record: { hash, exp: future() } });
    expect(r.out).toMatch(/^lares-sso:[0-9a-f]{32}$/);
    expect(r.consumed).toBe(false);
  });
  it('ignores normal requests', () => {
    expect(runSso({ token: '', host: 'site.vn', record: { hash, exp: future() } }).out).toBe('');
  });
  it('hops to the WordPress host first without consuming the token', () => {
    const r = runSso({ token, host: 'www.site.vn', record: { hash, exp: future() } });
    expect(r.out).toBe(`REDIRECT:http://site.vn/?lares_hop=1&lares_sso=${token}`);
    expect(r.consumed).toBe(false);
  });
});

describe('AI provider integration (mocked HTTP)', async () => {
  const ai = await import('../src/services/ai.js');
  const { vi, afterEach } = await import('vitest');
  afterEach(() => vi.unstubAllGlobals());

  /** SSE body delivered in awkward 7-byte chunks to exercise the line buffering. */
  const sseResponse = (events: unknown[], raw = false) => {
    const text = events.map((e) => `${raw ? '' : `event: x\n`}data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
    const bytes = new TextEncoder().encode(text);
    return new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
          c.close();
        },
      }),
      { status: 200 },
    );
  };
  const article = {
    title: 'Kinh nghiệm mua căn hộ chung cư lần đầu',
    slug: 'Kinh nghiệm mua căn hộ',
    metaDescription: 'Mô tả',
    focusKeyword: 'mua căn hộ',
    excerpt: 'Tóm tắt',
    contentHtml: '<h2 style="x">Mua căn hộ</h2><p>Nội dung</p><script>alert(1)</script>',
    tags: ['căn hộ', 'nhà, đất'],
  };
  const req: ArticleRequest = { topic: 'Mua căn hộ', keyword: 'mua căn hộ', secondaryKeywords: [], language: 'vi', tone: 'chuyen-nghiep', words: 800, includeFaq: true };
  const ctx = { categories: ['Tin tức'], posts: [{ title: 'Bài cũ', url: 'https://a.vn/bai-cu/' }] };

  it('stores the key encrypted and only exposes a hint', () => {
    const v = ai.saveAiSettings({ provider: 'anthropic', apiKey: 'sk-ant-api03-secretsecret-7890', model: 'claude-sonnet-5-5' });
    expect(v).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: null, hasKey: true, keyHint: 'sk-ant-…7890' });
    expect(JSON.stringify(v)).not.toContain('secretsecret');
    // empty key = keep
    expect(ai.saveAiSettings({ provider: 'anthropic', model: 'claude-opus-5-5' }).hasKey).toBe(true);
  });

  it('Anthropic: forced tool call, streamed JSON, sanitized result', async () => {
    ai.saveAiSettings({ provider: 'anthropic', apiKey: 'sk-ant-api03-secretsecret-7890', model: 'claude-sonnet-5-5' });
    const json = JSON.stringify(article);
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: 'message_start', message: {} },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'save_article', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, 40) } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(40) } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.generateArticle(req, ctx, () => {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-api03-secretsecret-7890');
    const body = JSON.parse(init.body as string);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'save_article' });
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toContain('https://a.vn/bai-cu/');
    expect(out.slug).toBe('kinh-nghiem-mua-can-ho');
    expect(out.contentHtml).toBe('<h2>Mua căn hộ</h2><p>Nội dung</p>');
    expect(out.tags).toEqual(['căn hộ', 'nhà đất']);
  });

  it('Anthropic: reports a truncated article and a rejected key', async () => {
    vi.stubGlobal('fetch', async () => sseResponse([{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]));
    await expect(ai.generateArticle(req, ctx, () => {})).rejects.toThrow(/giảm số từ/);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 }));
    await expect(ai.generateArticle(req, ctx, () => {})).rejects.toThrow(/từ chối API key \(401\): invalid x-api-key/);
  });

  it('OpenAI-compatible: JSON mode stream with custom base URL', async () => {
    const v = ai.saveAiSettings({ provider: 'openai', apiKey: 'sk-proj-abcdefghijklmnop', model: 'some-model', baseUrl: 'https://openrouter.ai/api/v1/' });
    expect(v.baseUrl).toBe('https://openrouter.ai/api/v1/');
    const json = JSON.stringify(article);
    const fetchMock = vi.fn(async () =>
      sseResponse([{ choices: [{ delta: { content: json.slice(0, 50) } }] }, { choices: [{ delta: { content: json.slice(50) }, finish_reason: 'stop' }] }, '[DONE]'], true),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.generateArticle(req, ctx, () => {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-proj-abcdefghijklmnop');
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' });
    expect(out.title).toBe(article.title);
  });

  it('Gemini: structured-output stream, key in header, thoughts skipped', async () => {
    ai.saveAiSettings({ provider: 'gemini', apiKey: 'AIzaSyFAKEFAKEFAKE1234', model: 'gemini-3.8-flash' });
    const json = JSON.stringify(article);
    const fetchMock = vi.fn(async () =>
      sseResponse(
        [
          { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: json.slice(0, 60) }] } }] },
          { candidates: [{ content: { parts: [{ text: json.slice(60) }] }, finishReason: 'STOP' }] },
        ],
        true,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.generateArticle(req, ctx, () => {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(url).not.toContain('AIza');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaSyFAKEFAKEFAKE1234');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required).toContain('contentHtml');
    expect(out.title).toBe(article.title);
    expect(out.contentHtml).toBe('<h2>Mua căn hộ</h2><p>Nội dung</p>');
  });

  it('Gemini: invalid key (400) and blocked output are reported', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }), { status: 400 }));
    await expect(ai.generateArticle(req, ctx, () => {})).rejects.toThrow(/Gemini từ chối API key \(400\)/);
    vi.stubGlobal('fetch', async () => sseResponse([{ candidates: [{ content: { parts: [{ text: '{' }] }, finishReason: 'SAFETY' }] }], true));
    await expect(ai.generateArticle(req, ctx, () => {})).rejects.toThrow(/SAFETY/);
  });

  it('Gemini: connection test reads models/<id> names', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash' }] }), { status: 200 }));
    expect((await ai.testAi()).message).toContain('sẵn sàng');
    ai.saveAiSettings({ provider: 'gemini', model: 'gemini-9-typo' });
    expect((await ai.testAi()).message).toContain('không thấy model');
  });

  it('switching provider without a new key drops the old one', () => {
    ai.saveAiSettings({ provider: 'openai', apiKey: 'sk-proj-abcdefghijklmnop', model: 'm' });
    expect(ai.saveAiSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' }).hasKey).toBe(false);
  });
});
