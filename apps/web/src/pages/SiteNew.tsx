import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LANG_LABELS, LOCALHOST, SITE_TYPES, msg, type Branding, type CreateSiteResult, type SiteType, type SystemStats } from '@lares/shared';
import { get, post, type TaskInfo } from '../api';
import { TemplatePicker } from '../components/TemplatePicker';
import { Alert, Check, ErrorBox, Field, TaskLog } from '../components/ui';
import { t } from '../i18n';

const TYPE_INFO: Record<SiteType, { title: string; desc: string }> = {
  wordpress: { title: 'WordPress', desc: msg('Tự cài WordPress + database, chọn được giao diện mẫu có sẵn nội dung') },
  nextjs: { title: 'Next.js', desc: msg('Node.js app chạy bằng systemd, Nginx reverse proxy. Không cần database (dữ liệu JSON).') },
  php: { title: 'PHP', desc: msg('Site PHP thuần / framework (Laravel, CodeIgniter...)') },
  static: { title: msg('HTML tĩnh'), desc: msg('HTML/CSS/JS, có giao diện mẫu dựng sẵn hoặc Next.js static export') },
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
          <h1>{result ? t('Đã tạo website') : t('Đang tạo {domain}', { domain: domain || 'site' })}</h1>
        </div>
        {result && (
          <div className="card stack">
            <div className="kv">
              <div>{t('Địa chỉ truy cập')}</div>
              <div>
                <a href={result.url} target="_blank" rel="noreferrer">
                  <strong>{result.url}</strong>
                </a>
              </div>
              {result.wordpressAdmin && (
                <>
                  <div>{t('Trang quản trị WordPress')}</div>
                  <div>
                    <a href={result.wordpressAdmin.url} target="_blank" rel="noreferrer">
                      {result.wordpressAdmin.url}
                    </a>
                  </div>
                  <div>{t('Tài khoản / mật khẩu')}</div>
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
            {result.wordpressAdmin && <Alert tone="warn">{t('Lưu lại mật khẩu WordPress — Lares chỉ hiển thị một lần.')}</Alert>}
            {result.site.listenPort && (
              <Alert tone="info">
                {t('Site chạy theo port {port}. Nếu VPS có firewall của nhà cung cấp (AWS, GCP, Vultr…), hãy mở thêm port này.', { port: result.site.listenPort })}
              </Alert>
            )}
            <div className="row">
              <a className="btn primary" href={result.url} target="_blank" rel="noreferrer">
                {t('Mở website')}
              </a>
              <button className="btn" onClick={() => nav(`/sites/${result.site.id}`)}>
                {t('Quản lý site')}
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
          <h1>{t('Thêm website')}</h1>
          <div className="sub">{t('Chọn loại site, Lares sẽ tạo vhost Nginx, thư mục và runtime tương ứng')}</div>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {SITE_TYPES.map((st) => (
          <div
            key={st}
            className="card"
            onClick={() => setType(st)}
            style={{ cursor: 'pointer', marginBottom: 0, borderColor: type === st ? 'var(--primary)' : undefined, outline: type === st ? '2px solid var(--primary-soft)' : undefined }}
          >
            <strong>{t(TYPE_INFO[st].title)}</strong>
            <div className="sub">{t(TYPE_INFO[st].desc)}</div>
          </div>
        ))}
      </div>
      <div className="card stack">
        <div className="form-grid">
          <Field
            label={t('Tên miền')}
            hint={
              <>
                {t('Ví dụ: example.com — hoặc nhập')} <code>localhost</code>{' '}
                {t('(để trống) để chạy qua {url} khi chưa có tên miền', { url: `http://${window.location.hostname}:PORT` })}
              </>
            }
          >
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t('example.com hoặc localhost')} />
          </Field>
          {portMode && (
            <Field label="Port" hint={t('Bỏ trống để Lares tự chọn port trống (từ 8001)')}>
              <input type="number" min={1024} max={65535} value={listenPort} onChange={(e) => setListenPort(e.target.value)} placeholder={t('tự động')} />
            </Field>
          )}
          {(type === 'wordpress' || type === 'php') && (
            <Field label={t('Phiên bản PHP')}>
              <select value={php} onChange={(e) => setPhp(e.target.value)}>
                <option value="">{t('Mặc định')}</option>
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
            {t('Chưa có tên miền: site sẽ truy cập qua')} <strong>http://{window.location.hostname}:{listenPort || 'PORT'}</strong>.{' '}
            {t('Không cài được SSL cho dạng này.')}
          </Alert>
        ) : (
          <Check checked={addWww} onChange={setAddWww}>
            {t('Thêm alias www.{domain}', { domain: domain || 'example.com' })}
          </Check>
        )}

        {(type === 'wordpress' || type === 'static') && (
          <TemplatePicker siteType={type} value={template} onChange={setTemplate} branding={branding} onBranding={setBranding} />
        )}

        {type === 'wordpress' && (
          <>
            <h3>{t('Tài khoản quản trị WordPress (tuỳ chọn)')}</h3>
            <div className="sub">
              {template
                ? t('Bỏ trống để Lares tự tạo tài khoản admin (hiển thị sau khi tạo xong).')
                : t('Nếu điền đủ và server có wp-cli, Lares sẽ cài đặt luôn. Bỏ trống để tự hoàn tất qua trình duyệt.')}
            </div>
            <div className="form-grid">
              <Field label={t('Tiêu đề site')}>
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
              <Field label={t('Ngôn ngữ')}>
                <select value={wp.locale} onChange={(e) => setWp({ ...wp, locale: e.target.value })}>
                  <option value="vi">{LANG_LABELS.vi}</option>
                  <option value="en_US">{LANG_LABELS.en}</option>
                </select>
              </Field>
            </div>
          </>
        )}

        {type === 'nextjs' && (
          <>
            <h3>{t('Mã nguồn Next.js')}</h3>
            <Alert tone="info">
              {t('Bỏ trống Git URL nếu bạn muốn upload code qua SFTP vào')} <code>/var/www/{domain || 'domain'}/app</code>{' '}
              {t('rồi bấm “Build & khởi động” trong trang site.')}
            </Alert>
            <div className="form-grid">
              <Field label="Git URL" hint={t('https://github.com/org/repo.git hoặc git@...')}>
                <input value={next.gitUrl} onChange={(e) => setNext({ ...next, gitUrl: e.target.value })} />
              </Field>
              <Field label="Branch">
                <input value={next.branch} onChange={(e) => setNext({ ...next, branch: e.target.value })} />
              </Field>
              <Field label="Package manager">
                <select value={next.packageManager} onChange={(e) => setNext({ ...next, packageManager: e.target.value })}>
                  <option value="auto">{t('Tự nhận (theo lockfile)')}</option>
                  <option value="npm">npm</option>
                  <option value="yarn">yarn</option>
                  <option value="pnpm">pnpm</option>
                </select>
              </Field>
            </div>
            <details>
              <summary>{t('Lệnh tuỳ chỉnh & biến môi trường')}</summary>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Install command" hint={t('Mặc định: npm ci / yarn install / pnpm install')}>
                  <input value={next.installCommand} onChange={(e) => setNext({ ...next, installCommand: e.target.value })} />
                </Field>
                <Field label="Build command" hint={t('Mặc định: <pm> run build')}>
                  <input value={next.buildCommand} onChange={(e) => setNext({ ...next, buildCommand: e.target.value })} />
                </Field>
                <Field label="Start command" hint={t('Mặc định: next start -H 127.0.0.1 -p "$PORT"')}>
                  <input value={next.startCommand} onChange={(e) => setNext({ ...next, startCommand: e.target.value })} />
                </Field>
              </div>
              <Field label={t('Biến môi trường (.env.production.local)')} hint={t('Mỗi dòng KEY=value')}>
                <textarea value={next.env} onChange={(e) => setNext({ ...next, env: e.target.value })} placeholder={'NEXT_PUBLIC_SITE_URL=https://example.com'} />
              </Field>
            </details>
          </>
        )}

        {type === 'php' && (
          <Check checked={createDb} onChange={setCreateDb}>
            {t('Tạo database MySQL cho site')}
          </Check>
        )}

        <div className="row end">
          <button className="btn primary">{t('Tạo website')}</button>
        </div>
      </div>
    </form>
  );
}
