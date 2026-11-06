import { randomUUID } from 'node:crypto';
import { msg, type AiRunTrigger, type AiScheduleInput, type AiScheduleRun, type AiSchedulesResponse, type AiScheduleView, type AiTopic, type Article, type PublishedPost, type Site } from '@lares/shared';
import { db, nowIso } from '../db/index.js';
import { t, tDefault } from '../i18n/index.js';
import { conflict, errorMessage, notFound } from '../lib/errors.js';
import { generateArticle } from './ai.js';
import { dueSlot, latestSlot, mergeTopics, nextRunAt } from './aiSchedulePolicy.js';
import * as backups from './backups.js';
import type { HostLogger } from './host.js';
import { notify } from './notifications.js';
import { assertNotQuarantined } from './securityStore.js';
import * as sites from './sites.js';
import { startTask, type TaskInfo } from './tasks.js';
import { aiSiteContext, publishArticle } from './wpContent.js';

/*
 * Scheduled AI articles: each schedule holds a queue of topics and a weekly timetable. At every time
 * slot the first topic is written with the panel's AI settings and posted to WordPress (draft or
 * published). Runs are sequential (one article at a time for the whole panel) so a busy timetable
 * never fires several long, paid AI calls at once.
 */

interface ScheduleRow {
  id: number;
  site_id: number;
  name: string;
  enabled: number;
  config_json: string;
  topics_json: string;
  last_slot: string | null;
  created_at: string;
}

interface RunRow {
  id: number;
  schedule_id: number;
  schedule_name: string;
  trigger: AiRunTrigger;
  status: AiScheduleRun['status'];
  topic_json: string;
  title: string | null;
  has_article: number;
  post_json: string | null;
  error: string | null;
  task_id: string | null;
  started_at: string;
  finished_at: string | null;
}

type StoredConfig = Omit<AiScheduleInput, 'name' | 'enabled' | 'topics'>;

const MAX_SCHEDULES_PER_SITE = 20;
/** Runs kept per schedule (with their article). */
const KEEP_RUNS = 50;
/** How long a written article waits for a backup/restore/update of the site before giving up. */
const SITE_BUSY_WAIT_MS = 60 * 60_000;

/** scheduleId -> task writing its article right now. */
const running = new Map<number, string>();
let ticking = false;

const configOf = (r: ScheduleRow) => JSON.parse(r.config_json) as StoredConfig;
const topicsOf = (r: ScheduleRow) => JSON.parse(r.topics_json) as AiTopic[];

