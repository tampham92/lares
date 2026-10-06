import { useState } from 'react';
import {
  BUILDER_STYLES,
  LOGO_MAX_LENGTH,
  SECTION_LABELS,
  SECTION_VARIANTS,
  STYLE_LABELS,
  VARIANT_LABELS,
  makePalette,
  paletteMinContrast,
  type BuilderBusiness,
  type BuilderItem,
  type BuilderSpec,
} from '@lares/shared';
import { Alert, Badge, Check, Field } from './ui';
import { t } from '../i18n';

type Update = (fn: (s: BuilderSpec) => BuilderSpec) => void;

function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Shrinks an uploaded logo in the browser (max 480×160) and returns a data URL. */
async function readLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t('Không đọc được ảnh')));
      i.src = url;
    });
    const scale = Math.min(1, 480 / img.width, 160 / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BusinessStep({ spec, update }: { spec: BuilderSpec; update: Update }) {
  const b = spec.business;
  const [logoError, setLogoError] = useState<string | null>(null);
  const set = (patch: Partial<BuilderBusiness>) => update((s) => ({ ...s, business: { ...s.business, ...patch } }));
  const setItem = (i: number, patch: Partial<BuilderItem>) => set({ items: b.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const itemsLabel = spec.industry === 'product' ? t('Sản phẩm / gói bán') : spec.industry === 'restaurant' ? t('Món ăn & đồ uống') : t('Dịch vụ & bảng giá');

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label={t('Tên thương hiệu')}>
          <input value={b.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t('Điện thoại / Hotline')}>
          <input value={b.phone} maxLength={30} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Zalo" hint={t('Bỏ trống nếu trùng số điện thoại')}>
          <input value={b.zalo} maxLength={30} inputMode="tel" onChange={(e) => set({ zalo: e.target.value })} />
        </Field>
        <Field label={t('Email liên hệ')}>
          <input type="email" value={b.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
        </Field>
      </div>
      <Field label={t('Slogan / mô tả ngắn')}>
        <input value={b.slogan} maxLength={200} onChange={(e) => set({ slogan: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label={t('Địa chỉ')}>
          <input value={b.address} maxLength={200} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label={t('Tỉnh / thành phố')} hint={t('Bỏ trống để lấy phần cuối của địa chỉ')}>
          <input value={b.city} maxLength={80} onChange={(e) => set({ city: e.target.value })} />
        </Field>
      </div>

      <Field label={t('Logo (không bắt buộc)')} hint={t('PNG, JPG hoặc WebP — được thu nhỏ ngay trên trình duyệt')}>
        <div className="bld-logo">
          {b.logo && <img src={b.logo} alt="" />}
          <label className="btn sm">
            {b.logo ? t('Đổi logo') : t('Chọn ảnh logo')}
            <input
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setLogoError(null);
              try {
                const data = await readLogo(f);
                if (data.length > LOGO_MAX_LENGTH) setLogoError(t('Logo quá lớn'));
                else set({ logo: data });
              } catch (err) {
                setLogoError(err instanceof Error ? err.message : String(err));
              }
            }}
            />
          </label>
          {b.logo && (
            <button type="button" className="btn sm" onClick={() => set({ logo: undefined })}>
              {t('Bỏ logo')}
            </button>
          )}
        </div>
      </Field>
      {logoError && <Alert tone="err">{logoError}</Alert>}

      <h3>{t('Giờ mở cửa')}</h3>
      <div className="bld-list">
        {b.hours.map((h, i) => (
          <div className="bld-hours" key={i}>
            <input aria-label={t('Ngày')} value={h.label} maxLength={60} placeholder={t('Thứ Hai – Thứ Sáu')} onChange={(e) => set({ hours: b.hours.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
            <input aria-label={t('Giờ')} value={h.value} maxLength={60} placeholder="9:00 – 21:00" onChange={(e) => set({ hours: b.hours.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
            <button type="button" className="bld-mini danger" title={t('Xoá')} aria-label={t('Xoá')} onClick={() => set({ hours: b.hours.filter((_, k) => k !== i) })}>
              ×
            </button>
          </div>
        ))}
        {b.hours.length < 7 && (
          <div>
            <button type="button" className="btn sm" onClick={() => set({ hours: [...b.hours, { label: '', value: '' }] })}>
              {t('+ Thêm dòng')}
            </button>
          </div>
        )}
      </div>

      <h3>{itemsLabel}</h3>
      <div className="sub">{t('Hiển thị trong bảng giá / thực đơn và trong ô chọn của form đặt lịch, đặt hàng.')}</div>
      <div className="bld-list">
        {b.items.map((it, i) => (
          <div className="bld-item" key={i}>
            <input aria-label={t('Tên')} value={it.title} maxLength={140} placeholder={t('Tên')} onChange={(e) => setItem(i, { title: e.target.value })} />
            <input aria-label={t('Giá')} value={it.price ?? ''} maxLength={40} placeholder={t('Giá')} onChange={(e) => setItem(i, { price: e.target.value || undefined })} />
            <div className="acts">
              <button type="button" className="bld-mini" title={t('Lên')} aria-label={t('Lên')} disabled={i === 0} onClick={() => set({ items: move(b.items, i, -1) })}>
                ↑
              </button>
              <button type="button" className="bld-mini" title={t('Xuống')} aria-label={t('Xuống')} disabled={i === b.items.length - 1} onClick={() => set({ items: move(b.items, i, 1) })}>
                ↓
              </button>
              <button type="button" className="bld-mini danger" title={t('Xoá')} aria-label={t('Xoá')} onClick={() => set({ items: b.items.filter((_, k) => k !== i) })}>
                ×
              </button>
            </div>
            <input className="wide" aria-label={t('Mô tả ngắn')} value={it.text ?? ''} maxLength={800} placeholder={t('Mô tả ngắn')} onChange={(e) => setItem(i, { text: e.target.value || undefined })} />
          </div>
        ))}
        {b.items.length < 24 && (
          <div>
            <button type="button" className="btn sm" onClick={() => set({ items: [...b.items, { title: '' }] })}>
              {t('+ Thêm mục')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const SWATCHES = ['#2f6b4f', '#b5452a', '#c27c0e', '#1f4e8c', '#7c3aed', '#be185d', '#0f766e', '#111827'];

export function StyleStep({ spec, update }: { spec: BuilderSpec; update: Update }) {
  const setStyle = (patch: Partial<BuilderSpec['style']>) => update((s) => ({ ...s, style: { ...s.style, ...patch } }));
  const [hex, setHex] = useState(spec.style.color);
  const palette = makePalette(spec.style.color, spec.style.preset);
  const aa = paletteMinContrast(palette) >= 4.5;
  return (
    <div className="stack">
      <Field label={t('Màu thương hiệu')} hint={t('Lares tự tính bảng màu đầy đủ và chỉnh độ sáng để chữ luôn dễ đọc.')}>
        <div className="bld-color">
          <input
            type="color"
            aria-label={t('Màu thương hiệu')}
            value={spec.style.color}
            onChange={(e) => {
              setHex(e.target.value);
              setStyle({ color: e.target.value });
            }}
          />
          <input
            className="hex"
            aria-label="Hex"
            value={hex}
            maxLength={7}
            onChange={(e) => {
              setHex(e.target.value);
              if (/^#[0-9a-f]{6}$/i.test(e.target.value)) setStyle({ color: e.target.value.toLowerCase() });
            }}
          />
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`bld-swatch ${spec.style.color === c ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={c}
              onClick={() => {
                setHex(c);
                setStyle({ color: c });
              }}
            />
          ))}
        </div>
      </Field>
      <div className="bld-palette">
        {[palette.primary, palette.primaryText, palette.accent, palette.bg, palette.bgAlt, palette.text, palette.dark].map((c, i) => (
          <i key={i} style={{ background: c }} title={c} />
        ))}
        <Badge tone={aa ? 'ok' : 'warn'}>{aa ? t('Đạt chuẩn tương phản WCAG AA') : t('Độ tương phản thấp')}</Badge>
      </div>

      <h3>{t('Phong cách')}</h3>
      <div className="bld-styles" role="radiogroup" aria-label={t('Phong cách')}>
        {BUILDER_STYLES.map((st) => (
          <button key={st} type="button" role="radio" aria-checked={spec.style.preset === st} className={`bld-style ${spec.style.preset === st ? 'active' : ''}`} onClick={() => setStyle({ preset: st })}>
            <strong>{t(STYLE_LABELS[st].name)}</strong>
            <span className="sub">{t(STYLE_LABELS[st].desc)}</span>
            <span className="fonts">{STYLE_LABELS[st].fonts}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionsStep({ spec, update }: { spec: BuilderSpec; update: Update }) {
  const list = spec.sections;
  const set = (i: number, patch: Partial<BuilderSpec['sections'][number]>) => update((s) => ({ ...s, sections: s.sections.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const fixed = (i: number) => list[i]!.type === 'hero' || list[i]!.type === 'footer';
  const canMove = (i: number, d: number) => !fixed(i) && i + d >= 0 && i + d < list.length && !fixed(i + d);
  return (
    <div className="stack">
      <div className="sub">{t('Bật/tắt, đổi thứ tự và chọn kiểu bố cục cho từng khối. Ảnh bìa luôn ở đầu, chân trang luôn ở cuối.')}</div>
      <div className="bld-sections">
        {list.map((sec, i) => (
          <div key={sec.type} className={`bld-sec ${sec.enabled ? '' : 'off'}`}>
            <input type="checkbox" checked={sec.enabled} aria-label={t(SECTION_LABELS[sec.type])} onChange={(e) => set(i, { enabled: e.target.checked })} />
            <span className="name">{t(SECTION_LABELS[sec.type])}</span>
            <select value={sec.variant} aria-label={t('Kiểu bố cục')} onChange={(e) => set(i, { variant: e.target.value })}>
              {SECTION_VARIANTS[sec.type].map((v) => (
                <option key={v} value={v}>
                  {t(VARIANT_LABELS[v] ?? v)}
                </option>
              ))}
            </select>
            <span className="acts">
              <button type="button" className="bld-mini" title={t('Lên')} aria-label={t('Lên')} disabled={!canMove(i, -1)} onClick={() => update((s) => ({ ...s, sections: move(s.sections, i, -1) }))}>
                ↑
              </button>
              <button type="button" className="bld-mini" title={t('Xuống')} aria-label={t('Xuống')} disabled={!canMove(i, 1)} onClick={() => update((s) => ({ ...s, sections: move(s.sections, i, 1) }))}>
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>
      <Check checked={spec.floatingContact} onChange={(v) => update((s) => ({ ...s, floatingContact: v }))}>
        {t('Hiện nút Zalo / gọi điện nổi ở góc màn hình')}
      </Check>
    </div>
  );
}
