import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResult } from '@lares/shared';
import { auth, post } from '../api';
import { ErrorBox, Field } from '../components/ui';
import { t } from '../i18n';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';

export function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  // Set after a correct password when the account has two-factor auth on.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const finish = (r: LoginResult) => {
    if ('mfaRequired' in r) {
      setMfaToken(r.mfaToken);
      setCode('');
      return;
    }
    auth.set(r.token);
    nav('/');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      finish(mfaToken ? await post<LoginResult>('/api/auth/login/2fa', { mfaToken, code }) : await post<LoginResult>('/api/auth/login', { username, password }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div className="brand" style={{ color: 'var(--text)', padding: 0 }}>
          <span style={{ color: '#fff' }}>L</span>Lares
        </div>
        <ErrorBox error={error} />
        {mfaToken ? (
          <>
            <Field label={t('Mã xác thực')} hint={t('Mã 6 số trong ứng dụng xác thực, hoặc một mã khôi phục.')}>
              <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" maxLength={32} autoFocus placeholder="123456" />
            </Field>
            <button className="btn primary" disabled={busy || code.trim().length < 6}>
              {busy ? t('Đang kiểm tra…') : t('Xác nhận')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setMfaToken(null);
                setPassword('');
                setError(null);
              }}
            >
              {t('Quay lại')}
            </button>
          </>
        ) : (
          <>
            <Field label={t('Tên đăng nhập')}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            <Field label={t('Mật khẩu')}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
            </Field>
            <button className="btn primary" disabled={busy}>
              {busy ? t('Đang đăng nhập…') : t('Đăng nhập')}
            </button>
          </>
        )}
        <LanguageSwitcher />
      </form>
    </div>
  );
}
