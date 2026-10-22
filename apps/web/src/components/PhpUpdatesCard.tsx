import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { msg, type PhpBranchUpdates, type PhpSupport, type PhpUpdatesView } from '@lares/shared';
import { errMsg, fmtDate, get, post, put, type TaskInfo } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Check, ErrorBox, TaskLog } from './ui';

const SUPPORT: Record<PhpSupport, { tone: 'ok' | 'warn' | 'err' | 'default'; label: string }> = {
  supported: { tone: 'ok', label: msg('đến {date}') },
  ending: { tone: 'warn', label: msg('sắp hết hạn {date}') },
  eol: { tone: 'err', label: msg('hết hỗ trợ từ {date}') },
  unknown: { tone: 'default', label: msg('không rõ') },
};

const supportBadge = (b: PhpBranchUpdates) => (
  <Badge tone={SUPPORT[b.support].tone}>{t(SUPPORT[b.support].label, { date: b.eolDate ?? '' })}</Badge>
);

/**
 * Settings > Updates: patch releases of the installed PHP branches (ondrej / sury repository, which
 * the OS's automatic security updates skip), php.net support dates and the nightly automatic update.
 */
export function PhpUpdatesCard() {
  const qc = useQueryClient();
  const key = ['php-updates'];
  const q = useQuery({ queryKey: key, queryFn: () => get<PhpUpdatesView>('/api/php-updates') });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const v = q.data;
  const running = taskId ?? v?.running ?? null;

  const run = async (fn: () => Promise<void>) => {
    setNote(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNote({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const checkNow = () =>
    run(async () => {
      setChecking(true);
      try {
        // refreshes the apt lists: up to a minute on a slow mirror
        const next = await post<PhpUpdatesView>('/api/php-updates/check');
        qc.setQueryData(key, next);
        if (!next.error && !next.branches.some((b) => b.packages.length)) setNote({ tone: 'ok', text: t('PHP đã có bản vá mới nhất.') });
      } finally {
        setChecking(false);
      }
    });

  const toggleAuto = (autoUpdate: boolean) =>
    run(async () => {
      qc.setQueryData(key, await put<PhpUpdatesView>('/api/php-updates/settings', { autoUpdate }));
      setNote({ tone: 'ok', text: autoUpdate ? t('Đã bật tự cập nhật PHP') : t('Đã tắt tự cập nhật PHP') });
    });

  const upgrade = () => {
    if (!confirm(t('Cài bản vá PHP? PHP-FPM của các site khởi động lại (gián đoạn vài giây); php.ini và cấu hình pool được giữ nguyên.'))) return;
    void run(async () => setTaskId((await post<TaskInfo>('/api/php-updates/upgrade', {})).id));
  };

  const finished = (task: TaskInfo) => {
    setNote(task.status === 'completed' ? { tone: 'ok', text: t('Đã cập nhật PHP.') } : null);
    setTaskId(null);
    void qc.invalidateQueries({ queryKey: key });
  };

  const pending = v?.branches.filter((b) => b.packages.length) ?? [];
  // php-common alone can be pending too: it goes with the same button
  const anyPending = pending.length > 0 || !!v?.others.some((p) => p.from !== null && p.name.startsWith('php'));
  const eolInUse = v?.branches.filter((b) => b.support === 'eol' && b.sites > 0) ?? [];

  return (
    <div className="card stack">
      <h2>{t('Cập nhật PHP')}</h2>
      <div className="sub">
        {t('PHP được cài từ kho ondrej/sury nên không nằm trong cập nhật bảo mật tự động của hệ điều hành. Lares kiểm tra bản vá mỗi ngày; cập nhật chỉ trong cùng phiên bản (ví dụ 8.3.12 lên 8.3.14), giữ nguyên php.ini và cấu hình pool.')}
      </div>
      {q.error && <ErrorBox error={q.error} />}
      {note && <Alert tone={note.tone}>{note.text}</Alert>}
      {v?.error && <Alert tone="warn">{v.error}</Alert>}
      {eolInUse.map((b) => (
        <Alert key={b.branch} tone="warn">
          {t('PHP {version} đã hết hỗ trợ bảo mật từ {date} nhưng còn {count} site dùng. Đổi sang PHP mới hơn ở thẻ Cấu hình trong trang của từng site.', {
            version: b.branch,
            date: b.eolDate ?? '',
            count: b.sites,
          })}
        </Alert>
      ))}
      {v && (
        <>
          {v.branches.length > 0 ? (
            <div className="table-wrap">
              <table className="php-updates">
                <thead>
                  <tr>
                    <th>PHP</th>
                    <th>{t('Đang chạy')}</th>
                    <th>{t('Bản vá')}</th>
                    <th>{t('Hỗ trợ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.branches.map((b) => (
                    <tr key={b.branch}>
                      <td>
                        <strong>{b.branch}</strong>
                        <div className="hint">{t('{count} site', { count: b.sites })}</div>
                      </td>
                      <td className="mono">{b.installed ?? '—'}</td>
                      <td>
                        {b.packages.length ? (
                          <span title={b.packages.map((p) => `${p.name} ${p.to}`).join('\n')}>
                            <Badge tone="warn">{b.available === b.installed ? t('{version} (bản dựng mới)', { version: b.available ?? '' }) : b.available}</Badge>
                          </span>
                        ) : (
                          <span className="sub">{t('Mới nhất')}</span>
                        )}
                      </td>
                      <td>{supportBadge(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{t('Chưa có PHP-FPM nào trên máy chủ này.')}</div>
          )}
          {v.others.length > 0 && <div className="hint">{t('Cập nhật kèm theo: {packages}', { packages: v.others.map((p) => p.name).join(', ') })}</div>}
          <div className="kv">
            <div>{t('Kiểm tra lần cuối')}</div>
            <div>{v.checkedAt ? fmtDate(v.checkedAt) : t('chưa kiểm tra')}</div>
            {v.lastRun && (
              <>
                <div>{t('Lần cập nhật gần nhất')}</div>
                <div>
                  {fmtDate(v.lastRun.at)}
                  {v.lastRun.auto ? ` · ${t('tự động')}` : ''}{' '}
                  {v.lastRun.ok ? <Badge tone="ok">{t('thành công')}</Badge> : <Badge tone="err">{t('thất bại')}</Badge>}
                  {v.lastRun.error && <div className="sub">{v.lastRun.error}</div>}
                </div>
              </>
            )}
          </div>
          <Check checked={v.autoUpdate} disabled={busy} onChange={(on) => !busy && toggleAuto(on)}>
            {t('Tự cài bản vá PHP mỗi đêm (2h–6h theo giờ máy chủ)')}
          </Check>
          <div className="row end">
            <button className="btn" disabled={busy || !!running} onClick={checkNow}>
              {checking ? t('Đang kiểm tra bản vá…') : t('Kiểm tra ngay')}
            </button>
            {anyPending && (
              <button className="btn primary" disabled={busy || !!running} onClick={upgrade}>
                {pending.length ? t('Cài bản vá PHP {versions}', { versions: pending.map((b) => b.branch).join(', ') }) : t('Cài bản cập nhật')}
              </button>
            )}
          </div>
        </>
      )}
      {running && <TaskLog taskId={running} onDone={finished} />}
    </div>
  );
}
