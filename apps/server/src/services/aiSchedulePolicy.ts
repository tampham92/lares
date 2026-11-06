import type { AiTopic, AiTopicInput } from '@lares/shared';
import { localDate } from './backupPolicy.js';

/*
 * Pure rules of scheduled AI articles (no I/O): which time slot is due, when the next one is, and
 * how an edited topic list is merged with the stored queue. Kept separate so they are easy to test.
 */

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Slot key "YYYY-MM-DD HH:MM" (local time); keys of one schedule sort chronologically as strings. */
export const slotKey = (d: Date, time: string) => `${localDate(d)} ${time}`;

/**
 * The latest slot of today that the clock has passed, if today is one of `days`. Only today counts:
 * a panel that was down for days writes one late article when it is back, not one per missed slot.
 */
export function latestSlot(now: Date, days: number[], times: string[]): string | null {
  if (!days.includes(now.getDay())) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const passed = times.filter((t) => minutes(t) <= nowMin).sort();
  return passed.length ? slotKey(now, passed[passed.length - 1]!) : null;
}

/**
 * The slot to run now, or null. `lastSlot` is recorded before a run starts (so a restart never runs
 * a slot twice) and set to the current slot when a schedule is saved (so saving at 10:00 does not
 * immediately run the 08:00 slot of the same day).
 */
export function dueSlot(now: Date, days: number[], times: string[], lastSlot: string | null): string | null {
  const slot = latestSlot(now, days, times);
  return slot && slot > (lastSlot ?? '') ? slot : null;
}

/** When the next article will be written: an overdue slot of today (runs within a minute) or the next one. */
export function nextRunAt(now: Date, days: number[], times: string[], lastSlot: string | null): Date | null {
  if (!days.length || !times.length) return null;
  if (dueSlot(now, days, times, lastSlot)) return now;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!days.includes(day.getDay())) continue;
    for (const time of [...times].sort()) {
      if (offset === 0 && minutes(time) <= nowMin) continue;
      day.setHours(Math.floor(minutes(time) / 60), minutes(time) % 60, 0, 0);
      return day;
    }
  }
  return null;
}

/**
 * Apply an edited topic list to the stored queue. Topics keep their id; an id that is no longer
 * stored was written (or deleted) while the form was open, so it is dropped rather than queued again.
 * Topics without an id are new.
 */
export function mergeTopics(stored: AiTopic[], input: AiTopicInput[], newId: () => string): AiTopic[] {
  const known = new Set(stored.map((t) => t.id));
  const seen = new Set<string>();
  const out: AiTopic[] = [];
  for (const t of input) {
    if (t.id) {
      if (!known.has(t.id) || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ ...t, id: t.id });
    } else out.push({ ...t, id: newId() });
  }
  return out;
}
