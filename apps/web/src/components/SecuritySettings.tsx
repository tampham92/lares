import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { encode } from 'uqr';
import type { AllowlistView, TwoFactorEnabled, TwoFactorSetup, TwoFactorStatus } from '@lares/shared';
import { ApiError, auth, errMsg, get, logout, post, put } from '../api';
import { Alert, Badge, Field } from './ui';
import { t } from '../i18n';

type Msg = { tone: 'ok' | 'err' | 'warn'; text: string } | null;

function QrCode({ text }: { text: string }) {
  const { size, d } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 });
    let path = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x} ${y}h1v1h-1z`)));
    return { size: qr.size, d: path };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={200} height={200} role="img" aria-label={t('Mã QR')} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
      <path d={d} fill="#000" />
    </svg>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Lares Panel - ${t('mã khôi phục')}\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lares-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="stack">
      <Alert tone="warn">{t('Lưu các mã khôi phục này ở nơi an toàn. Mỗi mã dùng được một lần khi mất điện thoại. Chúng chỉ hiển thị lần này.')}</Alert>
      <pre className="mono" style={{ columns: 2, margin: 0, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
        {text}
      </pre>
      <div className="row end">
        <button className="btn" onClick={() => void navigator.clipboard?.writeText(text)}>
          {t('Sao chép')}
        </button>
        <button className="btn" onClick={download}>
          {t('Tải xuống .txt')}
        </button>
        <button className="btn primary" onClick={onDone}>
          {t('Tôi đã lưu các mã này')}
        </button>
      </div>
    </div>
  );
}

export function TwoFactorCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['2fa'], queryFn: () => get<TwoFactorStatus>('/api/security/2fa') });
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [disableWith, setDisableWith] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const st = q.data;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['2fa'] });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('Xác thực hai lớp (2FA)')}</h2>
        {st && (st.enabled ? <Badge tone="ok">{t('Đang bật')}</Badge> : <Badge tone="warn">{t('Đang tắt')}</Badge>)}
      </div>
      <div className="sub">{t('Ngoài mật khẩu, đăng nhập cần thêm mã 6 số từ ứng dụng xác thực (Google Authenticator, Authy, 1Password, Bitwarden…).')}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      ) : setup ? (
        <>
          <div>{t('1. Quét mã QR bằng ứng dụng xác thực, hoặc nhập khoá thủ công:')}</div>
          <QrCode text={setup.otpauthUrl} />
          <code style={{ wordBreak: 'break-all' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          <Field label={t('2. Nhập mã 6 số ứng dụng hiển thị')}>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" />
          </Field>
          <div className="row end">
            <button className="btn" disabled={busy} onClick={() => setSetup(null)}>
              {t('Huỷ')}
            </button>
            <button
              className="btn primary"
              disabled={busy || code.trim().length < 6}
              onClick={() =>
                run(async () => {
                  const r = await post<TwoFactorEnabled>('/api/security/2fa/enable', { code });
                  auth.set(r.token);
                  setSetup(null);
                  setCode('');
                  setCodes(r.recoveryCodes);
                  setMsg({ tone: 'ok', text: t('Đã bật xác thực hai lớp. Các phiên đăng nhập khác đã bị đăng xuất.') });
                })
              }
            >
              {t('Xác nhận & bật')}
            </button>
          </div>
        </>
      ) : st?.enabled ? (
        <>
          {st.recoveryCodesLeft <= 3 ? (
            <Alert tone="warn">{t('Chỉ còn {n} mã khôi phục - hãy tạo bộ mã mới.', { n: st.recoveryCodesLeft })}</Alert>
          ) : (
            <div className="sub">{t('Còn {n} mã khôi phục chưa dùng.', { n: st.recoveryCodesLeft })}</div>
          )}
          <Field label={t('Mã 6 số từ ứng dụng hoặc mật khẩu hiện tại')} hint={t('Cần để tạo mã khôi phục mới (chỉ nhận mã) hoặc tắt 2FA.')}>
            <input type="password" value={disableWith} onChange={(e) => setDisableWith(e.target.value)} autoComplete="off" />
          </Field>
          <div className="row end">
            <button
              className="btn"
              disabled={busy || !/^\d{6}$/.test(disableWith.trim())}
              onClick={() =>
                run(async () => {
                  const r = await post<{ recoveryCodes: string[] }>('/api/security/2fa/recovery-codes', { code: disableWith.trim() });
                  setDisableWith('');
                  setCodes(r.recoveryCodes);
                })
              }
            >
              {t('Tạo mã khôi phục mới')}
            </button>
            <button
              className="btn danger"
              disabled={busy || !disableWith}
              onClick={() =>
                confirm(t('Tắt xác thực hai lớp? Tài khoản sẽ chỉ còn được bảo vệ bằng mật khẩu.')) &&
                run(async () => {
                  const v = disableWith.trim();
                  await post('/api/security/2fa/disable', /^\d{6}$/.test(v) ? { code: v } : { password: disableWith });
                  setDisableWith('');
                  setMsg({ tone: 'ok', text: t('Đã tắt xác thực hai lớp') });
                })
              }
            >
              {t('Tắt 2FA')}
            </button>
          </div>
        </>
      ) : (
        <div className="row end">
          <button
            className="btn primary"
            disabled={busy || !st}
            onClick={() =>
              run(async () => {
                setSetup(await post<TwoFactorSetup>('/api/security/2fa/setup'));
              })
            }
          >
            {t('Bật xác thực hai lớp')}
          </button>
        </div>
      )}
    </div>
  );
}

const splitEntries = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function AllowlistCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['allowlist'], queryFn: () => get<AllowlistView>('/api/security/allowlist') });
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const data = q.data;

  useEffect(() => {
    if (data) setText(data.entries.join('\n'));
  }, [data]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const entries = splitEntries(text);
    try {
      let r: AllowlistView;
      try {
        r = await put<AllowlistView>('/api/security/allowlist', { entries });
      } catch (e) {
        // 409: the list would lock this browser out - only save after an explicit confirmation.
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        if (!confirm(`${e.message}\n\n${t('Vẫn lưu? Bạn sẽ cần SSH vào máy chủ và chạy "lares allowlist clear" để vào lại.')}`)) return;
        r = await put<AllowlistView>('/api/security/allowlist', { entries, force: true });
      }
      qc.setQueryData(['allowlist'], r);
      setMsg({ tone: 'ok', text: r.entries.length ? t('Đã lưu - chỉ {n} địa chỉ/dải IP này truy cập được panel.', { n: r.entries.length }) : t('Đã lưu - mọi IP đều truy cập được panel.') });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('Giới hạn IP truy cập panel')}</h2>
      <div className="sub">{t('Khi có danh sách, mọi IP khác nhận lỗi 403 (cả trang đăng nhập). Bỏ trống = không giới hạn.')}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {data && (
        <div className="row">
          <span>
            {t('IP hiện tại của bạn:')} <code>{data.currentIp}</code>
          </span>
          {!splitEntries(text).includes(data.currentIp) && (
            <button className="btn sm" onClick={() => setText((s) => (s.trim() ? `${s.trim()}\n${data.currentIp}` : data.currentIp))}>
              {t('+ Thêm IP này')}
            </button>
          )}
        </div>
      )}
      <Field label={t('IP hoặc dải CIDR được phép (mỗi dòng một mục)')} hint={t('Ví dụ: 203.0.113.7, 10.0.0.0/8, 2001:db8::/32. Kết nối từ chính máy chủ (127.0.0.1, đường hầm SSH) luôn được phép.')}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="203.0.113.7" />
      </Field>
      <div className="row end">
        <button className="btn primary" disabled={busy || !data} onClick={() => void save()}>
          {t('Lưu')}
        </button>
      </div>
    </div>
  );
}

export function SessionsCard() {
  const nav = useNavigate();
  return (
    <div className="card stack">
      <h2>{t('Phiên đăng nhập')}</h2>
      <div className="sub">{t('Đăng xuất mọi trình duyệt và thiết bị đang đăng nhập bằng tài khoản này, kể cả trình duyệt hiện tại. Đổi mật khẩu cũng đăng xuất các phiên khác.')}</div>
      <div className="row end">
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm(t('Đăng xuất khỏi mọi thiết bị?'))) return;
            await logout(true);
            nav('/login');
          }}
        >
          {t('Đăng xuất mọi nơi')}
        </button>
      </div>
    </div>
  );
}

const NOTICE_KEY = 'lares_allowlist_notice_hidden';

/** Dashboard banner while the panel is reachable from any IP. */
export function AllowlistNotice() {
  const q = useQuery({ queryKey: ['allowlist'], queryFn: () => get<AllowlistView>('/api/security/allowlist') });
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden || !q.data || q.data.entries.length > 0) return null;
  return (
    <Alert tone="warn">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          {t('Panel đang mở cho mọi địa chỉ IP. Nên giới hạn IP truy cập và bật xác thực hai lớp trong')} <Link to="/settings?tab=security">{t('Cài đặt')}</Link>.
        </span>
        <button
          className="btn sm"
          onClick={() => {
            try {
              localStorage.setItem(NOTICE_KEY, '1');
            } catch {
              /* storage unavailable */
            }
            setHidden(true);
          }}
        >
          {t('Ẩn')}
        </button>
      </div>
    </Alert>
  );
}
