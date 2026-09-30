import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { APP_LABELS, type Site } from '@tpanel/shared';
import { fmtDate, get } from '../api';
import { Badge, ErrorBox } from '../components/ui';

export function Sites() {
  const q = useQuery({ queryKey: ['sites'], queryFn: () => get<Site[]>('/api/sites') });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Website</h1>
          <div className="sub">WordPress, Next.js, PHP và HTML tĩnh</div>
        </div>
        <div className="row">
          <Link to="/migrations/new" className="btn">
            Chuyển site từ VPS/panel khác
          </Link>
          <Link to="/sites/new" className="btn primary">
            + Thêm site
          </Link>
        </div>
      </div>
      <ErrorBox error={q.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tên miền</th>
              <th>Loại</th>
              <th>Runtime</th>
              <th>SSL</th>
              <th>Trạng thái</th>
              <th>Tạo lúc</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/sites/${s.id}`}>
                    <strong>{s.domain}</strong>
                  </Link>
                  {s.aliases.length > 0 && <div className="sub">{s.aliases.join(', ')}</div>}
                </td>
                <td>
                  {APP_LABELS[s.appType]} {s.migrationId && <Badge tone="info">migrated</Badge>}
                </td>
                <td className="mono">{s.appType === 'nextjs' ? `node :${s.appPort}` : s.phpVersion ? `PHP ${s.phpVersion}` : '—'}</td>
                <td>
                  {s.ssl.enabled ? (
                    <Badge tone={s.ssl.expiresAt && Date.parse(s.ssl.expiresAt) - Date.now() < 14 * 86_400_000 ? 'warn' : 'ok'}>
                      {s.ssl.type === 'letsencrypt' ? "Let's Encrypt" : 'Custom'}
                    </Badge>
                  ) : (
                    <Badge>Chưa có</Badge>
                  )}
                </td>
                <td>{s.status === 'active' ? <Badge tone="ok">Hoạt động</Badge> : <Badge tone="warn">Tạm ngưng</Badge>}</td>
                <td className="sub">{fmtDate(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.length === 0 && <div className="empty">Chưa có website. Bấm “Thêm site” hoặc chuyển site từ nơi khác về.</div>}
      </div>
    </>
  );
}
