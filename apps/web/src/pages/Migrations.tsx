import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PANEL_LABELS, type Migration, type MigrationStatus } from '@tpanel/shared';
import { fmtDate, get } from '../api';
import { Badge, ErrorBox } from '../components/ui';

export const STATUS_LABEL: Record<MigrationStatus, [string, 'ok' | 'warn' | 'err' | 'info' | 'default']> = {
  pending: ['Chờ', 'default'],
  running: ['Đang chạy', 'info'],
  completed: ['Hoàn tất', 'ok'],
  partial: ['Một phần', 'warn'],
  failed: ['Lỗi', 'err'],
  cancelled: ['Đã huỷ', 'warn'],
};

export function Migrations() {
  const q = useQuery({ queryKey: ['migrations'], queryFn: () => get<Migration[]>('/api/migrations'), refetchInterval: 5000 });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chuyển site</h1>
          <div className="sub">Di chuyển website từ VPS / panel khác (aaPanel, CyberPanel, HestiaCP, cPanel, DirectAdmin, CloudPanel, Plesk, Webinoly, VPS thuần) về TPanel</div>
        </div>
        <Link to="/migrations/new" className="btn primary">
          + Chuyển site mới
        </Link>
      </div>
      <ErrorBox error={q.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Tên</th>
              <th>Nguồn</th>
              <th>Site</th>
              <th>Trạng thái</th>
              <th>Bắt đầu</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((m) => {
              const c = m.itemCounts ?? {};
              const total = Object.values(c).reduce((a, b) => a + (b ?? 0), 0);
              const [label, tone] = STATUS_LABEL[m.status];
              return (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>
                    <Link to={`/migrations/${m.id}`}>{m.name}</Link>
                  </td>
                  <td>
                    <div className="mono">{m.sourceLabel}</div>
                    <div className="sub">
                      {PANEL_LABELS[m.panel]} {m.sameHost && <Badge tone="warn">cùng VPS</Badge>}
                    </div>
                  </td>
                  <td>
                    {c.completed ?? 0}/{total} thành công{c.failed ? `, ${c.failed} lỗi` : ''}
                  </td>
                  <td>
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                  <td className="sub">{fmtDate(m.startedAt ?? m.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {q.data?.length === 0 && <div className="empty">Chưa có lần chuyển site nào</div>}
      </div>
    </>
  );
}
