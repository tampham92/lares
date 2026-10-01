import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALHOST, SITE_TYPES, type Branding, type CreateSiteResult, type SiteType, type SystemStats } from '@tpanel/shared';
import { get, post, type TaskInfo } from '../api';
import { TemplatePicker } from '../components/TemplatePicker';
import { Alert, Check, ErrorBox, Field, TaskLog } from '../components/ui';

const TYPE_INFO: Record<SiteType, { title: string; desc: string }> = {
  wordpress: { title: 'WordPress', desc: 'Tự cài WordPress + database, chọn được giao diện mẫu có sẵn nội dung' },
  nextjs: { title: 'Next.js', desc: 'Node.js app chạy bằng systemd, Nginx reverse proxy. Không cần database (dữ liệu JSON).' },
  php: { title: 'PHP', desc: 'Site PHP thuần / framework (Laravel, CodeIgniter...)' },
  static: { title: 'HTML tĩnh', desc: 'HTML/CSS/JS, có giao diện mẫu dựng sẵn hoặc Next.js static export' },
};

export function SiteNew() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => get<SystemStats>('/api/system/stats') });
  const [type, setType] = useState<SiteType>('wordpress');
  const [domain, setDomain] = useState('');
  const [addWww, setAddWww] = useState(true);
  const [php, setPhp] = useState('');
  const [wp, setWp] = useState({ title: '', adminUser: '', adminPassword: '', adminEmail: '', locale: 'vi' });
  const [next, setNext] = useState({ gitUrl: '', branch: 'main', packageManager: 'auto', installCommand: '', buildCommand: '', startCommand: '', env: '' });
  const [createDb, setCreateDb] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [branding, setBranding] = useState<Branding>({});
  const [listenPort, setListenPort] = useState('');
  const [task, setTask] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSiteResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const d = domain.trim().toLowerCase() || LOCALHOST;
    const portMode = d === LOCALHOST;
    const aliases = !portMode && addWww && !d.startsWith('www.') ? [`www.${d}`] : [];
    const body: Record<string, unknown> = { type, domain: d, aliases, publicHost: window.location.hostname };
    if (portMode && listenPort) body.listenPort = Number(listenPort);
    if (type === 'wordpress' || type === 'static') {
      body.template = template ?? undefined;
      body.branding = Object.fromEntries(Object.entries(branding).filter(([, v]) => typeof v === 'string' && v.trim()));
    }
    if (type === 'wordpress' || type === 'php') body.phpVersion = php || undefined;
    if (type === 'wordpress') body.wordpress = wp;
    if (type === 'php') body.createDatabase = createDb;
    if (type === 'nextjs') {
      const env: Record<string, string> = {};
      for (const line of next.env.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      body.nextjs = {
        gitUrl: next.gitUrl || undefined,
        branch: next.branch || 'main',
        packageManager: next.packageManager,
        installCommand: next.installCommand || undefined,
        buildCommand: next.buildCommand || undefined,
        startCommand: next.startCommand || undefined,
        env,
      };
    }
    try {
      const t = await post<TaskInfo>('/api/sites', body);
      setTask(t.id);
    } catch (err) {
      setError(err);
    }
  };

  const onDone = (t: TaskInfo) => {
    void qc.invalidateQueries({ queryKey: ['sites'] });
    if (t.status === 'completed') setResult(t.result as CreateSiteResult);
  };

  if (task) {
    return (
      <>
        <div className="page-head">
          <h1>{result ? 'Đã tạo website' : `Đang tạo ${domain || 'site'}`}</h1>
        </div>
        {result && (
          <div className="card stack">
            <div className="kv">
              <div>Địa chỉ truy cập</div>
              <div>
                <a href={result.url} target="_blank" rel="noreferrer">
                  <strong>{result.url}</strong>
                </a>
              </div>
              {result.wordpressAdmin && (
                <>
                  <div>Trang quản trị WordPress</div>
                  <div>
                    <a href={result.wordpressAdmin.url} target="_blank" rel="noreferrer">
                      {result.wordpressAdmin.url}
                    </a>
                  </div>
                  <div>Tài khoản / mật khẩu</div>
                  <div className="mono">
                    {result.wordpressAdmin.user} / {result.wordpressAdmin.password}
                  </div>
                </>
              )}
              {result.database && (
                <>
                  <div>Database</div>
                  <div className="mono">
                    {result.database.name} / {result.database.username} / {result.database.password}
                  </div>
                </>
              )}
            </div>
            {result.wordpressAdmin && <Alert tone="warn">Lưu lại mật khẩu WordPress — TPanel chỉ hiển thị một lần.</Alert>}
            {result.site.listenPort && (
              <Alert tone="info">
                Site chạy theo port {result.site.listenPort}. Nếu VPS có firewall của nhà cung cấp (AWS, GCP, Vultr…), hãy mở thêm port này.
              </Alert>
            )}
            <div className="row">
              <a className="btn primary" href={result.url} target="_blank" rel="noreferrer">
                Mở website
              </a>
              <button className="btn" onClick={() => nav(`/sites/${result.site.id}`)}>
                Quản lý site
              </button>
            </div>
          </div>
        )}
        <div className="card">
          <TaskLog taskId={task} onDone={onDone} />
        </div>
      </>
    );
  }

  const portMode = domain.trim().toLowerCase() === LOCALHOST || domain.trim() === '';

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div>
          <h1>Thêm website</h1>
          <div className="sub">Chọn loại site, TPanel sẽ tạo vhost Nginx, thư mục và runtime tương ứng</div>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {SITE_TYPES.map((t) => (
          <div
            key={t}
            className="card"
            onClick={() => setType(t)}
            style={{ cursor: 'pointer', marginBottom: 0, borderColor: type === t ? 'var(--primary)' : undefined, outline: type === t ? '2px solid var(--primary-soft)' : undefined }}
          >
            <strong>{TYPE_INFO[t].title}</strong>
            <div className="sub">{TYPE_INFO[t].desc}</div>
          </div>
        ))}
      </div>
      <div className="card stack">
        <div className="form-grid">
          <Field label="Tên miền" hint={<>Ví dụ: example.com — hoặc nhập <code>localhost</code> (để trống) để chạy qua http://{window.location.hostname}:PORT khi chưa có tên miền</>}>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com hoặc localhost" />
          </Field>
          {portMode && (
            <Field label="Port" hint="Bỏ trống để TPanel tự chọn port trống (từ 8001)">
              <input type="number" min={1024} max={65535} value={listenPort} onChange={(e) => setListenPort(e.target.value)} placeholder="tự động" />
            </Field>
          )}
          {(type === 'wordpress' || type === 'php') && (
            <Field label="Phiên bản PHP">
              <select value={php} onChange={(e) => setPhp(e.target.value)}>
                <option value="">Mặc định</option>
                {stats.data?.phpVersions.map((v) => (
                  <option key={v} value={v}>
                    PHP {v}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {portMode ? (
          <Alert tone="info">
            Chưa có tên miền: site sẽ truy cập qua <strong>http://{window.location.hostname}:{listenPort || 'PORT'}</strong>. Không cài được SSL cho dạng này.
          </Alert>
        ) : (
          <Check checked={addWww} onChange={setAddWww}>
            Thêm alias www.{domain || 'example.com'}
          </Check>
        )}

        {(type === 'wordpress' || type === 'static') && (
          <TemplatePicker siteType={type} value={template} onChange={setTemplate} branding={branding} onBranding={setBranding} />
        )}

        {type === 'wordpress' && (
          <>
            <h3>Tài khoản quản trị WordPress (tuỳ chọn)</h3>
            <div className="sub">
              {template
                ? 'Bỏ trống để TPanel tự tạo tài khoản admin (hiển thị sau khi tạo xong).'
                : 'Nếu điền đủ và server có wp-cli, TPanel sẽ cài đặt luôn. Bỏ trống để tự hoàn tất qua trình duyệt.'}
            </div>
            <div className="form-grid">
              <Field label="Tiêu đề site">
                <input value={wp.title} onChange={(e) => setWp({ ...wp, title: e.target.value })} />
              </Field>
              <Field label="Admin user">
                <input value={wp.adminUser} onChange={(e) => setWp({ ...wp, adminUser: e.target.value })} />
              </Field>
              <Field label="Admin password">
                <input type="password" value={wp.adminPassword} onChange={(e) => setWp({ ...wp, adminPassword: e.target.value })} />
              </Field>
              <Field label="Admin email">
                <input type="email" value={wp.adminEmail} onChange={(e) => setWp({ ...wp, adminEmail: e.target.value })} />
              </Field>
              <Field label="Ngôn ngữ">
                <select value={wp.locale} onChange={(e) => setWp({ ...wp, locale: e.target.value })}>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en_US">English</option>
                </select>
              </Field>
            </div>
          </>
        )}

        {type === 'nextjs' && (
          <>
            <h3>Mã nguồn Next.js</h3>
            <Alert tone="info">
              Bỏ trống Git URL nếu bạn muốn upload code qua SFTP vào <code>/var/www/{domain || 'domain'}/app</code> rồi bấm “Build &amp; khởi động” trong trang site.
            </Alert>
            <div className="form-grid">
              <Field label="Git URL" hint="https://github.com/org/repo.git hoặc git@...">
                <input value={next.gitUrl} onChange={(e) => setNext({ ...next, gitUrl: e.target.value })} />
              </Field>
              <Field label="Branch">
                <input value={next.branch} onChange={(e) => setNext({ ...next, branch: e.target.value })} />
              </Field>
              <Field label="Package manager">
                <select value={next.packageManager} onChange={(e) => setNext({ ...next, packageManager: e.target.value })}>
                  <option value="auto">Tự nhận (theo lockfile)</option>
                  <option value="npm">npm</option>
                  <option value="yarn">yarn</option>
                  <option value="pnpm">pnpm</option>
                </select>
              </Field>
            </div>
            <details>
              <summary>Lệnh tuỳ chỉnh &amp; biến môi trường</summary>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Install command" hint="Mặc định: npm ci / yarn install / pnpm install">
                  <input value={next.installCommand} onChange={(e) => setNext({ ...next, installCommand: e.target.value })} />
                </Field>
                <Field label="Build command" hint="Mặc định: <pm> run build">
                  <input value={next.buildCommand} onChange={(e) => setNext({ ...next, buildCommand: e.target.value })} />
                </Field>
                <Field label="Start command" hint='Mặc định: next start -H 127.0.0.1 -p "$PORT"'>
                  <input value={next.startCommand} onChange={(e) => setNext({ ...next, startCommand: e.target.value })} />
                </Field>
              </div>
              <Field label="Biến môi trường (.env.production.local)" hint="Mỗi dòng KEY=value">
                <textarea value={next.env} onChange={(e) => setNext({ ...next, env: e.target.value })} placeholder={'NEXT_PUBLIC_SITE_URL=https://example.com'} />
              </Field>
            </details>
          </>
        )}

        {type === 'php' && (
          <Check checked={createDb} onChange={setCreateDb}>
            Tạo database MySQL cho site
          </Check>
        )}

        <div className="row end">
          <button className="btn primary">Tạo website</button>
        </div>
      </div>
    </form>
  );
}
