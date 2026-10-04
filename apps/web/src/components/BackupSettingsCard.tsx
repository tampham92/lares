import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupSettings, BackupSettingsView } from '@lares/shared';
import { errMsg, get, put } from '../api';
import { t } from '../i18n';
import { Alert, Check, Field } from './ui';

/** Settings page: daily schedule, retention and location of site backups. */
export function BackupSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backup-settings'], queryFn: () => get<BackupSettingsView>('/api/settings/backup') });
  const [form, setForm] = useState<BackupSettings>({ enabled: false, time: '03:00', keep: 7, root: '' });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (q.data) setForm({ enabled: q.data.enabled, time: q.data.time, keep: q.data.keep, root: q.data.root });
  }, [q.data]);

  const save = async () => {
    setMsg(null);
    try {
      const next = await put<BackupSettingsView>('/api/settings/backup', form);
      qc.setQueryData(['backup-settings'], next);
      setMsg({ tone: 'ok', text: t('Đã lưu cấu hình sao lưu') });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    }
  };

  return (
    <div className="card stack">
      <h2>{t('Sao lưu website')}</h2>
      <div className="sub">{t('Sao lưu file và database của từng site lên ổ đĩa VPS. Sao lưu thủ công, xem danh sách và khôi phục ở tab Sao lưu của mỗi site.')}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Check checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })}>
        {t('Tự động sao lưu tất cả site mỗi ngày')}
      </Check>
      <div className="form-grid">
        <Field label={t('Giờ chạy (giờ máy chủ)')} hint={t('Nếu panel tắt vào giờ này, bản sao lưu chạy ngay khi panel bật lại trong ngày')}>
          <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
        </Field>
        <Field label={t('Giữ lại (bản / site)')} hint={t('Chỉ tính bản tự động; bản thủ công không bị xoá tự động')}>
          <input type="number" min={1} max={365} value={form.keep} onChange={(e) => setForm({ ...form, keep: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label={t('Thư mục lưu')} hint={t('Để trống = mặc định {path}. Khi đổi thư mục, các bản cũ vẫn nằm ở thư mục cũ và không hiện trong danh sách.', { path: q.data?.defaultRoot ?? '/var/backups/lares' })}>
        <input value={form.root} onChange={(e) => setForm({ ...form, root: e.target.value })} placeholder={q.data?.defaultRoot ?? '/var/backups/lares'} />
      </Field>
      <div className="row end">
        <button className="btn primary" onClick={save}>
          {t('Lưu')}
        </button>
      </div>
    </div>
  );
}
