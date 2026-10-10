import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Site, SiteIsolationView } from '@lares/shared';
import { errMsg, get, post, put, type TaskInfo } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Check, TaskLog } from './ui';

const PHP_TYPES = ['wordpress', 'laravel', 'php', 'unknown'];

/** Site page → Overview: the site's own Linux user, its PHP-FPM and outbound firewall (services/isolation.ts). */
export function IsolationCard({ site }: { site: Site }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['isolation', site.id], queryFn: () => get<SiteIsolationView>(`/api/sites/${site.id}/isolation`) });
  const [task, setTask] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['isolation', site.id] });
    void qc.invalidateQueries({ queryKey: ['site', site.id] });
  };
  const v = q.data;
  if (!v) return null;
  const isPhp = PHP_TYPES.includes(site.appType);

  const isolate = async () => {
    setError(null);
    try {
      setTask((await post<TaskInfo>(`/api/sites/${site.id}/isolation`)).id);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const setExec = async (allowed: boolean) => {
    setError(null);
    setBusy(true);
    try {
      await put(`/api/sites/${site.id}/php-exec`, { allowed });
      refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{t('Cách ly site')}</h2>
        {v.sysUser ? <Badge tone="ok">{t('Đã cách ly')}</Badge> : <Badge tone="warn">{t('Dùng chung user')}</Badge>}
      </div>
      {v.sysUser ? (
        <>
          <div className="sub">{t('Site chạy bằng user Linux riêng: site khác trên máy chủ không đọc hay ghi được file của site này, kể cả khi bị nhiễm mã độc.')}</div>
          <div className="kv">
            <div>{t('User hệ thống')}</div>
            <div className="mono">{v.sysUser}</div>
            {v.phpService && (
              <>
                <div>PHP-FPM</div>
                <div className="row">
                  <span className="mono">{v.phpService}</span>
                  {v.phpActive === true && <Badge tone="ok">{t('đang chạy')}</Badge>}
                  {v.phpActive === false && <Badge tone={site.status === 'disabled' ? 'default' : 'err'}>{t('đã dừng')}</Badge>}
                </div>
              </>
            )}
            <div>{t('Kết nối ra ngoài')}</div>
            <div>
              {v.firewall === false ? (
                <Badge tone="warn">{t('chưa chặn (thiếu nftables)')}</Badge>
              ) : (
                t('Chặn gửi mail trực tiếp (cổng 25), metadata của cloud và cổng panel')
              )}
            </div>
          </div>
          {isPhp && (
            <>
              <Check checked={v.phpExecAllowed} onChange={(on) => !busy && void setExec(on)}>
                {t('Cho phép PHP chạy lệnh hệ thống (exec, shell_exec, proc_open...)')}
              </Check>
              <div className="hint">
                {t('Nên tắt: webshell cần các hàm này để chạy lệnh trên máy chủ. Chỉ bật khi plugin thật sự cần chương trình ngoài (tạo PDF, tối ưu ảnh bằng công cụ dòng lệnh). Đổi xong PHP-FPM của site khởi động lại.')}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="sub">
            {t('Site được tạo trước khi có tính năng cách ly nên vẫn chạy bằng user chung {user}: một site khác bị nhiễm mã độc có thể đọc và sửa file của site này.', { user: 'www-data' })}
          </div>
          {v.error && <Alert tone="err">{t('Lần chuyển trước thất bại, site đã được đưa về như cũ: {error}', { error: v.error })}</Alert>}
          {v.disabled ? (
            <Alert tone="info">{t('Tính năng cách ly đang tắt trên máy chủ này (LARES_SITE_ISOLATION=0).')}</Alert>
          ) : (
            <div className="row">
              <button className="btn primary" disabled={!!task} onClick={() => void isolate()}>
                {v.error ? t('Thử cách ly lại') : t('Cách ly ngay')}
              </button>
              <span className="hint">{t('Tạo user riêng, PHP-FPM riêng rồi chuyển quyền file. Site vẫn chạy trong lúc chuyển; lỗi thì tự đưa về như cũ.')}</span>
            </div>
          )}
        </>
      )}
      {error && <Alert tone="err">{error}</Alert>}
      {task && (
        <TaskLog
          taskId={task}
          onDone={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}
