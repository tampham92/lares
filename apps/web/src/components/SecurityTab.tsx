import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QUARANTINE_STEP_LABELS,
  SCAN_CHECK_LABELS,
  SECURITY_EVENT_LABELS,
  msg,
  type CleanSiteInput,
  type MalwareScan,
  type MalwareScanSummary,
  type ScanFinding,
  type ScanSeverity,
  type ScanStatus,
  type SecuritySettings,
  type Site,
  type SiteSecurityView,
} from '@lares/shared';
import { errMsg, fmtDate, get, post, put, type TaskInfo } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Check, ErrorBox, Field, TaskLog } from './ui';

/** Site → Security: malware scan (C5), emergency quarantine and cleaning (C6), code lock (C7). Server: services/malware.ts, quarantine.ts, codeLock.ts. */

const STATUS: Record<ScanStatus, { tone: 'ok' | 'warn' | 'err' | 'info' | 'default'; label: string }> = {
  running: { tone: 'info', label: msg('Đang quét') },
  clean: { tone: 'ok', label: msg('Không thấy dấu hiệu mã độc') },
  warning: { tone: 'warn', label: msg('Có điểm cần xem') },
  infected: { tone: 'err', label: msg('Có dấu hiệu nhiễm mã độc') },
  failed: { tone: 'default', label: msg('Quét lỗi') },
};

const SEVERITY: Record<ScanSeverity, { tone: 'err' | 'warn' | 'default'; label: string }> = {
  critical: { tone: 'err', label: msg('Nghiêm trọng') },
  warning: { tone: 'warn', label: msg('Cần xem') },
  info: { tone: 'default', label: msg('Thông tin') },
};

/** Raw details the server writes as codes. */
const DETAIL: Record<string, string> = {
  modified: msg('khác bản gốc'),
  added: msg('file không có trong bản gốc'),
  unverified: msg('không có trên wordpress.org, chưa đối chiếu được'),
  missing: msg('thiếu file so với bản gốc (site có thể bị lỗi)'),
};
const FIREWALL_KIND: Record<string, string> = {
  smtp: msg('gửi mail thẳng ra cổng 25 (spam)'),
  metadata: msg('gọi dịch vụ metadata của cloud (lấy khoá của máy chủ)'),
  panel: msg('gọi cổng panel / Adminer'),
  rate: msg('mở quá nhiều kết nối ra ngoài'),
};
const DB_PLACE: Record<string, string> = { posts: msg('bài viết / trang'), options: msg('tuỳ chọn (wp_options)') };

/** Findings about one file's content: the owner may mark it as not malware (same rule as malwarePolicy.ignorable). */
const IGNORABLE = new Set<ScanFinding['check']>(['core-checksum', 'plugin-checksum', 'uploads-php', 'uploads-code', 'pattern', 'user-ini']);
const ignorable = (f: ScanFinding) => IGNORABLE.has(f.check) && !!f.path && !f.count && !f.path.endsWith('/') && f.severity !== 'info';

/** What to do about findings the cleaning cannot fix by itself. */
const FIX_HINT: Partial<Record<ScanFinding['check'], string>> = {
  'db-script': msg('Mở Adminer ở tab Tổng quan để xem và xoá đoạn lạ (có thể là mã hợp lệ như analytics).'),
  'site-url': msg('Dọn site đặt lại địa chỉ này về tên miền của site.'),
};

type OnIgnore = (path: string, ignore: boolean) => void;

