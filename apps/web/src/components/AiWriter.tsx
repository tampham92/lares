import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AiSettingsView, Article, Site, WpCategory } from '@lares/shared';
import { errMsg, get, post, type TaskInfo } from '../api';
import { getLang, t } from '../i18n';
import { AiSchedules } from './AiSchedules';
import { ArticleEditor } from './ArticleEditor';
import { ArticleOptions, articleOptionsPayload, splitKeywords, type ArticleOptionsValue } from './ArticleOptions';
import { Alert, Badge, ErrorBox, Field, Tabs, TaskLog } from './ui';

type View = 'write' | 'schedules';

export function AiWriter({ site }: { site: Site }) {
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => get<AiSettingsView>('/api/settings/ai') });
  const info = useQuery({ queryKey: ['wp-info', site.id], queryFn: () => get<{ name: string; categories: WpCategory[] }>(`/api/sites/${site.id}/wp/info`), retry: false });
  // ?ai=schedules: links from the notification bell
  const [view, setView] = useState<View>(useSearchParams()[0].get('ai') === 'schedules' ? 'schedules' : 'write');

  if (settings.data && !settings.data.hasKey) {
    return (
      <div className="card stack" style={{ maxWidth: 640 }}>
        <h2>{t('Viết bài bằng AI')}</h2>
        <Alert tone="warn">
          {t('Chưa có API key AI. Thêm key Claude (Anthropic) hoặc OpenAI trong')} <Link to="/settings?tab=integrations">{t('Cài đặt')}</Link> {t('để bắt đầu.')}
        </Alert>
      </div>
    );
  }

  const categories = info.data?.categories ?? [];
  return (
    <div className="stack">
      <Tabs
        tabs={[
          ['write', t('Viết ngay')],
          ['schedules', t('Lịch tự động')],
        ]}
        value={view}
        onChange={setView}
      />
      {info.error && <Alert tone="warn">{t('Không đọc được dữ liệu WordPress ({error}). Vẫn viết được bài, nhưng cần wp-cli để đăng.', { error: errMsg(info.error) })}</Alert>}
      {view === 'write' ? <WriteNow site={site} model={settings.data?.model} categories={categories} /> : <AiSchedules site={site} categories={categories} />}
    </div>
  );
}

function WriteNow({ site, model, categories }: { site: Site; model?: string; categories: WpCategory[] }) {
  const [req, setReq] = useState({ topic: '', keyword: '', secondary: '' });
  const [opts, setOpts] = useState<ArticleOptionsValue>({ words: 1200, tone: 'chuyen-nghiep', language: getLang(), audience: '', instructions: '', includeFaq: true });
  const [task, setTask] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<unknown>(null);

  const generate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    try {
      const created = await post<TaskInfo>(`/api/sites/${site.id}/ai/article`, {
        ...articleOptionsPayload(opts),
        topic: req.topic,
        keyword: req.keyword,
        secondaryKeywords: splitKeywords(req.secondary),
      });
      setTask(created.id);
      setRunning(true);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <form className="card stack" onSubmit={generate}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Viết bài chuẩn SEO bằng AI')}</h2>
          {model && <Badge tone="info">{model}</Badge>}
        </div>
        <ErrorBox error={error} />
        <Field label={t('Chủ đề bài viết')} hint={t('Mô tả ngắn nội dung muốn viết, ví dụ: Kinh nghiệm mua căn hộ chung cư lần đầu cho người trẻ')}>
          <input value={req.topic} onChange={(e) => setReq({ ...req, topic: e.target.value })} required minLength={3} />
        </Field>
        <ArticleOptions value={opts} onChange={setOpts}>
          <Field label={t('Từ khoá chính (focus keyword)')}>
            <input value={req.keyword} onChange={(e) => setReq({ ...req, keyword: e.target.value })} placeholder={t('mua căn hộ chung cư')} required minLength={2} />
          </Field>
          <Field label={t('Từ khoá phụ')} hint={t('Cách nhau bởi dấu phẩy')}>
            <input value={req.secondary} onChange={(e) => setReq({ ...req, secondary: e.target.value })} placeholder={t('kinh nghiệm mua nhà, vay mua nhà')} />
          </Field>
        </ArticleOptions>
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
      {article && <ArticleEditor key={task} site={site} initial={article} categories={categories} />}
    </>
  );
}
