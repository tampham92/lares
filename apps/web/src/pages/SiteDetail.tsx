import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_LABELS, LOCALHOST, msg, type AutoDnsInput, type CreateSiteResult, type DatabaseRecord, type LogTail, type LogType, type NodeAppStatus, type Site, type SystemStats, type TrafficStats } from '@lares/shared';
import { auth, del, errMsg, fmtBytes, fmtDate, get, patch, post, put, siteHref, siteLabel, type TaskInfo } from '../api';
import { AiWriter } from '../components/AiWriter';
import { BackupsTab } from '../components/BackupsTab';
import { CloudflareDnsOption } from '../components/CloudflareDnsOption';
import { SiteDnsCard } from '../components/SiteDnsCard';
import { LeadsTab } from '../components/LeadsTab';
import { Alert, Badge, Check, Console, ErrorBox, Field, Tabs, TaskLog } from '../components/ui';
import { WpAdminButton } from '../components/WpAdminButton';
import { WpUpdatesTab, useWpUpdatesTabLabel } from '../components/WpUpdatesTab';
import { locale, t } from '../i18n';

interface SiteDetailResponse {
  site: Site;
  databases: DatabaseRecord[];
  nodeApp: NodeAppStatus | null;
  nodeConfig: { gitUrl?: string; branch?: string; packageManager?: string; installCommand?: string; buildCommand?: string; startCommand?: string; env?: Record<string, string> } | null;
}

type Tab = 'overview' | 'ssl' | 'logs' | 'leads' | 'nextjs' | 'ai' | 'updates' | 'backups' | 'clone' | 'danger';

export function SiteDetail() {
  const id = Number(useParams().id);
  // fresh state (tab, forms) when navigating from one site to another, e.g. to a new clone
  return <SitePage key={id} id={id} />;
}

function SitePage({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['site', id], queryFn: () => get<SiteDetailResponse>(`/api/sites/${id}`) });
  const [tab, setTab] = useState<Tab>('overview');
  const updatesLabel = useWpUpdatesTabLabel(id, q.data?.site.appType === 'wordpress');
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="sub">{t('Đang tải…')}</div>;
  const { site } = q.data;
  const tabs: Array<[Tab, string]> = [
    ['overview', t('Tổng quan')],
    ['ssl', 'SSL'],
    ['logs', t('Log traffic')],
    ['leads', t('Khách liên hệ')],
    ...(site.appType === 'nextjs' ? ([['nextjs', 'Next.js']] as Array<[Tab, string]>) : []),
    ...(site.appType === 'wordpress' ? ([['ai', t('Viết bài AI')], ['updates', updatesLabel]] as Array<[Tab, string]>) : []),
    ['backups', t('Sao lưu')],
    ['clone', t('Nhân bản')],
    ['danger', t('Xoá site')],
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <a href={siteHref(site)} target="_blank" rel="noreferrer">
              {siteLabel(site)}
            </a>
          </h1>
          <div className="row sub">
            <Badge tone="info">{t(APP_LABELS[site.appType])}</Badge>
            {site.status === 'active' ? <Badge tone="ok">{t('Hoạt động')}</Badge> : <Badge tone="warn">{t('Tạm ngưng')}</Badge>}
            {site.ssl.enabled ? <Badge tone="ok">HTTPS</Badge> : <Badge>HTTP</Badge>}
            {site.listenPort && <Badge tone="info">{t('chạy theo port {port}', { port: site.listenPort })}</Badge>}
          </div>
        </div>
        <div className="row">
          <a className="btn" href={siteHref(site)} target="_blank" rel="noreferrer">
            {t('Mở website ↗')}
          </a>
          {site.appType === 'wordpress' && <WpAdminButton siteId={site.id} className="btn primary" />}
        </div>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview data={q.data} />}
      {tab === 'ssl' && <SslTab site={site} />}
      {tab === 'logs' && <LogsTab site={site} />}
      {tab === 'leads' && <LeadsTab site={site} />}
      {tab === 'nextjs' && <NextTab data={q.data} />}
      {tab === 'ai' && <AiWriter site={site} />}
      {tab === 'updates' && <WpUpdatesTab site={site} />}
      {tab === 'backups' && <BackupsTab site={site} />}
      {tab === 'clone' && <CloneTab site={site} dbs={q.data.databases} />}
      {tab === 'danger' && <DangerTab site={site} dbs={q.data.databases} />}
    </>
  );
}