function FindingRow({ f, busy, onIgnore }: { f: ScanFinding; busy: boolean; onIgnore?: OnIgnore }) {
  const known = (table: Record<string, string>, key: string | undefined) => (key && table[key] ? t(table[key]) : key);
  const where = f.check === 'firewall' ? known(FIREWALL_KIND, f.path) : f.check === 'db-script' ? known(DB_PLACE, f.path) : f.path;
  const detail = known(DETAIL, f.detail);
  const hint = FIX_HINT[f.check];
  return (
    <div className="finding">
      <Badge tone={SEVERITY[f.severity].tone}>{t(SEVERITY[f.severity].label)}</Badge>
      <div className="finding-body">
        <div>
          {t(SCAN_CHECK_LABELS[f.check])}
          {f.count ? <span className="sub"> · {t('{n} lần/file', { n: f.count })}</span> : null}
          {f.ignored && <span className="sub"> · {t('đã đánh dấu không phải mã độc (vốn là: {severity})', { severity: t(SEVERITY[f.ignored].label) })}</span>}
        </div>
        {where && <div className={f.check === 'firewall' || f.check === 'db-script' ? 'sub' : 'mono'}>{where}</div>}
        {detail && <div className="hint mono">{detail}</div>}
        {hint && !f.ignored && <div className="hint">{t(hint)}</div>}
        {onIgnore && f.path && ignorable(f) && (
          <button className="btn sm" disabled={busy} onClick={() => onIgnore(f.path!, true)}>
            {t('Không phải mã độc')}
          </button>
        )}
        {onIgnore && f.path && f.ignored && (
          <button className="btn sm" disabled={busy} onClick={() => onIgnore(f.path!, false)}>
            {t('Bỏ đánh dấu')}
          </button>
        )}
      </div>
    </div>
  );
}

function Findings({ scan, busy, onIgnore }: { scan: MalwareScan; busy: boolean; onIgnore?: OnIgnore }) {
  const main = scan.findings.filter((f) => f.severity !== 'info');
  const info = scan.findings.filter((f) => f.severity === 'info');
  return (
    <>
      {main.length > 0 && (
        <div>
          {main.map((f, i) => (
            <FindingRow key={i} f={f} busy={busy} onIgnore={onIgnore} />
          ))}
        </div>
      )}
      {main.some(ignorable) && onIgnore && (
        <div className="hint">{t('"Không phải mã độc" chỉ dùng khi bạn đã mở file và chắc chắn nó hợp lệ. File bị sửa sau đó sẽ bị báo lại.')}</div>
      )}
      {info.length > 0 && (
        <details>
          <summary>{t('{n} mục thông tin (file mới/sửa, plugin chưa đối chiếu được...)', { n: info.length })}</summary>
          <div>
            {info.map((f, i) => (
              <FindingRow key={i} f={f} busy={busy} onIgnore={onIgnore} />
            ))}
          </div>
        </details>
      )}
      {scan.truncated && <Alert tone="warn">{t('Site có quá nhiều file: một phần chưa được quét.')}</Alert>}
    </>
  );
}

function ScheduleForm({ settings, onSaved }: { settings: SecuritySettings; onSaved: () => void }) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await put('/api/security/settings', form);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details>
      <summary>{t('Lịch quét tự động (áp dụng cho mọi site)')}</summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <Check checked={form.scanEnabled} onChange={(v) => setForm({ ...form, scanEnabled: v })}>
          {t('Quét mọi site mỗi ngày')}
        </Check>
        <Field label={t('Giờ quét (giờ máy chủ)')}>
          <input type="time" value={form.scanTime} disabled={!form.scanEnabled} onChange={(e) => setForm({ ...form, scanTime: e.target.value })} />
        </Field>
        <Check checked={form.externalAlerts} onChange={(v) => setForm({ ...form, externalAlerts: v })}>
          {t('Gửi cảnh báo qua Telegram / webhook đã cài ở Khách liên hệ → Thông báo')}
        </Check>
        <Check checked={form.autoQuarantine} disabled={!form.scanEnabled} onChange={(v) => setForm({ ...form, autoQuarantine: v })}>
          {t('Tự động cách ly khẩn site khi lần quét hằng ngày có phát hiện nghiêm trọng mới')}
        </Check>
        <div className="hint">{t('Chỉ áp dụng cho site có user riêng. Một lần báo nhầm cũng làm site ngừng phục vụ cho đến khi bạn gỡ cách ly.')}</div>
        {error && <Alert tone="err">{error}</Alert>}
        <div className="row end">
          <button className="btn" disabled={busy} onClick={() => void save()}>
            {t('Lưu lịch quét')}
          </button>
        </div>
      </div>
    </details>
  );
}

