import { useEffect, useRef, useState, type ReactNode } from 'react';
import { get, type TaskInfo } from '../api';
import { locale, t } from '../i18n';

export function Badge({ tone = 'default', children }: { tone?: 'ok' | 'warn' | 'err' | 'info' | 'default'; children: ReactNode }) {
  return <span className={`badge ${tone === 'default' ? '' : tone}`}>{children}</span>;
}

export function Alert({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'info'; children: ReactNode }) {
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert tone="err">{error instanceof Error ? error.message : String(error)}</Alert>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<[T, string]>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([id, label]) => (
        <button key={id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Console({ lines, autoScroll = true }: { lines: Array<{ t?: string; msg: string; level?: string }>; autoScroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, autoScroll]);
  return (
    <div className="console" ref={ref}>
      {lines.length === 0 && <span className="debug">{t('Chưa có log…')}</span>}
      {lines.map((l, i) => (
        <div key={i} className={l.level ?? ''}>
          {l.t && <span className="t">{new Date(l.t).toLocaleTimeString(locale())}</span>}
          {l.msg}
        </div>
      ))}
    </div>
  );
}

/** Polls a background task (site creation, build, SSL) and streams its log. */
export function TaskLog({ taskId, onDone }: { taskId: string; onDone?: (t: TaskInfo) => void }) {
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [lines, setLines] = useState<TaskInfo['logs']>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let since = 0;
    let stopped = false;
    const tick = async () => {
      try {
        const info = await get<TaskInfo>(`/api/tasks/${taskId}?since=${since}`);
        if (stopped) return;
        since = info.totalLines;
        if (info.logs.length) setLines((prev) => [...prev, ...info.logs]);
        setTask(info);
        if (info.status !== 'running') {
          doneRef.current?.(info);
          return;
        }
      } catch {
        /* transient error - retry */
      }
      if (!stopped) setTimeout(tick, 1000);
    };
    setLines([]);
    void tick();
    return () => {
      stopped = true;
    };
  }, [taskId]);

  return (
    <div className="stack">
      <div className="row">
        <strong>{task?.label ?? t('Đang chạy…')}</strong>
        {task && <Badge tone={task.status === 'completed' ? 'ok' : task.status === 'failed' ? 'err' : 'info'}>{task.status === 'running' ? t('đang chạy') : task.status === 'completed' ? t('hoàn tất') : t('lỗi')}</Badge>}
      </div>
      <Console lines={lines.map((l) => ({ ...l, level: /^(LỖI|ERROR)/.test(l.msg) /* i18n-ignore */ ? 'error' : /^(Cảnh báo|Warning)/.test(l.msg) ? 'warn' : l.msg.startsWith('[dry-run]') ? 'debug' : '' }))} />
      {task?.error && <Alert tone="err">{task.error}</Alert>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
