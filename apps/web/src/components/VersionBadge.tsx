import { useQuery } from '@tanstack/react-query';
import { CHANGELOG_URL, type VersionInfo } from '@lares/shared';
import { get } from '../api';
import { t } from '../i18n';

/** Sidebar footer: the running version. A newer release is announced by the bell in the top bar (NotificationBell). */
export function VersionBadge() {
  const q = useQuery({ queryKey: ['version'], queryFn: () => get<VersionInfo>('/api/system/version'), staleTime: 3_600_000, retry: false });
  const v = q.data;
  if (!v) return null;
  return (
    <div className="sidebar-footer">
      <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" title={t('Xem thay đổi')}>
        Lares v{v.version}
      </a>
    </div>
  );
}
