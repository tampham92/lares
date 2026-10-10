import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SITE_LIMIT_RANGES, type Site, type SiteLimitKey, type SiteLimits, type SiteLimitsView } from '@lares/shared';
import { errMsg, fmtBytes, get, put } from '../api';
import { t } from '../i18n';
import { Alert, Field } from './ui';

type Form = Record<SiteLimitKey, string>;
const toForm = (l: SiteLimits): Form => ({
  memoryMb: l.memoryMb?.toString() ?? '',
  cpuPercent: l.cpuPercent?.toString() ?? '',
  phpWorkers: l.phpWorkers?.toString() ?? '',
  mysqlConnections: l.mysqlConnections?.toString() ?? '',
});
const toLimits = (f: Form): SiteLimits => {
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  return { memoryMb: n(f.memoryMb), cpuPercent: n(f.cpuPercent), phpWorkers: n(f.phpWorkers), mysqlConnections: n(f.mysqlConnections) };
};

/** Site page → Overview: RAM / CPU / PHP workers / MySQL connections of one site (services/siteLimits.ts). */
export function LimitsCard({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['limits', site.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<SiteLimitsView>(`/api/sites/${site.id}/limits`), refetchInterval: 30_000 });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const v = q.data;

  useEffect(() => {
    if (v && !form) setForm(toForm(v.limits));
  }, [v, form]);

  if (!v || !form) return null;
  const { applies } = v;
  if (!applies.process && !applies.mysql) return null;

  const save = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const next = await put<SiteLimitsView>(`/api/sites/${site.id}/limits`, toLimits(form));
      qc.setQueryData(key, next);
      setForm(toForm(next.limits));
      setMsg({ tone: 'ok', text: t('Đã áp dụng giới hạn') });
    } catch (e) {
      setMsg({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const input = (k: SiteLimitKey, placeholder: string) => (
    <input
      type="number"
      inputMode="numeric"
      min={SITE_LIMIT_RANGES[k].min}
      max={SITE_LIMIT_RANGES[k].max}
      step={1}
      placeholder={placeholder}
      value={form[k]}
      disabled={busy}
      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
    />
  );

  const usage = [
    v.usage.memoryBytes !== null && t('RAM {size}', { size: fmtBytes(v.usage.memoryBytes) }),
    v.usage.tasks !== null && t('{n} tiến trình', { n: v.usage.tasks }),
    v.usage.mysqlConnections !== null && t('{n} kết nối MySQL', { n: v.usage.mysqlConnections }),
  ].filter(Boolean);

  return (
    <div className="card stack">
      <h2>{t('Giới hạn tài nguyên')}</h2>
      <div className="sub">
        {t('Giữ một site quá tải hoặc bị tấn công không chiếm hết tài nguyên của các site khác. Để trống = không giới hạn.')}
      </div>
      <div className="hint">
        {t('Máy chủ: {cpu} CPU, {ram} RAM', { cpu: v.server.cpuCount, ram: fmtBytes(v.server.memoryMb * 1048576) })}
        {usage.length > 0 && <> · {t('Đang dùng: {usage}', { usage: usage.join(', ') })}</>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid cols-2">
        {applies.process && (
          <>
            <Field label={t('RAM tối đa (MB)')} hint={t('Gần mức này site bị làm chậm, vượt thì tiến trình bị dừng.')}>
              {input('memoryMb', t('Không giới hạn'))}
            </Field>
            <Field label={t('CPU tối đa (%)')} hint={t('100 = một nhân CPU. Máy chủ có {n} nhân = tối đa {max}%.', { n: v.server.cpuCount, max: v.server.cpuCount * 100 })}>
              {input('cpuPercent', t('Không giới hạn'))}
            </Field>
          </>
        )}
        {applies.phpWorkers && (
          <Field label={t('Số worker PHP')} hint={t('Số request PHP xử lý cùng lúc (pm.max_children).')}>
            {input('phpWorkers', t('Mặc định: {n}', { n: v.defaultPhpWorkers }))}
          </Field>
        )}
        {applies.mysql && (
          <Field label={t('Kết nối MySQL tối đa')} hint={t('Cho mỗi user database của site (MAX_USER_CONNECTIONS).')}>
            {input('mysqlConnections', t('Không giới hạn'))}
          </Field>
        )}
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? t('Đang áp dụng...') : t('Áp dụng')}
        </button>
        {applies.process && <span className="hint">{t('{service} khởi động lại vài giây để nhận giới hạn mới.', { service: v.service ?? '' })}</span>}
      </div>
    </div>
  );
}
