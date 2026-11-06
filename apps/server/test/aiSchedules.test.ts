import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiScheduleInput, ArticleRequest, PublishArticleInput } from '@lares/shared';
import { dueSlot, latestSlot, mergeTopics, nextRunAt } from '../src/services/aiSchedulePolicy.js';

// testAndReload() would otherwise start a real (dev) nginx on the developer's machine
vi.mock('../src/services/devNginx.js', () => ({ syncDevNginx: async () => {}, stopDevNginx: async () => {} }));

const generateArticle = vi.fn(async (req: ArticleRequest) => ({
  title: `Article ${req.keyword}`,
  slug: 'article',
  metaDescription: '',
  focusKeyword: req.keyword,
  excerpt: '',
  contentHtml: '<p>x</p>',
  tags: [],
}));
const publishArticle = vi.fn(async (_site: unknown, input: PublishArticleInput) => ({ id: 7, url: 'http://example.com/?p=7', editUrl: '', status: input.status }));
const notify = vi.fn();
vi.mock('../src/services/notifications.js', () => ({ notify: (e: unknown) => notify(e) }));
vi.mock('../src/services/ai.js', () => ({ generateArticle: (req: ArticleRequest) => generateArticle(req) }));
vi.mock('../src/services/wpContent.js', () => ({
  aiSiteContext: async () => ({ categories: [], posts: [] }),
  publishArticle: (site: unknown, input: PublishArticleInput) => publishArticle(site, input),
}));

const { db } = await import('../src/db/index.js');
const schedules = await import('../src/services/aiSchedules.js');
const sites = await import('../src/services/sites.js');

// 2026-11-06 is a Friday (getDay() = 5)
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m);

describe('timetable', () => {
  const weekdays = [1, 2, 3, 4, 5];
  it('takes the latest passed slot of today only', () => {
    expect(latestSlot(at(6, 7, 59), weekdays, ['08:00', '17:00'])).toBeNull();
    expect(latestSlot(at(6, 8, 0), weekdays, ['08:00', '17:00'])).toBe('2026-11-06 08:00');
    expect(latestSlot(at(6, 18, 0), weekdays, ['17:00', '08:00'])).toBe('2026-11-06 17:00');
    expect(latestSlot(at(7, 9, 0), weekdays, ['08:00'])).toBeNull(); // Saturday
  });
  it('runs a slot once', () => {
    expect(dueSlot(at(6, 8, 1), weekdays, ['08:00'], null)).toBe('2026-11-06 08:00');
    expect(dueSlot(at(6, 8, 1), weekdays, ['08:00'], '2026-11-05 08:00')).toBe('2026-11-06 08:00');
    expect(dueSlot(at(6, 9, 0), weekdays, ['08:00'], '2026-11-06 08:00')).toBeNull();
    // the panel was down at 08:00 and 17:00: one late article, not two
    expect(dueSlot(at(6, 18, 0), weekdays, ['08:00', '17:00'], '2026-11-05 17:00')).toBe('2026-11-06 17:00');
  });
  it('finds the next run', () => {
    expect(nextRunAt(at(6, 7, 0), weekdays, ['08:00'], null)).toEqual(at(6, 8, 0));
    expect(nextRunAt(at(6, 9, 0), weekdays, ['08:00'], '2026-11-06 08:00')).toEqual(at(9, 8, 0)); // Monday
    expect(nextRunAt(at(6, 9, 0), weekdays, ['08:00'], '2026-11-05 08:00')).toEqual(at(6, 9, 0)); // overdue: now
    expect(nextRunAt(at(6, 9, 0), [], ['08:00'], null)).toBeNull();
  });
});

describe('topic merge', () => {
  const stored = [
    { id: 'a', topic: 'Topic A', keyword: 'ka', secondaryKeywords: [] },
    { id: 'b', topic: 'Topic B', keyword: 'kb', secondaryKeywords: [] },
  ];
  it('keeps ids, adds new topics and drops topics written meanwhile', () => {
    let n = 0;
    const out = mergeTopics(
      stored.slice(1), // "a" was written while the form was open
      [
        { id: 'a', topic: 'Topic A', keyword: 'ka', secondaryKeywords: [] },
        { id: 'b', topic: 'Topic B2', keyword: 'kb', secondaryKeywords: [] },
        { id: 'b', topic: 'dup', keyword: 'kb', secondaryKeywords: [] },
        { topic: 'Topic C', keyword: 'kc', secondaryKeywords: [] },
      ],
      () => `new-${++n}`,
    );
    expect(out.map((t) => [t.id, t.topic])).toEqual([
      ['b', 'Topic B2'],
      ['new-1', 'Topic C'],
    ]);
  });
});

