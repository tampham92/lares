import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_LABELS, type DatabaseRecord, type LogTail, type LogType, type NodeAppStatus, type Site, type SystemStats, type TrafficStats } from '@tpanel/shared';
import { auth, del, errMsg, fmtBytes, fmtDate, get, patch, post, put, siteHref, siteLabel, type TaskInfo } from '../api';
import { Alert, Badge, Check, Console, ErrorBox, Field, Tabs, TaskLog } from '../components/ui';

interface SiteDetailResponse {
  site: Site;
  databases: DatabaseRecord[];
  nodeApp: NodeAppStatus | null;
  nodeConfig: { gitUrl?: string; branch?: string; packageManager?: string; installCommand?: string; buildCommand?: string; startCommand?: string; env?: Record<string, string> } | null;
}

type Tab = 'overview' | 'ssl' | 'logs' | 'nextjs' | 'danger';

export function SiteDetail() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['site', id], queryFn: () => get<SiteDetailResponse>(`/api/sites/${id}`) });
  const [tab, setTab] = useState<Tab>('overview');
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="sub">Đang tải…</div>;
  const { site } = q.data;
  const tabs: Array<[Tab, string]> = [
    ['overview', 'Tổng quan'],
    ['ssl', 'SSL'],
    ['logs', 'Log traffic'],
    ...(site.appType === 'nextjs' ? ([['nextjs', 'Next.js']] as Array<[Tab, string]>) : []),
    ['danger', 'Xoá site'],
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
            <Badge tone="info">{APP_LABELS[site.appType]}</Badge>
            {site.status === 'active' ? <Badge tone="ok">Hoạt động</Badge> : <Badge tone="warn">Tạm ngưng</Badge>}
            {site.ssl.enabled ? <Badge tone="ok">HTTPS</Badge> : <Badge>HTTP</Badge>}
            {site.listenPort && <Badge tone="info">chạy theo port {site.listenPort}</Badge>}
          </div>
        </div>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview data={q.data} />}
      {tab === 'ssl' && <SslTab site={site} />}
      {tab === 'logs' && <LogsTab site={site} />}
      {tab === 'nextjs' && <NextTab data={q.data} />}
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
      setMsg({ tone: 'ok', text: 'Đã lưu và reload nginx' });
      refresh();
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Thông tin</h2>
        <div className="kv">
          <div>Thư mục site</div>
          <div className="mono">{site.rootPath}</div>
          <div>{site.appType === 'nextjs' ? 'Thư mục app' : 'Web root'}</div>
          <div className="mono">{site.webRoot}</div>
          {site.phpVersion && (
            <>
              <div>PHP</div>
              <div>{site.phpVersion}</div>
            </>
          )}
          {site.appPort && (
            <>
              <div>Port nội bộ</div>
              <div className="mono">127.0.0.1:{site.appPort}</div>
            </>
          )}
          <div>Tạo lúc</div>
          <div>{fmtDate(site.createdAt)}</div>
          {site.migrationId && (
            <>
              <div>Nguồn</div>
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
                {d.name} / {d.username} {!d.managed && <Badge tone="warn">dùng chung</Badge>}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="card stack">
        <h2>Cấu hình</h2>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Alias (cách nhau bởi dấu phẩy)">
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        {site.phpVersion && (
          <Field label="Phiên bản PHP">
            <select value={php} onChange={(e) => setPhp(e.target.value)}>
              {(stats.data?.phpVersions ?? [site.phpVersion]).map((v) => (
                <option key={v} value={v}>
                  PHP {v}
                </option>
              ))}
            </select>
          </Field>
        )}
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
            Lưu
          </button>
        </div>
        <Check checked={site.accessLog} onChange={(v) => save({ accessLog: v })}>
          Ghi access log (cần cho thống kê traffic)
        </Check>
        <Check checked={site.status === 'disabled'} onChange={(v) => save({ status: v ? 'disabled' : 'active' })}>
          Tạm ngưng site (trả về 503)
        </Check>
      </div>
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
    <div className="grid cols-2">
      <div className="card stack">
        <h2>Trạng thái SSL</h2>
        <ErrorBox error={error} />
        {site.listenPort && <Alert tone="warn">Site chạy theo port (chưa có tên miền) nên không cài được SSL. Let&apos;s Encrypt chỉ cấp chứng chỉ cho tên miền thật.</Alert>}
        {site.ssl.enabled ? (
          <>
            <div className="kv">
              <div>Loại</div>
              <div>{site.ssl.type === 'letsencrypt' ? "Let's Encrypt (tự gia hạn)" : 'Certificate tự upload'}</div>
              <div>Nhà phát hành</div>
              <div>{site.ssl.issuer ?? '—'}</div>
              <div>Tên miền</div>
              <div>{site.ssl.domains.join(', ') || '—'}</div>
              <div>Hết hạn</div>
              <div>
                {site.ssl.expiresAt ? new Date(site.ssl.expiresAt).toLocaleDateString('vi-VN') : '—'}{' '}
                {daysLeft !== null && <Badge tone={daysLeft < 14 ? 'warn' : 'ok'}>còn {daysLeft} ngày</Badge>}
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
              Bắt buộc HTTPS (redirect 301 + HSTS)
            </Check>
            <div className="row">
              {site.ssl.type === 'letsencrypt' && (
                <button className="btn" onClick={() => run(() => post<TaskInfo>(`/api/sites/${site.id}/ssl/renew`))}>
                  Gia hạn ngay
                </button>
              )}
              <button
                className="btn danger"
                onClick={async () => {
                  if (!confirm('Tắt SSL cho site này?')) return;
                  try {
                    await del(`/api/sites/${site.id}/ssl`, { revoke: true });
                    refresh();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Tắt SSL
              </button>
            </div>
          </>
        ) : (
          <Alert tone="warn">Site chưa có SSL.</Alert>
        )}
        {task && <TaskLog taskId={task} onDone={refresh} />}
      </div>
      <div className="card stack">
        <h2>{site.ssl.enabled ? 'Cài lại / thay chứng chỉ' : 'Cài SSL'}</h2>
        <Tabs
          tabs={[
            ['letsencrypt', "Let's Encrypt (miễn phí)"],
            ['custom', 'Upload certificate'],
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'letsencrypt' ? (
          <>
            <Alert tone="info">Tên miền phải trỏ DNS về máy chủ này. TPanel dùng xác thực HTTP-01 qua /.well-known/acme-challenge/.</Alert>
            <Field label="Email nhận thông báo hết hạn">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            </Field>
            {site.aliases.length > 0 && (
              <Check checked={includeAliases} onChange={setIncludeAliases}>
                Bao gồm alias: {site.aliases.join(', ')}
              </Check>
            )}
            <Check checked={staging} onChange={setStaging}>
              Dùng môi trường staging (thử nghiệm, không bị giới hạn rate-limit)
            </Check>
          </>
        ) : (
          <>
            <Field label="Certificate (PEM, gồm cả chain)">
              <textarea value={cert} onChange={(e) => setCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
            </Field>
            <Field label="Private key (PEM)">
              <textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
            </Field>
          </>
        )}
        <Check checked={forceHttps} onChange={setForceHttps}>
          Bắt buộc HTTPS
        </Check>
        <div className="row end">
          <button className="btn primary" onClick={issue} disabled={mode === 'letsencrypt' ? !email : !cert || !key}>
            {mode === 'letsencrypt' ? 'Cấp chứng chỉ' : 'Cài certificate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
  const max = rows[0]?.count ?? 1;
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length === 0 && <div className="sub">Không có dữ liệu</div>}
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
      <div className="v">{v.toLocaleString('vi-VN')}</div>
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
      {!site.accessLog && <Alert tone="warn">Access log đang tắt cho site này — bật lại ở tab Tổng quan để thu thập số liệu.</Alert>}
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>Khoảng thời gian:</strong>
        {[
          [1, '1 giờ'],
          [24, '24 giờ'],
          [168, '7 ngày'],
          [720, '30 ngày'],
        ].map(([h, l]) => (
          <button key={h} className={`btn sm ${hours === h ? 'primary' : ''}`} onClick={() => setHours(h as number)}>
            {l}
          </button>
        ))}
        <button className="btn sm" onClick={() => void stats.refetch()}>
          Làm mới
        </button>
      </div>
      <ErrorBox error={stats.error} />
      {s && (
        <>
          <div className="grid cols-4">
            <div className="card stat">
              <div className="label">Requests</div>
              <div className="value">{s.totalRequests.toLocaleString('vi-VN')}</div>
            </div>
            <div className="card stat">
              <div className="label">IP duy nhất</div>
              <div className="value">{s.uniqueIps.toLocaleString('vi-VN')}</div>
            </div>
            <div className="card stat">
              <div className="label">Băng thông</div>
              <div className="value">{fmtBytes(s.bytesSent)}</div>
            </div>
            <div className="card stat">
              <div className="label">Phản hồi TB</div>
              <div className="value">{s.avgResponseMs !== null ? `${s.avgResponseMs} ms` : '—'}</div>
            </div>
          </div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Requests theo {hours <= 48 ? 'giờ' : 'ngày'}</h2>
              <div className="row">
                <Badge tone="ok">2xx {s.statusClasses['2xx']}</Badge>
                <Badge tone="info">3xx {s.statusClasses['3xx']}</Badge>
                <Badge tone="warn">4xx {s.statusClasses['4xx']}</Badge>
                <Badge tone="err">5xx {s.statusClasses['5xx']}</Badge>
              </div>
            </div>
            <div className="bars">
              {s.timeline.map((t) => (
                <div
                  key={t.t}
                  className="bar"
                  style={{ height: `${(t.requests / maxReq) * 100}%` }}
                  title={`${new Date(t.t).toLocaleString('vi-VN')}: ${t.requests} requests, ${fmtBytes(t.bytes)}, ${t.errors} lỗi 5xx`}
                >
                  {t.errors > 0 && <div className="bar err" style={{ height: `${(t.errors / Math.max(1, t.requests)) * 100}%` }} />}
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
          <h2>Xem log</h2>
          <div className="row">
            <select value={type} onChange={(e) => setType(e.target.value as LogType)} style={{ width: 'auto' }}>
              <option value="access">Access log</option>
              <option value="error">Error log</option>
              {site.appType === 'nextjs' && <option value="app">Log ứng dụng Next.js</option>}
            </select>
            <select value={lines} onChange={(e) => setLines(Number(e.target.value))} style={{ width: 'auto' }}>
              {[100, 200, 500, 1000, 5000].map((n) => (
                <option key={n} value={n}>
                  {n} dòng
                </option>
              ))}
            </select>
            <input placeholder="Lọc (IP, URL, status...)" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setApplied(filter)} style={{ width: 220 }} />
            <button className="btn sm" onClick={() => setApplied(filter)}>
              Lọc
            </button>
            {type !== 'app' && (
              <>
                <button className="btn sm" onClick={download}>
                  Tải về
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!confirm(`Xoá toàn bộ nội dung ${type} log?`)) return;
                    await del(`/api/sites/${site.id}/logs?type=${type}`);
                    void tail.refetch();
                  }}
                >
                  Xoá log
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
            <div>Trạng thái</div>
            <div>
              <Badge tone={nodeApp.active === 'active' ? 'ok' : nodeApp.active === 'failed' ? 'err' : 'warn'}>{nodeApp.active}</Badge>
            </div>
            <div>Port</div>
            <div className="mono">127.0.0.1:{nodeApp.port}</div>
            <div>Package manager</div>
            <div>{nodeApp.packageManager ?? 'chưa có package.json'}</div>
          </div>
        )}
        <div className="row">
          <button className="btn primary" onClick={async () => setTask((await post<TaskInfo>(`/api/sites/${site.id}/deploy`)).id)}>
            {form.gitUrl ? 'Pull & Build & khởi động' : 'Build & khởi động'}
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
          Dữ liệu JSON và file của ứng dụng nằm trong <code>{site.webRoot}</code>. Khi deploy lại qua Git, các file không được Git theo dõi (vd. data/*.json đã .gitignore) vẫn được giữ.
        </Alert>
        {task && <TaskLog taskId={task} onDone={refresh} />}
      </div>
      <div className="card stack">
        <h2>Cấu hình build</h2>
        {saved && <Alert tone="ok">Đã lưu. Bấm “Build &amp; khởi động” để áp dụng.</Alert>}
        <div className="form-grid">
          <Field label="Git URL">
            <input value={form.gitUrl} onChange={(e) => setForm({ ...form, gitUrl: e.target.value })} />
          </Field>
          <Field label="Branch">
            <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
          </Field>
          <Field label="Package manager">
            <select value={form.packageManager} onChange={(e) => setForm({ ...form, packageManager: e.target.value })}>
              <option value="auto">Tự nhận</option>
              <option value="npm">npm</option>
              <option value="yarn">yarn</option>
              <option value="pnpm">pnpm</option>
            </select>
          </Field>
          <Field label="Install command">
            <input value={form.installCommand} onChange={(e) => setForm({ ...form, installCommand: e.target.value })} placeholder="mặc định" />
          </Field>
          <Field label="Build command">
            <input value={form.buildCommand} onChange={(e) => setForm({ ...form, buildCommand: e.target.value })} placeholder="mặc định" />
          </Field>
          <Field label="Start command">
            <input value={form.startCommand} onChange={(e) => setForm({ ...form, startCommand: e.target.value })} placeholder="mặc định" />
          </Field>
        </div>
        <h3>Biến môi trường</h3>
        <div className="sub">Giá trị đã lưu được ẩn; để trống = giữ nguyên giá trị cũ.</div>
        {envRows.map((r, i) => (
          <div className="row" key={i}>
            <input style={{ flex: 1 }} value={r.k} placeholder="KEY" onChange={(e) => setEnvRows(envRows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
            <input style={{ flex: 2 }} value={r.v} placeholder="(giữ nguyên)" onChange={(e) => setEnvRows(envRows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
            <button className="btn sm danger" onClick={() => setEnvRows(envRows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setEnvRows([...envRows, { k: '', v: '' }])}>
            + Thêm biến
          </button>
        </div>
        <div className="row end">
          <button className="btn primary" onClick={save}>
            Lưu cấu hình
          </button>
        </div>
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
      <h2>Xoá site {site.domain}</h2>
      <ErrorBox error={error} />
      <Check checked={opts.removeFiles} onChange={(v) => setOpts({ ...opts, removeFiles: v })}>
        Xoá toàn bộ file trong <code>{site.rootPath}</code>
      </Check>
      {dbs.length > 0 && (
        <Check checked={opts.removeDatabases} onChange={(v) => setOpts({ ...opts, removeDatabases: v })}>
          Xoá database: {dbs.filter((d) => d.managed).map((d) => d.name).join(', ') || '(không có database do TPanel quản lý)'}
        </Check>
      )}
      <Check checked={opts.removeLogs} onChange={(v) => setOpts({ ...opts, removeLogs: v })}>
        Xoá log truy cập
      </Check>
      {site.ssl.type === 'letsencrypt' && (
        <Check checked={opts.revokeSsl} onChange={(v) => setOpts({ ...opts, revokeSsl: v })}>
          Xoá chứng chỉ Let&apos;s Encrypt
        </Check>
      )}
      <Field label={`Gõ "${site.domain}" để xác nhận`}>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      </Field>
      <div className="row end">
        <button className="btn danger solid" disabled={confirmText !== site.domain || !!task} onClick={remove}>
          Xoá vĩnh viễn
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
