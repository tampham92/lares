// ---------------------------------------------------------------------------
// Site builder ("Trình tạo giao diện"): the spec a user builds in the wizard, the
// section library catalogue and the design tokens of generated websites.
// Shared by server (validation + rendering) and web (wizard, palette preview).
// ---------------------------------------------------------------------------
import { z } from 'zod';
import { msg } from './i18n.js';

export const BUILDER_INDUSTRIES = ['spa', 'restaurant', 'product'] as const;
export type BuilderIndustry = (typeof BUILDER_INDUSTRIES)[number];

export const BUILDER_STYLES = ['luxury', 'young', 'minimal', 'warm'] as const;
export type BuilderStyle = (typeof BUILDER_STYLES)[number];

export const SECTION_TYPES = ['hero', 'about', 'services', 'pricing', 'offer', 'testimonials', 'gallery', 'team', 'faq', 'contact', 'map', 'footer'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** Layout variants of every section type (the first one is the default). */
export const SECTION_VARIANTS: { readonly [K in SectionType]: readonly string[] } = {
  hero: ['split', 'overlay', 'centered'],
  about: ['split', 'stats'],
  services: ['cards', 'icons', 'menu'],
  pricing: ['table', 'plans'],
  offer: ['band', 'card'],
  testimonials: ['cards', 'spotlight'],
  gallery: ['grid', 'masonry', 'strip'],
  team: ['cards', 'round'],
  faq: ['accordion', 'split'],
  contact: ['split', 'centered'],
  map: ['split', 'card'],
  footer: ['columns', 'simple'],
};

/** Icons available to items (rendered as CSS masks, so they survive the block editor). */
export const BUILDER_ICONS = ['check', 'star', 'leaf', 'sparkle', 'heart', 'shield', 'truck', 'gift', 'clock', 'phone', 'mail', 'pin', 'chat', 'cup', 'flame', 'drop', 'award', 'users'] as const;
export type BuilderIcon = (typeof BUILDER_ICONS)[number];

/** Panel labels (Vietnamese source text, shown through t()). */
export const INDUSTRY_LABELS: Record<BuilderIndustry, string> = {
  spa: msg('Spa / Thẩm mỹ viện'),
  restaurant: msg('Nhà hàng / Quán cà phê'),
  product: msg('Landing page bán một sản phẩm'),
};

export const STYLE_LABELS: Record<BuilderStyle, { name: string; desc: string; fonts: string }> = {
  luxury: { name: msg('Sang trọng'), desc: msg('Chữ có chân thanh lịch, khoảng trắng rộng, nút vuông, điểm nhấn ánh vàng'), fonts: 'Playfair Display + Be Vietnam Pro' },
  young: { name: msg('Trẻ trung'), desc: msg('Chữ bo tròn, màu tươi, góc bo lớn, nút dạng viên thuốc'), fonts: 'Quicksand + Be Vietnam Pro' },
  minimal: { name: msg('Tối giản'), desc: msg('Font hệ thống tải tức thì, viền mảnh thay cho bóng đổ, một màu chủ đạo'), fonts: 'System UI' },
  warm: { name: msg('Ấm áp'), desc: msg('Nền kem, chữ có chân mềm mại, tông nâu đất gần gũi'), fonts: 'Lora + Be Vietnam Pro' },
};

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: msg('Ảnh bìa (hero)'),
  about: msg('Giới thiệu'),
  services: msg('Dịch vụ / Thực đơn'),
  pricing: msg('Bảng giá'),
  offer: msg('Ưu đãi + đếm ngược'),
  testimonials: msg('Khách hàng nói gì'),
  gallery: msg('Thư viện ảnh'),
  team: msg('Đội ngũ / Chuyên gia'),
  faq: msg('Câu hỏi thường gặp'),
  contact: msg('Form đặt lịch / đặt hàng / liên hệ'),
  map: msg('Bản đồ + giờ mở cửa'),
  footer: msg('Chân trang'),
};

