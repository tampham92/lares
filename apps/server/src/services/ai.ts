import { ARTICLE_TONES, articleSchema, type AiProvider, type AiSettingsInput, type AiSettingsView, type Article, type ArticleRequest } from '@lares/shared';
import { getSetting, setSetting } from '../db/index.js';
import { currentLang, t } from '../i18n/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, conflict } from '../lib/errors.js';
import type { HostLogger } from './host.js';
import { sanitizeArticleHtml, slugify } from './article.js';

interface StoredAi {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  keyEnc: string | null;
}

const SETTING_KEY = 'ai';
const DEFAULTS: StoredAi = { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: null, keyEnc: null };
const ANTHROPIC_URL = 'https://api.anthropic.com/v1';
const OPENAI_URL = 'https://api.openai.com/v1';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_BASE: Record<AiProvider, string> = { anthropic: ANTHROPIC_URL, openai: OPENAI_URL, gemini: GEMINI_URL };
const PROVIDER_NAMES: Record<AiProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini' };

const stored = () => ({ ...DEFAULTS, ...getSetting<Partial<StoredAi>>(SETTING_KEY, {}) });

const hint = (key: string) => (key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••');

export function getAiSettings(): AiSettingsView {
  const s = stored();
  const key = s.keyEnc ? decrypt<string>(s.keyEnc) : null;
  return { provider: s.provider, model: s.model, baseUrl: s.baseUrl, hasKey: !!key, keyHint: key ? hint(key) : null };
}

export function saveAiSettings(input: AiSettingsInput): AiSettingsView {
  const current = stored();
  // a key belongs to one provider: switching provider without a new key drops the old one
  const keyEnc = input.apiKey ? encrypt(input.apiKey) : input.provider === current.provider ? current.keyEnc : null;
  setSetting(SETTING_KEY, { provider: input.provider, model: input.model, baseUrl: input.provider === 'openai' ? (input.baseUrl ?? null) : null, keyEnc });
  return getAiSettings();
}

export function deleteAiKey(): AiSettingsView {
  setSetting(SETTING_KEY, { ...stored(), keyEnc: null });
  return getAiSettings();
}

function credentials() {
  const s = stored();
  if (!s.keyEnc) throw conflict(t('Chưa có API key AI - thêm key trong mục Cài đặt'));
  return { ...s, key: decrypt<string>(s.keyEnc), base: (s.baseUrl ?? DEFAULT_BASE[s.provider]).replace(/\/+$/, '') };
}

function headers(c: ReturnType<typeof credentials>): Record<string, string> {
  if (c.provider === 'anthropic') return { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  // header rather than ?key= so the key never lands in a URL (logs, error messages)
  if (c.provider === 'gemini') return { 'x-goog-api-key': c.key, 'content-type': 'application/json' };
  return { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' };
}

/** Readable error from a failed API response (never echoes the key). */
async function apiError(res: Response, provider: AiProvider): Promise<Error> {
  const body = await res.text().catch(() => '');
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string };
    detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? detail);
  } catch {
    /* not JSON */
  }
  const name = PROVIDER_NAMES[provider];
  // Gemini answers an invalid key with 400 API_KEY_INVALID
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _]?key/i.test(detail))) return badRequest(t('{name} từ chối API key ({status}): {detail}', { name, status: res.status, detail }));
  if (res.status === 429) return badRequest(t('{name} báo vượt giới hạn hoặc hết credit (429): {detail}', { name, detail }));
  if (res.status === 404) return badRequest(t('{name} không tìm thấy model hoặc endpoint (404): {detail}', { name, detail }));
  return new Error(t('{name} lỗi {status}: {detail}', { name, status: res.status, detail }));
}

