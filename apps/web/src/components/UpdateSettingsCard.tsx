import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CHANGELOG_URL, type UpgradeStatus, type VersionInfo } from '@lares/shared';
import { errMsg, fmtDate, get, post, put } from '../api';
import { t } from '../i18n';
import { Alert, Check, Console } from './ui';

/** Settings > Updates: running version, the daily check toggle, "Check now" and the one-click upgrade. */
export function UpdateSettingsCard() {
  const qc = useQueryClient();
  const version = useQuery({ queryKey: ['version'], queryFn: () => get<VersionInfo>('/api/system/version'), retry: false });
  const [status, setStatus] = useState<UpgradeStatus | null>(null);
  // The panel restarts during an upgrade: requests fail for a while, which is expected.
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const v = version.data;
  const running = status?.state === 'running';

  useEffect(() => {
    get<UpgradeStatus>('/api/system/upgrade').then(setStatus, () => {});
  }, []);

  // Follow a running upgrade until the installer reports back (through the panel restart).
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const next = await get<UpgradeStatus>('/api/system/upgrade');
        setOffline(false);
        setStatus(next);
        if (next.state !== 'running') void qc.invalidateQueries({ queryKey: ['version'] });
      } catch {
        setOffline(true);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [running, qc]);

  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (enabled: boolean) =>
    run(async () => {
      qc.setQueryData(['version'], await put<VersionInfo>('/api/system/update-check', { enabled }));
      setMsg({ tone: 'ok', text: enabled ? t('Đã bật kiểm tra bản mới') : t('Đã tắt kiểm tra bản mới') });
    });

  const checkNow = () =>
    run(async () => {
      const next = await post<VersionInfo>('/api/system/update-check');
      qc.setQueryData(['version'], next);
      if (!next.latest) setMsg({ tone: 'err', text: t('Không kiểm tra được (máy chủ không kết nối được GitHub?)') });
      else if (!next.updateAvailable) setMsg({ tone: 'ok', text: t('Bạn đang dùng bản mới nhất.') });
    });

  const upgrade = (target: string) => {
    if (!confirm(t('Nâng cấp Lares lên {version}? Website và dữ liệu được giữ nguyên; trang quản trị tạm ngắt 1-2 phút khi khởi động lại.', { version: target }))) return;
    void run(async () => setStatus(await post<UpgradeStatus>('/api/system/upgrade', { version: target })));
  };

  const doneHere = status?.state === 'done' && v?.version === status.target;

  return (
    <div className="card stack">
      <h2>{t('Cập nhật Lares')}</h2>
      <div className="sub">
        {t('Bản phát hành mới được kiểm tra trên GitHub. Nâng cấp giữ nguyên website, database và tài khoản; dữ liệu của Lares được sao lưu trước khi cập nhật.')}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {v && (
        <>
          <div className="kv">
            <div>{t('Đang chạy')}</div>
            <div>v{v.version}</div>
            <div>{t('Bản mới nhất')}</div>
            <div>{v.latest ? `v${v.latest}` : t('chưa kiểm tra')}</div>
            <div>{t('Kiểm tra lần cuối')}</div>
            <div>{fmtDate(v.checkedAt)}</div>
          </div>
          <Check checked={v.updateCheck} onChange={(enabled) => !busy && !v.updateCheckLocked && toggle(enabled)}>
            {t('Tự kiểm tra bản mới mỗi ngày')}
          </Check>
          {v.updateCheckLocked && (
            <div className="hint">{t('Đã tắt bằng LARES_UPDATE_CHECK=0 trong /etc/lares/lares.env.')}</div>
          )}
          {v.updateAvailable && v.latest && !running && (
            <Alert tone="info">
              {t('Có bản mới {version}', { version: v.latest })}{' '}
              <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">
                {t('Xem thay đổi')}
              </a>
            </Alert>
          )}
          <div className="row end">
            <button className="btn" disabled={busy || running} onClick={checkNow}>
              {t('Kiểm tra ngay')}
            </button>
            {v.updateAvailable && v.latest && (
              <button className="btn primary" disabled={busy || running} onClick={() => upgrade(v.latest!)}>
                {t('Nâng cấp lên v{version}', { version: v.latest })}
              </button>
            )}
          </div>
        </>
      )}
      {status && status.state !== 'idle' && (
        <>
          {running && (
            <Alert tone="info">
              {offline
                ? t('Trang quản trị đang khởi động lại với bản mới…')
                : t('Đang nâng cấp lên v{version}. Có thể mất vài phút, đừng tắt máy chủ.', { version: status.target ?? '' })}
            </Alert>
          )}
          {status.state === 'done' && (
            <Alert tone="ok">
              {doneHere
                ? t('Đã nâng cấp lên v{version}. Tải lại trang để dùng giao diện mới.', { version: status.target ?? '' })
                : t('Lần nâng cấp gần nhất (v{from} lên v{to}) đã xong.', { from: status.from ?? '', to: status.target ?? '' })}{' '}
              {doneHere && (
                <button className="btn sm" onClick={() => window.location.reload()}>
                  {t('Tải lại trang')}
                </button>
              )}
            </Alert>
          )}
          {status.state === 'failed' && (
            <Alert tone="err">
              {status.exitCode === null
                ? t('Lần nâng cấp lên v{version} bị gián đoạn.', { version: status.target ?? '' })
                : t('Nâng cấp lên v{version} thất bại (mã lỗi {code}).', { version: status.target ?? '', code: status.exitCode })}{' '}
              {t('Xem log bên dưới, hoặc chạy lệnh nâng cấp trên VPS:')} <code>{v?.upgradeCommand}</code>
            </Alert>
          )}
          {(running || status.state === 'failed') && <Console lines={status.log.map((line) => ({ msg: line }))} />}
        </>
      )}
    </div>
  );
}
