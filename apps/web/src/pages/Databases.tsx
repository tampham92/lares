import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { DatabaseRecord } from '@tpanel/shared';
import { del, fmtDate, get, post } from '../api';
import { Alert, Badge, ErrorBox, Field } from '../components/ui';

export function Databases() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['databases'], queryFn: () => get<DatabaseRecord[]>('/api/databases') });
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await post<{ record: DatabaseRecord; password: string }>('/api/databases', { name, username: name.slice(0, 32) });
      setCreated({ name: r.record.name, username: r.record.username, password: r.password });
      setName('');
      void qc.invalidateQueries({ queryKey: ['databases'] });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Database</h1>
          <div className="sub">MySQL / MariaDB</div>
        </div>
      </div>
      <form className="card row" onSubmit={create}>
        <Field label="Tạo database mới (user cùng tên, mật khẩu ngẫu nhiên)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="shop_db" pattern="[A-Za-z0-9_]{1,64}" required />
        </Field>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }}>
          Tạo
        </button>
      </form>
      <ErrorBox error={error ?? q.error} />
      {created && (
        <Alert tone="ok">
          Đã tạo <code>{created.name}</code> — user <code>{created.username}</code> / mật khẩu <code>{created.password}</code>
        </Alert>
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Database</th>
              <th>User</th>
              <th>Site</th>
              <th>Mật khẩu</th>
              <th>Tạo lúc</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((d) => (
              <tr key={d.id}>
                <td className="mono">
                  {d.name} {!d.managed && <Badge tone="warn">dùng chung</Badge>}
                </td>
                <td className="mono">{d.username}</td>
                <td>{d.siteId ? <Link to={`/sites/${d.siteId}`}>{d.siteDomain}</Link> : '—'}</td>
                <td className="mono">
                  {revealed[d.id] ?? (
                    <button
                      className="btn sm"
                      onClick={async () => {
                        const c = await get<{ password: string }>(`/api/databases/${d.id}/credentials`);
                        setRevealed({ ...revealed, [d.id]: c.password });
                      }}
                    >
                      Hiện
                    </button>
                  )}
                </td>
                <td className="sub">{fmtDate(d.createdAt)}</td>
                <td>
                  <button
                    className="btn sm danger"
                    onClick={async () => {
                      if (!confirm(d.managed ? `Xoá database ${d.name} và toàn bộ dữ liệu?` : `Gỡ ${d.name} khỏi TPanel? (database dùng chung sẽ KHÔNG bị xoá)`)) return;
                      try {
                        await del(`/api/databases/${d.id}`);
                        void qc.invalidateQueries({ queryKey: ['databases'] });
                      } catch (err) {
                        setError(err);
                      }
                    }}
                  >
                    Xoá
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.length === 0 && <div className="empty">Chưa có database</div>}
      </div>
    </>
  );
}
