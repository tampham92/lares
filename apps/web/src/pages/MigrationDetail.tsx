import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { APP_LABELS, MIGRATION_STEPS, PANEL_LABELS, msg, type Migration, type MigrationEvent, type MigrationItem, type MigrationLog } from '@lares/shared';
import { auth, del, fmtDate, post } from '../api';
import { Alert, Badge, Console, ErrorBox, Progress } from '../components/ui';
import { getLang, t } from '../i18n';
import { STATUS_LABEL } from './Migrations';

const ITEM_TONE: Record<MigrationItem['status'], 'ok' | 'err' | 'warn' | 'info' | 'default'> = {
  pending: 'default',
  running: 'info',
  completed: 'ok',
  failed: 'err',
  cancelled: 'warn',
};
const ITEM_LABEL: Record<MigrationItem['status'], string> = {
  pending: msg('Chờ'),
  running: msg('Đang chạy'),
  completed: msg('Hoàn tất'),
  failed: msg('Lỗi'),
  cancelled: msg('Đã huỷ'),
};

function useMigrationStream(id: number) {
  const [migration, setMigration] = useState<Migration | null>(null);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/migrations/${id}/events?token=${encodeURIComponent(auth.token ?? '')}&lang=${getLang()}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource reconnects on its own and receives a fresh snapshot
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data as string) as MigrationEvent;
      if (e.type === 'snapshot') {
        setMigration(e.migration);
        setLogs(e.logs);
      } else if (e.type === 'migration') {
        setMigration((m) => (m ? { ...e.migration, items: m.items } : e.migration));
      } else if (e.type === 'item') {
        setMigration((m) => (m ? { ...m, items: (m.items ?? []).map((i) => (i.id === e.item.id ? e.item : i)) } : m));
      } else if (e.type === 'log') {
        setLogs((l) => (l.some((x) => x.id === e.log.id) ? l : [...l.slice(-4000), e.log]));
      }
    };
    return () => es.close();
  }, [id]);

  return { migration, logs, connected };
}

function ItemCard({ item, onFilter, active }: { item: MigrationItem; onFilter: () => void; active: boolean }) {
  const doneSteps = MIGRATION_STEPS.filter((s) => ['done', 'skipped'].includes(item.steps[s.id]?.status ?? '')).length;
  return (
    <div className="card" style={{ borderColor: active ? 'var(--primary)' : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong>{item.targetDomain}</strong>
          {item.targetDomain !== item.sourceDomain && <span className="sub"> ← {item.sourceDomain}</span>}
          <div className="sub mono">{item.sourceRoot}</div>
        </div>
        <div className="row">
          <Badge>{t(APP_LABELS[item.appType])}</Badge>
          <Badge tone={ITEM_TONE[item.status]}>{t(ITEM_LABEL[item.status])}</Badge>
          <button className="btn sm" onClick={onFilter}>
            {active ? t('Xem tất cả log') : t('Log site này')}
          </button>
        </div>
      </div>
      <div style={{ margin: '10px 0' }}>
        <Progress value={doneSteps / MIGRATION_STEPS.length} />
      </div>
      <div className="steps">
        {MIGRATION_STEPS.map((s) => {
          const st = item.steps[s.id] ?? { status: 'pending' };
          return (
            <div key={s.id} className={`step ${st.status}`}>
              <div className="dot">{st.status === 'done' ? '✓' : st.status === 'failed' ? '✕' : st.status === 'skipped' ? '–' : ''}</div>
              <div>
                <div>{t(s.label)}</div>
                {st.detail && <div className="detail">{st.detail}</div>}
                {st.status === 'running' && st.progress !== undefined && (
                  <div style={{ marginTop: 4, maxWidth: 360 }}>
                    <Progress value={st.progress} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {item.error && <Alert tone="err">{item.error}</Alert>}
      {item.notes.length > 0 && (
        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
          {item.notes.map((n) => (
            <Alert key={n} tone="info">
              {n}
            </Alert>
          ))}
        </div>
      )}
      {item.siteId && item.status === 'completed' && (
        <div className="row end">
          <Link className="btn primary sm" to={`/sites/${item.siteId}`}>
            {t('Mở site trên Lares →')}
          </Link>
        </div>
      )}
    </div>
  );
}

export function MigrationDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { migration: m, logs, connected } = useMigrationStream(id);
  const [filter, setFilter] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const visible = useMemo(
    () => logs.filter((l) => (filter === null || l.itemId === filter || l.itemId === null) && (showDebug || l.level !== 'debug')),
    [logs, filter, showDebug],
  );

  if (!m) return <div className="sub">{t('Đang kết nối…')}</div>;
  const [label, tone] = STATUS_LABEL[m.status];
  const running = m.status === 'running';
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{m.name}</h1>
          <div className="row sub">
            <span className="mono">{m.sourceLabel}</span>· {t(PANEL_LABELS[m.panel])}
            {m.sameHost && <Badge tone="warn">{t('cùng VPS với Lares')}</Badge>}
            <Badge tone={tone}>{t(label)}</Badge>
            {!connected && <Badge tone="warn">{t('mất kết nối realtime…')}</Badge>}
          </div>
          <div className="sub">
            {t('Bắt đầu {time}', { time: fmtDate(m.startedAt) })} {m.finishedAt && t('· kết thúc {time}', { time: fmtDate(m.finishedAt) })}
          </div>
        </div>
        <div className="row">
          {running && (
            <button className="btn danger" onClick={() => act(() => post(`/api/migrations/${id}/cancel`))}>
              {t('Huỷ')}
            </button>
          )}
          {!running && m.items?.some((i) => i.status === 'failed' || i.status === 'cancelled') && (
            <button className="btn primary" onClick={() => act(() => post(`/api/migrations/${id}/retry`))}>
              {t('Chạy lại site lỗi')}
            </button>
          )}
          {!running && (
            <button
              className="btn"
              onClick={() =>
                act(async () => {
                  if (!confirm(t('Xoá lịch sử migration này? (site đã chuyển không bị ảnh hưởng)'))) return;
                  await del(`/api/migrations/${id}`);
                  nav('/migrations');
                })
              }
            >
              {t('Xoá lịch sử')}
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {m.error && <Alert tone="err">{m.error}</Alert>}
      <div className="grid cols-2">
        <div>
          {(m.items ?? []).map((it) => (
            <ItemCard key={it.id} item={it} active={filter === it.id} onFilter={() => setFilter(filter === it.id ? null : it.id)} />
          ))}
        </div>
        <div className="card stack" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{t('Nhật ký')}</h2>
            <label className="check">
              <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> {t('Chi tiết (debug)')}
            </label>
          </div>
          <Console lines={visible.map((l) => ({ t: l.createdAt, msg: l.message, level: l.level }))} />
        </div>
      </div>
    </>
  );
}