/** Validate key + model with the free model-list endpoint. */
export async function testAi(): Promise<{ ok: true; message: string }> {
  const c = credentials();
  const query = { anthropic: '?limit=100', gemini: '?pageSize=1000', openai: '' }[c.provider];
  const res = await fetch(`${c.base}/models${query}`, { headers: headers(c), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await apiError(res, c.provider);
  const body = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
  // Gemini lists { models: [{ name: "models/<id>" }] }, the others { data: [{ id }] }
  const list = body.models ? body.models.map((m) => m.name.replace(/^models\//, '')) : (body.data ?? []).map((m) => m.id);
  const found = list.includes(c.model);
  return {
    ok: true,
    message:
      found || !list.length
        ? t('Kết nối thành công, model {model} sẵn sàng', { model: c.model })
        : t('API key hợp lệ nhưng không thấy model "{model}" trong danh sách của tài khoản - kiểm tra lại tên model', { model: c.model }),
  };
}

// ---------------------------------------------------------------------------
// Article generation
// ---------------------------------------------------------------------------

export interface SiteContext {
  siteName?: string | null;
  tagline?: string | null;
  categories: string[];
  /** Published posts the article may link to (internal links). */
  posts: Array<{ title: string; url: string }>;
}

const ARTICLE_FIELDS = {
  title: 'Post title (H1), max 60 characters, focus keyword near the beginning',
  slug: 'URL slug: lowercase ASCII without diacritics, words joined by "-", contains the focus keyword, max 6 words',
  metaDescription: 'Meta description, 140-160 characters, contains the focus keyword and a call to action',
  focusKeyword: 'The focus keyword exactly as given',
  excerpt: '1-2 sentence summary of the post',
  contentHtml: 'Post body as HTML (rules in the system prompt). Do NOT repeat the title as H1.',
  tags: 'Array of 3-8 short tags (no commas inside a tag)',
} as const;

/** Example FAQ headings for the prompt, one per article language (prompt text, not UI). */
const FAQ_EXAMPLE = '"Câu hỏi thường gặp" / "Frequently asked questions"'; // i18n-ignore

function systemPrompt(req: ArticleRequest): string {
  const lang = req.language === 'vi' ? 'Vietnamese (natural, fluent Vietnamese with correct diacritics)' : 'English';
  return `You are a senior SEO content writer. You write original, genuinely helpful blog posts that rank on Google and follow Google's helpful-content and E-E-A-T guidelines.

Write in ${lang}. Tone: ${ARTICLE_TONES[req.tone]}.

SEO rules:
- The focus keyword appears in the title, in the first 100 words, in at least one H2, in the meta description and naturally through the text (about 1% density, never stuffed). Use the secondary keywords and close variations naturally.
- Structure: a short engaging introduction, then logical H2 sections with H3 sub-sections where useful, then a conclusion with a clear call to action.
- Short paragraphs (2-4 sentences), bullet or numbered lists where they help scanning, a comparison table when relevant, <strong> for key ideas.
${req.includeFaq ? `- End with an FAQ section: an H2 (e.g. ${FAQ_EXAMPLE}) followed by 3-5 questions as H3, each answered in a short paragraph.\n` : ''}- When an existing post of the site is clearly relevant, link to it with a descriptive anchor (2-3 internal links at most, only URLs from the list given). Never invent URLs; no external links.
- Do not invent statistics, studies, quotes, prices or brand claims. If a number is needed, keep it general or clearly approximate.

HTML rules for contentHtml: only use <h2> <h3> <h4> <p> <ul> <ol> <li> <strong> <em> <a href> <blockquote> <table> <thead> <tbody> <tr> <th> <td> <br>. No <h1>, no inline styles, no classes, no images, no scripts, no markdown. Lists must not be nested.

Target length: about ${req.words} words in the body.`;
}

function userPrompt(req: ArticleRequest, ctx: SiteContext): string {
  const lines = [
    `Topic: ${req.topic}`,
    `Focus keyword: ${req.keyword}`,
    req.secondaryKeywords.length ? `Secondary keywords: ${req.secondaryKeywords.join(', ')}` : '',
    req.audience ? `Target readers: ${req.audience}` : '',
    ctx.siteName ? `Website: ${ctx.siteName}${ctx.tagline ? ` - ${ctx.tagline}` : ''}` : '',
    ctx.categories.length ? `Site categories: ${ctx.categories.join(', ')}` : '',
    ctx.posts.length ? `Existing posts available for internal links:\n${ctx.posts.map((p) => `- ${p.title}: ${p.url}`).join('\n')}` : '',
    req.instructions ? `Additional instructions from the site owner:\n${req.instructions}` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** Read a server-sent-events stream, yielding the JSON payload of every `data:` line. */
async function* sse(res: Response): AsyncGenerator<unknown> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
}

type Progress = (chars: number) => void;

async function streamAnthropic(c: ReturnType<typeof credentials>, system: string, user: string, progress: Progress, signal: AbortSignal): Promise<string> {
  const properties = Object.fromEntries(
    Object.entries(ARTICLE_FIELDS).map(([k, d]) => [k, k === 'tags' ? { type: 'array', items: { type: 'string' }, description: d } : { type: 'string', description: d }]),
  );
  const res = await fetch(`${c.base}/messages`, {
    method: 'POST',
    headers: headers(c),
    signal,
    body: JSON.stringify({
      model: c.model,
      max_tokens: 16000,
      stream: true,
      system,
      messages: [{ role: 'user', content: user }],
      // a forced tool call guarantees one well-formed JSON object
      tools: [{ name: 'save_article', description: 'Save the finished blog post.', input_schema: { type: 'object', properties, required: Object.keys(ARTICLE_FIELDS) } }],
      tool_choice: { type: 'tool', name: 'save_article' },
    }),
  });
  if (!res.ok) throw await apiError(res, 'anthropic');
  let json = '';
  for await (const ev of sse(res)) {
    const e = ev as { type: string; delta?: { type?: string; partial_json?: string; stop_reason?: string }; error?: { message?: string } };
    if (e.type === 'error') throw new Error(`Anthropic: ${e.error?.message ?? t('lỗi không xác định')}`);
    if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
      json += e.delta.partial_json ?? '';
      progress(json.length);
    }
    if (e.type === 'message_delta' && e.delta?.stop_reason === 'max_tokens') throw new Error(t('Bài viết vượt quá giới hạn độ dài của model - hãy giảm số từ'));
  }
  return json;
}

async function streamOpenAi(c: ReturnType<typeof credentials>, system: string, user: string, progress: Progress, signal: AbortSignal): Promise<string> {
  const shape = Object.entries(ARTICLE_FIELDS)
    .map(([k, d]) => `  "${k}": ${k === 'tags' ? '[string]' : 'string'}  // ${d}`)
    .join('\n');
  const res = await fetch(`${c.base}/chat/completions`, {
    method: 'POST',
    headers: headers(c),
    signal,
    body: JSON.stringify({
      model: c.model,
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\nReply with one JSON object only, with exactly these keys:\n{\n${shape}\n}` },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw await apiError(res, 'openai');
  let text = '';
  for await (const ev of sse(res)) {
    const e = ev as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; error?: { message?: string } };
    if (e.error) throw new Error(`OpenAI: ${e.error.message ?? t('lỗi không xác định')}`);
    const choice = e.choices?.[0];
    if (choice?.delta?.content) {
      text += choice.delta.content;
      progress(text.length);
    }
    if (choice?.finish_reason === 'length') throw new Error(t('Bài viết vượt quá giới hạn độ dài của model - hãy giảm số từ'));
  }
  return text;
}

async function streamGemini(c: ReturnType<typeof credentials>, system: string, user: string, progress: Progress, signal: AbortSignal): Promise<string> {
  const properties = Object.fromEntries(
    Object.entries(ARTICLE_FIELDS).map(([k, d]) => [k, k === 'tags' ? { type: 'ARRAY', items: { type: 'STRING' }, description: d } : { type: 'STRING', description: d }]),
  );
  const res = await fetch(`${c.base}/models/${encodeURIComponent(c.model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: headers(c),
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // structured output: the reply is one JSON object matching the schema
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties, required: Object.keys(ARTICLE_FIELDS), propertyOrdering: Object.keys(ARTICLE_FIELDS) },
        maxOutputTokens: 32768,
      },
    }),
  });
  if (!res.ok) throw await apiError(res, 'gemini');
  let text = '';
  for await (const ev of sse(res)) {
    const e = ev as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    };
    if (e.error) throw new Error(`Gemini: ${e.error.message ?? t('lỗi không xác định')}`);
    if (e.promptFeedback?.blockReason) throw new Error(t('Gemini từ chối yêu cầu ({reason}) - thử diễn đạt lại chủ đề', { reason: e.promptFeedback.blockReason }));
    const cand = e.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (part.text && !part.thought) text += part.text;
    }
    progress(text.length);
    const reason = cand?.finishReason;
    if (reason === 'MAX_TOKENS') throw new Error(t('Bài viết vượt quá giới hạn độ dài của model - hãy giảm số từ'));
    if (reason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(reason)) throw new Error(t('Gemini dừng giữa chừng ({reason}) - thử lại hoặc đổi chủ đề', { reason }));
  }
  return text;
}

/** Ask the configured model for a complete SEO article, then validate and sanitize it. */
export async function generateArticle(req: ArticleRequest, ctx: SiteContext, log: HostLogger): Promise<Article> {
  const c = credentials();
  log(t('Đang viết bài bằng {model} ({provider})...', { model: c.model, provider: c.provider === 'openai' ? (c.baseUrl ?? 'OpenAI') : PROVIDER_NAMES[c.provider] }));
  let next = 2000;
  const progress: Progress = (n) => {
    if (n < next) return;
    log(t('Đã nhận {count} ký tự...', { count: n.toLocaleString(currentLang() === 'en' ? 'en-US' : 'vi-VN') }));
    next += 4000;
  };
  const started = Date.now();
  const signal = AbortSignal.timeout(15 * 60_000);
  const system = systemPrompt(req);
  const user = userPrompt(req, ctx);
  const stream = { anthropic: streamAnthropic, openai: streamOpenAi, gemini: streamGemini }[c.provider];
  const raw = await stream(c, system, user, progress, signal);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>;
  } catch {
    throw new Error(t('AI trả về dữ liệu không đúng định dạng JSON - hãy thử lại'));
  }
  const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).replace(/[,<>\s]+/g, ' ').trim()).filter(Boolean).slice(0, 20) : [];
  const parsed = articleSchema.safeParse({
    title: String(data.title ?? '').slice(0, 200),
    slug: slugify(String(data.slug ?? '') || String(data.title ?? '')),
    metaDescription: String(data.metaDescription ?? '').slice(0, 320),
    focusKeyword: String(data.focusKeyword ?? req.keyword).slice(0, 100),
    excerpt: String(data.excerpt ?? '').slice(0, 1000),
    contentHtml: sanitizeArticleHtml(String(data.contentHtml ?? '')),
    tags,
  });
  if (!parsed.success) throw new Error(t('AI trả về bài viết thiếu dữ liệu: {issues}', { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }));
  log(t('Hoàn tất sau {seconds}s: "{title}"', { seconds: ((Date.now() - started) / 1000).toFixed(0), title: parsed.data.title }));
  return parsed.data;
}
