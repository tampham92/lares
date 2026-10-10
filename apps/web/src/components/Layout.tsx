import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { logout } from '../api';
import { msg } from '@lares/shared';
import { t } from '../i18n';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { LeadsNavBadge } from './LeadsInbox';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { VersionBadge } from './VersionBadge';

// Icon paths: 24x24 stroke icons (lucide style), drawn with currentColor.
const NAV: Array<[string, string, string]> = [
  ['/', msg('Tổng quan'), 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z'],
  ['/sites', msg('Website'), 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'],
  ['/leads', msg('Khách liên hệ'), 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  ['/databases', msg('Database'), 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  ['/migrations', msg('Chuyển site'), 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16'],
  ['/settings', msg('Cài đặt'), 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'],
];

const NavIcon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function Layout() {
  const nav = useNavigate();
  return (
    <div className="layout">
      <aside className="sidebar">
        <Logo size={30} />
        <nav>
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <NavIcon d={icon} />
              {t(label)}
              {to === '/leads' && <LeadsNavBadge />}
            </NavLink>
          ))}
        </nav>
        <VersionBadge />
      </aside>
      <main className="main">
        <header className="topbar">
          <NotificationBell />
          <LanguageSwitcher className="lang-switch" />
          <button
            className="icon-btn"
            title={t('Đăng xuất')}
            aria-label={t('Đăng xuất')}
            onClick={async () => {
              await logout();
              nav('/login');
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
