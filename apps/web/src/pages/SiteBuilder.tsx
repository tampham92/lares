import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { INDUSTRY_LABELS, LOCALHOST, msg, SECTION_VARIANTS, type BuilderPreset, type BuilderSpec, type CreateSiteResult, type SectionType, type TemplateInfo } from '@lares/shared';
import { auth, del, get, post, type TaskInfo } from '../api';
import { BuilderPreview } from '../components/BuilderPreview';
import { BusinessStep, SectionsStep, StyleStep } from '../components/BuilderSteps';
import { Alert, Check, ErrorBox, Field, TaskLog } from '../components/ui';
import { t } from '../i18n';
import '../builder.css';

const STEPS = [msg('Ngành nghề'), msg('Thông tin'), msg('Phong cách'), msg('Bố cục'), msg('Xem trước'), msg('Tạo website')];

/** Sections that render well from business data alone - offered (switched off) when a preset lacks them. */
const OPTIONAL: SectionType[] = ['services', 'pricing', 'contact', 'map'];

function withAllSections(spec: BuilderSpec): BuilderSpec {
  const have = new Set(spec.sections.map((s) => s.type));
  const extra = OPTIONAL.filter((type) => !have.has(type)).map((type) => ({ type, variant: SECTION_VARIANTS[type][0]!, enabled: false, content: {} }));
  const footerAt = spec.sections.findIndex((s) => s.type === 'footer');
  const sections = [...spec.sections];
  sections.splice(footerAt < 0 ? sections.length : footerAt, 0, ...extra);
  return { ...spec, sections };
}

const withToken = (url: string | null) => (url && url.startsWith('/api/') ? `${url}?token=${encodeURIComponent(auth.token ?? '')}` : url);

