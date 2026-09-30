import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LogrotateSettings } from '@tpanel/shared';
import { errMsg, get, post, put } from '../api';
import { Alert, Check, Field } from '../components/ui';

export function Settings() {
  const lr = useQuery({ queryKey: ['logrotate'], queryFn: () => get<LogrotateSettings>('/api/settings/logrotate') });
  const [form, setForm] = useState<LogrotateSettings>({ retentionDays: 14, compress: true });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (lr.data) setForm(lr.data);
  }, [lr.data]);

  return (
    <>
      <div className="page-head">
        <h1>Cài đặt</h1>
      </div>
      <div className="grid cols-2">
        <div className="card stack">
          <h2>Lưu trữ log truy cập (logrotate)</h2>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Field label="Giữ log trong (ngày)">
            <input type="number" min={1} max={365} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })} />
          </Field>
          <Field label="Xoay vòng sớm khi file vượt quá (MB)" hint="Bỏ trống = chỉ xoay vòng hằng ngày">
            <input type="number" min={1} value={form.maxSizeMb ?? ''} onChange={(e) => setForm({ ...form, maxSizeMb: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <Check checked={form.compress} onChange={(v) => setForm({ ...form, compress: v })}>
            Nén (gzip) log cũ
          </Check>
          <div className="row end">
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await put('/api/settings/logrotate', form);
                  setMsg({ tone: 'ok', text: 'Đã lưu /etc/logrotate.d/tpanel' });
                } catch (e) {
                  setMsg({ tone: 'err', text: errMsg(e) });
                }
              }}
            >
              Lưu
            </button>
          </div>
        </div>
        <div className="card stack">
          <h2>Đổi mật khẩu quản trị</h2>
          {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
          <Field label="Mật khẩu hiện tại">
            <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="Mật khẩu mới (≥ 10 ký tự)">
            <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <div className="row end">
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await post('/api/auth/password', pw);
                  setPwMsg({ tone: 'ok', text: 'Đã đổi mật khẩu' });
                  setPw({ current: '', next: '' });
                } catch (e) {
                  setPwMsg({ tone: 'err', text: errMsg(e) });
                }
              }}
            >
              Đổi mật khẩu
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
