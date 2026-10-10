import { afterEach, describe, expect, it } from 'vitest';
import { msg } from '@lares/shared';
import { db, setSetting } from '../src/db/index.js';
import { runWithLang } from '../src/i18n/index.js';
import { dismiss, listNotifications, markRead, notify, registerNotificationSource } from '../src/services/notifications.js';

const USER = 9001;

afterEach(() => {
  db.prepare('DELETE FROM notifications').run();
  setSetting(`notifications.read.${USER}`, []);
  registerNotificationSource('test', () => []);
  registerNotificationSource('broken', () => []);
});

describe('notification center', () => {
  it('lists live sources and stored events together, newest first', async () => {
    registerNotificationSource('test', () => [{ id: 'test:1', kind: 'test', tone: 'warn', title: 'live', createdAt: '2000-01-01T00:00:00.000Z', dismissible: false }]);
    notify({ kind: 'event', tone: 'ok', title: 'stored' });
    const { items, read } = await listNotifications(USER);
    expect(items.map((i) => i.title).slice(0, 2)).toEqual(['stored', 'live']);
    expect(items.find((i) => i.title === 'stored')).toMatchObject({ dismissible: true, kind: 'event' });
    expect(read).toEqual([]);
  });

  it("translates stored events in each viewer's language", async () => {
    notify({ kind: 'isolation', tone: 'ok', title: msg('Đã chuyển {ok} site sang user riêng'), params: { ok: 3 }, actions: [{ label: msg('Xem tài liệu'), href: 'https://example.com', external: true }] });
    const en = await runWithLang('en', () => listNotifications(USER));
    const vi = await runWithLang('vi', () => listNotifications(USER));
    expect(en.items[0]).toMatchObject({ title: 'Moved 3 sites to their own user', actions: [{ label: 'Read the docs' }] });
    expect(vi.items[0]!.title).toBe('Đã chuyển 3 site sang user riêng');
  });

  it('keeps read state per user and only for entries that still exist', async () => {
    notify({ kind: 'event', tone: 'info', title: 'a' });
    const id = (await listNotifications(USER)).items.find((i) => i.title === 'a')!.id;
    expect((await markRead(USER, [id, 'event:999999'])).read).toEqual([id]);
    expect((await listNotifications(USER + 1)).read).toEqual([]);
  });

  it('replaces an event with the same dedupe key by a new, unread one', async () => {
    notify({ kind: 'event', tone: 'info', title: 'first', dedupeKey: 'k' });
    const first = (await listNotifications(USER)).items.find((i) => i.title === 'first')!.id;
    await markRead(USER, [first]);
    notify({ kind: 'event', tone: 'info', title: 'second', dedupeKey: 'k' });
    const after = await listNotifications(USER);
    expect(after.items.some((i) => i.title === 'first')).toBe(false);
    expect(after.read).toEqual([]);
  });

  it('dismisses stored events only', async () => {
    notify({ kind: 'event', tone: 'info', title: 'gone' });
    const id = (await listNotifications(USER)).items.find((i) => i.title === 'gone')!.id;
    expect(dismiss('release:9.9.9')).toBe(false);
    expect(dismiss(id)).toBe(true);
    expect((await listNotifications(USER)).items.some((i) => i.id === id)).toBe(false);
  });

  it('survives a broken source', async () => {
    registerNotificationSource('broken', () => {
      throw new Error('boom');
    });
    notify({ kind: 'event', tone: 'info', title: 'still here' });
    expect((await listNotifications(USER)).items.some((i) => i.title === 'still here')).toBe(true);
  });
});