function download(spec: BuilderSpec) {
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${spec.business.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'giao-dien'}.lares.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function SiteBuilder() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const presets = useQuery({ queryKey: ['builder-presets'], queryFn: () => get<BuilderPreset[]>('/api/builder/presets') });
  const [step, setStep] = useState(0);
  const [spec, setSpec] = useState<BuilderSpec | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // create step
  const [type, setType] = useState<'static' | 'wordpress'>('static');
  const [domain, setDomain] = useState('');
  const [addWww, setAddWww] = useState(true);
  const [listenPort, setListenPort] = useState('');
  const [saveTpl, setSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [task, setTask] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSiteResult | null>(null);

  const update = (fn: (s: BuilderSpec) => BuilderSpec) => setSpec((s) => (s ? fn(s) : s));
  const start = (s: BuilderSpec) => {
    setSpec(withAllSections(structuredClone(s)));
    setTplName(s.business.name);
    setError(null);
    setStep(1);
  };

  const importJson = async (file: File) => {
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const r = await post<{ spec: BuilderSpec }>('/api/builder/validate', { spec: parsed });
      start(r.spec);
    } catch (err) {
      setError(err instanceof SyntaxError ? new Error(t('Tệp không phải JSON hợp lệ')) : err);
    }
  };

  const saveTemplate = async (name: string) => {
    if (!spec) return null;
    const tpl = await post<TemplateInfo>('/api/builder/templates', { name, description: t('Giao diện tự tạo: {industry}', { industry: t(INDUSTRY_LABELS[spec.industry]) }), spec });
    void qc.invalidateQueries({ queryKey: ['builder-presets'] });
    void qc.invalidateQueries({ queryKey: ['templates'] });
    return tpl;
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spec) return;
    setError(null);
    try {
      if (saveTpl && tplName.trim()) await saveTemplate(tplName.trim());
      const d = domain.trim().toLowerCase() || LOCALHOST;
      const portMode = d === LOCALHOST;
      const body: Record<string, unknown> = {
        type,
        domain: d,
        aliases: !portMode && addWww && !d.startsWith('www.') ? [`www.${d}`] : [],
        publicHost: window.location.hostname,
        builder: spec,
        branding: {},
      };
      if (portMode && listenPort) body.listenPort = Number(listenPort);
      if (type === 'wordpress') body.wordpress = { locale: spec.lang === 'en' ? 'en_US' : 'vi' };
      const r = await post<TaskInfo>('/api/sites', body);
      setTask(r.id);
    } catch (err) {
      setError(err);
    }
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
            </div>
            {result.wordpressAdmin && <Alert tone="warn">{t('Lưu lại mật khẩu WordPress — Lares chỉ hiển thị một lần.')}</Alert>}
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
          <TaskLog
            taskId={task}
            onDone={(r) => {
              void qc.invalidateQueries({ queryKey: ['sites'] });
              if (r.status === 'completed') setResult(r.result as CreateSiteResult);
            }}
          />
        </div>
      </>
    );
  }

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const canNext = !!spec && (step !== 1 || spec.business.name.trim().length > 0);
  const portMode = domain.trim().toLowerCase() === LOCALHOST || domain.trim() === '';
  const builtIn = (presets.data ?? []).filter((p) => !p.custom);
  const saved = (presets.data ?? []).filter((p) => p.custom);

  const presetCard = (p: BuilderPreset) => (
    <div key={p.id} className="tpl" role="button" tabIndex={0} onClick={() => start(p.spec)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && start(p.spec)}>
      <div className="tpl-thumb" style={{ backgroundColor: p.spec.style.color }}>
        {p.previewImage && <img src={withToken(p.previewImage) ?? ''} alt="" loading="lazy" />}
      </div>
      <div className="tpl-body">
        <strong>{p.custom ? p.name : t(INDUSTRY_LABELS[p.industry])}</strong>
        <span className="sub">{p.custom ? t(INDUSTRY_LABELS[p.industry]) : p.description}</span>
        {p.custom && (
          <span className="row">
            <button
              type="button"
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation();
                download(p.spec);
              }}
            >
              {t('Xuất JSON')}
            </button>
            <button
              type="button"
              className="btn sm danger"
              onClick={async (e) => {
                e.stopPropagation();
                if (!window.confirm(t('Xoá giao diện "{name}"?', { name: p.name }))) return;
                try {
                  await del(`/api/builder/templates/${p.id}`);
                  void qc.invalidateQueries({ queryKey: ['builder-presets'] });
                  void qc.invalidateQueries({ queryKey: ['templates'] });
                } catch (err) {
                  setError(err);
                }
              }}
            >
              {t('Xoá')}
            </button>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('Tự tạo giao diện')}</h1>
          <div className="sub">{t('Trả lời vài câu hỏi, Lares dựng sẵn website chuyên nghiệp — sau đó vẫn sửa bình thường trong WordPress hoặc file HTML.')}</div>
        </div>
        <Link to="/sites/new" className="btn">
          {t('← Thêm website')}
        </Link>
      </div>

      <div className="wizard-steps" style={{ marginBottom: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
            {i + 1}. {t(s)}
          </div>
        ))}
      </div>

      <ErrorBox error={error} />
      {notice && <Alert tone="ok">{notice}</Alert>}

      {step === 0 && (
        <div className="card stack">
          <h2>{t('Website của bạn thuộc ngành nào?')}</h2>
          <div className="bld-presets">{builtIn.map(presetCard)}</div>
          {saved.length > 0 && (
            <>
              <h3>{t('Giao diện đã lưu')}</h3>
              <div className="bld-presets">{saved.map(presetCard)}</div>
            </>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              {t('Nhập từ file JSON')}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importJson(f);
              }}
            />
            <span className="hint">{t('File được xuất từ trình tạo giao diện của Lares (trên máy chủ này hoặc máy chủ khác).')}</span>
          </div>
        </div>
      )}

      {spec && step >= 1 && step <= 3 && (
        <div className="bld-layout">
          <div className="card stack" style={{ marginBottom: 0 }}>
            <h2>{t(STEPS[step]!)}</h2>
            {step === 1 && <BusinessStep spec={spec} update={update} />}
            {step === 2 && <StyleStep spec={spec} update={update} />}
            {step === 3 && <SectionsStep spec={spec} update={update} />}
            <div className="bld-nav">
              <button type="button" className="btn" onClick={back}>
                {t('Quay lại')}
              </button>
              <button type="button" className="btn primary" disabled={!canNext} onClick={next}>
                {t('Tiếp tục')}
              </button>
            </div>
          </div>
          <div className="bld-side card" style={{ marginBottom: 0 }}>
            <BuilderPreview spec={spec} />
          </div>
        </div>
      )}

      {spec && step === 4 && (
        <div className="card stack">
          <div className="bld-frame-bar">
            <div className="row" role="group" aria-label={t('Kích thước xem trước')}>
              <button type="button" className={`btn sm ${device === 'desktop' ? 'primary' : ''}`} onClick={() => setDevice('desktop')}>
                {t('Máy tính')}
              </button>
              <button type="button" className={`btn sm ${device === 'mobile' ? 'primary' : ''}`} onClick={() => setDevice('mobile')}>
                {t('Điện thoại')}
              </button>
            </div>
            <div className="row">
              <button type="button" className="btn sm" onClick={() => download(spec)}>
                {t('Xuất JSON')}
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  const name = window.prompt(t('Tên giao diện'), tplName || spec.business.name);
                  if (!name?.trim()) return;
                  setError(null);
                  try {
                    const tpl = await saveTemplate(name.trim());
                    setNotice(t('Đã lưu "{name}" vào giao diện của tôi — dùng lại được khi thêm website.', { name: tpl?.name ?? name }));
                  } catch (err) {
                    setError(err);
                  }
                }}
              >
                {t('Lưu thành giao diện của tôi')}
              </button>
            </div>
          </div>
          <BuilderPreview spec={spec} device={device} full />
          <div className="bld-nav">
            <button type="button" className="btn" onClick={back}>
              {t('Quay lại')}
            </button>
            <button type="button" className="btn primary" onClick={next}>
              {t('Tiếp tục')}
            </button>
          </div>
        </div>
      )}

      {spec && step === 5 && (
        <form className="card stack" onSubmit={create}>
          <h2>{t('Tạo website')}</h2>
          <div className="grid cols-4">
            {(['static', 'wordpress'] as const).map((st) => (
              <div
                key={st}
                className="card"
                role="radio"
                aria-checked={type === st}
                tabIndex={0}
                onClick={() => setType(st)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setType(st)}
                style={{ cursor: 'pointer', marginBottom: 0, borderColor: type === st ? 'var(--primary)' : undefined, outline: type === st ? '2px solid var(--primary-soft)' : undefined }}
              >
                <strong>{st === 'static' ? t('HTML tĩnh') : 'WordPress'}</strong>
                <div className="sub">
                  {st === 'static' ? t('Nhanh nhất, không cần database. Sửa trực tiếp file index.html.') : t('Sửa nội dung bằng trình soạn thảo khối (Gutenberg), thêm bài viết, trang mới.')}
                </div>
              </div>
            ))}
          </div>
          <div className="form-grid">
            <Field label={t('Tên miền')} hint={t('Để trống hoặc nhập localhost để chạy theo port khi chưa có tên miền')}>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t('example.com hoặc localhost')} />
            </Field>
            {portMode && (
              <Field label="Port" hint={t('Bỏ trống để Lares tự chọn port trống (từ 8001)')}>
                <input type="number" min={1024} max={65535} value={listenPort} onChange={(e) => setListenPort(e.target.value)} placeholder={t('tự động')} />
              </Field>
            )}
          </div>
          {!portMode && (
            <Check checked={addWww} onChange={setAddWww}>
              {t('Thêm alias www.{domain}', { domain: domain || 'example.com' })}
            </Check>
          )}
          {type === 'wordpress' && <Alert tone="info">{t('Lares tự tạo tài khoản quản trị WordPress và hiển thị sau khi tạo xong.')}</Alert>}
          <Check checked={saveTpl} onChange={setSaveTpl}>
            {t('Đồng thời lưu thành giao diện của tôi để dùng lại')}
          </Check>
          {saveTpl && (
            <Field label={t('Tên giao diện')}>
              <input value={tplName} maxLength={60} onChange={(e) => setTplName(e.target.value)} />
            </Field>
          )}
          <div className="bld-nav">
            <button type="button" className="btn" onClick={back}>
              {t('Quay lại')}
            </button>
            <button className="btn primary">{t('Tạo website')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
