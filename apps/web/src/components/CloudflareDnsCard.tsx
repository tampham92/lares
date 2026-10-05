import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CLOUDFLARE_TOKEN_URL, type CloudflareDnsView, type DnsActionResult, type ServerIpView } from '@lares/shared';
import { del, errMsg, fmtDate, get, post, put } from '../api';
import { t } from '../i18n';
import { conflictText, summarize, useCloudflareDns, useDnsPlan } from './CloudflareDnsOption';
import { Alert, Badge, Check, Field } from './ui';

type Msg = { tone: 'ok' | 'err' | 'warn'; text: string } | null;

/** Settings card: Cloudflare API token (verify, zones, disconnect) and the server's public IP. */
export function CloudflareDnsCard() {
  const qc = useQueryClient();
  const q = useCloudflareDns();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data;

  const run = async (fn: () => Promise<CloudflareDnsView>, ok: string) => {
    setMsg(null);
    setBusy(true);
    try {
      qc.setQueryData(['cloudflare-dns'], await fn());
      setMsg({ tone: 'ok', text: ok });
      setToken('');
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
      void qc.invalidateQueries({ queryKey: ['cloudflare-dns'] });
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['dns-plan'] });
      void qc.invalidateQueries({ queryKey: ['site-dns'] });
    }
  };

  return (
    <div className="card stack">
      <h2>Cloudflare DNS</h2>
      <div className="sub">
        {t('Kết nối tài khoản Cloudflare để Lares tự tạo bản ghi DNS khi thêm site hoặc gán tên miền, và bật/tắt proxy ngay trong trang site.')}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {v?.connected && v.lastError && <Alert tone="warn">{t('Lần kiểm tra gần nhất lỗi: {error}', { error: v.lastError })}</Alert>}
      {v?.connected ? (
        <>
          <div className="kv">
            <div>{t('Trạng thái')}</div>
            <div>
              <Badge tone="ok">{t('Đã kết nối')}</Badge>
            </div>
            <div>{t('Tài khoản')}</div>
            <div>{v.accountName ?? '—'}</div>
            <div>API token</div>
            <div>
              <code>{v.tokenHint}</code>
            </div>
            <div>{t('Xác minh lúc')}</div>
            <div>{fmtDate(v.verifiedAt)}</div>
            <div>{t('Zone ({n})', { n: v.zones.length })}</div>
            <div>
              {v.zones.map((z) => (
                <div key={z.id}>
                  <span className="mono">{z.name}</span> {z.status !== 'active' && <Badge tone="warn">{z.status}</Badge>}
                </div>
              ))}
            </div>
          </div>
          <div className="row end">
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => confirm(t('Ngắt kết nối Cloudflare? Bản ghi DNS đã tạo vẫn giữ nguyên.')) && run(() => del<CloudflareDnsView>('/api/dns/cloudflare'), t('Đã ngắt kết nối Cloudflare'))}
            >
              {t('Ngắt kết nối')}
            </button>
            <button className="btn" disabled={busy} onClick={() => run(() => post<CloudflareDnsView>('/api/dns/cloudflare/refresh'), t('Token hợp lệ, đã cập nhật danh sách zone'))}>
              {t('Kiểm tra lại')}
            </button>
          </div>
        </>
      ) : (
        <>
          <Field
            label="API token"
            hint={
              <>
                {t('Tạo token tại')}{' '}
                <a href={CLOUDFLARE_TOKEN_URL} target="_blank" rel="noreferrer">
                  dash.cloudflare.com/profile/api-tokens
                </a>{' '}
                {t('(mẫu "Edit zone DNS"). Quyền cần có:')} <strong>Zone → DNS → Edit</strong> {t('và')} <strong>Zone → Zone → Read</strong>
                {t('; mục Zone Resources chọn các zone sẽ dùng (hoặc All zones). Token được mã hoá trên máy chủ và không bao giờ gửi lại trình duyệt.')}
              </>
            }
          >
            <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('Dán API token')} />
          </Field>
          <div className="row end">
            <button
              className="btn primary"
              disabled={busy || token.trim().length < 20}
              onClick={() => run(() => put<CloudflareDnsView>('/api/dns/cloudflare', { token }), t('Đã kết nối Cloudflare'))}
            >
              {busy ? t('Đang kiểm tra…') : t('Kiểm tra & kết nối')}
            </button>
          </div>
        </>
      )}
      <ServerIpSection />
    </div>
  );
}

function ServerIpSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['server-ip'], queryFn: () => get<ServerIpView>('/api/dns/server-ip') });
  const [form, setForm] = useState({ ipv4: '', ipv6: '', ipv6Disabled: false });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data;

  useEffect(() => {
    if (v) setForm({ ipv4: v.override.ipv4 ?? '', ipv6: v.override.ipv6 ?? '', ipv6Disabled: v.ipv6Disabled });
  }, [v]);

  const run = async (fn: () => Promise<ServerIpView>, ok: string) => {
    setMsg(null);
    setBusy(true);
    try {
      qc.setQueryData(['server-ip'], await fn());
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['dns-plan'] });
      void qc.invalidateQueries({ queryKey: ['site-dns'] });
    }
  };

  return (
    <>
      <h3>{t('IP public của máy chủ')}</h3>
      <div className="sub">{t('Nội dung của bản ghi A/AAAA. Lares tự phát hiện; chỉ nhập khi máy chủ có nhiều IP hoặc đứng sau NAT/firewall riêng.')}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {v ? (
        <div className="kv">
          <div>{t('Đang dùng')}</div>
          <div className="mono">
            {v.ipv4 ?? <Badge tone="warn">{t('chưa có IPv4')}</Badge>}
            {v.ipv6 && <div>{v.ipv6}</div>}
          </div>
          <div>{t('Tự phát hiện')}</div>
          <div>
            <span className="mono">{[v.detected.ipv4, v.detected.ipv6].filter(Boolean).join(' · ') || '—'}</span>
            {v.detected.at && <div className="hint">{fmtDate(v.detected.at)}</div>}
          </div>
        </div>
      ) : (
        <div className="sub">{t('Đang phát hiện IP…')}</div>
      )}
      <div className="form-grid">
        <Field label={t('IPv4 (tuỳ chọn)')}>
          <input value={form.ipv4} onChange={(e) => setForm({ ...form, ipv4: e.target.value })} placeholder={v?.detected.ipv4 ?? '203.0.113.10'} />
        </Field>
        <Field label={t('IPv6 (tuỳ chọn)')}>
          <input value={form.ipv6} disabled={form.ipv6Disabled} onChange={(e) => setForm({ ...form, ipv6: e.target.value })} placeholder={v?.detected.ipv6 ?? '2001:db8::10'} />
        </Field>
      </div>
      <Check checked={form.ipv6Disabled} onChange={(ipv6Disabled) => setForm({ ...form, ipv6Disabled })}>
        {t('Không tạo bản ghi AAAA (IPv6 của máy chủ không truy cập được từ ngoài)')}
      </Check>
      <div className="row end">
        <button className="btn" disabled={busy} onClick={() => run(() => post<ServerIpView>('/api/dns/server-ip/detect'), t('Đã phát hiện lại IP'))}>
          {t('Phát hiện lại')}
        </button>
        <button className="btn" disabled={busy} onClick={() => run(() => put<ServerIpView>('/api/dns/server-ip', form), t('Đã lưu IP máy chủ'))}>
          {t('Lưu IP')}
        </button>
      </div>
    </>
  );
}

/** Settings → panel domain: create the panel hostname record on Cloudflare, always DNS only. */
export function PanelDnsRecord({ domain }: { domain: string }) {
  const qc = useQueryClient();
  const d = domain.trim().toLowerCase();
  const { connected, plan, fresh } = useDnsPlan(d ? [d] : [], { ipv4Only: true });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const h = fresh ? plan?.data?.hostnames[0] : undefined;
  if (!connected || !h?.zone) return null;
  const summary = summarize(h);
  const proxied = h.records.some((r) => r.type !== 'CNAME' && r.proxied);

  const create = async (overwrite: boolean) => {
    if (overwrite && !confirm(t('Ghi đè bản ghi của {hostname} ({records}) để trỏ về máy chủ này?', { hostname: d, records: conflictText(h) }))) return;
    setMsg(null);
    setBusy(true);
    try {
      const r = await post<DnsActionResult>('/api/dns/panel-record', { domain: d, overwrite });
      setMsg({ tone: r.messages.some((m) => m.level === 'warn') ? 'warn' : 'ok', text: r.messages.map((m) => m.text).join(' · ') });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['dns-plan'] });
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="row">
        <span className="hint">{t('Cloudflare (zone {zone}):', { zone: h.zone.name })}</span>
        {summary === 'ok' && !proxied && <Badge tone="ok">{t('bản ghi đã đúng, DNS only')}</Badge>}
        {summary === 'ok' && proxied && <Badge tone="warn">{t('đang bật proxy - cần DNS only')}</Badge>}
        {summary === 'create' && <Badge tone="info">{t('chưa có bản ghi')}</Badge>}
        {summary === 'update' && <Badge tone="info">{t('cần cập nhật')}</Badge>}
        {summary === 'conflict' && (
          <>
            <Badge tone="warn">{t('đang trỏ nơi khác')}</Badge>
            <span className="hint mono">{conflictText(h)}</span>
          </>
        )}
        {summary === 'error' && <span className="hint">{h.error}</span>}
        {(summary === 'create' || summary === 'update' || (summary === 'ok' && proxied)) && (
          <button className="btn sm" disabled={busy} onClick={() => create(false)}>
            {t('Tạo bản ghi DNS (DNS only)')}
          </button>
        )}
        {summary === 'conflict' && (
          <button className="btn sm danger" disabled={busy} onClick={() => create(true)}>
            {t('Ghi đè (DNS only)')}
          </button>
        )}
      </div>
    </div>
  );
}
