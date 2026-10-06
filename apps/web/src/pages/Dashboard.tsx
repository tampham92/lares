import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Site, SystemStats } from '@lares/shared';
import { APP_LABELS } from '@lares/shared';
import { fmtBytes, get, siteLabel } from '../api';
import { Alert, Badge, ErrorBox, Progress } from '../components/ui';
import { AllowlistNotice } from '../components/SecuritySettings';
import { OnboardingCard } from '../components/OnboardingCard';
import { locale, t } from '../i18n';

export function Dashboard() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => get<SystemStats>('/api/system/stats'), refetchInterval: 10_000 });
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => get<Site[]>('/api/sites') });
  const s = stats.data;
  const expiring = (sites.data ?? []).filter((x) => x.ssl.expiresAt && Date.parse(x.ssl.expiresAt) - Date.now() < 14 * 86_400_000);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Tổng quan')}</h1>
          <div className="sub">{s ? `${s.hostname} · ${s.os}` : '…'}</div>
        </div>
      </div>
      <ErrorBox error={stats.error} />
      <AllowlistNotice />
      <OnboardingCard />
      {s?.dryRun && <Alert tone="warn">{t('Chế độ DRY-RUN: các lệnh thay đổi hệ thống (nginx, mysql, certbot, systemctl) chỉ được ghi log.')}</Alert>}
      {s && !s.dryRun && s.services.nginx === 'inactive' && (
        <Alert tone="warn">
          {t('nginx của Lares đang dừng (chế độ cùng tồn tại với web server cũ). Site đã tạo/chuyển về chưa nhận traffic. Khi sẵn sàng: dừng web server cũ rồi chạy')}{' '}
          <code>systemctl enable --now nginx</code>.
        </Alert>
      )}
      {expiring.map((x) => (
        <Alert key={x.id} tone="warn">
          {t('SSL của')} <Link to={`/sites/${x.id}`}>{x.domain}</Link> {t('hết hạn ngày {date}', { date: new Date(x.ssl.expiresAt!).toLocaleDateString(locale()) })}
        </Alert>
      ))}
      {s && (
        <div className="grid cols-4">
          <div className="card stat">
            <div className="label">CPU load (1/5/15m)</div>
            <div className="value">{s.loadavg.map((l) => l.toFixed(2)).join(' / ')}</div>
            <div className="sub">{s.cpuCount} vCPU</div>
          </div>
          <div className="card stat">
            <div className="label">RAM</div>
            <div className="value">{fmtBytes(s.memTotal - s.memFree)}</div>
            <Progress value={(s.memTotal - s.memFree) / s.memTotal} />
            <div className="sub">/ {fmtBytes(s.memTotal)}</div>
          </div>
          <div className="card stat">
            <div className="label">{t('Ổ đĩa')}</div>
            <div className="value">{s.disk ? fmtBytes(s.disk.used) : '—'}</div>
            {s.disk && <Progress value={s.disk.used / s.disk.total} />}
            <div className="sub">{s.disk ? t('trống {size}', { size: fmtBytes(s.disk.free) }) : ''}</div>
          </div>
          <div className="card stat">
            <div className="label">Uptime</div>
            <div className="value">{Math.floor(s.uptimeSec / 86400)}d {Math.floor((s.uptimeSec % 86400) / 3600)}h</div>
            <div className="sub">{t('{n} website', { n: sites.data?.length ?? 0 })}</div>
          </div>
        </div>
      )}
      <div className="grid cols-2">
        <div className="card">
          <h2>{t('Dịch vụ')}</h2>
          <table>
            <tbody>
              {s &&
                Object.entries(s.services).map(([name, st]) => (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td>
                      <Badge tone={st === 'active' ? 'ok' : st === 'inactive' ? 'err' : 'default'}>{st}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{t('Website gần đây')}</h2>
            <Link to="/sites/new" className="btn sm primary">
              {t('+ Thêm site')}
            </Link>
          </div>
          <table>
            <tbody>
              {(sites.data ?? []).slice(0, 8).map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link to={`/sites/${x.id}`}>{siteLabel(x)}</Link>
                  </td>
                  <td>{t(APP_LABELS[x.appType])}</td>
                  <td>{x.ssl.enabled ? <Badge tone="ok">HTTPS</Badge> : <Badge>HTTP</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sites.data?.length === 0 && <div className="empty">{t('Chưa có website nào')}</div>}
        </div>
      </div>
    </>
  );
}
