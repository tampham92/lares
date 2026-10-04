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
    <div style={{ marginTop: 'auto', padding: '12px 12px 0', fontSize: 12, color: 'var(--sidebar-text)', opacity: 0.85 }}>
      {v.updateAvailable && v.latest && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', color: '#fbbf24' }}>{t('Có bản mới {version}', { version: v.latest })}</summary>
          <div style={{ marginTop: 6, lineHeight: 1.45 }}>
            {t('Nâng cấp bằng lệnh sau trên VPS (website và dữ liệu được giữ nguyên):')}
            <code
              style={{ display: 'block', margin: '6px 0', padding: '6px 8px', borderRadius: 6, background: 'var(--code-bg)', color: 'var(--code-text)', wordBreak: 'break-all', userSelect: 'all' }}
            >
              {v.upgradeCommand}
            </code>
            <button type="button" className="btn sm" onClick={copy} style={{ marginRight: 8 }}>
              {copied ? t('Đã sao chép') : t('Sao chép')}
            </button>
            <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--sidebar-text)', textDecoration: 'underline', padding: 0, display: 'inline' }}>
              {t('Xem thay đổi')}
            </a>
          </div>
        </details>
      )}
      <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" title={t('Xem thay đổi')} style={{ color: 'inherit', padding: 0, display: 'inline' }}>
        Lares v{v.version}
      </a>
    </div>
  );
}
