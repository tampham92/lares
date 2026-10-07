import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { GithubAppView } from '@lares/shared';
import { errMsg, post } from '../api';
import { t } from '../i18n';
import { Alert } from '../components/ui';

/**
 * GitHub sends the admin here after "Create GitHub App" with a one-time code. The panel trades it
 * for the App's key, then goes straight on to installing the App so the admin can pick repos.
 */
export function GithubCallback() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // the code is single-use: never post it twice (StrictMode)
    started.current = true;
    const code = params.get('code') ?? '';
    const state = params.get('state') ?? '';
    post<GithubAppView>('/api/github/manifest/convert', { code, state })
      .then((v) => window.location.assign(v.app?.installUrl ?? '/settings?tab=integrations'))
      .catch((e) => setError(errMsg(e)));
  }, [params]);

  return (
    <>
      <div className="page-head">
        <h1>GitHub</h1>
      </div>
      <div className="card stack">
        {error ? (
          <>
            <Alert tone="err">{error}</Alert>
            <div>
              <Link to="/settings?tab=integrations">{t('Quay lại Cài đặt → Tích hợp')}</Link>
            </div>
          </>
        ) : (
          <div className="sub">{t('Đang lưu GitHub App và chuyển sang bước chọn repo…')}</div>
        )}
      </div>
    </>
  );
}
