import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHANGELOG_URL, type VersionInfo } from '@lares/shared';
import { get } from '../api';
import { t } from '../i18n';

/** Sidebar footer: running version, plus a small notice when a newer release is on GitHub. */
export function VersionBadge() {
  const q = useQuery({ queryKey: ['version'], queryFn: () => get<VersionInfo>('/api/system/version'), staleTime: 3_600_000, retry: false });
  const [copied, setCopied] = useState(false);
  const v = q.data;
  if (!v) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(v.upgradeCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (self-signed HTTPS / old browser): the command stays selectable */
    }
  };

  return (
    <div className="sidebar-footer">
      {v.updateAvailable && v.latest && (
        <details className="update">
          <summary>{t('Có bản mới {version}', { version: v.latest })}</summary>
          <div>
            {t('Nâng cấp bằng lệnh sau trên VPS (website và dữ liệu được giữ nguyên):')}
            <code>
              {v.upgradeCommand}
            </code>
            <button type="button" className="btn sm" onClick={copy}>
              {copied ? t('Đã sao chép') : t('Sao chép')}
            </button>
            {' '}
            <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">
              {t('Xem thay đổi')}
            </a>
          </div>
        </details>
      )}
      <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" title={t('Xem thay đổi')}>
        Lares v{v.version}
      </a>
    </div>
  );
}