describe('scheduler', () => {
  const SUFFIX = Math.random().toString(36).slice(2, 8);
  const domain = `ai-${SUFFIX}.example.com`;
  const siteId = Number(
    db.prepare(`INSERT INTO sites (domain, root_path, web_root, app_type) VALUES (?, ?, ?, 'wordpress')`).run(domain, `/var/www/${domain}`, `/var/www/${domain}/public_html`).lastInsertRowid,
  );
  const site = sites.getSite(siteId);
  const input = (over: Partial<AiScheduleInput> = {}): AiScheduleInput => ({
    name: 'Daily',
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    times: ['00:00'],
    article: { language: 'vi', tone: 'chuyen-nghiep', words: 800, includeFaq: true },
    publish: 'draft',
    categoryIds: [3],
    topics: [
      { topic: 'First topic', keyword: 'first', secondaryKeywords: [] },
      { topic: 'Second topic', keyword: 'second', secondaryKeywords: ['x'] },
    ],
    ...over,
  });
  // saving takes today's 00:00 slot, so the next one is tomorrow's
  const tomorrow = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 5);
  };
  // the bell keeps one notice per schedule (dedupe key)
  const lastNotice = (id: number) => notify.mock.calls.map((c) => c[0] as { tone: string; dedupeKey: string }).filter((e) => e.dedupeKey === `ai-schedule:${id}`).pop();

  beforeEach(() => {
    db.prepare('DELETE FROM ai_schedules WHERE site_id = ?').run(siteId);
    generateArticle.mockClear();
    publishArticle.mockClear();
    notify.mockClear();
  });

  it('does not run a slot that passed before the schedule was saved', async () => {
    schedules.createSchedule(site, input());
    await schedules.schedulerTick(new Date());
    expect(generateArticle).not.toHaveBeenCalled();
  });

  it('writes the first topic, posts it and takes it off the queue, once per slot', async () => {
    const s = schedules.createSchedule(site, input());
    await schedules.schedulerTick(tomorrow());
    expect(generateArticle).toHaveBeenCalledTimes(1);
    expect(generateArticle.mock.calls[0]![0]).toMatchObject({ topic: 'First topic', keyword: 'first', words: 800, language: 'vi' });
    expect(publishArticle.mock.calls[0]![1]).toMatchObject({ title: 'Article first', status: 'draft', categoryIds: [3] });

    const view = schedules.siteSchedules(siteId);
    expect(view.schedules[0]!.topics.map((t) => t.keyword)).toEqual(['second']);
    expect(view.runs[0]).toMatchObject({ status: 'ok', title: 'Article first', hasArticle: true, post: { id: 7 }, trigger: 'scheduled' });
    expect(lastNotice(s.id)).toMatchObject({ tone: 'ok' });

    await schedules.schedulerTick(tomorrow());
    expect(generateArticle).toHaveBeenCalledTimes(1);
  });

  it('keeps the topic when the AI fails', async () => {
    generateArticle.mockRejectedValueOnce(new Error('429 rate limit'));
    const s = schedules.createSchedule(site, input());
    await schedules.schedulerTick(tomorrow());
    const view = schedules.siteSchedules(siteId);
    expect(view.schedules[0]!.topics).toHaveLength(2);
    expect(view.runs[0]).toMatchObject({ status: 'failed', error: '429 rate limit', hasArticle: false });
    expect(lastNotice(s.id)).toMatchObject({ tone: 'err' });
  });

  it('keeps the written article when posting fails', async () => {
    publishArticle.mockRejectedValueOnce(new Error('wp-cli failed'));
    schedules.createSchedule(site, input());
    await schedules.schedulerTick(tomorrow());
    const view = schedules.siteSchedules(siteId);
    expect(view.schedules[0]!.topics).toHaveLength(1);
    expect(view.runs[0]).toMatchObject({ status: 'failed', hasArticle: true, title: 'Article first' });
    expect(schedules.runArticle(view.runs[0]!.id).title).toBe('Article first');
  });

  it('warns when the queue is empty and skips disabled schedules', async () => {
    const empty = schedules.createSchedule(site, input({ topics: [] }));
    schedules.createSchedule(site, input({ enabled: false }));
    await schedules.schedulerTick(tomorrow());
    expect(generateArticle).not.toHaveBeenCalled();
    expect(lastNotice(empty.id)).toMatchObject({ tone: 'warn' });
    expect(schedules.siteSchedules(siteId).schedules[0]!.nextRunAt).toBeNull();
  });

  it('does not queue again a topic written while the form was open', async () => {
    const s = schedules.createSchedule(site, input());
    await schedules.schedulerTick(tomorrow()); // writes "first"
    schedules.updateSchedule(s.id, input({ topics: [...s.topics, { topic: 'Third topic', keyword: 'third', secondaryKeywords: [] }] }));
    expect(schedules.siteSchedules(siteId).schedules[0]!.topics.map((t) => t.keyword)).toEqual(['second', 'third']);
  });
});
