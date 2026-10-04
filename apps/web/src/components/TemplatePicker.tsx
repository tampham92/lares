import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Branding, TemplateInfo } from '@lares/shared';
import { auth, get } from '../api';
import { Field } from './ui';
import { t } from '../i18n';

/** Gallery of bundled designs ("Trống" = Lares's plain placeholder page). */
export function TemplatePicker({
  siteType,
  value,
  onChange,
  branding,
  onBranding,
}: {
  siteType: 'wordpress' | 'static';
  value: string | null;
  onChange: (id: string | null) => void;
  branding: Branding;
  onBranding: (b: Branding) => void;
}) {
  const q = useQuery({ queryKey: ['templates'], queryFn: () => get<TemplateInfo[]>('/api/templates') });
  const [preview, setPreview] = useState<TemplateInfo | null>(null);
  const list = (q.data ?? []).filter((tpl) => tpl.types.includes(siteType));
  const selected = list.find((tpl) => tpl.id === value) ?? null;

  const previewUrl = (tpl: TemplateInfo) => {
    const p = new URLSearchParams({ token: auth.token ?? '' });
    for (const [k, v] of Object.entries(branding)) if (v) p.set(k, String(v));
    return `/api/templates/${tpl.id}/preview?${p.toString()}`;
  };

  return (
    <div className="stack">
      <h3>{t('Giao diện')}</h3>
      <div className="tpl-grid">
        <button type="button" className={`tpl ${value === null ? 'active' : ''}`} onClick={() => onChange(null)}>
          <div className="tpl-thumb blank">{siteType === 'wordpress' ? t('Theme mặc định của WordPress') : t('Trang trắng')}</div>
          <div className="tpl-body">
            <strong>{t('Trống')}</strong>
            <span className="sub">{t('Tự dựng giao diện từ đầu')}</span>
          </div>
        </button>
        {list.map((tpl) => (
          <button type="button" key={tpl.id} className={`tpl ${value === tpl.id ? 'active' : ''}`} onClick={() => onChange(tpl.id)}>
            <div className="tpl-thumb" style={{ backgroundColor: tpl.colors.primary }}>
              {tpl.previewImage && <img src={tpl.previewImage} alt="" loading="lazy" />}
              <span className="tpl-colors">
                <i style={{ background: tpl.colors.primary }} />
                <i style={{ background: tpl.colors.accent }} />
              </span>
            </div>
            <div className="tpl-body">
              <strong>{tpl.name}</strong>
              <span className="sub">{tpl.description}</span>
              <span
                className="link"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview(tpl);
                }}
              >
                {t('Xem trước →')}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="sub">
            {t('Thông tin hiển thị trên giao diện — bỏ trống để dùng nội dung mẫu.')} {siteType === 'wordpress' && t('Sửa lại bất kỳ lúc nào trong wp-admin.')}
          </div>
          <div className="form-grid">
            <Field label={t('Tên thương hiệu')}>
              <input value={branding.siteName ?? ''} placeholder={selected.defaults.siteName} onChange={(e) => onBranding({ ...branding, siteName: e.target.value })} />
            </Field>
            <Field label={t('Điện thoại / Hotline')}>
              <input value={branding.phone ?? ''} placeholder={selected.defaults.phone} onChange={(e) => onBranding({ ...branding, phone: e.target.value })} />
            </Field>
            <Field label={t('Email liên hệ')}>
              <input type="email" value={branding.email ?? ''} placeholder={selected.defaults.email} onChange={(e) => onBranding({ ...branding, email: e.target.value })} />
            </Field>
            <Field label={t('Địa chỉ')}>
              <input value={branding.address ?? ''} placeholder={selected.defaults.address} onChange={(e) => onBranding({ ...branding, address: e.target.value })} />
            </Field>
          </div>
          <Field label={t('Slogan / mô tả ngắn')}>
            <input value={branding.tagline ?? ''} placeholder={selected.defaults.tagline} onChange={(e) => onBranding({ ...branding, tagline: e.target.value })} />
          </Field>
        </>
      )}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{t('Xem trước: {name}', { name: preview.name })}</strong>
              <div className="row">
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => {
                    onChange(preview.id);
                    setPreview(null);
                  }}
                >
                  {t('Dùng giao diện này')}
                </button>
                <button type="button" className="btn sm" onClick={() => setPreview(null)}>
                  {t('Đóng')}
                </button>
              </div>
            </div>
            {/* no allow-same-origin: the preview can never touch the panel's session */}
            <iframe title={t('Xem trước: {name}', { name: preview.name })} sandbox="allow-scripts" src={previewUrl(preview)} />
          </div>
        </div>
      )}
    </div>
  );
}
