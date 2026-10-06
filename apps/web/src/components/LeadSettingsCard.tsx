import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAD_CHANNEL_LABELS, type LeadSettingsView } from '@lares/shared';
import { errMsg, fmtDate, get, put } from '../api';
import { t } from '../i18n';
import { LeadNotifyFields, notifyFormFrom, notifyInput, type NotifyForm } from './LeadNotifyFields';
import { Alert, Field } from './ui';

/** Settings page: where contact-form leads are sent, and how long they are kept. */
export function LeadSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lead-settings'], queryFn: () => get<LeadSettingsView>('/api/settings/leads') });
  const [form, setForm] = useState<NotifyForm | null>(null);
  const [retention, setRetention] = useState(12);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const v = q.data;

  useEffect(() => {
    if (v) {
      setForm(notifyFormFrom(v));
      setRetention(v.retentionMonths);
    }
  }, [v]);

  const save = async () => {
    if (!form) return;
    setMsg(null);
    setSaving(true);
    try {
      const next = await put<LeadSettingsView>('/api/settings/leads', { ...notifyInput(form), retentionMonths: retention });
      qc.setQueryData(['lead-settings'], next);
      setMsg({ tone: 'ok', text: t('Đã lưu cấu hình khách liên hệ') });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('Khách liên hệ (form website)')}</h2>
      <div className="sub">
        {t('Form liên hệ trên các website do Lares quản lý gửi về')} <Link to="/leads">{t('hộp thư Khách liên hệ')}</Link>.{' '}
        {t('Dữ liệu chỉ lưu trong panel và chỉ được gửi tới các kênh thông báo bạn bật dưới đây. Mỗi site có thể dùng cấu hình riêng ở tab Khách liên hệ.')}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {v && form && (
        <>
          <LeadNotifyFields view={v} form={form} onChange={setForm} />
          <h3>{t('Lưu trữ')}</h3>
          <Field label={t('Tự xoá khách liên hệ sau (tháng)')} hint={t('Thông tin khách là dữ liệu cá nhân: chỉ giữ trong thời gian cần thiết. 0 = không tự xoá.')}>
            <input type="number" min={0} max={120} value={retention} onChange={(e) => setRetention(Number(e.target.value))} />
          </Field>
          {v.recentFailures.length > 0 && (
            <Alert tone="warn">
              <strong>{t('Thông báo gửi lỗi gần đây')}</strong>
              <ul className="lead-failures">
                {v.recentFailures.map((f) => (
                  <li key={`${f.leadId}-${f.channel}`}>
                    {fmtDate(f.at)} · {f.site} · {LEAD_CHANNEL_LABELS[f.channel]}: {f.error}
                  </li>
                ))}
              </ul>
              {t('Sửa cấu hình rồi bấm "Gửi lại" ở từng khách trong hộp thư.')}
            </Alert>
          )}
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
