import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ARTICLE_TONES, LANG_LABELS, msg, type AiSettingsView, type Article, type ArticleTone, type Lang, type PublishedPost, type Site, type WpCategory } from '@lares/shared';
import { errMsg, get, post, type TaskInfo } from '../api';
import { getLang, t } from '../i18n';
import { seoChecks } from '../seo';
import { Alert, Badge, Check, ErrorBox, Field, Tabs, TaskLog } from './ui';
import { WpAdminButton } from './WpAdminButton';

const LENGTHS = [
  [800, msg('Ngắn (~800 từ)')],
  [1200, msg('Vừa (~1.200 từ)')],
  [1800, msg('Dài (~1.800 từ)')],
  [2500, msg('Chuyên sâu (~2.500 từ)')],
] as const;

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

export function AiWriter({ site }: { site: Site }) {
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => get<AiSettingsView>('/api/settings/ai') });
  const info = useQuery({ queryKey: ['wp-info', site.id], queryFn: () => get<{ name: string; categories: WpCategory[] }>(`/api/sites/${site.id}/wp/info`), retry: false });
  const [req, setReq] = useState({ topic: '', keyword: '', secondary: '', words: 1200, tone: 'chuyen-nghiep' as ArticleTone, language: getLang(), audience: '', instructions: '', includeFaq: true });
  const [task, setTask] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<unknown>(null);

  const generate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    try {
      const created = await post<TaskInfo>(`/api/sites/${site.id}/ai/article`, {
        ...req,
        secondaryKeywords: req.secondary
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        audience: req.audience || undefined,
        instructions: req.instructions || undefined,
      });
      setTask(created.id);
      setRunning(true);
    } catch (err) {
      setError(err);
    }
  };

  if (settings.data && !settings.data.hasKey) {
    return (
      <div className="card stack" style={{ maxWidth: 640 }}>
        <h2>{t('Viết bài bằng AI')}</h2>
        <Alert tone="warn">
          {t('Chưa có API key AI. Thêm key Claude (Anthropic) hoặc OpenAI trong')} <Link to="/settings">{t('Cài đặt')}</Link> {t('để bắt đầu.')}
        </Alert>
      </div>
    );
  }

  return (
    <>
      <form className="card stack" onSubmit={generate}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Viết bài chuẩn SEO bằng AI')}</h2>
          {settings.data && <Badge tone="info">{settings.data.model}</Badge>}
        </div>
        <ErrorBox error={error} />
        {info.error && <Alert tone="warn">{t('Không đọc được dữ liệu WordPress ({error}). Vẫn viết được bài, nhưng cần wp-cli để đăng.', { error: errMsg(info.error) })}</Alert>}
        <Field label={t('Chủ đề bài viết')} hint={t('Mô tả ngắn nội dung muốn viết, ví dụ: Kinh nghiệm mua căn hộ chung cư lần đầu cho người trẻ')}>
          <input value={req.topic} onChange={(e) => setReq({ ...req, topic: e.target.value })} required minLength={3} />
        </Field>
        <div className="form-grid">
          <Field label={t('Từ khoá chính (focus keyword)')}>
            <input value={req.keyword} onChange={(e) => setReq({ ...req, keyword: e.target.value })} placeholder={t('mua căn hộ chung cư')} required minLength={2} />
          </Field>
          <Field label={t('Từ khoá phụ')} hint={t('Cách nhau bởi dấu phẩy')}>
            <input value={req.secondary} onChange={(e) => setReq({ ...req, secondary: e.target.value })} placeholder={t('kinh nghiệm mua nhà, vay mua nhà')} />
          </Field>
          <Field label={t('Độ dài')}>
            <select value={req.words} onChange={(e) => setReq({ ...req, words: Number(e.target.value) })}>
              {LENGTHS.map(([n, l]) => (
                <option key={n} value={n}>
                  {t(l)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Giọng văn')}>
            <select value={req.tone} onChange={(e) => setReq({ ...req, tone: e.target.value as ArticleTone })}>
              {Object.entries(ARTICLE_TONES).map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Ngôn ngữ')}>
            <select value={req.language} onChange={(e) => setReq({ ...req, language: e.target.value as Lang })}>
              <option value="vi">{LANG_LABELS.vi}</option>
              <option value="en">{LANG_LABELS.en}</option>
            </select>
          </Field>
          <Field label={t('Độc giả mục tiêu (tuỳ chọn)')}>
            <input value={req.audience} onChange={(e) => setReq({ ...req, audience: e.target.value })} placeholder={t('Người đi làm 25–35 tuổi ở TP.HCM')} />
          </Field>
        </div>
        <Field label={t('Yêu cầu thêm (tuỳ chọn)')} hint={t('Ý chính cần có, thông tin về sản phẩm/dịch vụ của bạn, điều cần tránh...')}>
          <textarea value={req.instructions} onChange={(e) => setReq({ ...req, instructions: e.target.value })} rows={3} className="prose-input" />
        </Field>
        <Check checked={req.includeFaq} onChange={(v) => setReq({ ...req, includeFaq: v })}>
          {t('Thêm mục Câu hỏi thường gặp (FAQ)')}
        </Check>
        <div className="row end">
          <button className="btn primary" disabled={running}>
            {running ? t('AI đang viết…') : article ? t('Viết lại bài mới') : t('Viết bài')}
          </button>
        </div>
        {task && (
          <TaskLog
            taskId={task}
            onDone={(done) => {
              setRunning(false);
              if (done.status === 'completed') setArticle(done.result as Article);
            }}
          />
        )}
      </form>
      {article && <ArticleEditor key={task} site={site} initial={article} categories={info.data?.categories ?? []} />}
    </>
  );
}

function ArticleEditor({ site, initial, categories }: { site: Site; initial: Article; categories: WpCategory[] }) {
  const [a, setA] = useState<Article>(initial);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [cats, setCats] = useState<number[]>([]);
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
        tags: tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
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
