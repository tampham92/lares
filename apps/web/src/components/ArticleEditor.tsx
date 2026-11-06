import { useMemo, useState } from 'react';
import type { Article, PublishedPost, Site, WpCategory } from '@lares/shared';
import { post } from '../api';
import { t } from '../i18n';
import { seoChecks } from '../seo';
import { splitKeywords } from './ArticleOptions';
import { Alert, Badge, Check, ErrorBox, Field, Tabs } from './ui';
import { WpAdminButton } from './WpAdminButton';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Article rendered like a blog page; sandboxed with no permissions, so edited HTML can never run script. */
function previewDoc(a: Article) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:16px/1.75 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;background:#fff;max-width:760px;margin:0 auto;padding:24px 20px}
h1{font-size:30px;line-height:1.3;margin:0 0 16px}h2{font-size:23px;margin:32px 0 10px}h3{font-size:19px;margin:24px 0 8px}
a{color:#2563eb}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left}th{background:#f8fafc}
blockquote{border-left:4px solid #e5e7eb;margin:16px 0;padding:4px 16px;color:#4b5563}
</style></head><body><h1>${escapeHtml(a.title)}</h1>${a.contentHtml}</body></html>`;
}

/** Review an AI article (SEO checks, preview, HTML) and post it to WordPress. */
export function ArticleEditor({ site, initial, categories, initialCats = [] }: { site: Site; initial: Article; categories: WpCategory[]; initialCats?: number[] }) {
  const [a, setA] = useState<Article>(initial);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [cats, setCats] = useState<number[]>(initialCats);
  const [view, setView] = useState<'preview' | 'html'>('preview');
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<PublishedPost | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seo = useMemo(() => seoChecks(a), [a]);
  const passed = seo.checks.filter((c) => c.ok).length;

  const publish = async (status: 'draft' | 'publish') => {
    if (status === 'publish' && !confirm(t('Đăng bài này công khai lên website?'))) return;
    setError(null);
    setBusy(true);
    try {
      const post_ = await post<PublishedPost>(`/api/sites/${site.id}/wp/posts`, {
        ...a,
        tags: splitKeywords(tags),
        categoryIds: cats,
        status,
      });
      setPublished(post_);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid ai-editor">
      <div className="card stack">
        <h2>{t('Bài viết')}</h2>
        <ErrorBox error={error} />
        <Field label={t('Tiêu đề ({n}/60)', { n: a.title.length })}>
          <input value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label={t('Slug (đường dẫn)')}>
            <input value={a.slug} onChange={(e) => setA({ ...a, slug: e.target.value })} className="mono" />
          </Field>
          <Field label={t('Từ khoá chính')}>
            <input value={a.focusKeyword} onChange={(e) => setA({ ...a, focusKeyword: e.target.value })} />
          </Field>
        </div>
        <Field label={`Meta description (${a.metaDescription.length}/160)`} hint={t('Hiển thị dưới tiêu đề trên Google. Được ghi vào Yoast SEO / Rank Math nếu site có cài.')}>
          <textarea value={a.metaDescription} onChange={(e) => setA({ ...a, metaDescription: e.target.value })} rows={2} className="prose-input" />
        </Field>
        <Field label={t('Thẻ (tags)')} hint={t('Cách nhau bởi dấu phẩy')}>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {categories.length > 0 && (
          <div className="field">
            {t('Danh mục')}
            <div className="row">
              {categories.map((c) => (
                <Check key={c.id} checked={cats.includes(c.id)} onChange={(v) => setCats(v ? [...cats, c.id] : cats.filter((x) => x !== c.id))}>
                  {c.name}
                </Check>
              ))}
            </div>
          </div>
        )}
        <Tabs
          tabs={[
            ['preview', t('Xem trước')],
            ['html', t('Sửa HTML')],
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'preview' ? (
          <iframe className="article-preview" title={t('Xem trước bài viết')} sandbox="" srcDoc={previewDoc(a)} />
        ) : (
          <textarea className="mono article-html" value={a.contentHtml} onChange={(e) => setA({ ...a, contentHtml: e.target.value })} />
        )}
        {published ? (
          <Alert tone="ok">
            {published.status === 'publish' ? t('Đã đăng bài #{id}.', { id: published.id }) : t('Đã lưu bản nháp #{id}.', { id: published.id })}
            <div className="row" style={{ marginTop: 8 }}>
              <a className="btn sm" href={published.url} target="_blank" rel="noreferrer">
                {t('Xem bài ↗')}
              </a>
              <WpAdminButton siteId={site.id} target={`post.php?post=${published.id}&action=edit`} className="btn sm primary">
                {t('Sửa trong WordPress ↗')}
              </WpAdminButton>
            </div>
          </Alert>
        ) : (
          <div className="row end">
            <button className="btn" disabled={busy} onClick={() => publish('draft')}>
              {t('Lưu nháp vào WordPress')}
            </button>
            <button className="btn primary" disabled={busy} onClick={() => publish('publish')}>
              {t('Đăng bài')}
            </button>
          </div>
        )}
      </div>
      <div className="card stack seo-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Kiểm tra SEO')}</h2>
          <Badge tone={passed >= seo.checks.length - 1 ? 'ok' : passed >= seo.checks.length - 4 ? 'warn' : 'err'}>
            {passed}/{seo.checks.length}
          </Badge>
        </div>
        <ul className="seo-list">
          {seo.checks.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
              {c.label}
            </li>
          ))}
        </ul>
        <div className="sub">{t('Số liệu cập nhật ngay khi bạn sửa bài. Nên đọc lại và bổ sung kinh nghiệm thực tế, hình ảnh trước khi đăng.')}</div>
      </div>
    </div>
  );
}
