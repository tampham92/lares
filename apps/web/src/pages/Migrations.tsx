import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PANEL_LABELS, msg, type Migration, type MigrationStatus } from '@lares/shared';
import { fmtDate, get } from '../api';
import { Badge, ErrorBox } from '../components/ui';
import { t } from '../i18n';

export const STATUS_LABEL: Record<MigrationStatus, [string, 'ok' | 'warn' | 'err' | 'info' | 'default']> = {
  pending: [msg('Chờ'), 'default'],
  running: [msg('Đang chạy'), 'info'],
  completed: [msg('Hoàn tất'), 'ok'],
  partial: [msg('Một phần'), 'warn'],
  failed: [msg('Lỗi'), 'err'],
  cancelled: [msg('Đã huỷ'), 'warn'],
};

export function Migrations() {
  const q = useQuery({ queryKey: ['migrations'], queryFn: () => get<Migration[]>('/api/migrations'), refetchInterval: 5000 });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Chuyển site')}</h1>
          <div className="sub">
            {t('Di chuyển website từ VPS / panel khác (aaPanel, CyberPanel, HestiaCP, cPanel, DirectAdmin, CloudPanel, Plesk, Webinoly, VPS thuần) về Lares')}
          </div>
        </div>
        <Link to="/migrations/new" className="btn primary">
          {t('+ Chuyển site mới')}
        </Link>
      </div>
      <ErrorBox error={q.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Tên')}</th>
              <th>{t('Nguồn')}</th>
              <th>Site</th>
              <th>{t('Trạng thái')}</th>
              <th>{t('Bắt đầu')}</th>
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
                      {t(PANEL_LABELS[m.panel])} {m.sameHost && <Badge tone="warn">{t('cùng VPS')}</Badge>}
                    </div>
                  </td>
                  <td>
                    {c.failed
                      ? t('{done}/{total} thành công, {failed} lỗi', { done: c.completed ?? 0, total, failed: c.failed })
                      : t('{done}/{total} thành công', { done: c.completed ?? 0, total })}
                  </td>
                  <td>
                    <Badge tone={tone}>{t(label)}</Badge>
                  </td>
                  <td className="sub">{fmtDate(m.startedAt ?? m.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {q.data?.length === 0 && <div className="empty">{t('Chưa có lần chuyển site nào')}</div>}
      </div>
    </>
  );
}
