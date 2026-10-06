import { Fragment, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAD_CHANNEL_LABELS, LEAD_STATUS_LABELS, LEAD_STATUSES, type Lead, type LeadListResponse, type LeadNotification, type LeadStatus, type Site } from '@lares/shared';
import { auth, del, fmtDate, get, patch, post } from '../api';
import { getLang, t } from '../i18n';
import { Badge, ErrorBox } from './ui';

const PAGE = 50;

/** Sidebar badge: leads still marked "new". */
export function LeadsNavBadge() {
  const q = useQuery({ queryKey: ['leads-unread'], queryFn: () => get<{ count: number }>('/api/leads/unread'), refetchInterval: 60_000, retry: false });
  const n = q.data?.count ?? 0;
  if (!n) return null;
  return (
    <span className="nav-count" title={t('{count} khách liên hệ mới', { count: n })}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

const statusTone: Record<LeadStatus, 'info' | 'warn' | 'ok'> = { new: 'info', contacted: 'warn', done: 'ok' };

function NotificationBadge({ n }: { n: LeadNotification }) {
  const label = LEAD_CHANNEL_LABELS[n.channel];
  if (n.status === 'sent') return <Badge tone="ok">{t('{channel}: đã gửi', { channel: label })}</Badge>;
  if (n.status === 'pending')
    return (
      <span title={n.error ?? ''}>
        <Badge tone="warn">{n.attempts ? t('{channel}: đang thử lại', { channel: label }) : t('{channel}: đang gửi', { channel: label })}</Badge>
      </span>
    );
  return (
    <span title={n.error ?? ''}>
      <Badge tone="err">{t('{channel}: lỗi', { channel: label })}</Badge>
    </span>
  );
}

/** Inbox of contact-form leads: all sites (with a site filter) or one site. */
export function LeadsInbox({ siteId }: { siteId?: number }) {
  const qc = useQueryClient();
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => get<Site[]>('/api/sites'), enabled: !siteId });
  const [site, setSite] = useState<number | ''>('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  // search as you type, without a request per keystroke
  useEffect(() => {
    const h = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  useEffect(() => setOffset(0), [site, status, query]);

  const params = new URLSearchParams();
  const filterSite = siteId ?? (site || undefined);
  if (filterSite) params.set('siteId', String(filterSite));
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  const listParams = new URLSearchParams(params);
  listParams.set('limit', String(PAGE));
  listParams.set('offset', String(offset));

  const key = ['leads', listParams.toString()];
  const q = useQuery({ queryKey: key, queryFn: () => get<LeadListResponse>(`/api/leads?${listParams}`), refetchInterval: 30_000 });
  const data = q.data;
  useEffect(() => {
    if (data) qc.setQueryData(['leads-unread'], { count: data.newCount });
  }, [data, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['leads-unread'] });
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e);
    }
  };

  const exportCsv = () =>
    act(async () => {
      const res = await fetch(`/api/leads/export.csv?${params}`, { headers: { Authorization: `Bearer ${auth.token ?? ''}`, 'X-Lares-Lang': getLang() } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `lares-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  const leads = data?.leads ?? [];
  const showSite = !siteId;
  const cols = showSite ? 6 : 5;

  return (
    <div className="card stack">
      <div className="row lead-toolbar">
        {showSite && (
          <select className="compact" value={site} onChange={(e) => setSite(e.target.value ? Number(e.target.value) : '')} aria-label={t('Website')}>
            <option value="">{t('Tất cả website')}</option>
            {(sites.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.domain}
              </option>
            ))}
          </select>
        )}
        <select className="compact" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')} aria-label={t('Trạng thái')}>
          <option value="">{t('Mọi trạng thái')}</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(LEAD_STATUS_LABELS[s])}
            </option>
          ))}
        </select>
        <input type="search" className="lead-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Tìm tên, SĐT, email, nội dung…')} />
        <button className="btn sm" onClick={exportCsv} disabled={!data?.total}>
          {t('Xuất CSV')}
        </button>
      </div>
      <ErrorBox error={error ?? q.error} />
      <div className="table-wrap">
        <table className="lead-table">
          <thead>
            <tr>
              <th>{t('Thời gian')}</th>
              {showSite && <th>{t('Website')}</th>}
              <th>{t('Khách')}</th>
              <th>{t('Lời nhắn')}</th>
              <th>{t('Trạng thái')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <Fragment key={l.id}>
                <tr className={l.status === 'new' ? 'lead-new' : ''}>
                  <td className="nowrap">{fmtDate(l.createdAt)}</td>
                  {showSite && <td className="lead-site">{l.site.endsWith('.localhost') && l.host ? l.host : l.site}</td>}
                  <td className="lead-contact">
                    {l.name && <strong>{l.name}</strong>}
                    {l.phone && (
                      <div>
                        <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>{l.phone}</a>
                      </div>
                    )}
                    {l.email && (
                      <div>
                        <a href={`mailto:${l.email}`}>{l.email}</a>
                      </div>
                    )}
                  </td>
                  <td>
                    {l.service && <Badge>{l.service}</Badge>}
                    <div className="lead-preview">{l.message || <span className="sub">—</span>}</div>
                    {l.notifications.some((n) => n.status !== 'sent') && (
                      <div className="row lead-notes">
                        {l.notifications
                          .filter((n) => n.status !== 'sent')
                          .map((n) => (
                            <NotificationBadge key={n.channel} n={n} />
                          ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      className={`compact lead-status ${statusTone[l.status]}`}
                      value={l.status}
                      onChange={(e) => act(() => patch(`/api/leads/${l.id}`, { status: e.target.value }))}
                      aria-label={t('Trạng thái')}
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(LEAD_STATUS_LABELS[s])}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn sm ghost" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                      {open === l.id ? t('Thu gọn') : t('Chi tiết')}
                    </button>
                  </td>
                </tr>
                {open === l.id && (
                  <tr className="lead-detail-row">
                    <td colSpan={cols}>
                      <LeadDetail lead={l} onAction={act} onDeleted={() => setOpen(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data && leads.length === 0 && (
          <div className="empty">{query || status || site ? t('Không có khách liên hệ phù hợp bộ lọc') : t('Chưa có khách liên hệ nào. Form liên hệ trên website gửi về sẽ hiện ở đây.')}</div>
        )}
      </div>
      {data && data.total > PAGE && (
        <div className="row end">
          <span className="sub">{t('{from}–{to} / {total}', { from: offset + 1, to: Math.min(offset + PAGE, data.total), total: data.total })}</span>
          <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            {t('Trước')}
          </button>
          <button className="btn sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            {t('Sau')}
          </button>
        </div>
      )}
    </div>
  );
}

function LeadDetail({ lead, onAction, onDeleted }: { lead: Lead; onAction: (fn: () => Promise<unknown>) => Promise<void>; onDeleted: () => void }) {
  const [note, setNote] = useState(lead.note);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);

  return (
    <div className="stack lead-detail">
      {lead.message && <div className="lead-message">{lead.message}</div>}
      <div className="kv">
        {lead.company && (
          <>
            <div>{t('Công ty')}</div>
            <div>{lead.company}</div>
          </>
        )}
        {lead.service && (
          <>
            <div>{t('Dịch vụ quan tâm')}</div>
            <div>{lead.service}</div>
          </>
        )}
        <div>{t('Trang gửi form')}</div>
        <div>
          {lead.pageUrl ? (
            <a href={lead.pageUrl} target="_blank" rel="noreferrer noopener">
              {lead.pageUrl}
            </a>
          ) : (
            lead.page || '—'
          )}
        </div>
        <div>IP</div>
        <div className="mono">{lead.ip || '—'}</div>
        <div>{t('Thông báo')}</div>
        <div>
          {lead.notifications.length ? (
            <div className="stack lead-notify-list">
              {lead.notifications.map((n) => (
                <div key={n.channel}>
                  <NotificationBadge n={n} />
                  {n.sentAt && <span className="sub"> {fmtDate(n.sentAt)}</span>}
                  {n.status !== 'sent' && n.error && <div className="hint">{n.error}</div>}
                  {n.status === 'pending' && n.nextAttemptAt && <div className="hint">{t('Thử lại lúc {time}', { time: fmtDate(n.nextAttemptAt) })}</div>}
                </div>
              ))}
            </div>
          ) : (
            <span className="sub">{t('Không gửi (chưa bật kênh thông báo nào)')}</span>
          )}
        </div>
      </div>
      <label className="field">
        {t('Ghi chú nội bộ')}
        <textarea
          className="prose-input"
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          placeholder={t('Ví dụ: đã gọi, hẹn xem nhà thứ Bảy')}
        />
      </label>
      <div className="row end">
        <button
          className="btn sm danger"
          onClick={() =>
            confirm(t('Xoá khách liên hệ này? Không thể hoàn tác.')) &&
            onAction(async () => {
              await del(`/api/leads/${lead.id}`);
              onDeleted();
            })
          }
        >
          {t('Xoá')}
        </button>
        <button
          className="btn sm"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            await onAction(() => post(`/api/leads/${lead.id}/notify`));
            setSending(false);
          }}
        >
          {sending ? t('Đang gửi…') : t('Gửi lại thông báo')}
        </button>
        <button
          className="btn sm primary"
          disabled={note === lead.note}
          onClick={() =>
            onAction(async () => {
              await patch(`/api/leads/${lead.id}`, { note });
              setSaved(true);
            })
          }
        >
          {saved ? t('Đã lưu') : t('Lưu ghi chú')}
        </button>
      </div>
    </div>
  );
}

