import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  APP_LABELS,
  APP_TYPES,
  PANEL_LABELS,
  PANEL_TYPES,
  type AppType,
  type ConnectionReport,
  type DbCredentials,
  type DbStrategy,
  type DiscoveredSite,
  type DiscoveryResult,
  type Migration,
  type MigrationOptions,
  type PanelType,
  type TransferMode,
} from '@tpanel/shared';
import { fmtBytes, post } from '../api';
import { Alert, Badge, Check, ErrorBox, Field } from '../components/ui';

interface SourceForm {
  mode: 'local' | 'ssh';
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password: string;
  privateKey: string;
  passphrase: string;
  useSudo: boolean;
  hostFingerprint: string;
  panel: PanelType;
}

interface Row {
  key: string;
  selected: boolean;
  expanded: boolean;
  discovered: DiscoveredSite | null;
  sourceDomain: string;
  targetDomain: string;
  aliases: string;
  sourceRoot: string;
  webRootSubdir: string;
  configPath: string;
  appType: AppType;
  phpVersion: string;
  strategy: DbStrategy;
  db: DbCredentials | null;
  excludes: string;
  searchReplace: boolean;
  overwrite: boolean;
}

const NO_DB_TYPES: AppType[] = ['nextjs', 'static'];

function defaultExcludes(appType: AppType, nested: string[]): string {
  const base = appType === 'wordpress' ? ['wp-content/cache'] : appType === 'nextjs' ? ['node_modules', '.next'] : [];
  return [...nested, ...base].join(', ');
}

function rowFromDiscovered(s: DiscoveredSite): Row {
  return {
    key: s.domain,
    selected: !s.existsOnTarget && Boolean(s.rootPath),
    expanded: false,
    discovered: s,
    sourceDomain: s.domain,
    targetDomain: s.domain,
    aliases: s.aliases.join(', '),
    sourceRoot: s.rootPath,
    webRootSubdir: s.webRootSubdir,
    configPath: s.configPath ?? '',
    appType: s.appType,
    phpVersion: s.phpVersion ?? '',
    strategy: NO_DB_TYPES.includes(s.appType) || !s.db ? 'skip' : 'import',
    db: s.db,
    excludes: defaultExcludes(s.appType, s.nestedPaths),
    searchReplace: true,
    overwrite: false,
  };
}

