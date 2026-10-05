import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DnsActionResult, HostnameDnsStatus, Site, SiteDnsStatus } from '@lares/shared';
import { get, post } from '../api';
import { t } from '../i18n';
import { conflictText, summarize } from './CloudflareDnsOption';
import { Alert, Badge, ErrorBox } from './ui';

/** Site page (SSL tab): where each hostname resolves, its Cloudflare record, create/fix and proxy buttons. */
export function SiteDnsCard({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['site-dns', site.id, site.domain, site.aliases.join(' ')];
  const q = useQuery({ queryKey: key, queryFn: () => get<SiteDnsStatus>(`/api/sites/${site.id}/dns`) });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DnsActionResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const s = q.data;

  const act = async (path: 'records' | 'proxy', body: Record<string, unknown>) => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await post<DnsActionResult>(`/api/sites/${site.id}/dns/${path}`, body));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['dns-plan'] });
    }
  };

  const fix = (h: HostnameDnsStatus, overwrite: boolean) => {
    if (overwrite && !confirm(t('Ghi đè bản ghi của {hostname} ({records}) để trỏ về máy chủ này?', { hostname: h.hostname, records: conflictText(h) }))) return;
    void act('records', { hostnames: [h.hostname], overwrite: overwrite ? [h.hostname] : [] });
  };
  const proxy = (hostnames: string[], proxied: boolean) => void act('proxy', { hostnames, proxied });

  const dnsOnly = s?.hostnames.filter((h) => h.proxied === false).map((h) => h.hostname) ?? [];
  const warnings = result?.messages.filter((m) => m.level === 'warn') ?? [];

  return (
    <div className="card stack">
      <h2>DNS</h2>
      <div className="sub">{t('Tên miền đang trỏ về đâu (tra cứu DNS công khai qua 1.1.1.1 và 8.8.8.8) và bản ghi tương ứng trên Cloudflare.')}</div>
      <ErrorBox error={error ?? q.error} />
      {result && result.messages.length > 0 && (
        <Alert tone={warnings.length ? 'warn' : 'ok'}>
          {result.messages.map((m, i) => (
            <div key={i}>{m.text}</div>
          ))}
        </Alert>
      )}
      {!s ? (
        <div className="sub">{t('Đang kiểm tra DNS…')}</div>
      ) : (
        <>
          <div className="kv">
            <div>{t('IP máy chủ')}</div>
            <div className="mono">
              {[s.ipv4, s.ipv6].filter(Boolean).join(' · ') || (
                <>
                  {t('chưa xác định -')} <Link to="/settings">{t('nhập trong Cài đặt')}</Link>
                </>
              )}
            </div>
          </div>
          {!s.connected && (
            <Alert tone="info">
              {t('Kết nối Cloudflare trong')} <Link to="/settings">{t('Cài đặt')}</Link> {t('để tạo bản ghi và bật/tắt proxy ngay tại đây.')}
            </Alert>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Tên miền')}</th>
                  <th>{t('Đang trỏ về')}</th>
                  <th>{t('Trạng thái')}</th>
                  {s.connected && <th>Cloudflare</th>}
                  {s.connected && <th />}
                </tr>
              </thead>
              <tbody>
                {s.hostnames.map((h) => (
                  <HostRow key={h.hostname} h={h} connected={s.connected} sslEnabled={s.sslEnabled} busy={busy} onFix={fix} onProxy={proxy} />
                ))}
              </tbody>
            </table>
          </div>
          {s.connected && (
            <div className="hint">
              {t('Bản ghi mới được tạo ở chế độ DNS only (đám mây xám) để Let\'s Encrypt xác thực được ngay. Sau khi cài SSL có thể bật proxy; khi đó đặt SSL/TLS của Cloudflare ở chế độ Full (strict).')}
            </div>
          )}
        </>
      )}
      <div className="row end">
        <button className="btn" disabled={q.isFetching || busy} onClick={() => void q.refetch()}>
          {q.isFetching ? t('Đang kiểm tra…') : t('Kiểm tra lại')}
        </button>
        {s?.connected && dnsOnly.length > 0 && (
          <button className="btn primary" disabled={busy || !s.sslEnabled} title={s.sslEnabled ? undefined : t('Cài SSL trước')} onClick={() => proxy(dnsOnly, true)}>
            {s.sslEnabled ? t('Bật proxy Cloudflare') : t('Bật proxy Cloudflare sau khi cài SSL')}
          </button>
        )}
      </div>
    </div>
  );
}

function ResolvedStatus({ h }: { h: HostnameDnsStatus }) {
  if (h.pointsHere) return <Badge tone="ok">{t('Đúng máy chủ')}</Badge>;
  if (h.viaCloudflare) return <Badge tone={h.proxied ? 'ok' : 'info'}>{t('Qua proxy Cloudflare')}</Badge>;
  if (h.resolved.error) return <Badge tone="warn">{t('Không tra cứu được')}</Badge>;
  if (!h.resolved.a.length && !h.resolved.aaaa.length) {
    // the Cloudflare record exists but public resolvers do not see it yet (new record, cached negative answer, pending zone)
    return h.proxied !== null ? <Badge tone="info">{t('Chờ DNS cập nhật')}</Badge> : <Badge tone="err">{t('Chưa có bản ghi')}</Badge>;
  }
  return <Badge tone="warn">{t('Trỏ nơi khác')}</Badge>;
}

function HostRow({
  h,
  connected,
  sslEnabled,
  busy,
  onFix,
  onProxy,
}: {
  h: HostnameDnsStatus;
  connected: boolean;
  sslEnabled: boolean;
  busy: boolean;
  onFix: (h: HostnameDnsStatus, overwrite: boolean) => void;
  onProxy: (hostnames: string[], proxied: boolean) => void;
}) {
  const summary = summarize(h);
  const answers = [...h.resolved.a, ...h.resolved.aaaa];
  return (
    <tr>
      {/* table scrolls sideways on phones: keep hostnames and IPv6 addresses readable instead of one letter per line */}
      <td className="mono" style={{ minWidth: 150 }}>
        {h.hostname}
      </td>
      <td className="mono" style={{ minWidth: 130 }}>
        {answers.length ? answers.map((ip) => <div key={ip}>{ip}</div>) : <span className="hint">{h.resolved.error ?? '—'}</span>}
      </td>
      <td>
        <ResolvedStatus h={h} />
      </td>
      {connected && (
        <td>
          {!h.zone ? (
            <span className="hint">{t('ngoài các zone đã kết nối')}</span>
          ) : h.error ? (
            <span className="hint">{h.error}</span>
          ) : (
            <div className="stack" style={{ gap: 4 }}>
              <div className="row">
                {h.proxied === true && <Badge tone="info">{t('Proxy (đám mây cam)')}</Badge>}
                {h.proxied === false && <Badge>{t('DNS only (đám mây xám)')}</Badge>}
                {summary === 'create' &&
                  (h.records.some((r) => r.type !== 'CNAME') ? (
                    <Badge tone="warn">{t('Thiếu bản ghi {types}', { types: h.plan.filter((p) => p.action === 'create').map((p) => p.type).join(', ') })}</Badge>
                  ) : (
                    <Badge tone="warn">{t('Chưa có bản ghi')}</Badge>
                  ))}
                {summary === 'update' && <Badge tone="warn">{t('Cần cập nhật')}</Badge>}
                {summary === 'conflict' && <Badge tone="warn">{t('Trỏ nơi khác')}</Badge>}
              </div>
              {summary === 'conflict' && <span className="hint">{conflictText(h)}</span>}
              {h.zone.status !== 'active' && <span className="hint">{t('Zone {zone} đang ở trạng thái "{status}": nameserver của tên miền chưa trỏ về Cloudflare.', { zone: h.zone.name, status: h.zone.status })}</span>}
            </div>
          )}
        </td>
      )}
      {connected && (
        <td>
          {h.zone && !h.error && (
            <div className="row end">
              {(summary === 'create' || summary === 'update') && (
                <button className="btn sm" disabled={busy} onClick={() => onFix(h, false)}>
                  {t('Tạo/sửa bản ghi')}
                </button>
              )}
              {summary === 'conflict' && (
                <button className="btn sm danger" disabled={busy} onClick={() => onFix(h, true)}>
                  {t('Ghi đè')}
                </button>
              )}
              {h.proxied === false && (
                <button className="btn sm" disabled={busy || !sslEnabled} title={sslEnabled ? undefined : t('Cài SSL trước')} onClick={() => onProxy([h.hostname], true)}>
                  {t('Bật proxy')}
                </button>
              )}
              {h.proxied === true && (
                <button className="btn sm" disabled={busy} onClick={() => onProxy([h.hostname], false)}>
                  {t('Tắt proxy')}
                </button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
