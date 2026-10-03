import type { Article } from '@tpanel/shared';

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190);

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface SeoCheck {
  ok: boolean;
  label: string;
}

/** The on-page checks Yoast / Rank Math run, computed live while the article is edited. */
export function seoChecks(a: Article): { checks: SeoCheck[]; words: number } {
  const kw = a.focusKeyword.trim().toLowerCase();
  const text = plain(a.contentHtml).toLowerCase();
  const words = text ? text.split(' ').length : 0;
  const hits = kw ? text.split(kw).length - 1 : 0;
  const density = words ? ((hits * kw.split(/\s+/).length) / words) * 100 : 0;
  const h2 = [...a.contentHtml.matchAll(/<h2>([\s\S]*?)<\/h2>/gi)].map((m) => plain(m[1] ?? '').toLowerCase());
  const links = (a.contentHtml.match(/<a href=/gi) ?? []).length;
  const meta = a.metaDescription.length;
  const has = (s: string) => !!kw && s.toLowerCase().includes(kw);
  return {
    words,
    checks: [
      { ok: a.title.length > 0 && a.title.length <= 60, label: `Tiêu đề ${a.title.length}/60 ký tự` },
      { ok: has(a.title), label: 'Từ khoá chính có trong tiêu đề' },
      { ok: meta >= 120 && meta <= 160, label: `Meta description ${meta} ký tự (nên 120–160)` },
      { ok: has(a.metaDescription), label: 'Từ khoá có trong meta description' },
      { ok: !!kw && a.slug.includes(slugify(kw)), label: 'Từ khoá có trong slug' },
      { ok: has(text.split(' ').slice(0, 100).join(' ')), label: 'Từ khoá xuất hiện trong 100 từ đầu' },
      { ok: h2.some(has), label: 'Từ khoá có trong ít nhất một thẻ H2' },
      { ok: h2.length >= 3, label: `${h2.length} mục H2 (nên ≥ 3)` },
      { ok: words >= 600, label: `${words.toLocaleString('vi-VN')} từ (nên ≥ 600)` },
      { ok: density >= 0.5 && density <= 2.5, label: `Mật độ từ khoá ${density.toFixed(1)}% (nên 0,5–2,5%)` },
      { ok: links > 0, label: `${links} liên kết nội bộ` },
    ],
  };
}