const emptyRow = (): Row => ({
  key: `manual-${Math.random().toString(36).slice(2)}`,
  selected: true,
  expanded: true,
  discovered: null,
  sourceDomain: '',
  targetDomain: '',
  aliases: '',
  sourceRoot: '',
  webRootSubdir: '',
  configPath: '',
  appType: 'unknown',
  phpVersion: '',
  strategy: 'skip',
  db: null,
  excludes: '',
  searchReplace: true,
  overwrite: false,
});

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function MigrationNew() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [src, setSrc] = useState<SourceForm>({
    mode: 'ssh',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    password: '',
    privateKey: '',
    passphrase: '',
    useSudo: false,
    hostFingerprint: '',
    panel: 'auto',
  });
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [opts, setOpts] = useState<MigrationOptions & { name: string }>({
    name: '',
    transferMode: 'auto',
    cleanupSource: true,
    keepLocalArchives: false,
    rollbackOnFailure: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const sourcePayload = () => ({
    connection:
      src.mode === 'local'
        ? { mode: 'local' as const }
        : {
            mode: 'ssh' as const,
            host: src.host.trim(),
            port: src.port,
            username: src.username.trim(),
            authType: src.authType,
            password: src.authType === 'password' ? src.password : undefined,
            privateKey: src.authType === 'key' ? src.privateKey : undefined,
            passphrase: src.authType === 'key' && src.passphrase ? src.passphrase : undefined,
            useSudo: src.useSudo,
            hostFingerprint: src.hostFingerprint || undefined,
          },
    panel: src.panel,
  });

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const test = () =>
    wrap('test', async () => {
      const r = await post<ConnectionReport>('/api/migrations/test-connection', sourcePayload());
      setReport(r);
      // pin the host key: discovery and the migration job must talk to this exact server
      if (r.hostFingerprint) setSrc((s) => ({ ...s, hostFingerprint: r.hostFingerprint! }));
    });

  const discover = () =>
    wrap('discover', async () => {
      const r = await post<DiscoveryResult>('/api/migrations/discover', sourcePayload());
      setDiscovery(r);
      setRows(r.sites.map(rowFromDiscovered));
      setStep(2);
    });

  const inspect = (row: Row) =>
    wrap(`inspect-${row.key}`, async () => {
      const p = await post<{ exists: boolean; rootPath: string; webRootSubdir: string; appType: AppType; configPath: string | null; db: DbCredentials | null }>(
        '/api/migrations/inspect',
        { source: sourcePayload(), path: row.sourceRoot },
      );
      if (!p.exists) throw new Error(`Không tìm thấy ${row.sourceRoot} trên VPS nguồn`);
      update(row.key, {
        sourceRoot: p.rootPath,
        webRootSubdir: p.webRootSubdir,
        appType: p.appType,
        configPath: p.configPath ?? '',
        db: p.db ?? row.db,
        strategy: NO_DB_TYPES.includes(p.appType) ? 'skip' : p.db ? 'import' : row.strategy,
        excludes: row.excludes || defaultExcludes(p.appType, []),
      });
    });

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const selected = rows.filter((r) => r.selected);
  const invalid = selected.filter((r) => !r.targetDomain || !r.sourceRoot || !r.sourceDomain || (r.strategy !== 'skip' && !r.db?.name));

  const start = () =>
    wrap('start', async () => {
      const m = await post<Migration>('/api/migrations', {
        name: opts.name || undefined,
        source: sourcePayload(),
        options: { transferMode: opts.transferMode, cleanupSource: opts.cleanupSource, keepLocalArchives: opts.keepLocalArchives, rollbackOnFailure: opts.rollbackOnFailure },
        items: selected.map((r) => ({
          sourceDomain: r.sourceDomain.trim().toLowerCase(),
          targetDomain: r.targetDomain.trim().toLowerCase(),
          aliases: splitList(r.aliases),
          sourceRoot: r.sourceRoot.trim(),
          webRootSubdir: r.webRootSubdir,
          appType: r.appType,
          configPath: r.configPath || undefined,
          phpVersion: r.phpVersion || undefined,
          db: { strategy: r.strategy, source: r.strategy !== 'skip' && r.db ? r.db : undefined },
          excludes: splitList(r.excludes),
          searchReplace: r.searchReplace,
          overwrite: r.overwrite,
        })),
      });
      nav(`/migrations/${m.id}`);
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chuyển site về TPanel</h1>
          <div className="sub">Từ VPS/panel khác (hoặc panel đang chạy chung VPS): tự nén database &amp; mã nguồn, đồng bộ về và cài lại trên TPanel</div>
        </div>
      </div>
      <div className="wizard-steps">
        {['1. Nguồn', '2. Chọn site', '3. Xác nhận'].map((l, i) => (
          <div key={l} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}>
            {l}
          </div>
        ))}
      </div>
      <ErrorBox error={error} />

      {step === 1 && (
        <div className="grid cols-2">
          <div className="card stack">
            <h2>VPS / panel nguồn</h2>
            <div className="row">
              <label className="check">
                <input type="radio" checked={src.mode === 'ssh'} onChange={() => setSrc({ ...src, mode: 'ssh' })} /> VPS khác (SSH)
              </label>
              <label className="check">
                <input type="radio" checked={src.mode === 'local'} onChange={() => setSrc({ ...src, mode: 'local' })} /> Panel trên chính VPS này
              </label>
            </div>
            {src.mode === 'ssh' && (
              <>
                <div className="form-grid">
                  <Field label="IP / hostname">
                    <input value={src.host} onChange={(e) => setSrc({ ...src, host: e.target.value, hostFingerprint: '' })} placeholder="103.x.x.x" />
                  </Field>
                  <Field label="Port SSH">
                    <input type="number" value={src.port} onChange={(e) => setSrc({ ...src, port: Number(e.target.value) })} />
                  </Field>
                  <Field label="User">
                    <input value={src.username} onChange={(e) => setSrc({ ...src, username: e.target.value })} />
                  </Field>
                  <Field label="Xác thực">
                    <select value={src.authType} onChange={(e) => setSrc({ ...src, authType: e.target.value as 'password' | 'key' })}>
                      <option value="password">Mật khẩu</option>
                      <option value="key">Private key</option>
                    </select>
                  </Field>
                </div>
                {src.authType === 'password' ? (
                  <Field label="Mật khẩu SSH">
                    <input type="password" value={src.password} onChange={(e) => setSrc({ ...src, password: e.target.value })} />
                  </Field>
                ) : (
                  <>
                    <Field label="Private key (OpenSSH/PEM)">
                      <textarea value={src.privateKey} onChange={(e) => setSrc({ ...src, privateKey: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                    </Field>
                    <Field label="Passphrase (nếu có)">
                      <input type="password" value={src.passphrase} onChange={(e) => setSrc({ ...src, passphrase: e.target.value })} />
                    </Field>
                  </>
                )}
                {src.username !== 'root' && (
                  <Check checked={src.useSudo} onChange={(v) => setSrc({ ...src, useSudo: v })}>
                    Chạy lệnh bằng sudo (yêu cầu NOPASSWD)
                  </Check>
                )}
                <div className="sub">
                  Nếu IP này chính là VPS đang chạy TPanel, hệ thống tự nhận ra và copy trực tiếp trên máy, không truyền qua mạng.
                </div>
              </>
            )}
            <Field label="Panel nguồn">
              <select value={src.panel} onChange={(e) => setSrc({ ...src, panel: e.target.value as PanelType })}>
                {PANEL_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {PANEL_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row end">
              <button className="btn" onClick={test} disabled={!!busy || (src.mode === 'ssh' && !src.host)}>
                {busy === 'test' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
              </button>
              <button className="btn primary" onClick={discover} disabled={!!busy || (src.mode === 'ssh' && !src.host)}>
                {busy === 'discover' ? 'Đang quét site…' : 'Quét site →'}
              </button>
            </div>
          </div>
          <div className="card">
            <h2>Kết quả kiểm tra</h2>
            {!report && <div className="sub">Bấm “Kiểm tra kết nối” để xem thông tin VPS nguồn.</div>}
            {report && (
              <div className="stack">
                <div className="kv">
                  <div>Hostname</div>
                  <div>{report.hostname}</div>
                  <div>Hệ điều hành</div>
                  <div>{report.os}</div>
                  <div>User</div>
                  <div>{report.user}</div>
                  <div>Panel phát hiện</div>
                  <div>
                    <Badge tone="info">{PANEL_LABELS[report.detectedPanel]}</Badge>
                  </div>
                  <div>Cùng VPS với TPanel</div>
                  <div>{report.sameHost ? <Badge tone="warn">Có — {report.sameHostReason}</Badge> : <Badge>Không</Badge>}</div>
                  {report.hostFingerprint && (
                    <>
                      <div>Host key</div>
                      <div className="mono" style={{ wordBreak: 'break-all' }}>
                        {report.hostFingerprint} <Badge tone="ok">đã ghim</Badge>
                      </div>
                    </>
                  )}
                  <div>Trống /var/tmp</div>
                  <div>{fmtBytes(report.tmpFreeBytes)}</div>
                  <div>Công cụ</div>
                  <div className="row">
                    {Object.entries(report.tools).map(([k, v]) => (
                      <Badge key={k} tone={v ? 'ok' : 'default'}>
                        {k}
                      </Badge>
                    ))}
                  </div>
                </div>
                {report.warnings.map((w) => (
                  <Alert key={w} tone="warn">
                    {w}
                  </Alert>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>
              {discovery ? `Panel: ${PANEL_LABELS[discovery.panel]} · tìm thấy ${discovery.sites.length} site` : 'Chọn site'}
            </h2>
            <div className="row">
              <button className="btn sm" onClick={() => setRows(rows.map((r) => ({ ...r, selected: true })))}>
                Chọn tất cả
              </button>
              <button className="btn sm" onClick={() => setRows(rows.map((r) => ({ ...r, selected: false })))}>
                Bỏ chọn
              </button>
              <button className="btn sm" onClick={() => setRows([...rows, emptyRow()])}>
                + Thêm site thủ công
              </button>
            </div>
          </div>
          {discovery?.warnings.map((w) => (
            <Alert key={w} tone="warn">
              {w}
            </Alert>
          ))}
          {rows.length === 0 && <div className="empty">Không tìm thấy site nào. Bấm “Thêm site thủ công” và nhập đường dẫn mã nguồn.</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Site nguồn</th>
                  <th>Loại</th>
                  <th>Thư mục</th>
                  <th>Database</th>
                  <th>Dung lượng</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowView key={r.key} row={r} update={(p) => update(r.key, p)} inspect={() => inspect(r)} busy={busy === `inspect-${r.key}`} remove={() => setRows(rows.filter((x) => x.key !== r.key))} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => setStep(1)}>
              ← Quay lại
            </button>
            <div className="row">
              {invalid.length > 0 && <span className="sub">{invalid.length} site thiếu thông tin (tên miền, thư mục hoặc database)</span>}
              <button className="btn primary" disabled={!selected.length || invalid.length > 0} onClick={() => setStep(3)}>
                Tiếp tục ({selected.length} site) →
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid cols-2">
          <div className="card stack">
            <h2>Tuỳ chọn</h2>
            <Field label="Tên migration (tuỳ chọn)">
              <input value={opts.name} onChange={(e) => setOpts({ ...opts, name: e.target.value })} />
            </Field>
            {!report?.sameHost && src.mode === 'ssh' && (
              <Field
                label="Cách truyền dữ liệu"
                hint="Archive: nén trên VPS nguồn, kiểm tra sha256 rồi tải về qua SFTP. Stream: nén và truyền trực tiếp qua SSH, không cần dung lượng trống trên nguồn."
              >
                <select value={opts.transferMode} onChange={(e) => setOpts({ ...opts, transferMode: e.target.value as TransferMode })}>
                  <option value="auto">Tự động (theo dung lượng trống)</option>
                  <option value="archive">Nén trên nguồn + SFTP (kiểm tra checksum)</option>
                  <option value="stream">Stream qua SSH</option>
                </select>
              </Field>
            )}
            <Check checked={opts.rollbackOnFailure} onChange={(v) => setOpts({ ...opts, rollbackOnFailure: v })}>
              Tự rollback (xoá site/database vừa tạo) nếu site bị lỗi
            </Check>
            <Check checked={opts.cleanupSource} onChange={(v) => setOpts({ ...opts, cleanupSource: v })}>
              Xoá file nén tạm trên VPS nguồn sau khi xong
            </Check>
            <Check checked={opts.keepLocalArchives} onChange={(v) => setOpts({ ...opts, keepLocalArchives: v })}>
              Giữ lại file nén trên TPanel (để backup)
            </Check>
            <Alert tone="info">Dữ liệu trên VPS/panel nguồn không bị thay đổi: TPanel chỉ đọc và tạo bản sao.</Alert>
          </div>
          <div className="card stack">
            <h2>Sẽ chuyển {selected.length} site</h2>
            <table>
              <tbody>
                {selected.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{r.targetDomain}</strong>
                      {r.targetDomain !== r.sourceDomain && <div className="sub">từ {r.sourceDomain}</div>}
                    </td>
                    <td>{APP_LABELS[r.appType]}</td>
                    <td>{r.strategy === 'import' ? `DB: ${r.db?.name} → DB mới` : r.strategy === 'reuse' ? `DB: dùng lại ${r.db?.name}` : 'Không DB'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" onClick={() => setStep(2)}>
                ← Quay lại
              </button>
              <button className="btn primary" onClick={start} disabled={!!busy}>
                {busy === 'start' ? 'Đang khởi tạo…' : 'Bắt đầu chuyển'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RowView({ row: r, update, inspect, busy, remove }: { row: Row; update: (p: Partial<Row>) => void; inspect: () => void; busy: boolean; remove: () => void }) {
  const d = r.discovered;
  const db = r.db ?? { host: 'localhost', name: '', user: '', password: '', prefix: 'wp_' };
  const setDb = (p: Partial<DbCredentials>) => update({ db: { ...db, ...p } });
  return (
    <>
      <tr>
        <td>
          <input type="checkbox" checked={r.selected} onChange={(e) => update({ selected: e.target.checked })} />
        </td>
        <td>
          <strong>{r.sourceDomain || <em className="sub">(site thủ công)</em>}</strong>
          {d?.existsOnTarget && (
            <div>
              <Badge tone="warn">đã có trên TPanel</Badge>
            </div>
          )}
          {d?.proxyPass && <div className="sub mono">proxy → {d.proxyPass}</div>}
        </td>
        <td>{APP_LABELS[r.appType]}</td>
        <td className="mono" style={{ maxWidth: 280, wordBreak: 'break-all' }}>
          {r.sourceRoot || <Badge tone="warn">cần nhập</Badge>}
        </td>
        <td>{r.strategy === 'skip' ? <span className="sub">—</span> : <span className="mono">{r.db?.name}</span>}</td>
        <td>{fmtBytes(d?.sizeBytes)}</td>
        <td>
          <button className="btn sm" onClick={() => update({ expanded: !r.expanded })}>
            {r.expanded ? 'Thu gọn' : 'Tuỳ chỉnh'}
          </button>
        </td>
      </tr>
      {r.expanded && (
        <tr>
          <td />
          <td colSpan={6}>
            <div className="stack" style={{ padding: '4px 0 12px' }}>
              <div className="form-grid">
                <Field label="Tên miền nguồn">
                  <input value={r.sourceDomain} onChange={(e) => update({ sourceDomain: e.target.value, targetDomain: r.targetDomain || e.target.value })} />
                </Field>
                <Field label="Tên miền trên TPanel" hint={r.targetDomain !== r.sourceDomain ? 'Đổi tên miền: WordPress sẽ được search-replace' : undefined}>
                  <input value={r.targetDomain} onChange={(e) => update({ targetDomain: e.target.value })} />
                </Field>
                <Field label="Alias">
                  <input value={r.aliases} onChange={(e) => update({ aliases: e.target.value })} placeholder="www.example.com" />
                </Field>
                <Field label="Loại ứng dụng">
                  <select value={r.appType} onChange={(e) => update({ appType: e.target.value as AppType, strategy: NO_DB_TYPES.includes(e.target.value as AppType) ? 'skip' : r.strategy })}>
                    {APP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {APP_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Field label="Thư mục mã nguồn trên VPS nguồn">
                    <input value={r.sourceRoot} onChange={(e) => update({ sourceRoot: e.target.value })} placeholder="/home/user/public_html" />
                  </Field>
                </div>
                <button className="btn" onClick={inspect} disabled={!r.sourceRoot || busy}>
                  {busy ? 'Đang đọc…' : 'Nhận diện lại'}
                </button>
              </div>
              <div className="form-grid">
                {!NO_DB_TYPES.includes(r.appType) && (
                  <Field label="PHP">
                    <input value={r.phpVersion} onChange={(e) => update({ phpVersion: e.target.value })} placeholder="8.2" />
                  </Field>
                )}
                <Field label="Web root con" hint="vd. public (Laravel)">
                  <input value={r.webRootSubdir} onChange={(e) => update({ webRootSubdir: e.target.value })} />
                </Field>
                <Field label="File cấu hình ngoài web root" hint="Webinoly: /var/www/site/wp-config.php">
                  <input value={r.configPath} onChange={(e) => update({ configPath: e.target.value })} />
                </Field>
                <Field label="Loại trừ (phẩy)" hint="Đường dẫn tương đối, hỗ trợ *">
                  <input value={r.excludes} onChange={(e) => update({ excludes: e.target.value })} />
                </Field>
              </div>
              {!NO_DB_TYPES.includes(r.appType) && (
                <>
                  <Field label="Database">
                    <select value={r.strategy} onChange={(e) => update({ strategy: e.target.value as DbStrategy, db: r.db ?? db })}>
                      <option value="import">Dump &amp; import sang database mới trên TPanel</option>
                      <option value="reuse">Dùng lại database hiện có (chỉ khi cùng VPS &amp; cùng MySQL)</option>
                      <option value="skip">Không chuyển database</option>
                    </select>
                  </Field>
                  {r.strategy !== 'skip' && (
                    <div className="form-grid">
                      <Field label="DB host">
                        <input value={db.host} onChange={(e) => setDb({ host: e.target.value })} />
                      </Field>
                      <Field label="DB name">
                        <input value={db.name} onChange={(e) => setDb({ name: e.target.value })} />
                      </Field>
                      <Field label="DB user">
                        <input value={db.user} onChange={(e) => setDb({ user: e.target.value })} />
                      </Field>
                      <Field label="DB password">
                        <input type="password" value={db.password} onChange={(e) => setDb({ password: e.target.value })} />
                      </Field>
                      {r.appType === 'wordpress' && (
                        <Field label="Table prefix">
                          <input value={db.prefix ?? ''} onChange={(e) => setDb({ prefix: e.target.value })} />
                        </Field>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="row">
                {r.appType === 'wordpress' && (
                  <Check checked={r.searchReplace} onChange={(v) => update({ searchReplace: v })}>
                    Search-replace tên miền khi đổi domain
                  </Check>
                )}
                <Check checked={r.overwrite} onChange={(v) => update({ overwrite: v })}>
                  Cho phép ghi đè thư mục đích đã tồn tại
                </Check>
                {!d && (
                  <button className="btn sm danger" onClick={remove}>
                    Xoá dòng
                  </button>
                )}
              </div>
              {d && <div className="sub mono">Nguồn phát hiện: {d.discoveredBy}</div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