function History({ scans }: { scans: MalwareScanSummary[] }) {
  if (scans.length < 2) return null;
  return (
    <details>
      <summary>{t('Các lần quét trước')}</summary>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <tbody>
            {scans.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.startedAt)}</td>
                <td>
                  <Badge tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}</Badge>
                </td>
                <td className="sub">
                  {s.status === 'failed' ? s.error : t('{critical} nghiêm trọng · {warning} cần xem · {files} file', { critical: s.counts.critical, warning: s.counts.warning, files: s.filesScanned })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ScanCard({ site, v, busy, start, refresh }: { site: Site; v: SiteSecurityView; busy: boolean; start: (path: string, body?: unknown) => void; refresh: () => void }) {
  const scan = v.lastScan;
  const [ackBusy, setAckBusy] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const ignore = async (path: string, on: boolean) => {
    setAckBusy(true);
    setIgnoreError(null);
    try {
      await post(`/api/sites/${site.id}/security/ignore`, { path, ignore: on });
      refresh();
    } catch (e) {
      setIgnoreError(errMsg(e));
    } finally {
      setAckBusy(false);
    }
  };
  const toAcknowledge = scan?.findings.some((f) => (f.check === 'new-admin' || f.check === 'mu-plugin') && f.severity !== 'info');
  const acknowledge = async () => {
    setAckBusy(true);
    try {
      await post(`/api/sites/${site.id}/security/acknowledge`);
      refresh();
    } finally {
      setAckBusy(false);
    }
  };
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{t('Quét mã độc')}</h2>
        {scan && <Badge tone={STATUS[scan.status].tone}>{t(STATUS[scan.status].label)}</Badge>}
      </div>
      <div className="sub">
        {t('Đối chiếu file lõi WordPress và plugin với bản gốc trên wordpress.org, tìm file PHP trong uploads, .user.ini nạp file lạ, các đoạn mã thường gặp trong mã độc, tài khoản quản trị mới, địa chỉ site bị đổi và các lần tường lửa chặn site. Không chạy code của site.')}
      </div>
      <div className="hint">{t('Máy quét không bắt được mọi backdoor: kết quả sạch không có nghĩa là chắc chắn sạch. Site đã nhiễm thì cách ly và dọn bằng bản gốc.')}</div>
      {scan && (
        <div className="kv">
          <div>{t('Lần quét gần nhất')}</div>
          <div>
            {fmtDate(scan.startedAt)}
            {scan.status !== 'running' && scan.status !== 'failed' && scan.filesScanned > 0 && <span className="sub"> · {t('{files} file', { files: scan.filesScanned })}</span>}
          </div>
          {scan.status !== 'running' && scan.status !== 'failed' && (
            <>
              <div>{t('Kết quả')}</div>
              <div>{t('{critical} nghiêm trọng · {warning} cần xem · {info} thông tin', scan.counts)}</div>
            </>
          )}
        </div>
      )}
      {scan?.status === 'failed' && scan.error && <Alert tone="err">{scan.error}</Alert>}
      {scan?.status === 'infected' && !v.quarantine.active && (
        <Alert tone="err">
          <div className="stack" style={{ gap: 8 }}>
            <div>{t('Nên xử lý ngay: 1) Cách ly khẩn (chặn site chạy code và gửi dữ liệu ra ngoài), 2) Dọn site, 3) xem kết quả quét lại, 4) gỡ cách ly. Nếu chắc một mục là báo nhầm, bấm "Không phải mã độc" ở mục đó.')}</div>
            {v.supported.quarantine && (
              <div>
                <button className="btn sm danger" onClick={() => document.getElementById('quarantine-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  {t('Đến phần Cách ly khẩn')}
                </button>
              </div>
            )}
          </div>
        </Alert>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy || !v.supported.scan} onClick={() => start(`/api/sites/${site.id}/security/scan`)}>
          {t('Quét ngay')}
        </button>
        {!v.settings.scanEnabled && <span className="hint">{t('Quét tự động đang tắt.')}</span>}
        {v.settings.scanEnabled && <span className="hint">{t('Tự quét mỗi ngày lúc {time}.', { time: v.settings.scanTime })}</span>}
      </div>
      {scan && scan.status !== 'running' && scan.status !== 'failed' && <Findings scan={scan} busy={busy || ackBusy} onIgnore={(p, on) => void ignore(p, on)} />}
      {ignoreError && <Alert tone="err">{ignoreError}</Alert>}
      {toAcknowledge && site.appType === 'wordpress' && (
        <div className="row">
          <button className="btn sm" disabled={ackBusy} onClick={() => void acknowledge()}>
            {t('Tài khoản quản trị và mu-plugin hiện tại là của tôi')}
          </button>
          <span className="hint">{t('Lần quét sau sẽ không báo chúng nữa (một mu-plugin bị sửa sau đó vẫn bị báo).')}</span>
        </div>
      )}
      <History scans={v.history} />
      <ScheduleForm settings={v.settings} onSaved={refresh} />
    </div>
  );
}

interface WpAdmin {
  id: number;
  login: string;
  email: string;
  registered: string;
}

const CLEAN_DEFAULTS: CleanSiteInput = {
  reinstallCore: true,
  reinstallPlugins: true,
  reinstallThemes: true,
  updateToLatest: false,
  quarantineFiles: true,
  deleteUserIds: [],
  shuffleSalts: true,
  rotateDbPassword: true,
  revokeAppPasswords: true,
  resetSiteUrl: true,
  resetAdminPasswords: true,
};

function CleanForm({ site, v, busy, start }: { site: Site; v: SiteSecurityView; busy: boolean; start: (path: string, body?: unknown) => void }) {
  const wp = site.appType === 'wordpress';
  const admins = useQuery({ queryKey: ['security-admins', site.id], queryFn: () => get<WpAdmin[]>(`/api/sites/${site.id}/security/admins`), enabled: wp });
  const [form, setForm] = useState<CleanSiteInput>(CLEAN_DEFAULTS);
  const flagged = new Set((v.lastScan?.findings ?? []).filter((f) => f.check === 'new-admin').map((f) => f.path));
  const set = (k: keyof CleanSiteInput) => (on: boolean) => setForm({ ...form, [k]: on });
  const toggleUser = (id: number, on: boolean) => setForm({ ...form, deleteUserIds: on ? [...form.deleteUserIds, id] : form.deleteUserIds.filter((x) => x !== id) });
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>{t('Dọn site')}</h3>
      <div className="sub">
        {wp
          ? t('Thay code bằng bản sạch thay vì tin vào việc quét rồi xoá: WordPress, plugin và theme được tải lại từ wordpress.org đúng phiên bản đang dùng. Chỉ giữ dữ liệu (database, uploads).')
          : t('Chuyển các file bị đánh dấu ra khỏi thư mục web. Với site không phải WordPress, cách chắc chắn nhất là deploy lại code từ nguồn gốc (git, bản gốc của bạn).')}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {wp && (
          <>
            <Check checked={form.reinstallCore} onChange={set('reinstallCore')}>
              {t('Cài lại WordPress core')}
            </Check>
            <Check checked={form.reinstallPlugins} onChange={set('reinstallPlugins')}>
              {t('Cài lại plugin từ wordpress.org (plugin trả phí sẽ được liệt kê để tải lại bằng tay)')}
            </Check>
            <Check checked={form.reinstallThemes} onChange={set('reinstallThemes')}>
              {t('Cài lại theme từ wordpress.org')}
            </Check>
            <Check checked={form.updateToLatest} onChange={set('updateToLatest')}>
              {t('Cài bản mới nhất thay vì đúng phiên bản đang dùng (vá luôn lỗ hổng đã bị khai thác)')}
            </Check>
          </>
        )}
        <Check checked={form.quarantineFiles} onChange={set('quarantineFiles')}>
          {t('Chuyển file bị đánh dấu ra khỏi thư mục web (không xoá hẳn)')}
        </Check>
        {wp && (
          <>
            <Check checked={form.shuffleSalts} onChange={set('shuffleSalts')}>
              {t('Đổi salt trong wp-config.php (đăng xuất mọi người, kể cả kẻ tấn công)')}
            </Check>
            <Check checked={form.rotateDbPassword} onChange={set('rotateDbPassword')}>
              {t('Đổi mật khẩu database')}
            </Check>
            <Check checked={form.revokeAppPasswords} onChange={set('revokeAppPasswords')}>
              {t('Thu hồi application password và phiên đăng nhập')}
            </Check>
            <Check checked={form.resetAdminPasswords} onChange={set('resetAdminPasswords')}>
              {t('Đặt mật khẩu ngẫu nhiên cho mọi tài khoản quản trị (sau đó vào wp-admin bằng nút của panel hoặc "Quên mật khẩu")')}
            </Check>
            <Check checked={form.resetSiteUrl} onChange={set('resetSiteUrl')}>
              {t('Đặt lại địa chỉ site (home/siteurl) nếu bị đổi sang tên miền khác')}
            </Check>
          </>
        )}
      </div>
      {wp && (admins.data?.length ?? 0) > 0 && (
        <Field label={t('Xoá tài khoản quản trị')} hint={t('Bài viết của tài khoản bị xoá chuyển cho tài khoản quản trị còn lại đầu tiên.')}>
          <div className="stack" style={{ gap: 6 }}>
            {admins.data!.map((a) => (
              <Check key={a.id} checked={form.deleteUserIds.includes(a.id)} onChange={(on) => toggleUser(a.id, on)}>
                <span className="mono">{a.login}</span> <span className="sub">· {a.email} · {fmtDate(a.registered)}</span> {flagged.has(a.login) && <Badge tone="warn">{t('mới')}</Badge>}
              </Check>
            ))}
          </div>
        </Field>
      )}
      <div className="row">
        <button className="btn danger solid" disabled={busy} onClick={() => start(`/api/sites/${site.id}/security/clean`, form)}>
          {t('Dọn site')}
        </button>
        <span className="hint">{t('Có bản sao lưu an toàn trước khi dọn. File cũ được giữ ở {dir}.', { dir: v.quarantineDir })}</span>
      </div>
    </div>
  );
}

function QuarantineCard({ site, v, busy, start }: { site: Site; v: SiteSecurityView; busy: boolean; start: (path: string, body?: unknown) => void }) {
  const q = v.quarantine;
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [force, setForce] = useState(false);
  const scan = v.lastScan;
  // the scan reads PHP code only (supported.clean = an isolated PHP site): for other sites the owner confirms
  const verifiable = v.supported.clean;
  const scannedSince = verifiable && !!scan && !!q.since && scan.startedAt >= q.since && (scan.status === 'clean' || scan.status === 'warning');

  if (!q.active) {
    return (
      <div className="card stack" id="quarantine-card">
        <h2 style={{ margin: 0 }}>{t('Cách ly khẩn')}</h2>
        <div className="sub">
          {t('Dùng khi nghi site bị nhiễm: site trả trang bảo trì, mọi kết nối ra ngoài của site bị chặn, PHP/Node và mọi tiến trình còn sót bị dừng, cron của site bị xoá, rồi chụp một bản sao lưu làm bằng chứng. Trong lúc cách ly không bật lại, cập nhật, nhân bản hay đăng nhập wp-admin được.')}
        </div>
        {!v.supported.quarantine && <Alert tone="info">{t('Cần site có user riêng: bấm "Cách ly ngay" ở tab Tổng quan trước.')}</Alert>}
        <Field label={t('Lý do (ghi vào lịch sử)')}>
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={t('Ví dụ: site chuyển hướng sang trang lạ')} />
        </Field>
        {confirming ? (
          <>
            <Alert tone="warn">{t('{domain} sẽ ngừng phục vụ khách ngay lập tức. Tiếp tục?', { domain: site.domain })}</Alert>
            <div className="row end">
              <button className="btn" onClick={() => setConfirming(false)}>
                {t('Huỷ')}
              </button>
              <button
                className="btn danger solid"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  start(`/api/sites/${site.id}/security/quarantine`, { reason });
                }}
              >
                {t('Xác nhận cách ly')}
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button className="btn danger" disabled={busy || !v.supported.quarantine} onClick={() => setConfirming(true)}>
              {t('Cách ly khẩn')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card stack" id="quarantine-card">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{t('Cách ly khẩn')}</h2>
        <Badge tone="err">{t('Đang cách ly')}</Badge>
      </div>
      {q.problems.length > 0 && (
        <Alert tone="err">
          <div className="stack" style={{ gap: 8 }}>
            <div>{t('Cách ly chưa trọn vẹn, lỗi ở bước: {steps}. Xem log, xử lý lỗi rồi chạy lại.', { steps: q.problems.map((p) => t(QUARANTINE_STEP_LABELS[p])).join(', ') })}</div>
            <div>
              <button className="btn sm danger" disabled={busy} onClick={() => start(`/api/sites/${site.id}/security/quarantine`, { reason: q.reason ?? '' })}>
                {t('Chạy lại cách ly')}
              </button>
            </div>
          </div>
        </Alert>
      )}
      <div className="kv">
        <div>{t('Từ lúc')}</div>
        <div>{fmtDate(q.since)}</div>
        <div>{t('Người thực hiện')}</div>
        <div>{q.by ?? '—'}</div>
        {q.reason && (
          <>
            <div>{t('Lý do')}</div>
            <div>{q.reason}</div>
          </>
        )}
        <div>{t('Bản sao lưu bằng chứng')}</div>
        <div className="mono">{q.backupId ?? t('không có')}</div>
      </div>
      <Alert tone="info">{t('Thứ tự nên làm: 1) Dọn site, 2) xem kết quả quét lại, 3) đổi mật khẩu quản trị và tài khoản FTP/hosting liên quan, 4) gỡ cách ly.')}</Alert>
      {v.supported.clean ? (
        <CleanForm site={site} v={v} busy={busy} start={start} />
      ) : (
        <div className="sub">
          {t('Site này không có bước dọn tự động và bộ quét không kiểm tra được code của nó. Deploy bị chặn trong lúc cách ly: kiểm tra hoặc thay code bằng tay (SFTP), gỡ cách ly, rồi deploy lại ngay từ nguồn gốc (git).')}
        </div>
      )}
      <h3 style={{ margin: 0 }}>{t('Gỡ cách ly')}</h3>
      {scannedSince ? (
        <div className="sub">{t('Lần quét sau khi cách ly không còn dấu hiệu nghiêm trọng.')}</div>
      ) : (
        <>
          {verifiable && <Alert tone="warn">{t('Chưa có lần quét nào sau khi cách ly cho kết quả không còn dấu hiệu nghiêm trọng.')}</Alert>}
          <Check checked={force} onChange={setForce}>
            {t('Tôi đã tự kiểm tra site, vẫn gỡ cách ly (ghi vào lịch sử)')}
          </Check>
        </>
      )}
      <div className="row">
        <button className={scannedSince ? 'btn primary' : 'btn danger'} disabled={busy || (!scannedSince && !force)} onClick={() => start(`/api/sites/${site.id}/security/release`, { force: !scannedSince })}>
          {t('Gỡ cách ly')}
        </button>
      </div>
    </div>
  );
}

function CodeLockCard({ site, v, busy, start }: { site: Site; v: SiteSecurityView; busy: boolean; start: (path: string, body?: unknown) => void }) {
  const lock = v.codeLock;
  const [dirs, setDirs] = useState(lock.writableDirs.join('\n'));
  useEffect(() => setDirs(lock.writableDirs.join('\n')), [lock.writableDirs.join('\n')]);
  const list = dirs
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean);
  const changed = list.join('\n') !== lock.writableDirs.join('\n');
  const body = (locked: boolean) => ({ locked, writableDirs: list.join('\n') === lock.defaultWritableDirs.join('\n') ? [] : list });
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{t('Khoá code')}</h2>
        {lock.locked ? <Badge tone="ok">{t('Đã khoá')}</Badge> : <Badge>{t('Chưa khoá')}</Badge>}
      </div>
      <div className="sub">
        {t('Code của site thuộc về root, PHP chỉ đọc được và chỉ ghi được vào các thư mục bên dưới. Plugin bị khai thác không sửa được code của chính site: không cài được backdoor vào theme hay wp-config.php.')}
      </div>
      {site.appType === 'wordpress' && (
        <div className="hint">{t('Khi khoá, cài và cập nhật plugin/theme trong wp-admin sẽ không chạy: cập nhật qua tab Cập nhật của panel (panel tự mở khoá trong lúc cập nhật rồi khoá lại).')}</div>
      )}
      <Field label={t('Thư mục PHP được ghi (mỗi dòng một thư mục, tính từ thư mục site)')} hint={t('Mặc định: {dirs}', { dirs: lock.defaultWritableDirs.join(', ') || '—' })}>
        <textarea value={dirs} onChange={(e) => setDirs(e.target.value)} rows={4} />
      </Field>
      <div className="row">
        {lock.locked ? (
          <>
            <button className="btn" disabled={busy || !changed} onClick={() => start(`/api/sites/${site.id}/security/code-lock`, body(true))}>
              {t('Lưu thư mục')}
            </button>
            <button className="btn danger" disabled={busy} onClick={() => start(`/api/sites/${site.id}/security/code-lock`, body(false))}>
              {t('Mở khoá code')}
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" disabled={busy || v.quarantine.active} onClick={() => start(`/api/sites/${site.id}/security/code-lock`, body(true))}>
              {t('Khoá code')}
            </button>
            {v.quarantine.active && <span className="hint">{t('Dọn site và gỡ cách ly trước khi khoá code.')}</span>}
          </>
        )}
      </div>
    </div>
  );
}

export function SecurityTab({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['security', site.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<SiteSecurityView>(`/api/sites/${site.id}/security`) });
  const [task, setTask] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['site', site.id] });
    void qc.invalidateQueries({ queryKey: ['backups', site.id] });
    void qc.invalidateQueries({ queryKey: ['security-admins', site.id] });
  };

  // a job started elsewhere (daily scan, another browser tab) is followed too
  const runningId = v?.running?.taskId;
  useEffect(() => {
    if (runningId) {
      setTask(runningId);
      setActive(true);
    }
  }, [runningId]);

  const start = (path: string, body?: unknown) => {
    setError(null);
    void (async () => {
      try {
        const info = await post<TaskInfo>(path, body);
        setTask(info.id);
        setActive(true);
        refresh();
      } catch (e) {
        setError(errMsg(e));
      }
    })();
  };

  if (!v) return q.error ? <ErrorBox error={q.error} /> : <div className="sub">{t('Đang tải…')}</div>;
  const busy = active || !!v.running;

  return (
    <div className="stack">
      {error && <Alert tone="err">{error}</Alert>}
      {task && (
        <div className="card">
          <TaskLog
            key={task}
            taskId={task}
            onDone={() => {
              setActive(false);
              refresh();
            }}
          />
        </div>
      )}
      <div className="grid cols-2">
        <ScanCard site={site} v={v} busy={busy} start={start} refresh={refresh} />
        <QuarantineCard site={site} v={v} busy={busy} start={start} />
      </div>
      {v.supported.codeLock && <CodeLockCard site={site} v={v} busy={busy} start={(p, b) => void putTask(p, b)} />}
      {v.events.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t('Lịch sử bảo mật')}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {v.events.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.at)}</td>
                    <td>
                      {t(SECURITY_EVENT_LABELS[e.action])}
                      <div className="sub">{e.by ?? '—'}</div>
                    </td>
                    <td className="sub">{e.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  async function putTask(path: string, body: unknown) {
    setError(null);
    try {
      const info = await put<TaskInfo>(path, body);
      setTask(info.id);
      setActive(true);
    } catch (e) {
      setError(errMsg(e));
    }
  }
}