export const VARIANT_LABELS: Record<string, string> = {
  split: msg('Hai cột'),
  overlay: msg('Chữ trên ảnh nền'),
  centered: msg('Căn giữa'),
  stats: msg('Kèm số liệu'),
  cards: msg('Thẻ có ảnh'),
  icons: msg('Biểu tượng'),
  menu: msg('Thực đơn kèm giá'),
  table: msg('Danh sách giá'),
  plans: msg('Gói nổi bật'),
  band: msg('Dải màu'),
  card: msg('Hộp nổi'),
  spotlight: msg('Một lời khen lớn'),
  grid: msg('Lưới'),
  masonry: msg('So le'),
  strip: msg('Cuộn ngang'),
  round: msg('Ảnh tròn'),
  accordion: msg('Xổ xuống'),
  columns: msg('Nhiều cột'),
  simple: msg('Gọn'),
};

// ---------------------------------------------------------------------------
// Spec schema
// ---------------------------------------------------------------------------

/** Placeholders allowed in sample copy; the renderer maps them to the template variables. */
export const COPY_PLACEHOLDERS = ['brand', 'slogan', 'phone', 'email', 'address', 'city'] as const;

const noAngle = /^[^<>]*$/;
const line = (max: number) => z.string().trim().max(max).regex(/^[^\r\n<>]*$/, 'Không được chứa xuống dòng hoặc < >');
/** Free text: line breaks allowed (blank line = new paragraph, **bold**), never HTML. */
const prose = (max: number) => z.string().trim().max(max).regex(noAngle, 'Không được chứa ký tự < >');

/** tpl:<template id>/<file> (bundled asset) or an https:// image URL. */
export const IMAGE_REF_RE = /^(tpl:[a-z0-9-]{1,40}\/[a-z0-9][a-z0-9._-]{0,79}\.(webp|jpe?g|png)|https:\/\/[^\s"'<>()\\]{1,400})$/;
const imageRef = z.string().trim().regex(IMAGE_REF_RE, 'Ảnh phải là ảnh có sẵn của giao diện hoặc URL https://');

/** Logos are embedded as data URLs (resized in the browser), so a saved spec is self-contained. */
export const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export const LOGO_MAX_LENGTH = 400_000;

export const builderItemSchema = z.object({
  title: line(140),
  text: prose(800).optional(),
  /** Role, unit, small caption. */
  meta: line(100).optional(),
  price: line(40).optional(),
  image: imageRef.optional(),
  icon: z.enum(BUILDER_ICONS).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  featured: z.boolean().optional(),
});
export type BuilderItem = z.infer<typeof builderItemSchema>;

export const sectionContentSchema = z
  .object({
    /** Menu label (empty = not in the menu) and #anchor of the section. */
    nav: line(30).optional(),
    anchor: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Anchor chỉ gồm chữ thường, số và dấu gạch ngang').optional(),
    eyebrow: line(80).optional(),
    title: line(180).optional(),
    text: prose(1500).optional(),
    image: imageRef.optional(),
    cta: line(50).optional(),
    cta2: line(50).optional(),
    note: line(300).optional(),
    price: line(40).optional(),
    oldPrice: line(40).optional(),
    /** Offer deadline (YYYY-MM-DD or full ISO date); empty = counts down to midnight every day. */
    endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?)?$/, 'Ngày kết thúc không hợp lệ').optional(),
    points: z.array(line(160)).max(8).optional(),
    stats: z.array(z.object({ value: line(20), label: line(60) })).max(4).optional(),
    items: z.array(builderItemSchema).max(24).optional(),
    formKind: z.enum(['booking', 'order', 'contact']).optional(),
  })
  .strict();
export type SectionContent = z.infer<typeof sectionContentSchema>;

export const builderSectionSchema = z
  .object({
    type: z.enum(SECTION_TYPES),
    variant: z.string(),
    enabled: z.boolean().default(true),
    content: sectionContentSchema.default({}),
  })
  .refine((s) => SECTION_VARIANTS[s.type].includes(s.variant), { message: 'Kiểu bố cục không hợp lệ', path: ['variant'] });
