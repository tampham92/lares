import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DOMAIN_RE, type AutoDnsInput, type CloudflareDnsView, type DnsPlanResult, type DnsRecordBrief, type HostnameDnsPlan } from '@lares/shared';
import { get, post } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Check } from './ui';

/** Connection state of the Cloudflare DNS integration (token itself never reaches the browser). */
export const useCloudflareDns = () => useQuery({ queryKey: ['cloudflare-dns'], queryFn: () => get<CloudflareDnsView>('/api/dns/cloudflare'), staleTime: 60_000 });

export function useDebounced<T>(value: T, ms = 500): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Preview of what Lares would do on Cloudflare for these hostnames (only when connected). */
export function useDnsPlan(hostnames: string[], opts: { ipv4Only?: boolean } = {}) {
  const cf = useCloudflareDns();
  const key = useDebounced(hostnames.filter((h) => DOMAIN_RE.test(h)).join(' '));
  const ipv4Only = opts.ipv4Only ?? false;
  const plan = useQuery({
    queryKey: ['dns-plan', key, ipv4Only],
    queryFn: () => post<DnsPlanResult>('/api/dns/plan', { hostnames: key.split(' '), ipv4Only }),
    enabled: !!cf.data?.connected && key !== '',
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const current = hostnames.filter((h) => DOMAIN_RE.test(h)).join(' ');
  // the answer matches what is on screen (not a previous domain while typing)
  const fresh = !!plan.data && !plan.isPlaceholderData && key === current;
  return { connected: !!cf.data?.connected, plan: key ? plan : null, fresh };
}

export type DnsSummary = 'ok' | 'create' | 'update' | 'conflict' | 'none' | 'outside' | 'error';

/** One word for a hostname's plan: the worst of its A/AAAA actions. */
export function summarize(h: HostnameDnsPlan): DnsSummary {
  if (!h.zone) return 'outside';
  if (h.error) return 'error';
  const actions = h.plan.map((p) => p.action);
  if (actions.includes('conflict')) return 'conflict';
  if (actions.includes('update') || actions.includes('delete')) return 'update';
  if (actions.includes('create')) return 'create';
  return actions.includes('ok') ? 'ok' : 'none';
}

/** Records that block the plan, e.g. "A 93.184.216.34 (proxy)". */
export const conflictText = (h: HostnameDnsPlan) => {
  const recs: DnsRecordBrief[] = h.plan.filter((p) => p.action === 'conflict').flatMap((p) => p.existing);
  return [...new Map(recs.map((r) => [r.id, r])).values()].map((r) => `${r.type} ${r.content}${r.proxied ? ' (proxy)' : ''}`).join(', ');
};

export function SummaryBadge({ value }: { value: DnsSummary }) {
  switch (value) {
    case 'ok':
      return <Badge tone="ok">{t('đã đúng')}</Badge>;
    case 'create':
      return <Badge tone="info">{t('sẽ tạo mới')}</Badge>;
    case 'update':
      return <Badge tone="info">{t('sẽ cập nhật')}</Badge>;
    case 'conflict':
      return <Badge tone="warn">{t('đang trỏ nơi khác')}</Badge>;
    case 'error':
      return <Badge tone="err">{t('lỗi')}</Badge>;
    case 'outside':
      return <Badge>{t('ngoài Cloudflare')}</Badge>;
    default:
      return null;
  }
}

/**
 * "Create DNS records on Cloudflare" for the Add site / Assign domain forms. Shown only when a token
 * is connected and the domain is in one of its zones; reports null when not applicable or unticked.
 */
export function CloudflareDnsOption({ hostnames, onChange }: { hostnames: string[]; onChange: (v: AutoDnsInput | null) => void }) {
  const { connected, plan, fresh } = useDnsPlan(hostnames);
  const [enabled, setEnabled] = useState(true);
  const [overwrite, setOverwrite] = useState<string[]>([]);
  const rows = fresh ? (plan?.data?.hostnames ?? []) : [];
  const inZone = rows.filter((h) => h.zone);
  const available = connected && inZone.length > 0;
  const chosen = overwrite.filter((h) => inZone.some((r) => r.hostname === h && summarize(r) === 'conflict'));

  const notify = useRef(onChange);
  notify.current = onChange;
  const signature = available && enabled ? chosen.join(' ') : null;
  useEffect(() => {
    notify.current(signature === null ? null : { overwrite: signature ? signature.split(' ') : [] });
  }, [signature]);

  if (!hostnames.length) return null;
  if (!connected) {
    return (
      <div className="hint">
        {t('Mẹo: kết nối Cloudflare trong')} <Link to="/settings">{t('Cài đặt')}</Link> {t('để Lares tự tạo bản ghi DNS cho tên miền.')}
      </div>
    );
  }
  if (!plan) return null;
  if (!fresh || !plan.data) return <div className="hint">{t('Đang kiểm tra DNS trên Cloudflare…')}</div>;
  if (!available) {
    return <div className="hint">{t('{domain} không thuộc zone nào của tài khoản Cloudflare đã kết nối - hãy tự tạo bản ghi DNS.', { domain: hostnames[0]! })}</div>;
  }
  const ips = [plan.data.ipv4, plan.data.ipv6].filter(Boolean).join(', ');

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Check checked={enabled} onChange={setEnabled}>
        {t('Tự tạo bản ghi DNS trên Cloudflare')}
      </Check>
      {enabled && (
        <>
          <div className="hint">
            {ips
              ? t('Bản ghi A/AAAA trỏ về {ip}, chế độ DNS only (đám mây xám) để cấp SSL Let\'s Encrypt được ngay. Có thể bật proxy sau khi cài SSL.', { ip: ips })
              : t('Chưa xác định được IP public của máy chủ - nhập IP trong Cài đặt → Cloudflare DNS.')}
          </div>
          {rows.map((h) => {
            const s = summarize(h);
            return (
              <div key={h.hostname} className="stack" style={{ gap: 4 }}>
                <div className="row">
                  <span className="mono">{h.hostname}</span>
                  <SummaryBadge value={s} />
                </div>
                {s === 'error' && <div className="hint">{h.error}</div>}
                {s === 'conflict' && (
                  <Alert tone="warn">
                    <div className="stack" style={{ gap: 8 }}>
                      <div>{t('Đang có bản ghi {records}. Lares không đổi bản ghi này nếu bạn không chọn ghi đè.', { records: conflictText(h) })}</div>
                      <Check checked={overwrite.includes(h.hostname)} onChange={(v) => setOverwrite((o) => (v ? [...o, h.hostname] : o.filter((x) => x !== h.hostname)))}>
                        {t('Ghi đè, trỏ {hostname} về máy chủ này', { hostname: h.hostname })}
                      </Check>
                    </div>
                  </Alert>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
