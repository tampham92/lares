/** Tags an AI-written post may contain; everything else is dropped (attributes too, except a safe href). */
const ALLOWED_TAGS = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br']);
/** Removed together with their content. */
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button|head|title)\b[\s\S]*?<\/\1\s*>/gi;
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const escapeText = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

function safeHref(attrs: string): string | null {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const url = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  // absolute http(s) or site-relative ("/path", not protocol-relative "//host")
  return /^(https?:\/\/|\/(?!\/))[^\s"'<>`\\]*$/i.test(url) ? url : null;
}

/**
 * Allow-list sanitizer for model output that becomes post content. Text between tags is
 * escaped, so a malformed tag can never turn into markup (WordPress' kses runs again on insert).
 */
export function sanitizeArticleHtml(html: string): string {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    out += escapeText(src.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[0].startsWith('</');
    let tag = m[1]!.toLowerCase();
    if (tag === 'h1') tag = 'h2'; // the post title is the only H1
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (tag === 'br') out += closing ? '' : '<br>';
    else if (closing) out += `</${tag}>`;
    else if (tag === 'a') {
      const href = safeHref(m[2] ?? '');
      out += href ? `<a href="${href}">` : '<a>';
    } else out += `<${tag}>`;
  }
  out += escapeText(src.slice(last));
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** "Hướng dẫn chọn Đất nền 2025!" -> "huong-dan-chon-dat-nen-2025" */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190)
    .replace(/-+$/, '');
}
