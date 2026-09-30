import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SITE_TYPES, type SiteType, type SystemStats } from '@tpanel/shared';
import { get, post, type TaskInfo } from '../api';
import { Alert, Check, ErrorBox, Field, TaskLog } from '../components/ui';

const TYPE_INFO: Record<SiteType, { title: string; desc: string }> = {
  wordpress: { title: 'WordPress', desc: 'Tự tải WordPress, tạo database & wp-config.php' },
  nextjs: { title: 'Next.js', desc: 'Node.js app chạy bằng systemd, Nginx reverse proxy. Không cần database (dữ liệu JSON).' },
  php: { title: 'PHP', desc: 'Site PHP thuần / framework (Laravel, CodeIgniter...)' },
  static: { title: 'HTML tĩnh', desc: 'HTML/CSS/JS, hoặc Next.js static export' },
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
  const [task, setTask] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const d = domain.trim().toLowerCase();
    const aliases = addWww && !d.startsWith('www.') ? [`www.${d}`] : [];
    const body: Record<string, unknown> = { type, domain: d, aliases };
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
    const r = t.result as { site?: { id: number } } | undefined;
    if (t.status === 'completed' && r?.site) setTimeout(() => nav(`/sites/${r.site!.id}`), 1200);
  };

  if (task) {
    return (
      <>
        <div className="page-head">
          <h1>Đang tạo {domain}</h1>
        </div>
        <div className="card">
          <TaskLog taskId={task} onDone={onDone} />
        </div>
      </>
    );
  }

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
          <Field label="Tên miền" hint="Ví dụ: example.com">
            <input required value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
          </Field>
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
        <Check checked={addWww} onChange={setAddWww}>
          Thêm alias www.{domain || 'example.com'}
        </Check>

        {type === 'wordpress' && (
          <>
            <h3>Thông tin WordPress (tuỳ chọn)</h3>
            <div className="sub">Nếu điền đủ và server có wp-cli, TPanel sẽ cài đặt luôn. Bỏ trống để tự hoàn tất qua trình duyệt.</div>
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
