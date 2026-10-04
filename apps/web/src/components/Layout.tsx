import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { auth } from '../api';
import { msg } from '@lares/shared';
import { t } from '../i18n';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';

const NAV: Array<[string, string]> = [
  ['/', msg('Tổng quan')],
  ['/sites', msg('Website')],
  ['/databases', msg('Database')],
  ['/migrations', msg('Chuyển site')],
  ['/settings', msg('Cài đặt')],
];

export function Layout() {
  const nav = useNavigate();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span>L</span>Lares
        </div>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t(label)}
          </NavLink>
        ))}
      </aside>
      <main className="main">
        <div className="topbar">
          <LanguageSwitcher className="lang-switch" />
          <button
            className="icon-btn"
            title={t('Đăng xuất')}
            aria-label={t('Đăng xuất')}
            onClick={() => {
              auth.set(null);
              nav('/login');
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