export type BuilderSection = z.infer<typeof builderSectionSchema>;

export const builderBusinessSchema = z.object({
  name: line(80).min(1, 'Nhập tên thương hiệu'),
  slogan: line(200).default(''),
  phone: z.string().trim().max(30).regex(/^[0-9+().\s-]*$/, 'Số điện thoại không hợp lệ').default(''),
  /** Zalo number; empty = same as the phone. */
  zalo: z.string().trim().max(30).regex(/^[0-9+().\s-]*$/, 'Số Zalo không hợp lệ').default(''),
  email: z.string().trim().email('Email không hợp lệ').or(z.literal('')).default(''),
  address: line(200).default(''),
  /** Empty = last part of the address. */
  city: line(80).default(''),
  hours: z.array(z.object({ label: line(60), value: line(60) })).max(7).default([]),
  /** Services / dishes / product packages with prices. */
  items: z.array(builderItemSchema).max(24).default([]),
  logo: z.string().max(LOGO_MAX_LENGTH, 'Logo quá lớn').regex(LOGO_RE, 'Logo phải là ảnh PNG, JPEG hoặc WebP').optional(),
});
export type BuilderBusiness = z.infer<typeof builderBusinessSchema>;

export const HEX_RE = /^#[0-9a-f]{6}$/i;

export const builderSpecSchema = z
  .object({
    version: z.literal(1).default(1),
    industry: z.enum(BUILDER_INDUSTRIES),
    /** Language of the website's fixed texts (form labels, menu...). */
    lang: z.enum(['vi', 'en']).default('vi'),
    business: builderBusinessSchema,
    style: z.object({
      color: z.string().trim().toLowerCase().regex(HEX_RE, 'Màu phải có dạng #rrggbb'),
      preset: z.enum(BUILDER_STYLES),
    }),
    sections: z.array(builderSectionSchema).min(1).max(SECTION_TYPES.length),
    /** Floating call / Zalo buttons. */
    floatingContact: z.boolean().default(true),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.sections.forEach((s, i) => {
      if (seen.has(s.type)) ctx.addIssue({ code: 'custom', path: ['sections', i, 'type'], message: 'Mỗi loại khối chỉ dùng một lần' });
      seen.add(s.type);
    });
    if (!spec.sections.some((s) => s.enabled && s.type !== 'footer')) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Bật ít nhất một khối nội dung' });
    // Placeholders in copy must be ones the renderer knows, so nothing like {brnad} ships to a customer.
    const copy = JSON.stringify({ sections: spec.sections, items: spec.business.items, hours: spec.business.hours });
    const bad = copy.match(/\{([a-z_]+)\}/g)?.find((p) => !(COPY_PLACEHOLDERS as readonly string[]).includes(p.slice(1, -1)));
    if (bad) ctx.addIssue({ code: 'custom', path: ['sections', bad], message: 'Nội dung có biến không hợp lệ (chỉ dùng {brand}, {slogan}, {phone}, {email}, {address}, {city})' });
  });
export type BuilderSpec = z.infer<typeof builderSpecSchema>;
export type BuilderSpecInput = z.input<typeof builderSpecSchema>;

/** Save the current spec as a reusable template in the custom templates folder. */
export const saveBuilderTemplateSchema = z.object({
  name: line(60).min(1, 'Nhập tên giao diện'),
  description: line(200).default(''),
  spec: builderSpecSchema,
});
export type SaveBuilderTemplateInput = z.infer<typeof saveBuilderTemplateSchema>;

/** A built-in industry preset or a saved builder template, as listed in the wizard. */
export interface BuilderPreset {
  id: string;
  name: string;
  description: string;
  industry: BuilderIndustry;
  custom: boolean;
  previewImage: string | null;
  spec: BuilderSpec;
}

// ---------------------------------------------------------------------------
// Colour: WCAG contrast + palette generation from one brand colour
// ---------------------------------------------------------------------------

type Hsl = { h: number; s: number; l: number };

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

function toHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

