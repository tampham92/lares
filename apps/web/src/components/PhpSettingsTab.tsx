import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { msg, PHP_PRESETS, PHP_SETTING_KEYS, PHP_SETTING_LIMITS, type PhpSettingKey, type PhpSettings, type PhpSettingsView, type PhpValueSource, type Site } from '@lares/shared';
import { errMsg, get, put } from '../api';
import { t } from '../i18n';
import { Alert, Badge, ErrorBox, Field } from './ui';

const LABELS: Record<PhpSettingKey, string> = {
  upload_max_filesize: msg('Dung lượng file upload tối đa'),
  post_max_size: msg('Dung lượng request POST tối đa'),
  memory_limit: msg('Giới hạn bộ nhớ'),
  max_execution_time: msg('Thời gian chạy tối đa'),
  max_input_vars: msg('Số biến input tối đa'),
};

const SOURCES: Record<PhpValueSource, string> = {
  site: msg('Site (Lares)'),
  'user-ini': msg('.user.ini (dòng khác)'),
  pool: msg('PHP-FPM pool'),
  'php.ini': 'php.ini',
  builtin: msg('PHP mặc định'),
};

const UNIT: Record<string, string> = { MB: 'MB', s: msg('giây'), '': '' };

type Form = Record<PhpSettingKey, string>;
const toForm = (s: PhpSettings): Form => Object.fromEntries(PHP_SETTING_KEYS.map((k) => [k, s[k] === null ? '' : String(s[k])])) as Form;
const parseNum = (v: string) => (v.trim() === '' ? null : Number(v));

/** Errors per field for the form values (ranges, whole numbers, post >= upload with server values). */
function validate(form: Form, view: PhpSettingsView): Partial<Record<PhpSettingKey, string>> {
  const errors: Partial<Record<PhpSettingKey, string>> = {};
  for (const k of PHP_SETTING_KEYS) {
    const n = parseNum(form[k]);
    if (n === null) continue;
    const { min, max } = PHP_SETTING_LIMITS[k];
    if (!Number.isInteger(n) || n < min || n > max) errors[k] = t('Số nguyên từ {min} đến {max}', { min, max });
  }
  const upload = parseNum(form.upload_max_filesize) ?? view.serverMb.upload_max_filesize;
  const post = parseNum(form.post_max_size) ?? view.serverMb.post_max_size;
  if (!errors.post_max_size && upload !== null && post !== null && post < upload) {
    errors.post_max_size = t('Phải ≥ upload_max_filesize ({n} MB)', { n: upload });
  }
  return errors;
}

