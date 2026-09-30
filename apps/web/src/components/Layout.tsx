import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { auth } from '../api';

const NAV: Array<[string, string]> = [
  ['/', 'Tổng quan'],
  ['/sites', 'Website'],
  ['/databases', 'Database'],
  ['/migrations', 'Chuyển site'],
  ['/settings', 'Cài đặt'],
];

export function Layout() {
  const nav = useNavigate();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span>T</span>TPanel
        </div>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
        <div className="spacer" />
        <a
          href="#logout"
          onClick={(e) => {
            e.preventDefault();
            auth.set(null);
            nav('/login');
          }}
        >
          Đăng xuất
        </a>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