const hsl = (h: number, s: number, l: number) => fromHsl({ h, s: Math.min(1, Math.max(0, s)), l: Math.min(1, Math.max(0, l)) });

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken (on light backgrounds) or lighten (on dark ones) until `color` reaches `min` contrast with every background. */
export function ensureContrast(color: string, backgrounds: string[], min = 4.5): string {
  const passes = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= min);
  if (passes(color)) return color;
  const dark = backgrounds.reduce((s, bg) => s + luminance(bg), 0) / backgrounds.length < 0.3;
  const start = toHsl(color);
  for (let step = 1; step <= 100; step++) {
    const c = fromHsl({ ...start, l: Math.min(1, Math.max(0, start.l + (dark ? step : -step) / 100)) });
    if (passes(c)) return c;
  }
  return dark ? '#ffffff' : '#000000';
}

export interface SitePalette {
  /** The colour the user picked. */
  brand: string;
  /** Filled buttons / strong brand surfaces, and the text on them. */
  primary: string;
  onPrimary: string;
  primaryHover: string;
  /** Brand colour for text and links on light surfaces. */
  primaryText: string;
  /** Very light / light brand tints (badges, icon backgrounds, highlights). */
  tint: string;
  tint2: string;
  /** Decorative accent (stars, rules) and its readable text version. */
  accent: string;
  accentText: string;
  bg: string;
  bgAlt: string;
  surface: string;
  text: string;
  heading: string;
  muted: string;
  border: string;
  /** Dark band (footer, offer, overlays) and its texts. */
  dark: string;
  onDark: string;
  onDarkMuted: string;
  darkAccent: string;
}

/**
 * Full palette from one brand colour and a style. Every text/background pair used by the
 * section CSS is pushed to at least WCAG AA (4.5:1) - see the contrast test in the server.
 */
