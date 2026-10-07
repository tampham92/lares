import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GithubAppView, GithubManifestStart } from '@lares/shared';
import { del, errMsg, get, post } from '../api';
import { t } from '../i18n';
import { Alert, Badge, Field } from './ui';

export const useGithub = () => useQuery({ queryKey: ['github'], queryFn: () => get<GithubAppView>('/api/github'), staleTime: 60_000 });

/**
 * Post the manifest to GitHub as a real form: GitHub's "create App from manifest" page only takes a
 * top-level POST (the panel CSP allows form-action to github.com for exactly this).
 */
function submitManifest(start: GithubManifestStart) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = start.action;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = start.manifest;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

/** Settings card: create the panel's own GitHub App, install it on repos, disconnect. */
export function GithubAppCard() {
  const qc = useQueryClient();
  const q = useGithub();
  const [params] = useSearchParams();
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = q.data;

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      submitManifest(await post<GithubManifestStart>('/api/github/manifest', { origin: window.location.origin, org }));
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm(t('Ngắt kết nối GitHub? Các site đã deploy vẫn chạy, nhưng lần pull sau từ repo private sẽ cần kết nối lại hoặc Access token.'))) return;
    setBusy(true);
    try {
      qc.setQueryData(['github'], await del<GithubAppView>('/api/github'));
      void qc.removeQueries({ queryKey: ['github-repos'] });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>GitHub</h2>
      <div className="sub">
        {t('Kết nối GitHub để chọn repo (kể cả private) khi tạo site Next.js, không cần dán token. Lares tạo một GitHub App riêng cho máy chủ này: chỉ có quyền đọc code, khoá bí mật nằm trên máy chủ của bạn.')}
      </div>
      {error && <Alert tone="err">{error}</Alert>}
      {v?.lastError && <Alert tone="warn">{v.lastError}</Alert>}
      {v?.connected && v.app ? (
        <>
          {params.get('github') === 'installed' && v.installations.length > 0 && <Alert tone="ok">{t('Đã cập nhật quyền truy cập repo của GitHub App.')}</Alert>}
          <div className="kv">
            <div>{t('Trạng thái')}</div>
            <div>
              <Badge tone="ok">{t('Đã kết nối')}</Badge>
            </div>
            <div>GitHub App</div>
            <div>
              <a href={v.app.htmlUrl} target="_blank" rel="noreferrer">
                {v.app.name}
              </a>
            </div>
            <div>{t('Chủ sở hữu')}</div>
            <div>{v.app.owner || '—'}</div>
            <div>{t('Đã cài trên')}</div>
            <div>
              {v.installations.length === 0
                ? '—'
                : v.installations.map((i) => (
                    <div key={i.id}>
                      <a href={i.settingsUrl} target="_blank" rel="noreferrer">
                        {i.account}
                      </a>{' '}
                      <span className="hint">{i.repositorySelection === 'all' ? t('(mọi repo)') : t('(repo đã chọn)')}</span>
                    </div>
                  ))}
            </div>
          </div>
          {v.installations.length === 0 && !v.lastError && (
            <Alert tone="warn">{t('Bước cuối: cài App lên tài khoản GitHub và chọn các repo Lares được đọc.')}</Alert>
          )}
          <div className="row end">
            <button className="btn danger" disabled={busy} onClick={disconnect}>
              {t('Ngắt kết nối')}
            </button>
            <a className={`btn${v.installations.length === 0 ? ' primary' : ''}`} href={v.app.installUrl}>
              {v.installations.length === 0 ? t('Cài lên GitHub') : t('Thêm tài khoản / repo')}
            </a>
          </div>
          <div className="hint">
            {t('Ngắt kết nối không xoá App trên GitHub; xoá tại')}{' '}
            <a href={v.app.settingsUrl} target="_blank" rel="noreferrer">
              {t('trang cài đặt App')}
            </a>
            .
          </div>
        </>
      ) : (
        <>
          <Field label={t('Tổ chức GitHub (tuỳ chọn)')} hint={t('Để trống để tạo App trên tài khoản cá nhân. Nhập tên tổ chức nếu repo thuộc tổ chức và bạn là owner.')}>
            <input value={org} spellCheck={false} onChange={(e) => setOrg(e.target.value)} placeholder="my-company" />
          </Field>
          <div className="row end">
            <button className="btn primary" disabled={busy || q.isLoading} onClick={connect}>
              {busy ? t('Đang chuyển sang GitHub…') : t('Kết nối GitHub')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
