import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WP_MARKER_LABELS,
  msg,
  type Site,
  type WpExtension,
  type WpHealthProblem,
  type WpInventory,
  type WpUpdateItem,
  type WpUpdateRequest,
  type WpUpdateRun,
  type WpUpdatesResponse,
  type WpUpdatesSummaryItem,
} from '@lares/shared';
import { errMsg, fmtDate, get, post, siteLabel, type TaskInfo } from '../api';
import { t } from '../i18n';
import { Alert, Badge, ErrorBox, TaskLog } from './ui';

const SUMMARY_KEY = ['wp-updates-summary'];

function useSummary(enabled = true) {
  return useQuery({ queryKey: SUMMARY_KEY, queryFn: () => get<WpUpdatesSummaryItem[]>('/api/wp-updates/summary'), enabled, staleTime: 60_000 });
}

/** "Cập nhật (3)" for the site page tab. */
export function useWpUpdatesTabLabel(siteId: number, enabled: boolean): string {
  const pending = useSummary(enabled).data?.find((s) => s.siteId === siteId)?.pending ?? 0;
  return pending ? `${t('Cập nhật')} (${pending})` : t('Cập nhật');
}

/** Pending-updates badge for the site list. */
export function WpUpdatesBadge({ siteId }: { siteId: number }) {
  const pending = useSummary().data?.find((s) => s.siteId === siteId)?.pending ?? 0;
  if (!pending) return null;
  return (
    <span title={t('Có bản cập nhật WordPress, plugin hoặc theme')}>
      <Badge tone="warn">{t('{count} cập nhật', { count: pending })}</Badge>
    </span>
  );
}

interface Selection {
  core: boolean;
  plugins: string[];
  themes: string[];
}

const EMPTY: Selection = { core: false, plugins: [], themes: [] };

/** Items a request would update, as the server picks them (core, plugins, themes). */
function plannedItems(inv: WpInventory, req: WpUpdateRequest): WpUpdateItem[] {
  const out: WpUpdateItem[] = [];
  if ((req.all || req.core) && inv.core.update) out.push({ type: 'core', slug: 'wordpress', name: 'WordPress', from: inv.core.version, to: inv.core.update, status: 'pending' });
  for (const [type, list, wanted] of [
    ['plugin', inv.plugins, req.plugins],
    ['theme', inv.themes, req.themes],
  ] as const) {
    for (const x of list) if (x.update && (req.all || wanted.includes(x.slug))) out.push({ type, slug: x.slug, name: x.title, from: x.version, to: x.update, status: 'pending' });
  }
  return out;
}

