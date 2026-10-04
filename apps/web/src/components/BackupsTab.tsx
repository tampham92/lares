import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BACKUP_TRIGGER_LABELS, type BackupEntry, type Site, type SiteBackupsResponse } from '@lares/shared';
import { del, errMsg, fmtBytes, fmtDate, get, post, put, siteLabel, type TaskInfo } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Check, ErrorBox, Field, TaskLog } from './ui';

/** Site tab: manual backup, schedule toggle, list / download / delete / restore. */
export function BackupsTab({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['backups', site.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<SiteBackupsResponse>(`/api/sites/${site.id}/backups`) });
  // task whose log is shown (kept after it finishes) and whether it is still running
  const [task, setTask] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = q.data;
  const busy = active || !!data?.running;
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  // a backup/restore started elsewhere (scheduler, another browser tab) is followed too
  const runningId = data?.running?.taskId;
  useEffect(() => {
    if (runningId) {
      setTask(runningId);
      setActive(true);
    }
  }, [runningId]);

  const follow = (id: string) => {
    setTask(id);
    setActive(true);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };

  const backupNow = () => run(async () => follow((await post<TaskInfo>(`/api/sites/${site.id}/backups`)).id));

  const download = (b: BackupEntry) =>
    run(async () => {
      // short-lived signed link: the browser streams the file itself instead of buffering it in memory
      const { url } = await post<{ url: string }>(`/api/sites/${site.id}/backups/${b.id}/download`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lares-${site.domain}-${b.id}.tar`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

  const remove = (b: BackupEntry) =>
    run(async () => {
      if (!confirm(t('Xoá bản sao lưu {id}? Không thể hoàn tác.', { id: b.id }))) return;
      await del(`/api/sites/${site.id}/backups/${b.id}`);
      refresh();
    });

  const setScheduled = (v: boolean) =>
    run(async () => {
      await put(`/api/sites/${site.id}/backups/schedule`, { scheduled: v });
      refresh();
    });

  return (
    <div className="stack">
      <div className="grid cols-2">
        <div className="card stack">
          <h2>{t('Sao lưu')}</h2>
          <div className="sub">
            {t('Mỗi bản sao lưu gồm toàn bộ thư mục site (trừ cache, node_modules) và dump của các database thuộc site. Lưu tại')} <code>{data?.root ?? '…'}</code>
          </div>
          <ErrorBox error={error ?? q.error} />
          <div className="row end">
            <button className="btn primary" disabled={busy} onClick={backupNow}>
              {t('Sao lưu ngay')}
            </button>
          </div>
          {task && (
            <TaskLog
              key={task}
              taskId={task}
              onDone={() => {
                setActive(false);
                refresh();
              }}
            />
          )}
        </div>
        <div className="card stack">
          <h2>{t('Sao lưu tự động')}</h2>
          {data && (
            <>
              {data.schedule.globalEnabled ? (
                <div className="sub">
                  {t('Hằng ngày lúc {time} (giờ máy chủ), giữ {keep} bản gần nhất.', { time: data.schedule.time, keep: data.schedule.keep })}{' '}
                  <Link to="/settings">{t('Đổi trong Cài đặt')}</Link>
                </div>
              ) : (
                <Alert tone="info">
                  {t('Sao lưu tự động đang tắt cho toàn bộ panel.')} <Link to="/settings">{t('Bật trong Cài đặt')}</Link>
                </Alert>
              )}
              <Check checked={data.schedule.siteEnabled} onChange={setScheduled}>
                {t('Sao lưu tự động site này')}
              </Check>
              {data.last.at && (
                <div className="sub">
                  {t('Lần chạy tự động gần nhất:')} {fmtDate(data.last.at)}{' '}
                  {data.last.status === 'ok' ? <Badge tone="ok">{t('thành công')}</Badge> : <Badge tone="err">{t('lỗi')}</Badge>}
                </div>
              )}
              {data.last.status === 'failed' && data.last.error && <Alert tone="err">{data.last.error}</Alert>}
            </>
          )}
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('Thời gian')}</th>
              <th>{t('Loại')}</th>
              <th>{t('Dung lượng')}</th>
              <th>{t('Nội dung')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.backups ?? []).map((b) => (
              <tr key={b.id}>
                <td>
                  {b.damaged ? <span className="mono">{b.id}</span> : fmtDate(b.createdAt)}
                  <div className="sub mono">{b.id}</div>
                </td>
                <td>{b.damaged ? <Badge tone="err">{t('hỏng')}</Badge> : <Badge tone={b.trigger === 'safety' ? 'warn' : b.trigger === 'scheduled' ? 'info' : 'default'}>{t(BACKUP_TRIGGER_LABELS[b.trigger])}</Badge>}</td>
                <td>{b.damaged ? '—' : fmtBytes(b.totalBytes)}</td>
                <td className="sub">
                  {!b.damaged && (
                    <>
                      {t('File ({size})', { size: fmtBytes(b.filesBytes) })}
                      {b.databases.map((d) => (
                        <div key={d.name}>
                          Database <code>{d.name}</code> ({fmtBytes(d.bytes)})
                        </div>
                      ))}
                    </>
                  )}
                </td>
                <td>
                  <div className="row end">
                    {!b.damaged && (
                      <>
                        <button className="btn sm" onClick={() => download(b)}>
                          {t('Tải về')}
                        </button>
                        <button className="btn sm" disabled={busy} onClick={() => setRestoring(b)}>
                          {t('Khôi phục')}
                        </button>
                      </>
                    )}
                    <button className="btn sm danger" disabled={busy} onClick={() => remove(b)}>
                      {t('Xoá')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.backups.length === 0 && <div className="empty">{t('Chưa có bản sao lưu nào')}</div>}
      </div>

      {restoring && (
        <RestoreDialog
          site={site}
          backup={restoring}
          onClose={() => setRestoring(null)}
          onStarted={(id) => {
            setRestoring(null);
            follow(id);
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({ site, backup, onClose, onStarted }: { site: Site; backup: BackupEntry; onClose: () => void; onStarted: (taskId: string) => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const start = async () => {
    setError(null);
    setSending(true);
    try {
      onStarted((await post<TaskInfo>(`/api/sites/${site.id}/backups/${backup.id}/restore`, { confirm: confirmText })).id);
    } catch (e) {
      setError(errMsg(e));
      setSending(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="card stack" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <h2>{t('Khôi phục {site} về {date}?', { site: siteLabel(site), date: fmtDate(backup.createdAt) })}</h2>
        <Alert tone="warn">{t('Toàn bộ file của site và nội dung database sẽ bị thay bằng dữ liệu trong bản sao lưu. Mọi thay đổi sau thời điểm đó sẽ mất.')}</Alert>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Trước tiên Lares tự tạo một bản sao lưu an toàn của trạng thái hiện tại (giữ lại nếu khôi phục lỗi).')}</li>
          <li>
            {t('Thay thư mục')} <code>{site.rootPath}</code>
          </li>
          {backup.databases.length > 0 && <li>{t('Ghi đè database: {names}', { names: backup.databases.map((d) => d.name).join(', ') })}</li>}
          {site.appType === 'nextjs' && <li>{t('Khởi động lại ứng dụng Next.js (cài lại dependencies và build nếu cần)')}</li>}
        </ul>
        {error && <Alert tone="err">{error}</Alert>}
        <Field label={t('Gõ "{domain}" để xác nhận', { domain: site.domain })}>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
        </Field>
        <div className="row end">
          <button className="btn" onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button className="btn danger solid" disabled={confirmText !== site.domain || sending} onClick={start}>
            {t('Khôi phục')}
          </button>
        </div>
      </div>
    </div>
  );
}
