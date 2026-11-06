import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_PUBLISH_MODES, AI_SCHEDULE_MAX_TOPICS, type AiPublishMode, type AiScheduleRun, type AiSchedulesResponse, type AiScheduleView, type Article, type Site, type WpCategory } from '@lares/shared';
import { del, fmtDate, get, post, put, type TaskInfo } from '../api';
import { getLang, t } from '../i18n';
import { ArticleEditor } from './ArticleEditor';
import { ArticleOptions, articleOptionsPayload, splitKeywords, type ArticleOptionsValue } from './ArticleOptions';
import { Badge, Check, ErrorBox, Field, TaskLog } from './ui';
import { WpAdminButton } from './WpAdminButton';

/** Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** Short weekday name in the UI language; 2026-11-01 is a Sunday, so day d of that week has getDay() = d. */
const dayName = (d: number) => new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'vi-VN', { weekday: 'short' }).format(new Date(2026, 10, 1 + d));

const utcLabel = (min: number) => {
  const abs = Math.abs(min);
  return `UTC${min < 0 ? '-' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
};

function timetable(s: Pick<AiScheduleView, 'days' | 'times'>) {
  const days = s.days.length === 7 ? t('Hằng ngày') : WEEK.filter((d) => s.days.includes(d)).map(dayName).join(', ');
  return `${days} · ${s.times.join(', ')}`;
}

interface TopicRow {
  /** Server id of a queued topic; none for a topic added in this form. */
  id?: string;
  key: string;
  topic: string;
  keyword: string;
  secondary: string;
}

interface Form {
  id: number | null;
  name: string;
  enabled: boolean;
  days: number[];
  times: string[];
  opts: ArticleOptionsValue;
  publish: AiPublishMode;
  categoryIds: number[];
  topics: TopicRow[];
}

let keySeq = 0;
const rowKey = () => `new-${++keySeq}`;

const emptyForm = (): Form => ({
  id: null,
  name: '',
  enabled: true,
  days: [1, 2, 3, 4, 5],
  times: ['08:00'],
  opts: { words: 1200, tone: 'chuyen-nghiep', language: getLang(), audience: '', instructions: '', includeFaq: true },
  publish: 'draft',
  categoryIds: [],
  topics: [{ key: rowKey(), topic: '', keyword: '', secondary: '' }],
});

const formOf = (s: AiScheduleView): Form => ({
  id: s.id,
  name: s.name,
  enabled: s.enabled,
  days: s.days,
  times: s.times,
  opts: { ...s.article, audience: s.article.audience ?? '', instructions: s.article.instructions ?? '' },
  publish: s.publish,
  categoryIds: s.categoryIds,
  topics: s.topics.map((x) => ({ id: x.id, key: x.id, topic: x.topic, keyword: x.keyword, secondary: x.secondaryKeywords.join(', ') })),
});

const payloadOf = (f: Form) => ({
  name: f.name,
  enabled: f.enabled,
  days: f.days,
  times: f.times,
  article: articleOptionsPayload(f.opts),
  publish: f.publish,
  categoryIds: f.categoryIds,
  topics: f.topics.map((x) => ({ id: x.id, topic: x.topic, keyword: x.keyword, secondaryKeywords: splitKeywords(x.secondary) })),
});

/** "Topic | focus keyword | secondary, keywords" per line. */
function parseLines(text: string): TopicRow[] {
  return text
    .split('\n')
    .map((l) => l.split('|').map((p) => p.trim()))
    .filter((p) => p[0])
    .map(([topic, keyword, secondary]) => ({ key: rowKey(), topic: topic!, keyword: keyword ?? '', secondary: secondary ?? '' }));
}

/** Site AI tab, "Schedules": queues of topics the panel writes and posts on a weekly timetable. */
export function AiSchedules({ site, categories }: { site: Site; categories: WpCategory[] }) {
  const qc = useQueryClient();
  const key = ['ai-schedules', site.id];
  const [editing, setEditing] = useState<Form | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ run: number; article: Article; cats: number[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<AiSchedulesResponse>(`/api/sites/${site.id}/ai/schedules`),
    refetchInterval: (query) => (query.state.data?.schedules.some((s) => s.runningTaskId) ? 5000 : 30_000),
  });
  const data = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  // an article being written by the timetable (or from another browser tab) is followed too
  const runningId = data?.schedules.find((s) => s.runningTaskId)?.runningTaskId;
  useEffect(() => {
    if (runningId) setTask(runningId);
  }, [runningId]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };

  const runNow = (s: AiScheduleView) =>
    run(async () => {
      if (!confirm(t('Viết ngay chủ đề đầu tiên của lịch "{name}"? Bài sẽ được đăng theo cài đặt của lịch.', { name: s.name }))) return;
      setTask((await post<TaskInfo>(`/api/ai/schedules/${s.id}/run`)).id);
      refresh();
    });

  const toggle = (s: AiScheduleView, enabled: boolean) =>
    run(async () => {
      await put(`/api/ai/schedules/${s.id}`, { ...payloadOf(formOf(s)), enabled });
      refresh();
    });

  const remove = (s: AiScheduleView) =>
    run(async () => {
      if (!confirm(t('Xoá lịch "{name}" cùng {n} chủ đề còn trong hàng đợi?', { name: s.name, n: s.topics.length }))) return;
      await del(`/api/ai/schedules/${s.id}`);
      refresh();
    });

  const openArticle = (r: AiScheduleRun) =>
    run(async () => {
      const article = await get<Article>(`/api/ai/schedule-runs/${r.id}/article`);
      setOpened({ run: r.id, article, cats: data?.schedules.find((s) => s.id === r.scheduleId)?.categoryIds ?? [] });
    });

  if (editing) {
    return (
      <ScheduleForm
        site={site}
        initial={editing}
        categories={categories}
        utc={data ? utcLabel(data.serverUtcOffset) : ''}
        onClose={(saved) => {
          setEditing(null);
          if (saved) refresh();
        }}
      />
    );
  }

  return (
    <>
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Lịch viết bài tự động')}</h2>
          <button className="btn primary" onClick={() => setEditing(emptyForm())}>
            {t('Thêm lịch')}
          </button>
        </div>
        <div className="sub">
          {t('Mỗi lịch có một danh sách chủ đề. Đến giờ chạy, AI viết chủ đề đầu tiên rồi lưu nháp hoặc đăng lên WordPress, sau đó bỏ chủ đề đó khỏi danh sách.')}{' '}
          {data && t('Giờ theo giờ máy chủ ({utc}).', { utc: utcLabel(data.serverUtcOffset) })}
        </div>
        <ErrorBox error={error ?? q.error} />
        {data && data.schedules.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Lịch')}</th>
                  <th>{t('Thời gian chạy')}</th>
                  <th>{t('Chủ đề chờ')}</th>
                  <th>{t('Lần tới')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.schedules.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Check checked={s.enabled} onChange={(v) => toggle(s, v)}>
                        <strong>{s.name}</strong>
                      </Check>
                      <div className="sub">{s.publish === 'publish' ? t('Đăng công khai ngay') : t('Lưu nháp để duyệt')}</div>
                    </td>
                    <td>{timetable(s)}</td>
                    <td>{s.topics.length ? s.topics.length : <Badge tone="warn">{t('Hết chủ đề')}</Badge>}</td>
                    <td>{s.runningTaskId ? <Badge tone="info">{t('đang viết')}</Badge> : s.nextRunAt ? fmtDate(s.nextRunAt) : '—'}</td>
                    <td>
                      <div className="row end">
                        <button className="btn sm" disabled={!!s.runningTaskId || !s.topics.length} onClick={() => runNow(s)}>
                          {t('Viết ngay')}
                        </button>
                        <button className="btn sm" onClick={() => setEditing(formOf(s))}>
                          {t('Sửa')}
                        </button>
                        <button className="btn sm danger" disabled={!!s.runningTaskId} onClick={() => remove(s)}>
                          {t('Xoá')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.schedules.length === 0 && <div className="empty">{t('Chưa có lịch nào. Thêm lịch để AI tự viết bài theo danh sách chủ đề của bạn.')}</div>}
        {task && <TaskLog key={task} taskId={task} onDone={refresh} />}
      </div>

      {data && data.runs.length > 0 && (
        <div className="card stack">
          <h2>{t('Bài đã viết tự động')}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Thời gian')}</th>
                  <th>{t('Bài viết')}</th>
                  <th>{t('Trạng thái')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.startedAt)}</td>
                    <td>
                      {r.title ?? r.topic.topic}
                      <div className="sub">
                        {r.scheduleName} · {r.topic.keyword}
                        {r.trigger === 'manual' && ` · ${t('chạy tay')}`}
                      </div>
                      {r.error && <div className="sub err-text">{r.error}</div>}
                    </td>
                    <td>
                      {r.status === 'running' ? (
                        <Badge tone="info">{t('đang viết')}</Badge>
                      ) : r.status === 'failed' ? (
                        <Badge tone="err">{t('lỗi')}</Badge>
                      ) : r.post?.status === 'publish' ? (
                        <Badge tone="ok">{t('đã đăng')}</Badge>
                      ) : (
                        <Badge tone="warn">{t('bản nháp')}</Badge>
                      )}
                    </td>
                    <td>
                      <div className="row end">
                        {r.post && (
                          <>
                            <a className="btn sm" href={r.post.url} target="_blank" rel="noreferrer">
                              {t('Xem bài ↗')}
                            </a>
                            <WpAdminButton siteId={site.id} target={`post.php?post=${r.post.id}&action=edit`} className="btn sm">
                              {t('Sửa trong WordPress ↗')}
                            </WpAdminButton>
                          </>
                        )}
                        {!r.post && r.hasArticle && r.status !== 'running' && (
                          <button className="btn sm" onClick={() => openArticle(r)}>
                            {t('Mở bài để đăng')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {opened && <ArticleEditor key={opened.run} site={site} initial={opened.article} categories={categories} initialCats={opened.cats} />}
    </>
  );
}

function ScheduleForm({ site, initial, categories, utc, onClose }: { site: Site; initial: Form; categories: WpCategory[]; utc: string; onClose: (saved: boolean) => void }) {
  const [f, setF] = useState<Form>(initial);
  const [bulk, setBulk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const room = AI_SCHEDULE_MAX_TOPICS - f.topics.length;

  const setTopic = (i: number, patch: Partial<TopicRow>) => setF({ ...f, topics: f.topics.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addTopics = (rows: TopicRow[]) => setF({ ...f, topics: [...f.topics.filter((x) => x.topic || x.keyword || x.secondary), ...rows].slice(0, AI_SCHEDULE_MAX_TOPICS) });
  const move = (i: number, by: number) => {
    const topics = [...f.topics];
    const [x] = topics.splice(i, 1);
    topics.splice(i + by, 0, x!);
    setF({ ...f, topics });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (f.id) await put(`/api/ai/schedules/${f.id}`, payloadOf(f));
      else await post(`/api/sites/${site.id}/ai/schedules`, payloadOf(f));
      onClose(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>{f.id ? t('Sửa lịch viết bài') : t('Thêm lịch viết bài')}</h2>
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label={t('Tên lịch')}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Blog hằng tuần')} required maxLength={100} />
        </Field>
      </div>
      <Check checked={f.enabled} onChange={(enabled) => setF({ ...f, enabled })}>
        <span>
          {t('Bật lịch')}
          <span className="hint"> - {t('bỏ chọn để tạm dừng; chủ đề và cài đặt được giữ nguyên')}</span>
        </span>
      </Check>

      <h3>{t('Thời gian chạy')}</h3>
      <div className="field">
        <span className="label">{t('Ngày trong tuần')}</span>
        <div className="row">
          {WEEK.map((d) => (
            <Check key={d} checked={f.days.includes(d)} onChange={(v) => setF({ ...f, days: v ? [...f.days, d] : f.days.filter((x) => x !== d) })}>
              {dayName(d)}
            </Check>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{utc ? t('Giờ chạy (giờ máy chủ, {utc})', { utc }) : t('Giờ chạy (giờ máy chủ)')}</span>
        <div className="row">
          {f.times.map((time, i) => (
            <span key={i} className="row" style={{ gap: 4 }}>
              <input type="time" value={time} required style={{ width: 120 }} onChange={(e) => setF({ ...f, times: f.times.map((x, j) => (j === i ? e.target.value : x)) })} />
              {f.times.length > 1 && (
                <button type="button" className="icon-btn" aria-label={t('Bỏ giờ này')} title={t('Bỏ giờ này')} onClick={() => setF({ ...f, times: f.times.filter((_, j) => j !== i) })}>
                  ×
                </button>
              )}
            </span>
          ))}
          {f.times.length < 6 && (
            <button type="button" className="btn sm" onClick={() => setF({ ...f, times: [...f.times, '17:00'] })}>
              {t('+ Thêm giờ')}
            </button>
          )}
        </div>
        <span className="hint">{t('Mỗi giờ chạy viết một bài (tối đa 6 bài mỗi ngày). Nếu panel tắt đúng giờ chạy, bài được viết ngay khi panel bật lại trong ngày.')}</span>
      </div>

      <h3>
        {t('Chủ đề')} ({f.topics.length}/{AI_SCHEDULE_MAX_TOPICS})
      </h3>
      <div className="sub">{t('Viết lần lượt từ trên xuống; chủ đề đã viết được bỏ khỏi danh sách.')}</div>
      <div className="stack" style={{ gap: 8 }}>
        {f.topics.map((x, i) => (
          <div key={x.key} className="topic-row">
            <span className="num">{i + 1}.</span>
            <input value={x.topic} onChange={(e) => setTopic(i, { topic: e.target.value })} placeholder={t('Chủ đề bài viết')} aria-label={t('Chủ đề bài viết')} required minLength={3} maxLength={500} />
            <input value={x.keyword} onChange={(e) => setTopic(i, { keyword: e.target.value })} placeholder={t('Từ khoá chính')} aria-label={t('Từ khoá chính')} required minLength={2} maxLength={100} />
            <input value={x.secondary} onChange={(e) => setTopic(i, { secondary: e.target.value })} placeholder={t('Từ khoá phụ (cách nhau dấu phẩy)')} aria-label={t('Từ khoá phụ')} />
            <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button type="button" className="icon-btn neutral" aria-label={t('Lên')} title={t('Lên')} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" aria-label={t('Bỏ chủ đề')} title={t('Bỏ chủ đề')} onClick={() => setF({ ...f, topics: f.topics.filter((_, j) => j !== i) })}>
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn sm" disabled={room <= 0} onClick={() => setF({ ...f, topics: [...f.topics, { key: rowKey(), topic: '', keyword: '', secondary: '' }] })}>
          {t('+ Thêm chủ đề')}
        </button>
        <button type="button" className="btn sm" disabled={room <= 0} onClick={() => setBulk(bulk === null ? '' : null)}>
          {t('Dán nhiều chủ đề')}
        </button>
      </div>
      {bulk !== null && (
        <div className="stack" style={{ gap: 8 }}>
          <Field label={t('Mỗi dòng một chủ đề')} hint={t('Dạng: Chủ đề | từ khoá chính | từ khoá phụ 1, từ khoá phụ 2')}>
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} placeholder={t('Kinh nghiệm mua căn hộ lần đầu | mua căn hộ chung cư | vay mua nhà, kinh nghiệm mua nhà')} />
          </Field>
          <div className="row end">
            <button
              type="button"
              className="btn sm"
              disabled={!bulk.trim()}
              onClick={() => {
                addTopics(parseLines(bulk));
                setBulk(null);
              }}
            >
              {t('Thêm vào danh sách')}
            </button>
          </div>
        </div>
      )}

      <h3>{t('Cài đặt bài viết')}</h3>
      <ArticleOptions value={f.opts} onChange={(opts) => setF({ ...f, opts })} />

      <h3>{t('Đăng lên WordPress')}</h3>
      <div className="stack" style={{ gap: 8 }}>
        {(Object.keys(AI_PUBLISH_MODES) as AiPublishMode[]).map((m) => (
          <label key={m} className="check">
            <input type="radio" name="publish" checked={f.publish === m} onChange={() => setF({ ...f, publish: m })} />
            <span>
              {t(AI_PUBLISH_MODES[m])}
              <span className="hint"> - {m === 'draft' ? t('bạn đọc lại rồi bấm Đăng trong WordPress (nên dùng)') : t('bài lên site ngay, không qua duyệt')}</span>
            </span>
          </label>
        ))}
      </div>
      {categories.length > 0 && (
        <div className="field">
          <span className="label">{t('Danh mục')}</span>
          <div className="row">
            {categories.map((c) => (
              <Check key={c.id} checked={f.categoryIds.includes(c.id)} onChange={(v) => setF({ ...f, categoryIds: v ? [...f.categoryIds, c.id] : f.categoryIds.filter((x) => x !== c.id) })}>
                {c.name}
              </Check>
            ))}
          </div>
        </div>
      )}
      <div className="row end">
        <button type="button" className="btn" onClick={() => onClose(false)}>
          {t('Huỷ')}
        </button>
        <button className="btn primary" disabled={busy}>
          {t('Lưu lịch')}
        </button>
      </div>
    </form>
  );
}