/** Site tab: versions and available updates, safe update with automatic rollback, history. */
export function WpUpdatesTab({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['wp-updates', site.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<WpUpdatesResponse>(`/api/sites/${site.id}/wp-updates`) });
  const [checking, setChecking] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sel, setSel] = useState<Selection>(EMPTY);
  const [confirming, setConfirming] = useState<WpUpdateRequest | null>(null);
  const data = q.data;
  const inv = data?.inventory ?? null;
  const busy = active || !!data?.running;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: SUMMARY_KEY });
    void qc.invalidateQueries({ queryKey: ['backups', site.id] });
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      qc.setQueryData(key, await post<WpUpdatesResponse>(`/api/sites/${site.id}/wp-updates/check`));
      void qc.invalidateQueries({ queryKey: SUMMARY_KEY });
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };

  // never checked: look once automatically
  const autoChecked = useRef(false);
  useEffect(() => {
    if (data && !data.checkedAt && !data.running && !autoChecked.current) {
      autoChecked.current = true;
      void check();
    }
  }, [data]);

  // an update (or backup/restore) started elsewhere is followed too
  const runningId = data?.running?.taskId;
  useEffect(() => {
    if (runningId) {
      setTask(runningId);
      setActive(true);
    }
  }, [runningId]);

  const selected: WpUpdateRequest = { all: false, ...sel };
  const selectedCount = inv ? plannedItems(inv, selected).length : 0;

  const toggle = (kind: 'plugins' | 'themes', slug: string, on: boolean) =>
    setSel((s) => ({ ...s, [kind]: on ? [...s[kind], slug] : s[kind].filter((x) => x !== slug) }));

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ marginBottom: 4 }}>{t('Cập nhật WordPress')}</h2>
            <div className="sub">
              {data?.checkedAt ? t('Kiểm tra lần cuối: {date}', { date: fmtDate(data.checkedAt) }) : t('Chưa kiểm tra')}
              {inv && (data?.pending ? ` · ${t('{count} bản cập nhật', { count: data.pending })}` : ` · ${t('Tất cả đã là bản mới nhất')}`)}
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={checking || busy} onClick={check}>
              {checking ? t('Đang kiểm tra…') : t('Kiểm tra lại')}
            </button>
            <button className="btn" disabled={busy || checking || !data?.pending} onClick={() => setConfirming({ all: true, core: false, plugins: [], themes: [] })}>
              {t('Cập nhật tất cả')}
            </button>
            <button className="btn primary" disabled={busy || checking || !selectedCount} onClick={() => setConfirming(selected)}>
              {selectedCount ? t('Cập nhật mục đã chọn ({count})', { count: selectedCount }) : t('Cập nhật mục đã chọn')}
            </button>
          </div>
        </div>
        <div className="sub">
          {t('Mỗi lần cập nhật, Lares ghi nhận tình trạng site, sao lưu file + database, cập nhật rồi kiểm tra lại. Nếu site lỗi sau khi cập nhật, bản sao lưu được khôi phục tự động.')}
        </div>
        <ErrorBox error={error ?? q.error} />
        {data?.checkError && <Alert tone="warn">{t('Lần kiểm tra gần nhất bị lỗi: {error}', { error: data.checkError })}</Alert>}
        {!inv && (checking || !data) && <div className="sub">{t('Đang đọc phiên bản bằng wp-cli…')}</div>}
        {task && (
          <TaskLog
            key={task}
            taskId={task}
            onDone={() => {
              setActive(false);
              setSel(EMPTY);
              refresh();
            }}
          />
        )}
      </div>

      {inv && (
        <>
          <div className="card table-wrap">
            <h2>WordPress</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>{t('Thành phần')}</th>
                  <th>{t('Bản đang cài')}</th>
                  <th>{t('Bản mới')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <input type="checkbox" aria-label={t('Chọn')} disabled={!inv.core.update || busy} checked={sel.core && !!inv.core.update} onChange={(e) => setSel({ ...sel, core: e.target.checked })} />
                  </td>
                  <td>
                    <strong>WordPress core</strong>
                  </td>
                  <td className="mono">{inv.core.version}</td>
                  <td>{inv.core.update ? <Badge tone="warn">{inv.core.update}</Badge> : <span className="sub">{t('Mới nhất')}</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ExtensionTable title={t('Plugin ({count})', { count: inv.plugins.length })} kind="plugins" list={inv.plugins} selected={sel.plugins} busy={busy} onToggle={toggle} onSetAll={(slugs) => setSel({ ...sel, plugins: slugs })} />
          <ExtensionTable title={t('Theme ({count})', { count: inv.themes.length })} kind="themes" list={inv.themes} selected={sel.themes} busy={busy} onToggle={toggle} onSetAll={(slugs) => setSel({ ...sel, themes: slugs })} />
        </>
      )}

      <History runs={data?.history ?? []} />

      {confirming && inv && (
        <ConfirmDialog
          site={site}
          items={plannedItems(inv, confirming)}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            setTask(null);
            const started = await post<TaskInfo>(`/api/sites/${site.id}/wp-updates/run`, confirming);
            setConfirming(null);
            setTask(started.id);
            setActive(true);
            void qc.invalidateQueries({ queryKey: key });
          }}
        />
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: msg('Đang kích hoạt'),
  'active-network': msg('Kích hoạt toàn mạng'),
  inactive: msg('Chưa kích hoạt'),
  parent: msg('Theme cha'),
};

function statusBadge(kind: 'plugins' | 'themes', status: string) {
  if (kind === 'themes' && status === 'active') return <Badge tone="ok">{t('Đang dùng')}</Badge>;
  if (kind === 'themes' && status === 'inactive') return <Badge>{t('Không dùng')}</Badge>;
  if (status === 'active' || status === 'active-network') return <Badge tone="ok">{t(STATUS_LABELS[status]!)}</Badge>;
  return <Badge>{STATUS_LABELS[status] ? t(STATUS_LABELS[status]!) : status}</Badge>;
}

function ExtensionTable(props: {
  title: string;
  kind: 'plugins' | 'themes';
  list: WpExtension[];
  selected: string[];
  busy: boolean;
  onToggle: (kind: 'plugins' | 'themes', slug: string, on: boolean) => void;
  onSetAll: (slugs: string[]) => void;
}) {
  const { kind, list, selected, busy } = props;
  const updatable = list.filter((x) => x.update).map((x) => x.slug);
  const allOn = updatable.length > 0 && updatable.every((s) => selected.includes(s));
  return (
    <div className="card table-wrap">
      <h2>{props.title}</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input type="checkbox" aria-label={t('Chọn tất cả mục có bản mới')} disabled={!updatable.length || busy} checked={allOn} onChange={(e) => props.onSetAll(e.target.checked ? updatable : [])} />
            </th>
            <th>{kind === 'plugins' ? 'Plugin' : 'Theme'}</th>
            <th>{t('Trạng thái')}</th>
            <th>{t('Bản đang cài')}</th>
            <th>{t('Bản mới')}</th>
            <th>{t('Tự cập nhật')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.slug}>
              <td>
                <input type="checkbox" aria-label={t('Chọn')} disabled={!x.update || busy} checked={!!x.update && selected.includes(x.slug)} onChange={(e) => props.onToggle(kind, x.slug, e.target.checked)} />
              </td>
              <td style={{ minWidth: 180 }}>
                <strong>{x.title}</strong>
                {x.title !== x.slug && <div className="sub mono">{x.slug}</div>}
              </td>
              <td>{statusBadge(kind, x.status)}</td>
              <td className="mono">{x.version || '—'}</td>
              <td>{x.update ? <Badge tone="warn">{x.update}</Badge> : <span className="sub">{t('Mới nhất')}</span>}</td>
              <td className="sub">{x.autoUpdate ? t('Bật') : t('Tắt')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <div className="empty">{kind === 'plugins' ? t('Chưa cài plugin nào') : t('Chưa cài theme nào')}</div>}
    </div>
  );
}

function itemText(i: WpUpdateItem) {
  const kind = i.type === 'plugin' ? 'Plugin' : i.type === 'theme' ? 'Theme' : '';
  return `${kind ? `${kind} ` : ''}${i.name}: ${i.from} → ${i.to ?? '?'}`;
}

function ConfirmDialog({ site, items, onClose, onConfirm }: { site: Site; items: WpUpdateItem[]; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const start = async () => {
    setError(null);
    setSending(true);
    try {
      await onConfirm();
    } catch (e) {
      setError(errMsg(e));
      setSending(false);
    }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="card stack" style={{ width: 'min(600px, 100%)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>{t('Cập nhật {count} mục trên {site}?', { count: items.length, site: siteLabel(site) })}</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((i) => (
            <li key={`${i.type}:${i.slug}`}>{itemText(i)}</li>
          ))}
        </ul>
        <div className="sub">{t('Các bước:')}</div>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Ghi nhận tình trạng site: trang chủ, wp-login.php, log lỗi PHP')}</li>
          <li>{t('Sao lưu toàn bộ file + database (huỷ cập nhật nếu sao lưu lỗi)')}</li>
          <li>{t('Cập nhật bằng wp-cli: core (kèm cập nhật database), plugin, theme')}</li>
          <li>{t('Kiểm tra lại site; nếu lỗi thì tự khôi phục bản sao lưu')}</li>
        </ol>
        <Alert tone="warn">{t('Nếu phải khôi phục, nội dung mới phát sinh trong lúc cập nhật (đơn hàng, bình luận...) sẽ mất. Nên cập nhật lúc ít người truy cập.')}</Alert>
        {items.length > 1 && <div className="sub">{t('Cập nhật nhiều mục một lúc nhanh hơn, nhưng nếu site lỗi sẽ khó biết mục nào gây ra.')}</div>}
        {error && <Alert tone="err">{error}</Alert>}
        <div className="row end">
          <button className="btn" onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button className="btn primary" disabled={sending || !items.length} onClick={start}>
            {t('Bắt đầu cập nhật')}
          </button>
        </div>
      </div>
    </div>
  );
}

const pageName = (page: 'home' | 'login') => (page === 'home' ? t('Trang chủ') : 'wp-login.php');
const statusText = (s: number | null) => (s === null ? t('không phản hồi') : `HTTP ${s}`);

function problemText(p: WpHealthProblem): string {
  switch (p.code) {
    case 'status':
      return t('{page}: {after} (trước khi cập nhật: {before})', { page: pageName(p.page), after: statusText(p.after), before: statusText(p.before) });
    case 'marker':
      return t('{page} hiện {marker}', { page: pageName(p.page), marker: t(WP_MARKER_LABELS[p.marker] ?? p.marker) });
    case 'title':
      return t('{page}: tiêu đề đổi thành "{after}" (trước đó "{before}")', { page: pageName(p.page), after: p.after, before: p.before });
    case 'blank':
      return t('{page} trả về trang trắng', { page: pageName(p.page) });
    case 'fatal':
      return t('Lỗi PHP mới trong log: {line}', { line: p.line });
    case 'deactivated':
      return p.itemType === 'plugin' ? t('Plugin {slug} không còn được kích hoạt', { slug: p.slug }) : t('Theme {slug} không còn là theme đang dùng', { slug: p.slug });
  }
}

function culpritText(run: WpUpdateRun): string | null {
  const c = run.culprit;
  if (!c) return null;
  const names = c.items.join(', ');
  if (c.kind === 'single') return t('Bản cập nhật {name} làm site lỗi.', { name: names });
  const count = run.items.filter((i) => i.status === 'updated' || i.status === 'failed').length;
  if (c.kind === 'suspects') return t('Đã cập nhật {count} mục cùng lúc; log lỗi PHP chỉ ra {names}. Hãy cập nhật từng mục một để xác nhận.', { count, names });
  return t('Đã cập nhật {count} mục cùng lúc nên chưa rõ mục nào gây lỗi ({names}). Hãy cập nhật từng mục một.', { count, names });
}

const RESULT: Record<WpUpdateRun['status'], { tone: 'ok' | 'warn' | 'err' | 'info'; label: string }> = {
  success: { tone: 'ok', label: msg('Thành công') },
  rolled_back: { tone: 'warn', label: msg('Đã hoàn tác') },
  failed: { tone: 'err', label: msg('Thất bại') },
  running: { tone: 'info', label: msg('Đang chạy') },
};

const ITEM_STATUS: Record<WpUpdateItem['status'], { tone: 'ok' | 'err' | 'default'; label: string } | null> = {
  updated: null,
  pending: { tone: 'default', label: msg('chưa chạy') },
  skipped: { tone: 'default', label: msg('bỏ qua') },
  failed: { tone: 'err', label: msg('lỗi') },
};

function History({ runs }: { runs: WpUpdateRun[] }) {
  return (
    <div className="card table-wrap">
      <h2>{t('Lịch sử cập nhật')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('Thời gian')}</th>
            <th>{t('Mục')}</th>
            <th>{t('Kết quả')}</th>
            <th>{t('Chi tiết')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const culprit = culpritText(run);
            return (
              <tr key={run.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(run.startedAt)}</td>
                <td style={{ minWidth: 200 }}>
                  {run.items.map((i) => {
                    const st = ITEM_STATUS[i.status];
                    return (
                      <div key={`${i.type}:${i.slug}`}>
                        {itemText(i)}{' '}
                        {st && (
                          <span title={i.error}>
                            <Badge tone={st.tone}>{t(st.label)}</Badge>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </td>
                <td>
                  <Badge tone={RESULT[run.status].tone}>{t(RESULT[run.status].label)}</Badge>
                </td>
                <td className="sub" style={{ minWidth: 220 }}>
                  {culprit && <div>{culprit}</div>}
                  {run.problems.length > 0 && (
                    <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                      {run.problems.map((p, n) => (
                        <li key={n}>{problemText(p)}</li>
                      ))}
                    </ul>
                  )}
                  {run.stillBroken && <Alert tone="warn">{t('Site vẫn lỗi sau khi khôi phục - lỗi có thể không do bản cập nhật.')}</Alert>}
                  {run.error && <div>{run.error}</div>}
                  {run.backupId && (
                    <div>
                      {t('Bản sao lưu trước khi cập nhật:')} <code>{run.backupId}</code>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {runs.length === 0 && <div className="empty">{t('Chưa cập nhật lần nào từ Lares')}</div>}
    </div>
  );
}
