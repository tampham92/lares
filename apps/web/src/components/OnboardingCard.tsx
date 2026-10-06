import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { msg, type OnboardingItemId, type OnboardingView } from '@lares/shared';
import { errMsg, get, post } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Progress } from './ui';

const ITEMS: Record<OnboardingItemId, { title: string; hint: string; to: string; action: string }> = {
  allowlist: {
    title: msg('Giới hạn IP truy cập panel'),
    hint: msg('Chỉ IP của bạn mới mở được trang đăng nhập. Cài đặt → Giới hạn IP truy cập panel.'),
    to: '/settings',
    action: msg('Thiết lập'),
  },
  twoFactor: {
    title: msg('Bật xác thực hai lớp (2FA)'),
    hint: msg('Lộ mật khẩu cũng không đủ để vào panel. Cài đặt → Xác thực hai lớp (2FA).'),
    to: '/settings',
    action: msg('Bật 2FA'),
  },
  panelDomain: {
    title: msg('Gắn tên miền và HTTPS cho trang quản trị'),
    hint: msg("Chứng chỉ Let's Encrypt thay cho chứng chỉ tự ký. Cài đặt → Tên miền cho trang quản trị."),
    to: '/settings',
    action: msg('Thiết lập'),
  },
  firstSite: {
    title: msg('Tạo website đầu tiên'),
    hint: msg('WordPress, Next.js, PHP hoặc HTML tĩnh - hoặc chuyển site từ máy chủ khác về.'),
    to: '/sites/new',
    action: msg('Thêm site'),
  },
  backups: {
    title: msg('Bật sao lưu tự động hằng ngày'),
    hint: msg('Sao lưu file và database mỗi ngày, giữ nhiều bản. Cài đặt → Sao lưu website.'),
    to: '/settings',
    action: msg('Thiết lập'),
  },
  cloudflare: {
    title: msg('Kết nối Cloudflare API token'),
    hint: msg('Để Lares tự tạo bản ghi DNS cho tên miền. Cài đặt → Cloudflare.'),
    to: '/settings',
    action: msg('Kết nối'),
  },
};

/** "Bắt đầu với Lares": first steps computed from the server's real state; dismissal is stored server-side. */
export function OnboardingCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['onboarding'], queryFn: () => get<OnboardingView>('/api/onboarding') });
  const [busy, setBusy] = useState(false);
  const v = q.data;
  if (!v || v.dismissed) return null;
  const allDone = v.done === v.total;

  const dismiss = async () => {
    setBusy(true);
    try {
      qc.setQueryData(['onboarding'], await post<OnboardingView>('/api/onboarding/dismiss'));
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{t('Bắt đầu với Lares')}</h2>
          <div className="sub">{allDone ? t('Đã xong các bước chính - máy chủ đã sẵn sàng.') : t('{done}/{total} bước đã xong', { done: v.done, total: v.total })}</div>
        </div>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={dismiss} title={t('Ẩn thẻ này (thẻ hiện lại nếu một thiết lập bảo mật bị tắt)')}>
          {t('Ẩn')}
        </button>
      </div>
      {v.reappeared && <Alert tone="warn">{t('Một thiết lập bảo mật đã bị tắt sau khi bạn ẩn thẻ này - hãy kiểm tra lại.')}</Alert>}
      <Progress value={v.total ? v.done / v.total : 1} />
      <div className="steps">
        {v.items.map((item) => {
          const info = ITEMS[item.id];
          return (
            <div key={item.id} className={`step${item.done ? ' done' : ''}`}>
              <div className="dot" aria-label={item.done ? t('đã xong') : t('chưa xong')}>
                {item.done ? '✓' : ''}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{t(info.title)}</strong> {item.optional && <Badge>{t('tuỳ chọn')}</Badge>}
                  <div className="detail">{t(info.hint)}</div>
                </div>
                {!item.done && (
                  <Link to={info.to} className="btn sm" style={{ flexShrink: 0 }}>
                    {t(info.action)}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
