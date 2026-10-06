import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CloudflareRealIpView, PanelDomainView } from '@lares/shared';
import { del, errMsg, fmtDate, get, post, put, type TaskInfo } from '../api';
import { Alert, Badge, Check, ErrorBox, Field, TaskLog } from './ui';
import { PanelDnsRecord } from './CloudflareDnsCard';
import { locale, t } from '../i18n';

/** Settings card: trusted certificate for the panel. */
export function PanelDomainCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['panel-domain'], queryFn: () => get<PanelDomainView>('/api/settings/panel-domain') });
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [ignoreDns, setIgnoreDns] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [check, setCheck] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data;
  const daysLeft = v?.domain && v.expiresAt ? Math.floor((Date.parse(v.expiresAt) - Date.now()) / 86_400_000) : null;

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    setCheck(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('Tên miền cho trang quản trị')}</h2>
      <div className="sub">
        {t('Mặc định trang quản trị dùng chứng chỉ tự ký nên trình duyệt hiện cảnh báo. Gắn một tên miền trỏ về máy chủ này để Lares xin chứng chỉ Let\'s Encrypt miễn phí (tự gia hạn).')}
      </div>
      <ErrorBox error={error} />
      {v && (
        <div className="kv">
          <div>{t('Địa chỉ')}</div>
          <div>{v.url ? <a href={v.url}>{v.url}</a> : `${v.https ? 'https' : 'http'}://${window.location.hostname}:${v.port}`}</div>
          <div>{t('Chứng chỉ')}</div>
          <div>
            {v.domain ? (
              <>
                Let&apos;s Encrypt {v.issuer ? `(${v.issuer})` : ''} <Badge tone="ok">{t('hợp lệ')}</Badge>
              </>
            ) : v.https ? (
              <>
                {t('Tự ký')} <Badge tone="warn">{t('trình duyệt sẽ cảnh báo')}</Badge>
              </>
            ) : (
              <Badge tone="warn">{t('Chưa bật HTTPS')}</Badge>
            )}
          </div>
          {v.domain && (
            <>
              <div>{t('Hết hạn')}</div>
              <div>
                {v.expiresAt ? new Date(v.expiresAt).toLocaleDateString(locale()) : '—'}{' '}
                {daysLeft !== null && <Badge tone={daysLeft < 14 ? 'warn' : 'ok'}>{t('còn {n} ngày', { n: daysLeft })}</Badge>}
              </div>
            </>
          )}
        </div>
      )}
      {doneUrl && (
        <Alert tone="ok">
          {t('Chứng chỉ đã sẵn sàng. Mở trang quản trị tại')} <a href={doneUrl}>{doneUrl}</a> {t('(cần đăng nhập lại ở địa chỉ mới)')}
        </Alert>
      )}
      {check && <Alert tone={check.tone}>{check.text}</Alert>}
      <Field
        label={t('Tên miền')}
        hint={t('Bản ghi DNS A phải trỏ thẳng về IP máy chủ. Nếu dùng Cloudflare, tắt proxy (đám mây xám) cho tên miền này vì Cloudflare không chuyển tiếp port {port}.', {
          port: v?.port ?? 8686,
        })}
      >
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={v?.domain ?? 'panel.example.com'} />
      </Field>
      <PanelDnsRecord domain={domain} />
      <Field label={t('Email nhận thông báo từ Let\'s Encrypt (tuỳ chọn)')}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={v?.email ?? 'admin@example.com'} />
      </Field>
      <Check checked={ignoreDns} onChange={setIgnoreDns}>
        {t('Bỏ qua kiểm tra DNS')}
      </Check>
      <div className="row end">
        {v?.domain && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() =>
              confirm(t('Gỡ tên miền và quay về chứng chỉ tự ký?')) &&
              act(async () => {
                qc.setQueryData(['panel-domain'], await del<PanelDomainView>('/api/settings/panel-domain'));
                setDoneUrl(null);
              })
            }
          >
            {t('Gỡ tên miền (về chứng chỉ tự ký)')}
          </button>
        )}
        <button
          className="btn"
          disabled={busy || !domain.trim()}
          onClick={() =>
            act(async () => {
              const r = await post<{ warnings: string[] }>('/api/settings/panel-domain/check', { domain });
              setCheck(r.warnings.length ? { tone: 'warn', text: r.warnings.join(' · ') } : { tone: 'ok', text: t('{domain} đã trỏ về máy chủ này', { domain: domain.trim() }) });
            })
          }
        >
          {t('Kiểm tra DNS')}
        </button>
        <button
          className="btn primary"
          disabled={busy || !domain.trim()}
          onClick={() =>
            act(async () => {
              setDoneUrl(null);
              setTask((await post<TaskInfo>('/api/settings/panel-domain', { domain, email, ignoreDns })).id);
            })
          }
        >
          {t('Cài chứng chỉ')}
        </button>
      </div>
      {task && (
        <TaskLog
          taskId={task}
          onDone={(info) => {
            if (info.status === 'completed') setDoneUrl((info.result as { url?: string } | undefined)?.url ?? null);
            void qc.invalidateQueries({ queryKey: ['panel-domain'] });
          }}
        />
      )}
    </div>
  );
}

/** Settings card: real visitor IP behind Cloudflare. */
export function CloudflareRealIpCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cloudflare'], queryFn: () => get<CloudflareRealIpView>('/api/settings/cloudflare') });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data;

  const run = async (fn: () => Promise<CloudflareRealIpView>, ok: string) => {
    setMsg(null);
    setBusy(true);
    try {
      qc.setQueryData(['cloudflare'], await fn());
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
      void qc.invalidateQueries({ queryKey: ['cloudflare'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('IP thật của khách truy cập (Cloudflare)')}</h2>
      <div className="sub">
        {t('Khi site bật proxy Cloudflare (đám mây cam), nginx chỉ thấy IP của Cloudflare. Bật mục này để log truy cập và thống kê lưu IP thật (header CF-Connecting-IP, chỉ tin khi request đến từ dải IP của Cloudflare).')}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {v?.lastError && <Alert tone="warn">{t('Lần cập nhật gần nhất lỗi: {error}', { error: v.lastError })}</Alert>}
      {v && (
        <>
          <Check
            checked={v.enabled}
            onChange={(enabled) => !busy && run(() => put<CloudflareRealIpView>('/api/settings/cloudflare', { enabled }), enabled ? t('Đã bật') : t('Đã tắt'))}
          >
            {t('Khôi phục IP thật sau Cloudflare')}
          </Check>
          <div className="kv">
            <div>{t('Dải IP')}</div>
            <div>{t('{v4} IPv4, {v6} IPv6', { v4: v.ipv4.length, v6: v.ipv6.length })}</div>
            <div>{t('Cập nhật từ cloudflare.com')}</div>
            <div>{v.fetchedAt ? fmtDate(v.fetchedAt) : t('chưa - đang dùng danh sách có sẵn')}</div>
            <div>{t('File cấu hình')}</div>
            <div>
              <code>{v.confPath}</code>
            </div>
          </div>
        </>
      )}
      <div className="row end">
        <button className="btn" disabled={busy || !v?.enabled} onClick={() => run(() => post<CloudflareRealIpView>('/api/settings/cloudflare/refresh'), t('Đã cập nhật danh sách IP Cloudflare'))}>
          {t('Cập nhật ngay')}
        </button>
      </div>
    </div>
  );
}
