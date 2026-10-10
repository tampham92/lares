import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationsResponse, PanelNotification, VersionInfo } from '@lares/shared';
import { del, errMsg, fmtDate, get, post } from '../api';
import { t } from '../i18n';

const KEY = ['notifications'];

/**
 * Top bar bell: the panel's notification center (server: services/notifications.ts). It renders
 * every kind the same way - title, text, actions, an optional command - so new kinds (Pro, system
 * notices) need no change here. Visible on phones too, unlike the sidebar footer.
 */
export function NotificationBell() {
  const qc = useQueryClient();
  // Sources are cheap (local state + the daily release check): every 5 minutes keeps an open tab current.
  const q = useQuery({ queryKey: KEY, queryFn: () => get<NotificationsResponse>('/api/notifications'), refetchInterval: 300_000, retry: false });
  const [open, setOpen] = useState(false);
  // Unread when the panel opened: stays highlighted while it is open, though already marked read.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const data = q.data;
  const read = new Set(data?.read ?? []);
  const unread = (data?.items ?? []).filter((n) => !read.has(n.id));

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // What the open panel shows counts as read (new entries arriving while it is open included).
  const unreadKey = unread.map((n) => n.id).join('|');
  useEffect(() => {
    if (!open || !unreadKey) return;
    post<NotificationsResponse>('/api/notifications/read', { ids: unreadKey.split('|') }).then(
      (next) => qc.setQueryData(KEY, next),
      () => {},
    );
  }, [open, unreadKey, qc]);

  if (!data) return null;
  const count = unread.length;
  const toggle = () => {
    if (!open) setFresh(new Set(unread.map((n) => n.id)));
    setOpen(!open);
  };
  const label = count ? t('Thông báo ({n} mới)', { n: count }) : t('Thông báo');

  return (
    <div className="bell" ref={box}>
      <button className="icon-btn neutral" title={label} aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && <span className="bell-count">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('Thông báo')}>
          <div className="bell-head">{t('Thông báo')}</div>
          <div className="bell-list">
            {data.items.length ? (
              data.items.map((n) => <Item key={n.id} n={n} isNew={fresh.has(n.id) || !read.has(n.id)} onNavigate={() => setOpen(false)} />)
            ) : (
              <div className="bell-empty">{t('Không có thông báo mới')}</div>
            )}
          </div>
          <Footer onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function Item({ n, isNew, onNavigate }: { n: PanelNotification; isNew: boolean; onNavigate: () => void }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(n.command!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (self-signed HTTPS / old browser): the command stays selectable */
    }
  };

  const dismiss = async () => {
    try {
      qc.setQueryData(KEY, await del<NotificationsResponse>(`/api/notifications/${encodeURIComponent(n.id)}`));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className={`bell-item ${n.tone}${isNew ? ' new' : ''}`}>
      <div className="bell-item-head">
        <span className="bell-tone" aria-hidden="true" />
        <strong>{n.title}</strong>
        {n.dismissible && (
          <button type="button" className="bell-dismiss" title={t('Ẩn thông báo')} aria-label={t('Ẩn thông báo')} onClick={() => void dismiss()}>
            ×
          </button>
        )}
      </div>
      {n.body && <div className="sub">{n.body}</div>}
      {n.actions?.length ? (
        <div className="row">
          {n.actions.map((a, i) =>
            a.external ? (
              <a key={a.href} className={`btn sm${i === 0 ? ' primary' : ''}`} href={a.href} target="_blank" rel="noreferrer">
                {a.label}
              </a>
            ) : (
              <Link key={a.href} className={`btn sm${i === 0 ? ' primary' : ''}`} to={a.href} onClick={onNavigate}>
                {a.label}
              </Link>
            ),
          )}
        </div>
      ) : null}
      {n.command && (
        <details>
          <summary>{t('Chạy bằng lệnh trên VPS')}</summary>
          <code className="bell-cmd">{n.command}</code>
          <button type="button" className="btn sm" onClick={copy}>
            {copied ? t('Đã sao chép') : t('Sao chép')}
          </button>
        </details>
      )}
      <div className="bell-time">{fmtDate(n.createdAt)}</div>
      {error && <div className="bell-error">{error}</div>}
    </div>
  );
}

/** Running version, and where the update check lives (the release notice itself is an ordinary item). */
function Footer({ onNavigate }: { onNavigate: () => void }) {
  const v = useQuery({ queryKey: ['version'], queryFn: () => get<VersionInfo>('/api/system/version'), staleTime: 3_600_000, retry: false }).data;
  if (!v) return null;
  return (
    <div className="bell-foot">
      <span>Lares v{v.version}</span>
      <Link to="/settings?tab=update" onClick={onNavigate}>
        {v.updateCheck ? t('Cập nhật') : t('Kiểm tra bản mới đang tắt')}
      </Link>
    </div>
  );
}
