import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAD_FORM_PATH, SITE_NOTIFY_MODES, type Site, type SiteLeadSettingsView, type SiteNotifyMode } from '@lares/shared';
import { errMsg, get, put } from '../api';
import { t } from '../i18n';
import { LeadNotifyFields, notifyFormFrom, notifyInput, type NotifyForm } from './LeadNotifyFields';
import { LeadsInbox } from './LeadsInbox';
import { Alert, Field } from './ui';

/** Site tab: this site's leads, its notification override, and how to use the form on custom pages. */
export function LeadsTab({ site }: { site: Site }) {
  return (
    <div className="stack">
      <LeadsInbox siteId={site.id} />
      <div className="grid cols-2">
        <SiteNotifyCard site={site} />
        <FormHowToCard site={site} />
      </div>
    </div>
  );
}

function modeLabel(m: SiteNotifyMode): string {
  if (m === 'inherit') return t('Dùng cấu hình chung trong Cài đặt');
  if (m === 'custom') return t('Cấu hình riêng cho site này');
  return t('Tắt thông báo cho site này');
}

function SiteNotifyCard({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['site-lead-settings', site.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<SiteLeadSettingsView>(`/api/sites/${site.id}/lead-settings`) });
  const [mode, setMode] = useState<SiteNotifyMode>('inherit');
  const [form, setForm] = useState<NotifyForm | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const v = q.data;

  useEffect(() => {
    if (v) {
      setMode(v.mode);
      setForm(notifyFormFrom(v));
    }
  }, [v]);

  const save = async () => {
    if (!form) return;
    setMsg(null);
    setSaving(true);
    try {
      qc.setQueryData(key, await put<SiteLeadSettingsView>(`/api/sites/${site.id}/lead-settings`, { mode, ...notifyInput(form) }));
      setMsg({ tone: 'ok', text: t('Đã lưu cấu hình thông báo của site') });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('Thông báo khi có khách liên hệ')}</h2>
      {v && !v.vhostReady && (
        <Alert tone="warn">
          {t('Cấu hình nginx của site chưa có địa chỉ nhận form {path}. Lares tự thêm khi khởi động lại hoặc khi bạn lưu thay đổi của site (ví dụ bật/tắt access log ở tab Tổng quan).', { path: LEAD_FORM_PATH })}
        </Alert>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {v && form && (
        <>
          <Field label={t('Gửi thông báo')}>
            <select value={mode} onChange={(e) => setMode(e.target.value as SiteNotifyMode)}>
              {SITE_NOTIFY_MODES.map((m) => (
                <option key={m} value={m}>
                  {modeLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'inherit' && (
            <div className="sub">
              {t('Khách của site này được gửi tới các kênh trong')} <Link to="/settings">{t('Cài đặt → Khách liên hệ')}</Link>.
            </div>
          )}
          {mode === 'off' && <div className="sub">{t('Khách vẫn được lưu trong hộp thư, chỉ không gửi thông báo.')}</div>}
          {mode === 'custom' && <LeadNotifyFields view={v} form={form} onChange={setForm} siteId={site.id} />}
          <div className="row end">
            <button className="btn primary" disabled={saving} onClick={save}>
              {t('Lưu')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FormHowToCard({ site }: { site: Site }) {
  const snippet = `<form method="post" action="${LEAD_FORM_PATH}">
  <input name="name" placeholder="${t('Họ tên')}">
  <input name="phone" type="tel" placeholder="${t('Số điện thoại')}" required>
  <input name="email" type="email" placeholder="Email">
  <input name="service" placeholder="${t('Dịch vụ quan tâm')}">
  <textarea name="message" placeholder="${t('Lời nhắn')}"></textarea>
  <input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit">${t('Gửi')}</button>
</form>`;
  return (
    <div className="card stack">
      <h2>{t('Gắn form vào trang của bạn')}</h2>
      <div className="sub">
        {t('Giao diện mẫu của Lares đã có sẵn form. Với trang tự làm (HTML, WordPress, Next.js), mọi form gửi POST tới {path} trên chính tên miền {domain} đều được lưu vào đây.', { path: LEAD_FORM_PATH, domain: site.domain })}
      </div>
      <pre className="lead-code">{snippet}</pre>
      <ul className="lead-help">
        <li>{t('Trường: name, phone, email, message, service (tuỳ chọn), page (đường dẫn trang, tuỳ chọn). Cần ít nhất số điện thoại hoặc email.')}</li>
        <li>{t('_hp là bẫy chống spam: phải để trống và ẩn khỏi người xem.')}</li>
        <li>{t('Không cần JavaScript: sau khi gửi, trình duyệt quay lại trang kèm #lares-sent (hoặc #lares-error khi lỗi). Gửi bằng fetch với header Accept: application/json sẽ nhận {"ok":true}.')}</li>
        <li>{t('Chống spam: mỗi IP gửi tối đa 5 lần/phút và 50 lần/ngày.')}</li>
      </ul>
    </div>
  );
}
