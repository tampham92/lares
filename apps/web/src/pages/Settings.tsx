import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_MODELS, AI_PROVIDER_LABELS, AI_PROVIDERS, ANTHROPIC_MODELS, type AiProvider, type AiSettingsView, type LogrotateSettings } from '@tpanel/shared';
import { del, errMsg, get, post, put } from '../api';
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
        <AiSettingsCard />
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

const KEY_LINKS: Record<AiProvider, { url: string; label: string }> = {
  anthropic: { url: 'https://console.anthropic.com/settings/keys', label: 'console.anthropic.com' },
  gemini: { url: 'https://aistudio.google.com/apikey', label: 'aistudio.google.com' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'platform.openai.com' },
};

function AiSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => get<AiSettingsView>('/api/settings/ai') });
  const [form, setForm] = useState({ provider: 'anthropic' as AiProvider, model: ANTHROPIC_MODELS[0].id as string, baseUrl: '', apiKey: '' });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = q.data;

  useEffect(() => {
    if (saved) setForm({ provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl ?? '', apiKey: '' });
  }, [saved]);

  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    setBusy(true);
    try {
      setMsg({ tone: 'ok', text: await fn() });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  const store = async () => {
    const next = await put<AiSettingsView>('/api/settings/ai', { ...form, apiKey: form.apiKey || undefined });
    qc.setQueryData(['ai-settings'], next);
    setForm((f) => ({ ...f, apiKey: '' }));
    return next;
  };
  const switching = !!saved && saved.provider !== form.provider;
  const keyStored = !!saved?.hasKey && !switching;
  const models = AI_MODELS[form.provider];

  return (
    <div className="card stack">
      <h2>AI viết bài</h2>
      <div className="sub">Dùng cho tính năng Viết bài AI trong các site WordPress. API key được mã hoá trên máy chủ và không bao giờ gửi lại trình duyệt.</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label="Nhà cung cấp">
        <select
          value={form.provider}
          onChange={(e) => {
            const provider = e.target.value as AiProvider;
            const model = provider === saved?.provider ? saved.model : (AI_MODELS[provider]?.[0]?.id ?? '');
            setForm({ ...form, provider, model, apiKey: '' });
          }}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {AI_PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="API key"
        hint={
          <>
            {keyStored ? <>Đã lưu: <code>{saved?.keyHint}</code> — để trống để giữ nguyên. </> : switching && saved?.hasKey ? 'Đổi nhà cung cấp cần nhập key mới. ' : ''}
            Lấy key tại{' '}
            <a href={KEY_LINKS[form.provider].url} target="_blank" rel="noreferrer">
              {KEY_LINKS[form.provider].label}
            </a>
          </>
        }
      >
        <input
          type="password"
          autoComplete="off"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          placeholder={keyStored ? '•••••••• (đã lưu)' : { anthropic: 'sk-ant-...', gemini: 'AIza...', openai: 'sk-...' }[form.provider]}
        />
      </Field>
      {models ? (
        <Field label="Model">
          <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
            {!models.some((m) => m.id === form.model) && form.model && <option value={form.model}>{form.model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Model" hint="Tên model của nhà cung cấp, ví dụ một model GPT của OpenAI">
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="tên model" />
          </Field>
          <Field label="Base URL (tuỳ chọn)" hint="Chỉ điền khi dùng API tương thích OpenAI khác (OpenRouter, DeepSeek...). Để trống = api.openai.com">
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </Field>
        </>
      )}
      <div className="row end">
        {saved?.hasKey && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() =>
              confirm('Xoá API key đã lưu?') &&
              run(async () => {
                qc.setQueryData(['ai-settings'], await del<AiSettingsView>('/api/settings/ai/key'));
                return 'Đã xoá API key';
              })
            }
          >
            Xoá key
          </button>
        )}
        <button
          className="btn"
          disabled={busy || (!keyStored && !form.apiKey) || !form.model}
          onClick={() =>
            run(async () => {
              await store();
              return (await post<{ message: string }>('/api/settings/ai/test')).message;
            })
          }
        >
          Lưu &amp; kiểm tra kết nối
        </button>
        <button
          className="btn primary"
          disabled={busy || !form.model}
          onClick={() =>
            run(async () => {
              const next = await store();
              return next.hasKey ? 'Đã lưu cấu hình AI' : 'Đã lưu - chưa có API key';
            })
          }
        >
          Lưu
        </button>
      </div>
    </div>
  );
}