function row(id: number): ScheduleRow {
  const r = db.prepare('SELECT * FROM ai_schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  if (!r) throw notFound(t('Không tìm thấy lịch viết bài'));
  return r;
}

function toView(r: ScheduleRow, now = new Date()): AiScheduleView {
  const cfg = configOf(r);
  const topics = topicsOf(r);
  const enabled = r.enabled === 1;
  const next = enabled && topics.length ? nextRunAt(now, cfg.days, cfg.times, r.last_slot) : null;
  return { id: r.id, siteId: r.site_id, name: r.name, enabled, ...cfg, topics, nextRunAt: next?.toISOString() ?? null, runningTaskId: running.get(r.id) ?? null, createdAt: r.created_at };
}

function toRun(r: RunRow): AiScheduleRun {
  return {
    id: r.id,
    scheduleId: r.schedule_id,
    scheduleName: r.schedule_name,
    trigger: r.trigger,
    status: r.status,
    topic: JSON.parse(r.topic_json),
    title: r.title,
    hasArticle: r.has_article === 1,
    post: r.post_json ? (JSON.parse(r.post_json) as PublishedPost) : null,
    error: r.error,
    taskId: r.task_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

const splitConfig = (input: AiScheduleInput): StoredConfig => ({ days: input.days, times: input.times, article: input.article, publish: input.publish, categoryIds: input.categoryIds });

/** Later of two slot keys (they sort as strings). */
const maxSlot = (a: string | null, b: string | null) => ((a ?? '') > (b ?? '') ? a : b);

// ---- CRUD -----------------------------------------------------------------------------

export function siteSchedules(siteId: number): AiSchedulesResponse {
  const now = new Date();
  const schedules = (db.prepare('SELECT * FROM ai_schedules WHERE site_id = ? ORDER BY id').all(siteId) as ScheduleRow[]).map((r) => toView(r, now));
  const runs = (
    db
      .prepare(
        `SELECT r.id, r.schedule_id, s.name AS schedule_name, r.trigger, r.status, r.topic_json, r.title, r.article_json IS NOT NULL AS has_article,
                r.post_json, r.error, r.task_id, r.started_at, r.finished_at
         FROM ai_schedule_runs r JOIN ai_schedules s ON s.id = r.schedule_id
         WHERE r.site_id = ? ORDER BY r.id DESC LIMIT 30`,
      )
      .all(siteId) as RunRow[]
  ).map(toRun);
  return { schedules, runs, serverUtcOffset: -now.getTimezoneOffset() };
}

export function createSchedule(site: Site, input: AiScheduleInput): AiScheduleView {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM ai_schedules WHERE site_id = ?').get(site.id) as { n: number }).n;
  if (count >= MAX_SCHEDULES_PER_SITE) throw conflict(t('Mỗi site có tối đa {n} lịch viết bài', { n: MAX_SCHEDULES_PER_SITE }));
  const now = new Date();
  const topics = mergeTopics([], input.topics, randomUUID);
  // a slot that already passed today is not run just because the schedule was saved after it
  const info = db
    .prepare('INSERT INTO ai_schedules (site_id, name, enabled, config_json, topics_json, last_slot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(site.id, input.name, input.enabled ? 1 : 0, JSON.stringify(splitConfig(input)), JSON.stringify(topics), latestSlot(now, input.days, input.times), nowIso(), nowIso());
  return toView(row(Number(info.lastInsertRowid)), now);
}

export function updateSchedule(id: number, input: AiScheduleInput): AiScheduleView {
  const now = new Date();
  db.transaction(() => {
    const r = row(id);
    const topics = mergeTopics(topicsOf(r), input.topics, randomUUID);
    db.prepare('UPDATE ai_schedules SET name = ?, enabled = ?, config_json = ?, topics_json = ?, last_slot = ?, updated_at = ? WHERE id = ?').run(
      input.name,
      input.enabled ? 1 : 0,
      JSON.stringify(splitConfig(input)),
      JSON.stringify(topics),
      maxSlot(r.last_slot, latestSlot(now, input.days, input.times)),
      nowIso(),
      id,
    );
  })();
  return toView(row(id), now);
}

export function deleteSchedule(id: number) {
  row(id);
  if (running.has(id)) throw conflict(t('Lịch đang viết bài - hãy đợi xong rồi xoá'));
  db.prepare('DELETE FROM ai_schedules WHERE id = ?').run(id);
}

/** The article of a run, to open it in the editor (e.g. when posting it failed). */
export function runArticle(runId: number): Article {
  const r = db.prepare('SELECT article_json FROM ai_schedule_runs WHERE id = ?').get(runId) as { article_json: string | null } | undefined;
  if (!r?.article_json) throw notFound(t('Lần chạy này không có bài viết'));
  return JSON.parse(r.article_json) as Article;
}

/** Write the next topic now, outside the timetable (the timetable itself is unchanged). */
export function runNow(id: number): TaskInfo {
  if (running.has(id)) throw conflict(t('Lịch đang viết bài - hãy đợi xong'));
  return startRun(row(id), 'manual').task;
}

// ---- One run ------------------------------------------------------------------------------

/** Take a written topic off the queue (re-read: the list may have been edited meanwhile). */
function consumeTopic(scheduleId: number, topicId: string) {
  db.transaction(() => {
    const r = db.prepare('SELECT topics_json FROM ai_schedules WHERE id = ?').get(scheduleId) as { topics_json: string } | undefined;
    if (!r) return;
    const topics = (JSON.parse(r.topics_json) as AiTopic[]).filter((x) => x.id !== topicId);
    db.prepare('UPDATE ai_schedules SET topics_json = ? WHERE id = ?').run(JSON.stringify(topics), scheduleId);
  })();
}

/** Posting writes the site's database: never in the middle of a backup, restore or WordPress update. */
async function waitForSiteJobs(site: Site, log: HostLogger) {
  if (!backups.runningJob(site.id)) return;
  log(t('Site đang có tác vụ khác (sao lưu, khôi phục, cập nhật) - đợi xong rồi mới đăng bài...'));
  const deadline = Date.now() + SITE_BUSY_WAIT_MS;
  while (backups.runningJob(site.id)) {
    if (Date.now() > deadline) throw conflict(t('Site vẫn bận sau 1 giờ - bài viết được giữ trong lịch sử để đăng tay'));
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

function pruneRuns(scheduleId: number) {
  db.prepare('DELETE FROM ai_schedule_runs WHERE schedule_id = ? AND id NOT IN (SELECT id FROM ai_schedule_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT ?)').run(scheduleId, scheduleId, KEEP_RUNS);
}

/** Start writing the first queued topic as a task; `done` resolves when it has finished either way. */
function startRun(r: ScheduleRow, trigger: AiRunTrigger): { task: TaskInfo; done: Promise<void> } {
  const topic = topicsOf(r)[0];
  if (!topic) throw conflict(t('Lịch không còn chủ đề nào - hãy thêm chủ đề'));
  const site = sites.getSite(r.site_id);
  const cfg = configOf(r);
  const runId = Number(
    db
      .prepare("INSERT INTO ai_schedule_runs (schedule_id, site_id, trigger, status, topic_json, started_at) VALUES (?, ?, ?, 'running', ?, ?)")
      .run(r.id, site.id, trigger, JSON.stringify({ topic: topic.topic, keyword: topic.keyword, secondaryKeywords: topic.secondaryKeywords }), nowIso()).lastInsertRowid,
  );
  const finish = (status: 'ok' | 'failed', post: PublishedPost | null, error: string | null) =>
    db.prepare('UPDATE ai_schedule_runs SET status = ?, post_json = ?, error = ?, finished_at = ? WHERE id = ?').run(status, post ? JSON.stringify(post) : null, error, nowIso(), runId);
  const href = `/sites/${site.id}?tab=ai&ai=schedules`;

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const task = startTask(t('Viết bài tự động: {keyword}', { keyword: topic.keyword }), async (log) => {
    try {
      log(t('Lịch "{name}" - chủ đề: {topic}', { name: r.name, topic: topic.topic }));
      if (site.appType !== 'wordpress') throw conflict(t('Chỉ áp dụng cho site WordPress'));
      // checked before paying for an article that could not be posted anyway
      assertNotQuarantined(site);
      const article = await generateArticle({ ...cfg.article, topic: topic.topic, keyword: topic.keyword, secondaryKeywords: topic.secondaryKeywords }, await aiSiteContext(site, log), log);
      // written: off the queue, and the article is kept whatever happens to the post
      consumeTopic(r.id, topic.id);
      db.prepare('UPDATE ai_schedule_runs SET title = ?, article_json = ? WHERE id = ?').run(article.title, JSON.stringify(article), runId);
      await waitForSiteJobs(site, log);
      const post = await publishArticle(site, { ...article, categoryIds: cfg.categoryIds, status: cfg.publish }, log);
      log(post.status === 'publish' ? t('Đã đăng bài #{id}: {url}', { id: post.id, url: post.url }) : t('Đã lưu bản nháp #{id}', { id: post.id }));
      finish('ok', post, null);
      notify({
        kind: 'ai',
        tone: 'ok',
        title: post.status === 'publish' ? msg('Đã đăng bài tự động lên {domain}') : msg('Bài viết tự động chờ duyệt trên {domain}'),
        body: msg('"{title}" - lịch {name}'),
        params: { domain: site.domain, title: article.title, name: r.name },
        actions: [{ label: msg('Mở site'), href }],
        dedupeKey: `ai-schedule:${r.id}`,
      });
      return post;
    } catch (err) {
      finish('failed', null, errorMessage(err));
      notify({
        kind: 'ai',
        tone: 'err',
        title: msg('Viết bài tự động trên {domain} thất bại'),
        body: msg('Lịch "{name}": {error}'),
        params: { domain: site.domain, name: r.name, error: errorMessage(err).slice(0, 300) },
        actions: [{ label: msg('Mở site'), href }],
        dedupeKey: `ai-schedule:${r.id}`,
      });
      throw err;
    } finally {
      pruneRuns(r.id);
      running.delete(r.id);
      resolveDone();
    }
  });
  running.set(r.id, task.id);
  db.prepare('UPDATE ai_schedule_runs SET task_id = ? WHERE id = ?').run(task.id, runId);
  return { task, done };
}

// ---- Scheduler ------------------------------------------------------------------------------

/** Run every due schedule, one article after another. Exported for tests. */
export async function schedulerTick(now = new Date(), log: HostLogger = () => {}) {
  if (ticking) return;
  ticking = true;
  try {
    for (const r of db.prepare('SELECT * FROM ai_schedules WHERE enabled = 1 ORDER BY id').all() as ScheduleRow[]) {
      const cfg = configOf(r);
      const slot = dueSlot(now, cfg.days, cfg.times, r.last_slot);
      if (!slot || running.has(r.id)) continue;
      // recorded first: a crash or restart mid-run never writes the same slot twice
      db.prepare('UPDATE ai_schedules SET last_slot = ? WHERE id = ?').run(slot, r.id);
      if (!topicsOf(r).length) {
        const site = sites.getSite(r.site_id);
        notify({
          kind: 'ai',
          tone: 'warn',
          title: msg('Lịch viết bài "{name}" đã hết chủ đề'),
          body: msg('Thêm chủ đề cho {domain} để lịch tiếp tục viết bài.'),
          params: { name: r.name, domain: site.domain },
          actions: [{ label: msg('Mở site'), href: `/sites/${site.id}?tab=ai&ai=schedules` }],
          dedupeKey: `ai-schedule:${r.id}`,
        });
        continue;
      }
      try {
        await startRun(r, 'scheduled').done;
      } catch (err) {
        log(`ai schedule ${r.id}: ${errorMessage(err)}`);
      }
    }
  } finally {
    ticking = false;
  }
}

/** Runs left 'running' by a panel restart. Their topic is still queued unless the article was written. */
export function recoverInterruptedRuns() {
  db.prepare("UPDATE ai_schedule_runs SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'").run(tDefault('Bị gián đoạn khi panel khởi động lại'), nowIso());
}

export function startAiScheduler(log: HostLogger) {
  recoverInterruptedRuns();
  setInterval(() => void schedulerTick(new Date(), log).catch((err) => log(`ai scheduler: ${errorMessage(err)}`)), 60_000).unref();
}
