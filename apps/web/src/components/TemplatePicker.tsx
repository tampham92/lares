import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Branding, TemplateInfo } from '@tpanel/shared';
import { auth, get } from '../api';
import { Field } from './ui';

/** Gallery of bundled designs ("Trống" = TPanel's plain placeholder page). */
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
  const list = (q.data ?? []).filter((t) => t.types.includes(siteType));
  const selected = list.find((t) => t.id === value) ?? null;

  const previewUrl = (t: TemplateInfo) => {
    const p = new URLSearchParams({ token: auth.token ?? '' });
    for (const [k, v] of Object.entries(branding)) if (v) p.set(k, String(v));
    return `/api/templates/${t.id}/preview?${p.toString()}`;
  };

  return (
    <div className="stack">
      <h3>Giao diện</h3>
      <div className="tpl-grid">
        <button type="button" className={`tpl ${value === null ? 'active' : ''}`} onClick={() => onChange(null)}>
          <div className="tpl-thumb blank">{siteType === 'wordpress' ? 'Theme mặc định của WordPress' : 'Trang trắng'}</div>
          <div className="tpl-body">
            <strong>Trống</strong>
            <span className="sub">Tự dựng giao diện từ đầu</span>
          </div>
        </button>
        {list.map((t) => (
          <button type="button" key={t.id} className={`tpl ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
            <div className="tpl-thumb" style={{ backgroundColor: t.colors.primary }}>
              {t.previewImage && <img src={t.previewImage} alt="" loading="lazy" />}
              <span className="tpl-colors">
                <i style={{ background: t.colors.primary }} />
                <i style={{ background: t.colors.accent }} />
              </span>
            </div>
            <div className="tpl-body">
              <strong>{t.name}</strong>
              <span className="sub">{t.description}</span>
              <span
                className="link"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview(t);
                }}
              >
                Xem trước →
              </span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="sub">
            Thông tin hiển thị trên giao diện — bỏ trống để dùng nội dung mẫu. {siteType === 'wordpress' && 'Sửa lại bất kỳ lúc nào trong wp-admin.'}
          </div>
          <div className="form-grid">
            <Field label="Tên thương hiệu">
              <input value={branding.siteName ?? ''} placeholder={selected.defaults.siteName} onChange={(e) => onBranding({ ...branding, siteName: e.target.value })} />
            </Field>
            <Field label="Điện thoại / Hotline">
              <input value={branding.phone ?? ''} placeholder={selected.defaults.phone} onChange={(e) => onBranding({ ...branding, phone: e.target.value })} />
            </Field>
            <Field label="Email liên hệ">
              <input type="email" value={branding.email ?? ''} placeholder={selected.defaults.email} onChange={(e) => onBranding({ ...branding, email: e.target.value })} />
            </Field>
            <Field label="Địa chỉ">
              <input value={branding.address ?? ''} placeholder={selected.defaults.address} onChange={(e) => onBranding({ ...branding, address: e.target.value })} />
            </Field>
          </div>
          <Field label="Slogan / mô tả ngắn">
            <input value={branding.tagline ?? ''} placeholder={selected.defaults.tagline} onChange={(e) => onBranding({ ...branding, tagline: e.target.value })} />
          </Field>
        </>
      )}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Xem trước: {preview.name}</strong>
              <div className="row">
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => {
                    onChange(preview.id);
                    setPreview(null);
                  }}
                >
                  Dùng giao diện này
                </button>
                <button type="button" className="btn sm" onClick={() => setPreview(null)}>
                  Đóng
                </button>
              </div>
            </div>
            {/* no allow-same-origin: the preview can never touch the panel's session */}
            <iframe title={`Xem trước ${preview.name}`} sandbox="allow-scripts" src={previewUrl(preview)} />
          </div>
        </div>
      )}
    </div>
  );
}