export function makePalette(brandHex: string, style: BuilderStyle): SitePalette {
  const brand = HEX_RE.test(brandHex) ? brandHex.toLowerCase() : '#2449d8';
  const { h, s } = toHsl(brand);
  const sat = Math.max(s, 0.08);

  const surfaces: Record<BuilderStyle, { bg: string; bgAlt: string; surface: string; dark: string; border: string; heading: string; text: string; accent: string }> = {
    luxury: {
      bg: hsl(40, 0.33, 0.975),
      bgAlt: hsl(h, Math.min(sat, 0.25), 0.945),
      surface: '#ffffff',
      dark: hsl(h, Math.min(sat, 0.3), 0.1),
      border: hsl(38, 0.22, 0.87),
      heading: hsl(h, Math.min(sat, 0.35), 0.15),
      text: hsl(h, 0.1, 0.2),
      accent: hsl(38, 0.48, 0.56),
    },
    young: {
      bg: '#ffffff',
      bgAlt: hsl(h, Math.min(sat, 0.7), 0.965),
      surface: '#ffffff',
      dark: hsl(h, Math.min(sat, 0.5), 0.14),
      border: hsl(h, Math.min(sat, 0.4), 0.9),
      heading: hsl(h, Math.min(sat, 0.45), 0.14),
      text: hsl(h, 0.14, 0.2),
      accent: hsl(h + 150, Math.max(sat, 0.65), 0.55),
    },
    minimal: {
      bg: '#ffffff',
      bgAlt: hsl(h, Math.min(sat, 0.1), 0.965),
      surface: '#ffffff',
      dark: hsl(h, Math.min(sat, 0.12), 0.1),
      border: hsl(h, Math.min(sat, 0.1), 0.89),
      heading: hsl(h, 0.1, 0.09),
      text: hsl(h, 0.08, 0.17),
      accent: brand,
    },
    warm: {
      bg: hsl(36, 0.55, 0.97),
      bgAlt: hsl(32, 0.45, 0.925),
      surface: hsl(36, 0.6, 0.99),
      dark: hsl(20, 0.28, 0.12),
      border: hsl(30, 0.3, 0.86),
      heading: hsl(20, 0.32, 0.16),
      text: hsl(22, 0.18, 0.2),
      accent: (h >= 0 && h <= 60) || h >= 330 ? hsl(h + 18, Math.max(sat, 0.55), 0.52) : hsl(20, 0.62, 0.52),
    },
  };
  const base = surfaces[style];
  const lights = [base.bg, base.bgAlt, base.surface];

  // Filled button: keep the brand colour when it carries white (or, for light brands, dark) text;
  // otherwise darken it just enough for white text.
  const ink = hsl(h, 0.2, 0.1);
  const darkened = ensureContrast(brand, ['#ffffff'], 4.6);
  let primary = brand;
  let onPrimary = '#ffffff';
  if (contrast(brand, '#ffffff') < 4.6) {
    const shift = toHsl(brand).l - toHsl(darkened).l;
    if (shift > 0.16 && contrast(brand, ink) >= 4.6) onPrimary = ink;
    else primary = darkened;
  }
  const hoverBase = toHsl(primary);
  let primaryHover = fromHsl({ ...hoverBase, l: Math.max(0, hoverBase.l - 0.07) });
  if (contrast(primaryHover, onPrimary) < 4.5) primaryHover = fromHsl({ ...hoverBase, l: Math.min(1, hoverBase.l + 0.07) });
  if (contrast(primaryHover, onPrimary) < 4.5) primaryHover = primary;

  const tint = hsl(h, Math.min(sat, 0.75), 0.95);
  const tint2 = hsl(h, Math.min(sat, 0.65), 0.885);
  const text = ensureContrast(base.text, lights, 7);
  const dark = base.dark;
  return {
    brand,
    primary,
    onPrimary,
    primaryHover,
    primaryText: ensureContrast(brand, [...lights, tint], 4.6),
    tint,
    tint2,
    accent: base.accent,
    accentText: ensureContrast(base.accent, lights, 4.6),
    bg: base.bg,
    bgAlt: base.bgAlt,
    surface: base.surface,
    text,
    heading: ensureContrast(base.heading, lights, 7),
    muted: ensureContrast(hsl(h, Math.min(sat, 0.1), 0.4), lights, 4.6),
    border: base.border,
    dark,
    onDark: ensureContrast(hsl(h, 0.2, 0.97), [dark], 10),
    onDarkMuted: ensureContrast(hsl(h, Math.min(sat, 0.15), 0.74), [dark], 4.6),
    darkAccent: ensureContrast(base.accent, [dark], 4.6),
  };
}

/** Text/background pairs of a palette that must reach 4.5:1 (used by tests and the wizard's AA badge). */
export function paletteContrastPairs(p: SitePalette): Array<[string, string, string]> {
  const lights: Array<[string, string]> = [
    ['bg', p.bg],
    ['bgAlt', p.bgAlt],
    ['surface', p.surface],
  ];
  const pairs: Array<[string, string, string]> = [
    ['onPrimary/primary', p.onPrimary, p.primary],
    ['onPrimary/primaryHover', p.onPrimary, p.primaryHover],
    ['primaryText/tint', p.primaryText, p.tint],
    ['onDark/dark', p.onDark, p.dark],
    ['onDarkMuted/dark', p.onDarkMuted, p.dark],
    ['darkAccent/dark', p.darkAccent, p.dark],
  ];
  for (const [name, bg] of lights) {
    pairs.push([`text/${name}`, p.text, bg], [`heading/${name}`, p.heading, bg], [`muted/${name}`, p.muted, bg], [`primaryText/${name}`, p.primaryText, bg], [`accentText/${name}`, p.accentText, bg]);
  }
  return pairs;
}

/** Lowest contrast ratio among the required pairs (>= 4.5 means the palette passes WCAG AA). */
export const paletteMinContrast = (p: SitePalette) => Math.min(...paletteContrastPairs(p).map(([, a, b]) => contrast(a, b)));

/** ASCII slug for ids / theme names: "Hoa Mai Spa" → "hoa-mai-spa". */
export function slugify(s: string, max = 40): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}