function useRefreshSite(id: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['site', id] });
    void qc.invalidateQueries({ queryKey: ['sites'] });
  };
}

function Overview({ data }: { data: SiteDetailResponse }) {
  return (
    <>
      <OverviewCards data={data} />
      <DomainCard key={`${data.site.domain}-${data.site.listenPort}`} site={data.site} />
    </>
  );
}

function OverviewCards({ data }: { data: SiteDetailResponse }) {
  const { site, databases } = data;
  const refresh = useRefreshSite(site.id);
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => get<SystemStats>('/api/system/stats') });
  const [aliases, setAliases] = useState(site.aliases.join(', '));
  const [php, setPhp] = useState(site.phpVersion ?? '');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const save = async (body: Record<string, unknown>) => {
    setMsg(null);
    try {
      await patch(`/api/sites/${site.id}`, body);
      setMsg({ tone: 'ok', text: t('Đã lưu và reload nginx') });
      refresh();
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>{t('Thông tin')}</h2>
        <div className="kv">
          <div>{t('Thư mục site')}</div>
          <div className="mono">{site.rootPath}</div>
          <div>{site.appType === 'nextjs' ? t('Thư mục app') : 'Web root'}</div>
          <div className="mono">{site.webRoot}</div>
          {site.phpVersion && (
            <>
              <div>PHP</div>
              <div>{site.phpVersion}</div>
            </>
          )}
          {site.appPort && (
            <>
              <div>{t('Port nội bộ')}</div>
              <div className="mono">127.0.0.1:{site.appPort}</div>
            </>
          )}
          <div>{t('Tạo lúc')}</div>
          <div>{fmtDate(site.createdAt)}</div>
          {site.migrationId && (
            <>
              <div>{t('Nguồn')}</div>
              <div>
                <a href={`/migrations/${site.migrationId}`}>Migration #{site.migrationId}</a>
              </div>
            </>
          )}
        </div>
        {databases.length > 0 && (
          <>
            <h3>Database</h3>
            {databases.map((d) => (
              <div key={d.id} className="mono">
                {d.name} / {d.username} {!d.managed && <Badge tone="warn">{t('dùng chung')}</Badge>}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="card stack">
        <h2>{t('Cấu hình')}</h2>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {!site.listenPort && (
        <Field label={t('Alias (cách nhau bởi dấu phẩy)')}>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        )}
        {site.phpVersion && (
          <Field label={t('Phiên bản PHP')}>
            <select value={php} onChange={(e) => setPhp(e.target.value)}>
              {(stats.data?.phpVersions ?? [site.phpVersion]).map((v) => (
                <option key={v} value={v}>
                  PHP {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(!site.listenPort || site.phpVersion) && (
        <div className="row">
          <button
            className="btn primary"
            onClick={() =>
              save({
                aliases: aliases
                  .split(',')
                  .map((a) => a.trim())
                  .filter(Boolean),
                ...(site.phpVersion ? { phpVersion: php } : {}),
              })
            }
          >
            {t('Lưu')}
          </button>
        </div>
        )}
        <Check checked={site.accessLog} onChange={(v) => save({ accessLog: v })}>
          {t('Ghi access log (cần cho thống kê traffic)')}
        </Check>
        <Check checked={site.status === 'disabled'} onChange={(v) => save({ status: v ? 'disabled' : 'active' })}>
          {t('Tạm ngưng site (trả về 503)')}
        </Check>
      </div>
    </div>
  );
}

function DomainCard({ site }: { site: Site }) {
  const refresh = useRefreshSite(site.id);
  const [domain, setDomain] = useState(site.listenPort ? '' : site.domain);
  const [addWww, setAddWww] = useState(true);
  const [cfDns, setCfDns] = useState<AutoDnsInput | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const d = domain.trim().toLowerCase();
  const changed = d !== '' && (site.listenPort !== null || d !== site.domain);
  const hostnames = changed ? [d, ...(addWww && !d.startsWith('www.') ? [`www.${d}`] : [])] : [];

  const submit = async () => {
    setError(null);
    if (!confirm(site.listenPort ? t('Gán tên miền {domain}? Site sẽ không còn chạy ở port {port}.', { domain: d, port: site.listenPort }) : t('Đổi tên miền {old} → {domain}? Chứng chỉ SSL của tên miền cũ sẽ bị gỡ.', { old: site.domain, domain: d }))) return;
    try {
      const aliases = addWww && !d.startsWith('www.') ? [`www.${d}`] : [];
      setTask((await put<TaskInfo>(`/api/sites/${site.id}/domain`, { domain: d, aliases, cloudflareDns: cfDns ?? undefined })).id);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="card stack">
      <h2>{site.listenPort ? t('Gán tên miền thật') : t('Tên miền')}</h2>
      {site.listenPort ? (
        <div className="sub">
          {t('Site đang chạy tạm ở')} <strong>{siteHref(site)}</strong>.{' '}
          {site.appType === 'wordpress'
            ? t('Khi giao diện đã ổn, nhập tên miền để đưa site lên chính thức: Lares đổi vhost sang tên miền, cập nhật lại toàn bộ URL trong WordPress và đóng port {port}.', { port: site.listenPort })
            : t('Khi giao diện đã ổn, nhập tên miền để đưa site lên chính thức: Lares đổi vhost sang tên miền và đóng port {port}.', { port: site.listenPort })}
        </div>
      ) : (
        <div className="sub">{t('Đổi tên miền chính của site. File và database được giữ nguyên.')}</div>
      )}
      <ErrorBox error={error} />
      <div className="row">
        <input style={{ flex: 1, minWidth: 220 }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
        <button className="btn primary" disabled={!changed || !!task} onClick={submit}>
          {site.listenPort ? t('Gán tên miền') : t('Đổi tên miền')}
        </button>
      </div>
      <Check checked={addWww} onChange={setAddWww}>
        {t('Thêm alias www.{domain}', { domain: d || 'example.com' })}
      </Check>
      <CloudflareDnsOption hostnames={hostnames} onChange={setCfDns} />
      {!cfDns && (
        <Alert tone="info">
          {t('Trước hoặc sau khi gán: tạo bản ghi DNS')} <strong>A</strong>{' '}
          {t('cho {domain} (và www) trỏ về IP máy chủ. Khi DNS đã trỏ về, cài SSL ở tab', { domain: d || t('tên miền') })} <strong>SSL</strong>.
        </Alert>
      )}
      {task && <TaskLog taskId={task} onDone={(t) => t.status === 'completed' && refresh()} />}
    </div>
  );
}

function SslTab({ site }: { site: Site }) {
  const refresh = useRefreshSite(site.id);
  const [mode, setMode] = useState<'letsencrypt' | 'custom'>('letsencrypt');
  const [email, setEmail] = useState('');
  const [includeAliases, setIncludeAliases] = useState(true);
  const [forceHttps, setForceHttps] = useState(true);
  const [staging, setStaging] = useState(false);
  const [cert, setCert] = useState('');
  const [key, setKey] = useState('');
  const [task, setTask] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<TaskInfo>) => {
    setError(null);
    try {
      setTask((await fn()).id);
    } catch (e) {
      setError(e);
    }
  };
  const issue = () =>
    run(() =>
      post<TaskInfo>(
        `/api/sites/${site.id}/ssl`,
        mode === 'letsencrypt' ? { type: 'letsencrypt', email, includeAliases, forceHttps, staging } : { type: 'custom', certificate: cert, privateKey: key, forceHttps },
      ),
    );

  const daysLeft = site.ssl.expiresAt ? Math.floor((Date.parse(site.ssl.expiresAt) - Date.now()) / 86_400_000) : null;

  return (
    <>
    <div className="grid cols-2">
      <div className="card stack">
        <h2>{t('Trạng thái SSL')}</h2>
        <ErrorBox error={error} />
        {site.listenPort && <Alert tone="warn">{t("Site chạy theo port (chưa có tên miền) nên không cài được SSL. Let's Encrypt chỉ cấp chứng chỉ cho tên miền thật.")}</Alert>}
        {site.ssl.enabled ? (
          <>
            <div className="kv">
              <div>{t('Loại')}</div>
              <div>{site.ssl.type === 'letsencrypt' ? t("Let's Encrypt (tự gia hạn)") : t('Certificate tự upload')}</div>
              <div>{t('Nhà phát hành')}</div>
              <div>{site.ssl.issuer ?? '—'}</div>
              <div>{t('Tên miền')}</div>
              <div>{site.ssl.domains.join(', ') || '—'}</div>
              <div>{t('Hết hạn')}</div>
              <div>
                {site.ssl.expiresAt ? new Date(site.ssl.expiresAt).toLocaleDateString(locale()) : '—'}{' '}
                {daysLeft !== null && <Badge tone={daysLeft < 14 ? 'warn' : 'ok'}>{t('còn {n} ngày', { n: daysLeft })}</Badge>}
              </div>
            </div>
            <Check
              checked={site.ssl.forceHttps}
              onChange={async (v) => {
                try {
                  await patch(`/api/sites/${site.id}/ssl`, { forceHttps: v });
                  refresh();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              {t('Bắt buộc HTTPS (redirect 301 + HSTS)')}
            </Check>
            <div className="row">
              {site.ssl.type === 'letsencrypt' && (
                <button className="btn" onClick={() => run(() => post<TaskInfo>(`/api/sites/${site.id}/ssl/renew`))}>
                  {t('Gia hạn ngay')}
                </button>
              )}
              <button
                className="btn danger"
                onClick={async () => {
                  if (!confirm(t('Tắt SSL cho site này?'))) return;
                  try {
                    await del(`/api/sites/${site.id}/ssl`, { revoke: true });
                    refresh();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {t('Tắt SSL')}
              </button>
            </div>
          </>
        ) : (
          <Alert tone="warn">{t('Site chưa có SSL.')}</Alert>
        )}
        {task && <TaskLog taskId={task} onDone={refresh} />}
      </div>
      <div className="card stack">
        <h2>{site.ssl.enabled ? t('Cài lại / thay chứng chỉ') : t('Cài SSL')}</h2>
        <Tabs
          tabs={[
            ['letsencrypt', t("Let's Encrypt (miễn phí)")],
            ['custom', 'Upload certificate'],
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'letsencrypt' ? (
          <>
            <Alert tone="info">{t('Tên miền phải trỏ DNS về máy chủ này. Lares dùng xác thực HTTP-01 qua /.well-known/acme-challenge/.')}</Alert>
            <Field label={t('Email nhận thông báo hết hạn')}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            </Field>
            {site.aliases.length > 0 && (
              <Check checked={includeAliases} onChange={setIncludeAliases}>
                {t('Bao gồm alias: {aliases}', { aliases: site.aliases.join(', ') })}
              </Check>
            )}
            <Check checked={staging} onChange={setStaging}>
              {t('Dùng môi trường staging (thử nghiệm, không bị giới hạn rate-limit)')}
            </Check>
          </>
        ) : (
          <>
            <Field label={t('Certificate (PEM, gồm cả chain)')}>
              <textarea value={cert} onChange={(e) => setCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
            </Field>
            <Field label="Private key (PEM)">
              <textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
            </Field>
          </>
        )}
        <Check checked={forceHttps} onChange={setForceHttps}>
          {t('Bắt buộc HTTPS')}
        </Check>
        <div className="row end">
          <button className="btn primary" onClick={issue} disabled={mode === 'letsencrypt' ? !email : !cert || !key}>
            {mode === 'letsencrypt' ? t('Cấp chứng chỉ') : t('Cài certificate')}
          </button>
        </div>
      </div>
    </div>
    {!site.listenPort && <SiteDnsCard site={site} />}
    </>
  );
}

function TopList({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
  const max = rows[0]?.count ?? 1;
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length === 0 && <div className="sub">{t('Không có dữ liệu')}</div>}
      <div className="hbar">
        {rows.map((r) => (
          <FragmentRow key={r.key} k={r.key} v={r.count} pct={r.count / max} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ k, v, pct }: { k: string; v: number; pct: number }) {
  return (
    <>
      <div className="k" title={k}>
        <i style={{ width: `${pct * 100}%` }} />
        <span>{k}</span>
      </div>
      <div className="v">{v.toLocaleString(locale())}</div>
    </>
  );
}

function LogsTab({ site }: { site: Site }) {
  const [hours, setHours] = useState(24);
  const [type, setType] = useState<LogType>('access');
  const [lines, setLines] = useState(200);
  const [filter, setFilter] = useState('');
  const [applied, setApplied] = useState('');
  const stats = useQuery({ queryKey: ['traffic', site.id, hours], queryFn: () => get<TrafficStats>(`/api/sites/${site.id}/logs/stats?hours=${hours}`) });
  const tail = useQuery({
    queryKey: ['tail', site.id, type, lines, applied],
    queryFn: () => get<LogTail>(`/api/sites/${site.id}/logs?type=${type}&lines=${lines}${applied ? `&q=${encodeURIComponent(applied)}` : ''}`),
    refetchInterval: 5000,
  });
  const s = stats.data;
  const maxReq = Math.max(1, ...(s?.timeline.map((t) => t.requests) ?? [1]));

  const download = async () => {
    const res = await fetch(`/api/sites/${site.id}/logs/download?type=${type === 'app' ? 'access' : type}`, { headers: { Authorization: `Bearer ${auth.token}` } });
    if (!res.ok) return alert((await res.json().catch(() => ({ error: res.statusText }))).error);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${site.domain}-${type}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {!site.accessLog && <Alert tone="warn">{t('Access log đang tắt cho site này — bật lại ở tab Tổng quan để thu thập số liệu.')}</Alert>}
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{t('Khoảng thời gian:')}</strong>
        {[
          [1, t('1 giờ')],
          [24, t('24 giờ')],
          [168, t('7 ngày')],
          [720, t('30 ngày')],
        ].map(([h, l]) => (
          <button key={h} className={`btn sm ${hours === h ? 'primary' : ''}`} onClick={() => setHours(h as number)}>
            {l}
          </button>
        ))}
        <button className="btn sm" onClick={() => void stats.refetch()}>
          {t('Làm mới')}
        </button>
      </div>
      <ErrorBox error={stats.error} />
      {s && (
        <>
          <div className="grid cols-4">
            <div className="card stat">
              <div className="label">Requests</div>
              <div className="value">{s.totalRequests.toLocaleString(locale())}</div>
            </div>
            <div className="card stat">
              <div className="label">{t('IP duy nhất')}</div>
              <div className="value">{s.uniqueIps.toLocaleString(locale())}</div>
            </div>
            <div className="card stat">
              <div className="label">{t('Băng thông')}</div>
              <div className="value">{fmtBytes(s.bytesSent)}</div>
            </div>
            <div className="card stat">
              <div className="label">{t('Phản hồi TB')}</div>
              <div className="value">{s.avgResponseMs !== null ? `${s.avgResponseMs} ms` : '—'}</div>
            </div>
          </div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{hours <= 48 ? t('Requests theo giờ') : t('Requests theo ngày')}</h2>
              <div className="row">
                <Badge tone="ok">2xx {s.statusClasses['2xx']}</Badge>
                <Badge tone="info">3xx {s.statusClasses['3xx']}</Badge>
                <Badge tone="warn">4xx {s.statusClasses['4xx']}</Badge>
                <Badge tone="err">5xx {s.statusClasses['5xx']}</Badge>
              </div>
            </div>
            <div className="bars">
              {s.timeline.map((p) => (
                <div
                  key={p.t}
                  className="bar"
                  style={{ height: `${(p.requests / maxReq) * 100}%` }}
                  title={t('{time}: {requests} requests, {bytes}, {errors} lỗi 5xx', { time: new Date(p.t).toLocaleString(locale()), requests: p.requests, bytes: fmtBytes(p.bytes), errors: p.errors })}
                >
                  {p.errors > 0 && <div className="bar err" style={{ height: `${(p.errors / Math.max(1, p.requests)) * 100}%` }} />}
                </div>
              ))}
            </div>
          </div>
          <div className="grid cols-2">
            <TopList title="Top URL" rows={s.topPaths} />
            <TopList title="Top IP" rows={s.topIps} />
            <TopList title="Top Referrer" rows={s.topReferrers} />
            <TopList title="Top User-Agent" rows={s.topUserAgents} />
          </div>
        </>
      )}
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Xem log')}</h2>
          <div className="row">
            <select value={type} onChange={(e) => setType(e.target.value as LogType)} style={{ width: 'auto' }}>
              <option value="access">Access log</option>
              <option value="error">Error log</option>
              {site.appType === 'nextjs' && <option value="app">{t('Log ứng dụng Next.js')}</option>}
            </select>
            <select value={lines} onChange={(e) => setLines(Number(e.target.value))} style={{ width: 'auto' }}>
              {[100, 200, 500, 1000, 5000].map((n) => (
                <option key={n} value={n}>
                  {t('{n} dòng', { n })}
                </option>
              ))}
            </select>
            <input placeholder={t('Lọc (IP, URL, status...)')} value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setApplied(filter)} style={{ width: 220 }} />
            <button className="btn sm" onClick={() => setApplied(filter)}>
              {t('Lọc')}
            </button>
            {type !== 'app' && (
              <>
                <button className="btn sm" onClick={download}>
                  {t('Tải về')}
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!confirm(t('Xoá toàn bộ nội dung {type} log?', { type }))) return;
                    await del(`/api/sites/${site.id}/logs?type=${type}`);
                    void tail.refetch();
                  }}
                >
                  {t('Xoá log')}
                </button>
              </>
            )}
          </div>
        </div>
        {tail.data && (
          <div className="sub mono">
            {tail.data.file} {tail.data.sizeBytes > 0 && `· ${fmtBytes(tail.data.sizeBytes)}`}
          </div>
        )}
        <ErrorBox error={tail.error} />
        <Console lines={(tail.data?.lines ?? []).map((l) => ({ msg: l, level: / (5\d\d) \d+ "/.test(l) || /\[(error|crit|alert|emerg)\]/.test(l) ? 'error' : / (4\d\d) \d+ "/.test(l) || /\[warn\]/.test(l) ? 'warn' : '' }))} />
      </div>
    </>
  );
}

function NextTab({ data }: { data: SiteDetailResponse }) {
  const { site, nodeApp } = data;
  const refresh = useRefreshSite(site.id);
  const cfg = data.nodeConfig ?? {};
  const [form, setForm] = useState({
    gitUrl: cfg.gitUrl ?? '',
    branch: cfg.branch ?? 'main',
    packageManager: cfg.packageManager ?? 'auto',
    installCommand: cfg.installCommand ?? '',
    buildCommand: cfg.buildCommand ?? '',
    startCommand: cfg.startCommand ?? '',
  });
  const [envRows, setEnvRows] = useState<Array<{ k: string; v: string }>>(Object.keys(cfg.env ?? {}).map((k) => ({ k, v: '' })));
  const [task, setTask] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await put(`/api/sites/${site.id}/nextjs`, {
        ...form,
        gitUrl: form.gitUrl || undefined,
        installCommand: form.installCommand || undefined,
        buildCommand: form.buildCommand || undefined,
        startCommand: form.startCommand || undefined,
        env: Object.fromEntries(envRows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])),
      });
      setSaved(true);
      refresh();
    } catch (e) {
      setError(e);
    }
  };

  const action = async (a: 'start' | 'stop' | 'restart') => {
    try {
      await post(`/api/sites/${site.id}/service/${a}`);
      refresh();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card stack">
        <h2>Service</h2>
        <ErrorBox error={error} />
        {nodeApp && (
          <div className="kv">
            <div>systemd unit</div>
            <div className="mono">{nodeApp.service}</div>
            <div>{t('Trạng thái')}</div>
            <div>
              <Badge tone={nodeApp.active === 'active' ? 'ok' : nodeApp.active === 'failed' ? 'err' : 'warn'}>{nodeApp.active}</Badge>
            </div>
            <div>Port</div>
            <div className="mono">127.0.0.1:{nodeApp.port}</div>
            <div>Package manager</div>
            <div>{nodeApp.packageManager ?? t('chưa có package.json')}</div>
          </div>
        )}
        <div className="row">
          <button className="btn primary" onClick={async () => setTask((await post<TaskInfo>(`/api/sites/${site.id}/deploy`)).id)}>
            {form.gitUrl ? t('Pull & Build & khởi động') : t('Build & khởi động')}
          </button>
          <button className="btn" onClick={() => action('restart')}>
            Restart
          </button>
          <button className="btn" onClick={() => action('start')}>
            Start
          </button>
          <button className="btn danger" onClick={() => action('stop')}>
            Stop
          </button>
        </div>
        <Alert tone="info">
          {t('Dữ liệu JSON và file của ứng dụng nằm trong')} <code>{site.webRoot}</code>.{' '}
          {t('Khi deploy lại qua Git, các file không được Git theo dõi (vd. data/*.json đã .gitignore) vẫn được giữ.')}
        </Alert>
        {task && <TaskLog taskId={task} onDone={refresh} />}
      </div>
      <div className="card stack">
        <h2>{t('Cấu hình build')}</h2>
        {saved && <Alert tone="ok">{t('Đã lưu. Bấm “Build & khởi động” để áp dụng.')}</Alert>}
        <div className="form-grid">
          <Field label="Git URL">
            <input value={form.gitUrl} onChange={(e) => setForm({ ...form, gitUrl: e.target.value })} />
          </Field>
          <Field label="Branch">
            <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
          </Field>
          <Field label="Package manager">
            <select value={form.packageManager} onChange={(e) => setForm({ ...form, packageManager: e.target.value })}>
              <option value="auto">{t('Tự nhận')}</option>
              <option value="npm">npm</option>
              <option value="yarn">yarn</option>
              <option value="pnpm">pnpm</option>
            </select>
          </Field>
          <Field label="Install command">
            <input value={form.installCommand} onChange={(e) => setForm({ ...form, installCommand: e.target.value })} placeholder={t('mặc định')} />
          </Field>
          <Field label="Build command">
            <input value={form.buildCommand} onChange={(e) => setForm({ ...form, buildCommand: e.target.value })} placeholder={t('mặc định')} />
          </Field>
          <Field label="Start command">
            <input value={form.startCommand} onChange={(e) => setForm({ ...form, startCommand: e.target.value })} placeholder={t('mặc định')} />
          </Field>
        </div>
        <h3>{t('Biến môi trường')}</h3>
        <div className="sub">{t('Giá trị đã lưu được ẩn; để trống = giữ nguyên giá trị cũ.')}</div>
        {envRows.map((r, i) => (
          <div className="row" key={i}>
            <input style={{ flex: 1 }} value={r.k} placeholder="KEY" onChange={(e) => setEnvRows(envRows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
            <input style={{ flex: 2 }} value={r.v} placeholder={t('(giữ nguyên)')} onChange={(e) => setEnvRows(envRows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
            <button className="btn sm danger" onClick={() => setEnvRows(envRows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setEnvRows([...envRows, { k: '', v: '' }])}>
            {t('+ Thêm biến')}
          </button>
        </div>
        <div className="row end">
          <button className="btn primary" onClick={save}>
            {t('Lưu cấu hình')}
          </button>
        </div>
      </div>
    </div>
  );
}

const CLONE_NOTES: Partial<Record<Site['appType'], string>> = {
  wordpress: msg('WordPress: database được sao chép sang database mới, wp-config.php trỏ sang database đó và toàn bộ URL được đổi sang địa chỉ mới.'),
  nextjs: msg('Next.js: chạy bằng service riêng trên port nội bộ mới, dùng lại bản build và biến môi trường của site nguồn.'),
  laravel: msg('Laravel: .env được cập nhật DB_* và APP_URL theo database và địa chỉ mới.'),
  php: msg('PHP: nếu dùng .env, DB_* và APP_URL được cập nhật; cấu hình database ở file khác cần sửa tay.'),
};

function CloneTab({ site, dbs }: { site: Site; dbs: DatabaseRecord[] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [domain, setDomain] = useState('');
  const [listenPort, setListenPort] = useState('');
  const [addWww, setAddWww] = useState(true);
  const [task, setTask] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CreateSiteResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const d = domain.trim().toLowerCase();
  const portMode = d === '' || d === LOCALHOST;
  const note = CLONE_NOTES[site.appType];

  const submit = async () => {
    setError(null);
    setResult(null);
    const body: Record<string, unknown> = {
      domain: d || LOCALHOST,
      aliases: !portMode && addWww && !d.startsWith('www.') ? [`www.${d}`] : [],
      publicHost: window.location.hostname,
    };
    if (portMode && listenPort) body.listenPort = Number(listenPort);
    try {
      setTask((await post<TaskInfo>(`/api/sites/${site.id}/clone`, body)).id);
      setRunning(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card stack">
        <h2>{t('Nhân bản site')}</h2>
        <div className="sub">
          {t('Tạo một site mới giống hệt')} <strong>{siteLabel(site)}</strong>{' '}
          {t('để thử giao diện, plugin hay làm staging. Site hiện tại không bị thay đổi.')}
        </div>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field
            label={t('Tên miền cho bản sao')}
            hint={
              <>
                {t('Để trống (hoặc nhập')} <code>localhost</code>
                {t(') để chạy qua {url}', { url: `http://${window.location.hostname}:PORT` })}
              </>
            }
          >
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="staging.example.com" />
          </Field>
          {portMode && (
            <Field label="Port" hint={t('Bỏ trống để Lares tự chọn port trống (từ 8001)')}>
              <input type="number" min={1024} max={65535} value={listenPort} onChange={(e) => setListenPort(e.target.value)} placeholder={t('tự động')} />
            </Field>
          )}
        </div>
        {!portMode && (
          <Check checked={addWww} onChange={setAddWww}>
            {t('Thêm alias www.{domain}', { domain: d })}
          </Check>
        )}
        <div className="row end">
          <button className="btn primary" disabled={running} onClick={submit}>
            {t('Nhân bản')}
          </button>
        </div>
        {result && (
          <Alert tone="ok">
            {t('Đã tạo bản sao tại')}{' '}
            <a href={result.url} target="_blank" rel="noreferrer">
              <strong>{result.url}</strong>
            </a>
            {result.database && (
              <>
                {' '}
                · database <code>{result.database.name}</code>
              </>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm primary" onClick={() => nav(`/sites/${result.site.id}`)}>
                {t('Quản lý site mới')}
              </button>
            </div>
          </Alert>
        )}
        {task && (
          <TaskLog
            taskId={task}
            onDone={(t) => {
              setRunning(false);
              void qc.invalidateQueries({ queryKey: ['sites'] });
              if (t.status === 'completed') setResult(t.result as CreateSiteResult);
            }}
          />
        )}
      </div>
      <div className="card stack">
        <h2>{t('Những gì được sao chép')}</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            {t('Toàn bộ thư mục')} <code>{site.rootPath}</code>
          </li>
          {dbs.length > 0 || site.appType === 'wordpress' ? (
            <li>{t('Database: {dbs} → database mới, user và mật khẩu mới', { dbs: dbs.map((x) => x.name).join(', ') || t('database trong wp-config.php') })}</li>
          ) : null}
          {site.phpVersion && <li>{t('Phiên bản PHP {version}', { version: site.phpVersion })}</li>}
          {note && <li>{t(note)}</li>}
        </ul>
        <h3>{t('Không sao chép')}</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Chứng chỉ SSL: bản sao chạy HTTP, cài SSL ở tab SSL của site mới')}</li>
          <li>{t('Log traffic')}</li>
          <li>{t('Alias của site nguồn')}</li>
        </ul>
        {site.appType === 'wordpress' && (
          <Alert tone="info">{t('Đăng nhập wp-admin của bản sao bằng tài khoản WordPress của site nguồn.')}</Alert>
        )}
      </div>
    </div>
  );
}

function DangerTab({ site, dbs }: { site: Site; dbs: DatabaseRecord[] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [opts, setOpts] = useState({ removeFiles: true, removeDatabases: true, removeLogs: true, revokeSsl: true });
  const [confirmText, setConfirmText] = useState('');
  const [task, setTask] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const remove = async () => {
    setError(null);
    try {
      setTask((await del<TaskInfo>(`/api/sites/${site.id}`, opts)).id);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <h2>{t('Xoá site {domain}', { domain: site.domain })}</h2>
      <ErrorBox error={error} />
      <Check checked={opts.removeFiles} onChange={(v) => setOpts({ ...opts, removeFiles: v })}>
        {t('Xoá toàn bộ file trong')} <code>{site.rootPath}</code>
      </Check>
      {dbs.length > 0 && (
        <Check checked={opts.removeDatabases} onChange={(v) => setOpts({ ...opts, removeDatabases: v })}>
          {t('Xoá database: {names}', { names: dbs.filter((d) => d.managed).map((d) => d.name).join(', ') || t('(không có database do Lares quản lý)') })}
        </Check>
      )}
      <Check checked={opts.removeLogs} onChange={(v) => setOpts({ ...opts, removeLogs: v })}>
        {t('Xoá log truy cập')}
      </Check>
      {site.ssl.type === 'letsencrypt' && (
        <Check checked={opts.revokeSsl} onChange={(v) => setOpts({ ...opts, revokeSsl: v })}>
          {t("Xoá chứng chỉ Let's Encrypt")}
        </Check>
      )}
      <Field label={t('Gõ "{domain}" để xác nhận', { domain: site.domain })}>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      </Field>
      <div className="row end">
        <button className="btn danger solid" disabled={confirmText !== site.domain || !!task} onClick={remove}>
          {t('Xoá vĩnh viễn')}
        </button>
      </div>
      {task && (
        <TaskLog
          taskId={task}
          onDone={(t) => {
            void qc.invalidateQueries({ queryKey: ['sites'] });
            if (t.status === 'completed') setTimeout(() => nav('/sites'), 1000);
          }}
        />
      )}
    </div>
  );
}
