import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminerStatus } from '@lares/shared';
import { del, errMsg, get, post } from '../api';
import { t } from '../i18n';

/**
 * Opens Adminer logged in to one database, in a new tab (never an iframe). The server returns a
 * one-time launch link (60 s, this IP only); the database password never reaches the browser.
 * The tab is opened synchronously on click - browsers block window.open() after an await - and
 * pointed at the link once it arrives (the first time Lares also downloads and sets up Adminer).
 */
export function AdminerButton({ databaseId, className = 'btn sm', children }: { databaseId: number; className?: string; children?: ReactNode }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const { url } = await post<{ url: string }>('/api/adminer/open', { databaseId });
      if (tab) tab.location.href = url;
      else window.location.href = url;
      void qc.invalidateQueries({ queryKey: ['adminer'] });
    } catch (e) {
      tab?.close();
      alert(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={className} disabled={busy} onClick={open} title={t('Mở Adminer đã đăng nhập sẵn vào database này (tab mới)')}>
      {busy ? t('Đang mở…') : (children ?? t('Mở Adminer ↗'))}
    </button>
  );
}

/** One line under the database list: what Adminer is, where it runs, how to remove it. */
export function AdminerNote() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['adminer'], queryFn: () => get<AdminerStatus>('/api/adminer') });
  const [busy, setBusy] = useState(false);
  const s = q.data;
  if (!s) return null;
  const remove = async () => {
    if (!confirm(t('Gỡ Adminer khỏi máy chủ? (xoá file, pool PHP-FPM và cấu hình nginx; database không bị ảnh hưởng)'))) return;
    setBusy(true);
    try {
      qc.setQueryData(['adminer'], await del<AdminerStatus>('/api/adminer'));
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row hint" style={{ justifyContent: 'space-between' }}>
      <span style={{ minWidth: 0 }}>
        {s.dryRun
          ? t('Chế độ dry-run: "Mở Adminer" chạy thử đăng nhập một lần và cookie, nhưng Adminer chỉ thực sự chạy trên VPS Linux có PHP-FPM và nginx.')
          : s.installed
            ? t('Adminer {version} · PHP {php} · chỉ truy cập qua Lares (đăng nhập panel + giới hạn IP), không mở trên site công khai.', { version: s.version, php: s.phpVersion ?? '?' })
            : t('Lần đầu mở, Lares tải Adminer {version} (kiểm tra SHA-256), tạo pool PHP-FPM riêng và nginx chỉ nghe 127.0.0.1.', { version: s.version })}
      </span>
      {s.installed && (
        <button type="button" className="btn sm ghost" disabled={busy} onClick={remove}>
          {t('Gỡ Adminer')}
        </button>
      )}
    </div>
  );
}
