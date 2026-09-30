import { randomUUID } from 'node:crypto';
import { errorMessage } from '../lib/errors.js';

export interface TaskInfo {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
  logs: Array<{ t: string; msg: string }>;
  result?: unknown;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const tasks = new Map<string, TaskInfo>();
const MAX_LOG_LINES = 5000;
const KEEP_MS = 6 * 3_600_000;

/** Short-lived background jobs (site creation, Next.js build, SSL issuance) polled by the UI. */
export function startTask<T>(label: string, fn: (log: (msg: string) => void) => Promise<T>): TaskInfo {
  const task: TaskInfo = { id: randomUUID(), label, status: 'running', logs: [], startedAt: new Date().toISOString() };
  tasks.set(task.id, task);
  const log = (msg: string) => {
    task.logs.push({ t: new Date().toISOString(), msg });
    if (task.logs.length > MAX_LOG_LINES) task.logs.splice(0, task.logs.length - MAX_LOG_LINES);
  };
  fn(log)
    .then((result) => {
      task.status = 'completed';
      task.result = result;
    })
    .catch((err) => {
      task.status = 'failed';
      task.error = errorMessage(err);
      log(`LỖI: ${task.error}`);
    })
    .finally(() => {
      task.finishedAt = new Date().toISOString();
    });
  return task;
}

export function getTask(id: string, sinceLine = 0) {
  const t = tasks.get(id);
  if (!t) return null;
  return { ...t, logs: t.logs.slice(sinceLine), totalLines: t.logs.length };
}

setInterval(() => {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, t] of tasks) if (t.finishedAt && Date.parse(t.finishedAt) < cutoff) tasks.delete(id);
}, 600_000).unref();
