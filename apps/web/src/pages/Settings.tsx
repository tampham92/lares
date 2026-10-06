import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_MODELS, AI_PROVIDER_LABELS, AI_PROVIDERS, ANTHROPIC_MODELS, msg, type AiProvider, type AiSettingsView, type LogrotateSettings } from '@lares/shared';
import { auth, del, errMsg, get, post, put } from '../api';
import { CloudflareDnsCard } from '../components/CloudflareDnsCard';
import { CloudflareRealIpCard, PanelDomainCard } from '../components/NetworkSettings';
import { AllowlistCard, SessionsCard, TwoFactorCard } from '../components/SecuritySettings';
import { BackupSettingsCard } from '../components/BackupSettingsCard';
import { LeadSettingsCard } from '../components/LeadSettingsCard';
import { Alert, Check, Field, Tabs } from '../components/ui';
import { t } from '../i18n';

type SettingsTab = 'domain' | 'security' | 'backup' | 'integrations';

const TABS: Array<[SettingsTab, string]> = [
  ['domain', msg('Tên miền & Cloudflare')],
  ['security', msg('Bảo mật')],
  ['backup', msg('Sao lưu & log')],
  ['integrations', msg('Tích hợp')],
];

export function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'domain';

  return (
    <>
      <div className="page-head">
        <h1>{t('Cài đặt')}</h1>
      </div>
      <Tabs tabs={TABS.map(([id, label]) => [id, t(label)])} value={tab} onChange={(next) => setParams({ tab: next }, { replace: true })} />
      {tab === 'domain' && (
        <Columns left={<PanelDomainCard />} right={[<CloudflareDnsCard key="dns" />, <CloudflareRealIpCard key="ip" />]} />
      )}
      {tab === 'security' && (
        <Columns left={[<PasswordCard key="pw" />, <SessionsCard key="sessions" />]} right={[<TwoFactorCard key="2fa" />, <AllowlistCard key="allowlist" />]} />
      )}
      {tab === 'backup' && <Columns left={<BackupSettingsCard />} right={<LogrotateCard />} />}
      {tab === 'integrations' && <Columns left={<AiSettingsCard />} right={<LeadSettingsCard />} />}
    </>
  );
}

/** Two independent columns, so a tall card does not leave a gap next to a short one. */
function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="settings-cols">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

function LogrotateCard() {
  const lr = useQuery({ queryKey: ['logrotate'], queryFn: () => get<LogrotateSettings>('/api/settings/logrotate') });
  const [form, setForm] = useState<LogrotateSettings>({ retentionDays: 14, compress: true });
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (lr.data) setForm(lr.data);
  }, [lr.data]);

  return (
    <div className="card stack">
      <h2>{t('Lưu trữ log truy cập (logrotate)')}</h2>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Field label={t('Giữ log trong (ngày)')}>
        <input type="number" min={1} max={365} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })} />
      </Field>
      <Field label={t('Xoay vòng sớm khi file vượt quá (MB)')} hint={t('Bỏ trống = chỉ xoay vòng hằng ngày')}>
        <input type="number" min={1} value={form.maxSizeMb ?? ''} onChange={(e) => setForm({ ...form, maxSizeMb: e.target.value ? Number(e.target.value) : undefined })} />
      </Field>
      <Check checked={form.compress} onChange={(v) => setForm({ ...form, compress: v })}>
        {t('Nén (gzip) log cũ')}
      </Check>
      <div className="row end">
        <button
          className="btn primary"
          onClick={async () => {
            try {
              await put('/api/settings/logrotate', form);
              setNotice({ tone: 'ok', text: t('Đã lưu {path}', { path: '/etc/logrotate.d/lares' }) });
            } catch (e) {
              setNotice({ tone: 'err', text: errMsg(e) });
            }
          }}
        >
          {t('Lưu')}
        </button>
      </div>
    </div>
  );
}

function PasswordCard() {
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  return (
    <div className="card stack">
      <h2>{t('Đổi mật khẩu quản trị')}</h2>
      {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
      <Field label={t('Mật khẩu hiện tại')}>
        <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
      </Field>
      <Field label={t('Mật khẩu mới (≥ 10 ký tự)')}>
        <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
      </Field>
      <div className="row end">
        <button
          className="btn primary"
          onClick={async () => {
            try {
              const r = await post<{ token?: string }>('/api/auth/password', pw);
              if (r.token) auth.set(r.token); // the old token was revoked with the old password
              setPwMsg({ tone: 'ok', text: t('Đã đổi mật khẩu - các phiên đăng nhập khác đã bị đăng xuất') });
              setPw({ current: '', next: '' });
            } catch (e) {
              setPwMsg({ tone: 'err', text: errMsg(e) });
            }
          }}
        >
          {t('Đổi mật khẩu')}
        </button>
      </div>
    </div>
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
      <h2>{t('AI viết bài')}</h2>
      <div className="sub">{t('Dùng cho tính năng Viết bài AI trong các site WordPress. API key được mã hoá trên máy chủ và không bao giờ gửi lại trình duyệt.')}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label={t('Nhà cung cấp')}>
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
              {t(AI_PROVIDER_LABELS[p])}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="API key"
        hint={
          <>
            {keyStored ? <>{t('Đã lưu:')} <code>{saved?.keyHint}</code> — {t('để trống để giữ nguyên.')} </> : switching && saved?.hasKey ? t('Đổi nhà cung cấp cần nhập key mới.') + ' ' : ''}
            {t('Lấy key tại')}{' '}
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
          placeholder={keyStored ? t('•••••••• (đã lưu)') : { anthropic: 'sk-ant-...', gemini: 'AIza...', openai: 'sk-...' }[form.provider]}
        />
      </Field>
      {models ? (
        <Field label="Model">
          <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
            {!models.some((m) => m.id === form.model) && form.model && <option value={form.model}>{form.model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Model" hint={t('Tên model của nhà cung cấp, ví dụ một model GPT của OpenAI')}>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={t('tên model')} />
          </Field>
          <Field label={t('Base URL (tuỳ chọn)')} hint={t('Chỉ điền khi dùng API tương thích OpenAI khác (OpenRouter, DeepSeek...). Để trống = api.openai.com')}>
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
              confirm(t('Xoá API key đã lưu?')) &&
              run(async () => {
                qc.setQueryData(['ai-settings'], await del<AiSettingsView>('/api/settings/ai/key'));
                return t('Đã xoá API key');
              })
            }
          >
            {t('Xoá key')}
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
          {t('Lưu & kiểm tra kết nối')}
        </button>
        <button
          className="btn primary"
          disabled={busy || !form.model}
          onClick={() =>
            run(async () => {
              const next = await store();
              return next.hasKey ? t('Đã lưu cấu hình AI') : t('Đã lưu - chưa có API key');
            })
          }
        >
          {t('Lưu')}
        </button>
      </div>
    </div>
  );
}