/** Per-site PHP limits, written to a managed block of the site's .user.ini (see services/phpSettings.ts). */
export function PhpSettingsTab({ site }: { site: Site }) {
  const qc = useQueryClient();
  const key = ['php-settings', site.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<PhpSettingsView>(`/api/sites/${site.id}/php-settings`) });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (q.data) setForm(toForm(q.data.settings));
  }, [q.data]);

  if (q.error) return <ErrorBox error={q.error} />;
  const view = q.data;
  if (!view || !form) return <div className="sub">{t('Đang tải…')}</div>;

  const errors = validate(form, view);
  const dirty = PHP_SETTING_KEYS.some((k) => form[k] !== (view.settings[k] === null ? '' : String(view.settings[k])));
  const locked = view.directives.filter((d) => d.locked).map((d) => d.key);

  const set = (k: PhpSettingKey, v: string) => {
    const next = { ...form, [k]: v };
    // raising the upload limit above the POST limit would still reject the file: follow it
    if (k === 'upload_max_filesize') {
      const upload = parseNum(v);
      const post = parseNum(next.post_max_size) ?? view.serverMb.post_max_size;
      if (upload !== null && Number.isInteger(upload) && post !== null && post < upload) next.post_max_size = String(upload);
    }
    setForm(next);
  };

  const save = async (values: Form) => {
    setNote(null);
    setBusy(true);
    try {
      const body = Object.fromEntries(PHP_SETTING_KEYS.map((k) => [k, parseNum(values[k])]));
      const next = await put<PhpSettingsView>(`/api/sites/${site.id}/php-settings`, body);
      qc.setQueryData(key, next);
      setNote({ tone: 'ok', text: t('Đã lưu: .user.ini được cập nhật, nginx cho phép request tới {n} MB, PHP-FPM đã reload.', { n: next.clientMaxBodyMb }) });
    } catch (e) {
      setNote({ tone: 'err', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card stack">
        <h2>{t('Giới hạn PHP của site')}</h2>
        <div className="sub">{t('Để trống = dùng giá trị của máy chủ. Áp dụng riêng cho site này qua file .user.ini trong web root; nginx tự nâng giới hạn upload theo.')}</div>
        {!view.userIniEnabled && <Alert tone="warn">{t('PHP {version} đang tắt .user.ini (user_ini.filename trống trong php.ini), không áp dụng được giá trị riêng cho site.', { version: view.phpVersion })}</Alert>}
        {note && <Alert tone={note.tone}>{note.text}</Alert>}
        <div className="row">
          <span className="hint">{t('Mẫu có sẵn:')}</span>
          {PHP_PRESETS.map((p) => (
            <button key={p.id} type="button" className="btn sm" disabled={busy} onClick={() => setForm(toForm(p.values))}>
              {t(p.label)}
            </button>
          ))}
        </div>
        <div className="form-grid">
          {PHP_SETTING_KEYS.map((k) => {
            const d = view.directives.find((x) => x.key === k)!;
            const lim = PHP_SETTING_LIMITS[k];
            const unit = t(UNIT[lim.unit] ?? '');
            return (
              <Field
                key={k}
                label={`${t(LABELS[k])}${unit ? ` (${unit})` : ''}`}
                hint={
                  <>
                    <code>{k}</code> · {lim.min}–{lim.max}
                    {errors[k] && (
                      <>
                        {' '}
                        · <span style={{ color: 'var(--err)' }}>{errors[k]}</span>
                      </>
                    )}
                  </>
                }
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={lim.min}
                  max={lim.max}
                  step={1}
                  value={form[k]}
                  disabled={d.locked || busy}
                  aria-invalid={!!errors[k]}
                  placeholder={t('máy chủ: {value}', { value: d.server })}
                  onChange={(e) => set(k, e.target.value)}
                />
              </Field>
            );
          })}
        </div>
        <div className="row end">
          <button
            type="button"
            className="btn"
            disabled={busy || PHP_SETTING_KEYS.every((k) => view.settings[k] === null)}
            onClick={() => confirm(t('Bỏ mọi giá trị riêng của site và dùng lại giá trị máy chủ?')) && void save(toForm(PHP_PRESETS[0]!.values))}
          >
            {t('Dùng giá trị máy chủ')}
          </button>
          <button type="button" className="btn primary" disabled={busy || !dirty || Object.keys(errors).length > 0} onClick={() => void save(form)}>
            {busy ? t('Đang lưu…') : t('Lưu')}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>{t('Giá trị đang áp dụng')}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Thiết lập')}</th>
                <th>{t('Máy chủ')}</th>
                <th>{t('Hiệu lực')}</th>
              </tr>
            </thead>
            <tbody>
              {view.directives.map((d) => (
                <tr key={d.key}>
                  <td className="mono">{d.key}</td>
                  <td className="mono" title={t(SOURCES[d.serverSource])}>
                    {d.server}
                  </td>
                  <td>
                    <span className="mono">{d.effective}</span>{' '}
                    <Badge tone={d.effectiveSource === 'site' ? 'info' : d.locked ? 'warn' : 'default'}>{d.locked ? t('khoá bởi pool') : t(SOURCES[d.effectiveSource])}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kv">
          <div>PHP</div>
          <div>{view.phpVersion}</div>
          <div>nginx client_max_body_size</div>
          <div className="mono">{view.clientMaxBodyMb}m</div>
          <div>{t('File cấu hình')}</div>
          <div className="mono">{view.userIniPath}</div>
        </div>
        {locked.length > 0 && <Alert tone="warn">{t('PHP-FPM pool cố định {keys} bằng php_admin_value nên site không đổi được.', { keys: locked.join(', ') })}</Alert>}
        {view.foreignKeys.length > 0 && (
          <Alert tone="info">{t('File .user.ini còn có dòng khác (không do Lares ghi) đặt {keys}; dòng nằm sau cùng trong file sẽ có hiệu lực.', { keys: view.foreignKeys.join(', ') })}</Alert>
        )}
        <div className="hint">{t('Chỉ áp dụng cho PHP chạy qua web (PHP-FPM). wp-cli và cron dùng PHP CLI nên không đọc .user.ini.')}</div>
      </div>
    </div>
  );
}
