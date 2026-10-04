import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { APP_LABELS, type Site } from '@lares/shared';
import { fmtDate, get, siteHref, siteLabel } from '../api';
import { Badge, ErrorBox } from '../components/ui';
import { WpAdminButton } from '../components/WpAdminButton';
import { t } from '../i18n';

export function Sites() {
  const q = useQuery({ queryKey: ['sites'], queryFn: () => get<Site[]>('/api/sites') });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Website')}</h1>
          <div className="sub">{t('WordPress, Next.js, PHP và HTML tĩnh')}</div>
        </div>
        <div className="row">
          <Link to="/migrations/new" className="btn">
            {t('Chuyển site từ VPS/panel khác')}
          </Link>
          <Link to="/sites/new" className="btn primary">
            {t('+ Thêm site')}
          </Link>
        </div>
      </div>
      <ErrorBox error={q.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('Tên miền')}</th>
              <th>{t('Loại')}</th>
              <th>Runtime</th>
              <th>SSL</th>
              <th>{t('Trạng thái')}</th>
              <th>{t('Tạo lúc')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/sites/${s.id}`}>
                    <strong>{siteLabel(s)}</strong>
                  </Link>{' '}
                  {s.listenPort && <Badge tone="info">port {s.listenPort}</Badge>}
                  <div className="sub">
                    <a href={siteHref(s)} target="_blank" rel="noreferrer">
                      {siteHref(s)} ↗
                    </a>
                    {s.aliases.length > 0 && ` · ${s.aliases.join(', ')}`}
                  </div>
                </td>
                <td>
                  {t(APP_LABELS[s.appType])} {s.migrationId && <Badge tone="info">migrated</Badge>}
                </td>
                <td className="mono">{s.appType === 'nextjs' ? `node :${s.appPort}` : s.phpVersion ? `PHP ${s.phpVersion}` : '—'}</td>
                <td>
                  {s.ssl.enabled ? (
                    <Badge tone={s.ssl.expiresAt && Date.parse(s.ssl.expiresAt) - Date.now() < 14 * 86_400_000 ? 'warn' : 'ok'}>
                      {s.ssl.type === 'letsencrypt' ? "Let's Encrypt" : 'Custom'}
                    </Badge>
                  ) : (
                    <Badge>{t('Chưa có')}</Badge>
                  )}
                </td>
                <td>{s.status === 'active' ? <Badge tone="ok">{t('Hoạt động')}</Badge> : <Badge tone="warn">{t('Tạm ngưng')}</Badge>}</td>
                <td className="sub">{fmtDate(s.createdAt)}</td>
                <td>{s.appType === 'wordpress' && <WpAdminButton siteId={s.id} className="btn sm" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.length === 0 && <div className="empty">{t('Chưa có website. Bấm “Thêm site” hoặc chuyển site từ nơi khác về.')}</div>}
      </div>
    </>
  );
}
