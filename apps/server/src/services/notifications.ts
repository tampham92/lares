import type { MsgParams, NotificationAction, NotificationTone, NotificationsResponse, PanelNotification } from '@lares/shared';
import { db, getSetting, nowIso, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';

/*
 * Notification center behind the top bar bell. Two kinds of entries:
 *
 *  - Live sources (registerNotificationSource): computed on every read from the current state and
 *    gone as soon as the state is fixed - "a new release is out", "this site could not be isolated".
 *    Each feature registers its own source when its module loads; this file knows none of them.
 *  - Stored events (notify): something that happened - "older sites converted on upgrade", later
 *    a failed backup, a Pro license notice. Kept until dismissed (newest MAX_EVENTS).
 *
 * Text is translated when listed, so stored events keep msgids (marked with msg) plus params and every
 * viewer reads them in their own language. Read state is per user, on the server (any browser).
 */

export type NotificationSource = () => PanelNotification[] | Promise<PanelNotification[]>;

const sources = new Map<string, NotificationSource>();

export function registerNotificationSource(name: string, source: NotificationSource) {
  sources.set(name, source);
}

const MAX_EVENTS = 100;
const MAX_READ = 300;

export interface NotifyInput {
  kind: string;
  tone: NotificationTone;
  /** msgid (Vietnamese source, written with msg()) translated for each viewer, with `params`. */
  title: string;
  body?: string;
  params?: MsgParams;
  /** `label` is a msgid too. */
  actions?: NotificationAction[];
  /** A newer event with the same key replaces the older one (and is unread again). */
  dedupeKey?: string;
}

/** Record an event for the bell. Never throws: a notice must not break the job that sends it. */
export function notify(e: NotifyInput): void {
  try {
    db.transaction(() => {
      if (e.dedupeKey) db.prepare('DELETE FROM notifications WHERE dedupe_key = ?').run(e.dedupeKey);
      db.prepare('INSERT INTO notifications (kind, tone, title, body, params_json, actions_json, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        e.kind,
        e.tone,
        e.title,
        e.body ?? null,
        JSON.stringify(e.params ?? {}),
        JSON.stringify(e.actions ?? []),
        e.dedupeKey ?? null,
        nowIso(),
      );
      db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)').run(MAX_EVENTS);
    })();
  } catch {
    /* see above */
  }
}

interface EventRow {
  id: number;
  kind: string;
  tone: NotificationTone;
  title: string;
  body: string | null;
  params_json: string;
  actions_json: string;
  created_at: string;
}

function storedEvents(): PanelNotification[] {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY id DESC').all() as EventRow[];
  return rows.map((r) => {
    const params = JSON.parse(r.params_json) as MsgParams;
    const actions = JSON.parse(r.actions_json) as NotificationAction[];
    return {
      id: `event:${r.id}`,
      kind: r.kind,
      tone: r.tone,
      title: t(r.title, params),
      ...(r.body ? { body: t(r.body, params) } : {}),
      createdAt: r.created_at,
      ...(actions.length ? { actions: actions.map((a) => ({ ...a, label: t(a.label) })) } : {}),
      dismissible: true,
    };
  });
}

const readKey = (userId: number) => `notifications.read.${userId}`;

export async function listNotifications(userId: number): Promise<NotificationsResponse> {
  const live = await Promise.all(
    [...sources.values()].map(async (source) => {
      try {
        return await source();
      } catch {
        return []; // one broken source must not hide the others
      }
    }),
  );
  const items = [...live.flat(), ...storedEvents()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ids = new Set(items.map((i) => i.id));
  const read = getSetting<string[]>(readKey(userId), []).filter((id) => ids.has(id));
  return { items, read };
}

/** Mark ids as seen by this user. Ids of entries that no longer exist are dropped on the way. */
export async function markRead(userId: number, ids: string[]): Promise<NotificationsResponse> {
  const current = await listNotifications(userId);
  const exists = new Set(current.items.map((i) => i.id));
  const read = [...new Set([...current.read, ...ids.filter((id) => exists.has(id))])].slice(-MAX_READ);
  setSetting(readKey(userId), read);
  return { items: current.items, read };
}

/** Remove a stored event (for every user). Live entries cannot be dismissed: fix the cause instead. */
export function dismiss(id: string): boolean {
  const m = /^event:(\d+)$/.exec(id);
  if (!m) return false;
  return db.prepare('DELETE FROM notifications WHERE id = ?').run(Number(m[1])).changes > 0;
}
