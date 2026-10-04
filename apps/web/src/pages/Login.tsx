import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, post } from '../api';
import { ErrorBox, Field } from '../components/ui';
import { t } from '../i18n';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';

export function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string }>('/api/auth/login', { username, password });
      auth.set(r.token);
      nav('/');
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
        <Field label={t('Tên đăng nhập')}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </Field>
        <Field label={t('Mật khẩu')}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? t('Đang đăng nhập…') : t('Đăng nhập')}
        </button>
        <LanguageSwitcher />
      </form>
    </div>
  );
}
