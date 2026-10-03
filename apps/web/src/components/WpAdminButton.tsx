import { useState, type ReactNode } from 'react';
import { errMsg, post } from '../api';

/**
 * Opens wp-admin already logged in (one-time link, valid 60s). The tab is opened synchronously on
 * click - browsers block window.open() after an await - and pointed at the link once it arrives.
 */
export function WpAdminButton({ siteId, target = '', className = 'btn', children = 'WP Admin ↗' }: { siteId: number; target?: string; className?: string; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const { url } = await post<{ url: string }>(`/api/sites/${siteId}/wp/login`, { target, publicHost: window.location.hostname });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      alert(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={className} disabled={busy} onClick={open} title="Đăng nhập trang quản trị WordPress không cần mật khẩu">
      {busy ? 'Đang mở…' : children}
    </button>
  );
}
