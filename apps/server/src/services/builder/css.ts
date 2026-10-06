/**
 * Design system of generated websites (not the panel's): tokens computed from one brand colour
 * and a style, plus the CSS of every section. Selectors target the class names of the serialized
 * blocks, so the same stylesheet dresses the static page, the WordPress front end and the editor.
 * Spacing uses flex/grid gaps instead of margins (WordPress resets child margins in groups).
 */
import { BUILDER_ICONS, type BuilderIcon, type BuilderStyle, type SectionType, type SitePalette } from '@lares/shared';

export interface FontFile {
  family: string;
  weight: number;
  file: string;
  subset: 'latin' | 'vietnamese';
}

const UNICODE = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  vietnamese: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
};

const face = (family: string, slug: string, weight: number): FontFile[] =>
  (['latin', 'vietnamese'] as const).map((subset) => ({ family, weight, subset, file: `${slug}-${subset}-${weight}-normal.woff2` }));

const SYSTEM = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif";
const BODY = `'Be Vietnam Pro',${SYSTEM}`;
const BODY_FILES = [...face('Be Vietnam Pro', 'be-vietnam-pro', 400), ...face('Be Vietnam Pro', 'be-vietnam-pro', 600)];

interface StyleTokens {
  fonts: FontFile[];
  head: string;
  body: string;
  vars: Record<string, string>;
}

export const STYLE_TOKENS: Record<BuilderStyle, StyleTokens> = {
  luxury: {
    fonts: [...face('Playfair Display', 'playfair-display', 600), ...BODY_FILES],
    head: `'Playfair Display',Georgia,'Times New Roman',serif`,
    body: BODY,
    vars: {
      'w-head': '600', 't-head': '-0.005em', 't-eyebrow': '.22em', r: '4px', 'r-sm': '2px', 'r-btn': '2px', 'r-img': '2px',
      pad: 'clamp(72px,10vw,128px)', sh: '0 1px 2px rgba(20,14,6,.04),0 18px 40px -24px rgba(20,14,6,.22)', 'sh-lg': '0 30px 60px -30px rgba(20,14,6,.35)',
      'card-bd': '1px solid var(--c-border)', 'btn-tt': 'uppercase', 'btn-ls': '.14em', 'btn-w': '600', 'btn-fs': '.8rem', h1: 'clamp(2.4rem,1.5rem + 3.8vw,4.4rem)', h2: 'clamp(1.9rem,1.3rem + 2.2vw,3rem)',
    },
  },
  young: {
    fonts: [...face('Quicksand', 'quicksand', 700), ...BODY_FILES],
    head: `'Quicksand','Be Vietnam Pro',${SYSTEM}`,
    body: BODY,
    vars: {
      'w-head': '700', 't-head': '-0.01em', 't-eyebrow': '.08em', r: '22px', 'r-sm': '14px', 'r-btn': '999px', 'r-img': '28px',
      pad: 'clamp(64px,9vw,104px)', sh: '0 12px 30px -14px color-mix(in srgb,var(--c-primary) 40%,transparent)', 'sh-lg': '0 26px 50px -20px color-mix(in srgb,var(--c-primary) 45%,transparent)',
      'card-bd': '0', 'btn-tt': 'none', 'btn-ls': '0', 'btn-w': '700', 'btn-fs': '1rem', h1: 'clamp(2.3rem,1.4rem + 3.6vw,4rem)', h2: 'clamp(1.8rem,1.2rem + 2vw,2.7rem)',
    },
  },
  minimal: {
    fonts: [],
    head: SYSTEM,
    body: SYSTEM,
    vars: {
      'w-head': '650', 't-head': '-0.022em', 't-eyebrow': '.12em', r: '10px', 'r-sm': '6px', 'r-btn': '8px', 'r-img': '10px',
      pad: 'clamp(56px,8vw,96px)', sh: 'none', 'sh-lg': '0 1px 2px rgba(0,0,0,.06)',
      'card-bd': '1px solid var(--c-border)', 'btn-tt': 'none', 'btn-ls': '0', 'btn-w': '600', 'btn-fs': '.97rem', h1: 'clamp(2.2rem,1.4rem + 3.2vw,3.6rem)', h2: 'clamp(1.7rem,1.2rem + 1.8vw,2.4rem)',
    },
  },
  warm: {
    fonts: [...face('Lora', 'lora', 600), ...BODY_FILES],
    head: `Lora,Georgia,'Times New Roman',serif`,
    body: BODY,
    vars: {
      'w-head': '600', 't-head': '0', 't-eyebrow': '.16em', r: '16px', 'r-sm': '10px', 'r-btn': '12px', 'r-img': '20px',
      pad: 'clamp(64px,9vw,112px)', sh: '0 16px 36px -18px rgba(90,45,15,.28)', 'sh-lg': '0 30px 60px -28px rgba(90,45,15,.4)',
      'card-bd': '1px solid var(--c-border)', 'btn-tt': 'none', 'btn-ls': '.01em', 'btn-w': '600', 'btn-fs': '1rem', h1: 'clamp(2.3rem,1.4rem + 3.6vw,4.1rem)', h2: 'clamp(1.8rem,1.25rem + 2vw,2.75rem)',
    },
  },
};

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export function tokensCss(p: SitePalette, style: BuilderStyle): string {
  const t = STYLE_TOKENS[style];
  const colors = Object.entries(p).map(([k, v]) => `--c-${kebab(k)}:${v}`);
  const vars = Object.entries(t.vars).map(([k, v]) => `--${k}:${v}`);
  return `:root{${[...colors, `--f-head:${t.head}`, `--f-body:${t.body}`, ...vars].join(';')}}`;
}

export function fontFaceCss(fonts: FontFile[], url: (file: string) => string): string {
  return fonts
    .map((f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${url(f.file)}) format('woff2');unicode-range:${UNICODE[f.subset]}}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Icons (stroke SVG used as CSS masks, coloured with currentColor)
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<BuilderIcon, string> = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c-.5 10-5.5 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>',
  sparkle: '<path d="M12 3c.6 4.5 1.9 6.4 6 7-4.1.6-5.4 2.5-6 7-.6-4.5-1.9-6.4-6-7 4.1-.6 5.4-2.5 6-7z"/><path d="M19 15c.3 1.8.9 2.6 2.5 3-1.6.4-2.2 1.2-2.5 3-.3-1.8-.9-2.6-2.5-3 1.6-.4 2.2-1.2 2.5-3z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  truck: '<path d="M2.5 6.5h11v9.5h-11zM13.5 9.5h4l3 3.5v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  gift: '<path d="M4.5 11h15v9h-15zM3.5 7.5h17V11h-17zM12 7.5V20"/><path d="M12 7.5C10.5 4 7.5 4.2 7.5 6c0 1.5 4.5 1.5 4.5 1.5s4.5 0 4.5-1.5c0-1.8-3-2-4.5 1.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  chat: '<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"/><path d="M8 10.5h8"/>',
  cup: '<path d="M4.5 9h12v4.5a5.5 5.5 0 0 1-5.5 5.5h-1a5.5 5.5 0 0 1-5.5-5.5zM16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8.5 3.5c-.8 1 .8 2 0 3M12.5 3.5c-.8 1 .8 2 0 3"/>',
  flame: '<path d="M12 3c.8 3.8 5 5.5 5 10.2A5 5 0 0 1 12 18.5a5 5 0 0 1-5-5.3c0-2.4 1.4-3.6 2-5 .9 1.4 2 1.9 2 1.9s-.6-3.9 1-7.1z"/>',
  drop: '<path d="M12 3.5s6 6.3 6 10.8a6 6 0 0 1-12 0C6 9.8 12 3.5 12 3.5z"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.8 13.5-1.3 7 4.5-2.6 4.5 2.6-1.3-7"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M15.5 5.3a3.3 3.3 0 0 1 0 6.4M17.5 14a5.5 5.5 0 0 1 3.5 5.5"/>',
};

const svgUrl = (paths: string) =>
  `url("data:image/svg+xml,${`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'>${paths.replace(/"/g, "'")}</svg>`.replace(/</g, '%3C').replace(/>/g, '%3E')}")`;

/** `.ic-<name>{--ic:url(...)}` for the icons used on the page. */
export function iconCss(used: Set<string>): string {
  return BUILDER_ICONS.filter((i) => used.has(i))
    .map((i) => `.ic-${i}{--ic:${svgUrl(ICON_PATHS[i])}}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%;scroll-padding-top:84px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{transition:none!important;animation:none!important}}
body{margin:0;background:var(--c-bg);color:var(--c-text);font-family:var(--f-body);font-size:1rem;line-height:1.7;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{max-width:100%;height:auto;display:block}
a{color:var(--c-primary-text);text-underline-offset:3px}
h1,h2,h3,h4{font-family:var(--f-head);font-weight:var(--w-head);color:var(--c-heading);line-height:1.18;letter-spacing:var(--t-head);margin:0;text-wrap:balance}
h1{font-size:var(--h1)}h2{font-size:var(--h2)}h3{font-size:1.2rem;line-height:1.35}
p{margin:0}
figure{margin:0}
strong{font-weight:600;color:var(--c-heading)}
:focus-visible{outline:3px solid var(--c-primary-text);outline-offset:3px;border-radius:2px}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip{position:absolute;left:12px;top:-60px;z-index:200;background:var(--c-surface);color:var(--c-heading);padding:10px 16px;border-radius:var(--r-sm);box-shadow:var(--sh-lg);text-decoration:none;font-weight:600}
.skip:focus{top:12px}
.wrap{width:100%;max-width:1180px;margin-inline:auto;padding-inline:20px}
.sec{padding-block:var(--pad);position:relative}
.sec.alt{background:var(--c-bg-alt)}
.sec.dark{background:var(--c-dark);color:var(--c-on-dark-muted)}
.sec.dark h2,.sec.dark h3,.sec.dark strong{color:var(--c-on-dark)}
.sec.dark .eyebrow{color:var(--c-dark-accent)}
.sec.dark a{color:var(--c-on-dark)}
.sec-head{display:flex;flex-direction:column;gap:14px;max-width:700px;margin:0 auto clamp(36px,5vw,60px);text-align:center;align-items:center}
.sec-head.start{text-align:left;align-items:flex-start;margin-inline:0}
.eyebrow{font-family:var(--f-body);font-size:.78rem;font-weight:600;letter-spacing:var(--t-eyebrow);text-transform:uppercase;color:var(--c-accent-text);line-height:1.4}
.lead{font-size:1.1rem;color:var(--c-muted);max-width:62ch}
.sec-head .lead{margin-inline:auto}
.sec-head.start .lead{margin-inline:0}
.prose{display:flex;flex-direction:column;gap:1em}
.prose p{color:var(--c-muted)}
.points{display:flex;flex-direction:column;gap:12px}
.pt{position:relative;padding-left:32px;color:var(--c-text)}
.pt::before{content:'';position:absolute;left:0;top:.2em;width:22px;height:22px;border-radius:50%;background:var(--c-tint)}
.pt::after{content:'';position:absolute;left:5px;top:calc(.2em + 5px);width:12px;height:12px;background:var(--c-primary-text);-webkit-mask:var(--ic-check) center/contain no-repeat;mask:var(--ic-check) center/contain no-repeat}
:root{--ic-check:${svgUrl(ICON_PATHS.check)};--ic-star:${svgUrl(ICON_PATHS.star)}}
.card{background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);box-shadow:var(--sh);overflow:hidden}
.ratio img{width:100%;height:100%;object-fit:cover}
.avatar{width:48px;height:48px;border-radius:50%;background:var(--c-tint);color:var(--c-primary-text);display:grid;place-items:center;font-weight:600;font-size:.95rem;flex:none;letter-spacing:.02em}
/* buttons: the markup of core/button */
.wp-block-buttons{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.sec .wp-block-buttons,.site-head .wp-block-buttons{gap:12px}
.wp-block-button{margin:0}
.wp-block-button .wp-block-button__link{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:.85em 1.7em;border-radius:var(--r-btn);font-family:var(--f-body);font-size:var(--btn-fs);font-weight:var(--btn-w);line-height:1.2;letter-spacing:var(--btn-ls);text-transform:var(--btn-tt);text-decoration:none;border:2px solid transparent;transition:background-color .2s,color .2s,border-color .2s,transform .2s;cursor:pointer;text-align:center}
.wp-block-button .wp-block-button__link:hover{transform:translateY(-1px)}
.wp-block-button.btn-primary .wp-block-button__link{background:var(--c-primary);color:var(--c-on-primary)}
.wp-block-button.btn-primary .wp-block-button__link:hover{background:var(--c-primary-hover)}
.wp-block-button.btn-ghost .wp-block-button__link{background:transparent;color:var(--c-heading);border-color:var(--c-border)}
.wp-block-button.btn-ghost .wp-block-button__link:hover{border-color:var(--c-heading)}
.wp-block-button.btn-light .wp-block-button__link{background:var(--c-surface);color:var(--c-heading)}
.sec.dark .wp-block-button.btn-ghost .wp-block-button__link,.on-dark .wp-block-button.btn-ghost .wp-block-button__link{color:var(--c-on-dark);border-color:currentColor}
.sec.dark .wp-block-button.btn-light .wp-block-button__link{background:var(--c-on-dark);color:var(--c-dark)}
/* icon chips (contact lists) */
.ci{position:relative;padding-left:56px;min-height:44px;display:flex;flex-direction:column;justify-content:center;line-height:1.5}
.ci::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:var(--r-sm);background:var(--c-tint)}
.ci::after{content:'';position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;background:var(--c-primary-text);-webkit-mask:var(--ic) center/contain no-repeat;mask:var(--ic) center/contain no-repeat}
.ci strong{display:block;font-size:.8rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--c-muted)}
.ci a{color:var(--c-heading);font-weight:600;text-decoration:none}
.ci a:hover{color:var(--c-primary-text)}
.sec.dark .ci::before{background:color-mix(in srgb,var(--c-on-dark) 12%,transparent)}
.sec.dark .ci::after{background:var(--c-dark-accent)}
.sec.dark .ci strong{color:var(--c-on-dark-muted)}
.sec.dark .ci a{color:var(--c-on-dark)}
`;

const HEADER = `
.site-head{position:sticky;top:0;z-index:60;background:color-mix(in srgb,var(--c-bg) 92%,transparent);backdrop-filter:saturate(160%) blur(12px);-webkit-backdrop-filter:saturate(160%) blur(12px);border-bottom:1px solid var(--c-border)}
.head-in{display:flex;align-items:center;gap:24px;min-height:72px}
.brand{display:flex;align-items:center;gap:10px;margin-right:auto;color:var(--c-heading);text-decoration:none;font-family:var(--f-head);font-weight:var(--w-head);font-size:1.3rem;letter-spacing:var(--t-head);line-height:1.1;min-width:0}
.brand-logo,.site-head .logo-img img{height:40px;width:auto;max-width:140px;object-fit:contain}
.site-head .logo-img{margin:0}
.site-head .wp-block-site-title{margin:0;font-family:var(--f-head);font-weight:var(--w-head);font-size:1.3rem;letter-spacing:var(--t-head);line-height:1.1}
.site-head .wp-block-site-title a{color:var(--c-heading);text-decoration:none}
.menu{display:flex;gap:26px}
.brand-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu a,.site-head .wp-block-navigation-item__content{color:var(--c-text);text-decoration:none;font-weight:500;font-size:.96rem}
.menu a:hover,.site-head .wp-block-navigation-item__content:hover{color:var(--c-primary-text)}
.site-head .wp-block-navigation{gap:26px}
.site-head .wp-block-navigation .wp-block-navigation__container{gap:26px}
.head-cta{display:flex;align-items:center;gap:16px}
.head-phone{color:var(--c-heading);font-weight:600;text-decoration:none;white-space:nowrap}
.head-cta .wp-block-button__link,.btn-head{min-height:44px;padding:.6em 1.25em}
.btn-head{display:inline-flex;align-items:center;border-radius:var(--r-btn);background:var(--c-primary);color:var(--c-on-primary);font-weight:var(--btn-w);font-size:var(--btn-fs);letter-spacing:var(--btn-ls);text-transform:var(--btn-tt);text-decoration:none;white-space:nowrap}
.btn-head:hover{background:var(--c-primary-hover)}
.menu-toggle{display:none;width:44px;height:44px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:transparent;color:var(--c-heading);cursor:pointer;place-items:center}
.menu-toggle .bars,.menu-toggle .bars::before,.menu-toggle .bars::after{display:block;width:18px;height:2px;background:currentColor;border-radius:2px;position:relative;transition:transform .2s}
.menu-toggle .bars::before,.menu-toggle .bars::after{content:'';position:absolute;left:0}
.menu-toggle .bars::before{top:-6px}.menu-toggle .bars::after{top:6px}
.menu-toggle[aria-expanded="true"] .bars{background:transparent}
.menu-toggle[aria-expanded="true"] .bars::before{transform:translateY(6px) rotate(45deg)}
.menu-toggle[aria-expanded="true"] .bars::after{transform:translateY(-6px) rotate(-45deg)}
@media (max-width:900px){
  .head-phone{display:none}
}
@media (max-width:780px){
  .menu-toggle{display:grid}
  .menu{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;gap:0;padding:8px 20px 16px;background:var(--c-bg);border-bottom:1px solid var(--c-border);box-shadow:var(--sh-lg)}
  .menu.open{display:flex}
  .menu a{padding:12px 0;border-bottom:1px solid var(--c-border)}
  .menu a:last-child{border-bottom:0}
  .head-cta .head-phone{display:none}
}
`;

const FORM = `
.lead-form{background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);box-shadow:var(--sh-lg);padding:clamp(22px,4vw,36px);display:flex;flex-direction:column;gap:16px;color:var(--c-text);text-align:left}
.lead-form .row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.lead-form label{display:flex;flex-direction:column;gap:6px;font-size:.9rem;font-weight:600;color:var(--c-heading)}
.lead-form label .req{color:var(--c-primary-text)}
.lead-form input,.lead-form select,.lead-form textarea{width:100%;min-height:50px;padding:.75em 1em;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-bg);color:var(--c-text);font:inherit;font-weight:400;font-size:1rem;transition:border-color .2s,box-shadow .2s}
.lead-form textarea{min-height:110px;resize:vertical}
.lead-form input:focus,.lead-form select:focus,.lead-form textarea:focus{outline:none;border-color:var(--c-primary-text);box-shadow:0 0 0 3px color-mix(in srgb,var(--c-primary) 22%,transparent)}
.lead-form button{min-height:54px;border:0;border-radius:var(--r-btn);background:var(--c-primary);color:var(--c-on-primary);font-family:var(--f-body);font-size:var(--btn-fs);font-weight:var(--btn-w);letter-spacing:var(--btn-ls);text-transform:var(--btn-tt);cursor:pointer;transition:background-color .2s}
.lead-form button:hover{background:var(--c-primary-hover)}
.lead-form button:disabled{opacity:.7;cursor:progress}
.lead-form .form-note{font-size:.85rem;color:var(--c-muted);text-align:center}
.lead-form .hp{position:absolute!important;left:-10000px;width:1px;height:1px;overflow:hidden}
.lares-msg{display:none;padding:14px 16px;border-radius:var(--r-sm);font-weight:500;line-height:1.5}
.lares-msg:target,.lares-msg.show{display:block}
.lares-msg.ok{background:#e8f6ee;color:#14532d;border:1px solid #9fd6b5}
.lares-msg.err{background:#fdecec;color:#7f1d1d;border:1px solid #f1b0b0}
@media (max-width:560px){.lead-form .row2{grid-template-columns:1fr}}
`;

const FLOATING = `
.fab-stack{position:fixed;right:16px;bottom:16px;z-index:70;display:flex;flex-direction:column;gap:10px}
.fab{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;box-shadow:0 10px 24px -8px rgba(0,0,0,.45);text-decoration:none;font:700 .72rem/1 var(--f-body);transition:transform .2s}
.fab:hover{transform:scale(1.06)}
.fab-zalo{background:#0068ff;color:#fff}
.fab-call{background:var(--c-primary);color:var(--c-on-primary)}
.fab-call::before{content:'';width:24px;height:24px;background:currentColor;-webkit-mask:var(--ic) center/contain no-repeat;mask:var(--ic) center/contain no-repeat}
@media (min-width:1024px){.fab-call{display:none}}
`;

const SECTIONS: Record<SectionType, string> = {
  hero: `
.s-hero{overflow:hidden}
.hero-copy{display:flex;flex-direction:column;gap:22px;align-items:flex-start}
.hero-copy h1 strong{color:var(--c-primary-text);font-weight:inherit}
.s-hero.v-overlay h1 strong{color:var(--c-dark-accent)}
.hero-copy .lead{font-size:clamp(1.05rem,1rem + .3vw,1.22rem)}
.hero-copy .wp-block-buttons{margin-top:6px}
.hero-points{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:4px}
.hero-points .pt{font-size:.95rem;color:var(--c-muted)}
.s-hero.v-split{padding-block:clamp(48px,7vw,96px) clamp(64px,8vw,112px);background:radial-gradient(900px 480px at 100% 0,var(--c-tint),transparent 70%),var(--c-bg)}
.hero-grid{display:grid;grid-template-columns:1.05fr 1fr;gap:clamp(32px,5vw,72px);align-items:center}
.hero-img{position:relative}
.hero-img img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r-img);box-shadow:var(--sh-lg)}
.hero-img::before{content:'';position:absolute;inset:auto -18px -18px auto;width:62%;height:58%;border-radius:var(--r-img);background:var(--c-tint2);z-index:-1}
.s-hero.v-split .hero-img{z-index:0}
.s-hero.v-overlay{min-height:min(88vh,760px);display:flex;align-items:center;padding-block:clamp(80px,12vw,140px);color:var(--c-on-dark)}
.s-hero.v-overlay::before{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,var(--c-dark) 0%,color-mix(in srgb,var(--c-dark) 88%,transparent) 42%,color-mix(in srgb,var(--c-dark) 55%,transparent) 100%)}
.s-hero.v-overlay .hero-bg{position:absolute;inset:0;z-index:0;margin:0}
.s-hero.v-overlay .hero-bg img{width:100%;height:100%;object-fit:cover}
.s-hero.v-overlay .hero-copy{position:relative;z-index:2;max-width:680px}
.s-hero.v-overlay .hero-inner{position:relative;z-index:2;width:100%}
.s-hero.v-overlay h1{color:var(--c-on-dark)}
.s-hero.v-overlay .lead,.s-hero.v-overlay .hero-points .pt{color:var(--c-on-dark-muted)}
.s-hero.v-overlay .eyebrow{color:var(--c-dark-accent)}
.s-hero.v-overlay .pt::before{background:color-mix(in srgb,var(--c-on-dark) 16%,transparent)}
.s-hero.v-overlay .pt::after{background:var(--c-dark-accent)}
.s-hero.v-overlay .wp-block-button.btn-ghost .wp-block-button__link{color:var(--c-on-dark);border-color:color-mix(in srgb,var(--c-on-dark) 55%,transparent)}
.s-hero.v-centered{padding-block:clamp(56px,8vw,104px) clamp(56px,7vw,96px);background:linear-gradient(180deg,var(--c-tint) 0%,var(--c-bg) 62%)}
.s-hero.v-centered .hero-copy{align-items:center;text-align:center;max-width:860px;margin-inline:auto}
.s-hero.v-centered .hero-copy .lead{margin-inline:auto}
.s-hero.v-centered .hero-points{justify-content:center}
.hero-wide{margin-top:clamp(36px,5vw,64px)}
.hero-wide img{width:100%;aspect-ratio:21/9;object-fit:cover;border-radius:var(--r-img);box-shadow:var(--sh-lg)}
@media (max-width:900px){
  .hero-grid{grid-template-columns:1fr}
  .hero-img img{aspect-ratio:4/3}
  .hero-img::before{display:none}
  .s-hero.v-overlay::before{background:color-mix(in srgb,var(--c-dark) 80%,transparent)}
  .hero-wide img{aspect-ratio:4/3}
}`,
  about: `
.about-grid{display:grid;grid-template-columns:1fr 1.05fr;gap:clamp(32px,6vw,88px);align-items:center}
.about-copy{display:flex;flex-direction:column;gap:20px;align-items:flex-start}
.about-img{position:relative}
.about-img img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r-img)}
.about-img::after{content:'';position:absolute;inset:18px -18px -18px 18px;border:1px solid var(--c-accent);border-radius:var(--r-img);z-index:-1}
.s-about .about-img{z-index:0}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.stat{background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);padding:26px 24px;box-shadow:var(--sh);display:flex;flex-direction:column;gap:6px}
.stat-v{font-family:var(--f-head);font-weight:var(--w-head);font-size:clamp(2rem,1.5rem + 1.6vw,2.8rem);line-height:1;color:var(--c-primary-text);letter-spacing:var(--t-head)}
.stat-l{color:var(--c-muted);font-size:.95rem}
.s-about.v-stats .about-grid{grid-template-columns:1.1fr 1fr}
@media (max-width:900px){.about-grid,.s-about.v-stats .about-grid{grid-template-columns:1fr}.about-img img{aspect-ratio:4/3}.about-img::after{display:none}}`,
  services: `
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:24px}
.svc{display:flex;flex-direction:column;transition:transform .25s,box-shadow .25s}
.svc:hover{transform:translateY(-4px);box-shadow:var(--sh-lg)}
.svc-img{aspect-ratio:4/3;overflow:hidden}
.svc-img img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.svc:hover .svc-img img{transform:scale(1.04)}
.card-body{padding:22px 24px 26px;display:flex;flex-direction:column;gap:8px;flex:1}
.card-body .desc{color:var(--c-muted);font-size:.96rem}
.card-body .price{margin-top:auto;padding-top:8px;font-weight:600;color:var(--c-primary-text)}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;counter-reset:tile}
.tile{position:relative;background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);box-shadow:var(--sh);padding:96px 26px 28px;display:flex;flex-direction:column;gap:8px;counter-increment:tile}
.tile::before{content:counter(tile,decimal-leading-zero);position:absolute;left:26px;top:28px;width:52px;height:52px;border-radius:var(--r-sm);background:var(--c-tint);color:var(--c-primary-text);display:grid;place-items:center;font-weight:700;font-family:var(--f-head)}
.tile[class*=" ic-"]::before{content:''}
.tile[class*=" ic-"]::after{content:'';position:absolute;left:40px;top:42px;width:24px;height:24px;background:var(--c-primary-text);-webkit-mask:var(--ic) center/contain no-repeat;mask:var(--ic) center/contain no-repeat}
.tile p{color:var(--c-muted)}
.menu-list{display:grid;grid-template-columns:1fr 1fr;gap:8px 56px}
.menu-item{display:flex;gap:18px;align-items:flex-start;padding:18px 0;border-bottom:1px solid var(--c-border)}
.menu-thumb{flex:none;width:76px;height:76px;border-radius:var(--r-sm);overflow:hidden}
.menu-thumb img{width:100%;height:100%;object-fit:cover}
.menu-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.menu-row{display:flex;align-items:baseline;gap:0}
.menu-row h3{font-size:1.12rem}
.menu-row::after{content:'';flex:1;order:1;border-bottom:2px dotted var(--c-border);margin:0 10px;min-width:24px;transform:translateY(-5px)}
.menu-row .menu-price{order:2;font-weight:600;color:var(--c-primary-text);white-space:nowrap}
.menu-desc{color:var(--c-muted);font-size:.94rem}
.menu-tag{display:inline-block;align-self:flex-start;font-size:.75rem;font-weight:600;letter-spacing:.04em;color:var(--c-primary-text);background:var(--c-tint);padding:2px 10px;border-radius:999px}
@media (max-width:900px){.tiles{grid-template-columns:1fr 1fr}.menu-list{grid-template-columns:1fr}}
@media (max-width:600px){.tiles{grid-template-columns:1fr}}`,
  pricing: `
.price-list{max-width:880px;margin-inline:auto;background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);box-shadow:var(--sh);padding:8px clamp(18px,3vw,36px)}
.price-list.two{max-width:none;display:grid;grid-template-columns:1fr 1fr;column-gap:56px}
.price-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 0;border-bottom:1px solid var(--c-border)}
.price-list:not(.two) .price-row:last-child,.price-list.two .price-row:nth-last-child(-n+2){border-bottom:0}
.price-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.price-main h3{font-size:1.08rem}
.price-main p{color:var(--c-muted);font-size:.93rem}
.price-val{font-family:var(--f-head);font-weight:var(--w-head);font-size:1.2rem;color:var(--c-primary-text);white-space:nowrap}
.price-note{text-align:center;color:var(--c-muted);font-size:.92rem;margin-top:24px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px;align-items:stretch}
.plan{position:relative;background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);box-shadow:var(--sh);padding:34px 28px 30px;display:flex;flex-direction:column;gap:12px}
.plan.featured{border:2px solid var(--c-primary);box-shadow:var(--sh-lg)}
.plan-badge{position:absolute;top:0;left:50%;transform:translate(-50%,-50%);background:var(--c-primary);color:var(--c-on-primary);font-size:.78rem;font-weight:600;letter-spacing:.04em;padding:5px 14px;border-radius:999px;white-space:nowrap}
.plan-meta{color:var(--c-muted);font-size:.93rem}
.plan-price{font-family:var(--f-head);font-weight:var(--w-head);font-size:2.2rem;line-height:1.1;color:var(--c-heading)}
.plan-feats{display:flex;flex-direction:column;gap:10px;padding:14px 0 6px;border-top:1px solid var(--c-border);flex:1}
.plan .wp-block-buttons{margin-top:8px}
.plan .wp-block-button,.plan .wp-block-button__link{width:100%}
@media (max-width:760px){.price-list.two{grid-template-columns:1fr}.price-list.two .price-row:nth-last-child(2){border-bottom:1px solid var(--c-border)}}`,
  offer: `
.offer-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:clamp(28px,5vw,64px);align-items:center}
.offer-copy,.offer-act{display:flex;flex-direction:column;gap:18px}
.offer-act{align-items:flex-start}
.offer-price{font-family:var(--f-head);font-size:clamp(1.8rem,1.4rem + 1.5vw,2.6rem);line-height:1.1}
.offer-price s{font-size:.55em;opacity:.75;margin-right:10px;font-family:var(--f-body)}
.offer-price strong{color:inherit}
.sec.dark .offer-price{color:var(--c-on-dark)}
.countdown{display:flex;flex-direction:column;gap:12px}
.cd-label{font-weight:600}
.cd-boxes{display:none;gap:10px}
.countdown.is-live .cd-boxes{display:flex}
.cd-box{min-width:72px;padding:12px 8px;border-radius:var(--r-sm);text-align:center;background:var(--c-tint);color:var(--c-heading);display:flex;flex-direction:column;gap:4px}
.cd-box b{font-family:var(--f-head);font-size:1.9rem;line-height:1;font-variant-numeric:tabular-nums}
.cd-box small{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--c-muted)}
.sec.dark .cd-box{background:color-mix(in srgb,var(--c-on-dark) 10%,transparent);color:var(--c-on-dark)}
.sec.dark .cd-box small{color:var(--c-on-dark-muted)}
.offer-card{max-width:760px;margin-inline:auto;text-align:center;background:var(--c-surface);border:2px solid var(--c-primary);border-radius:var(--r);box-shadow:var(--sh-lg);padding:clamp(28px,5vw,56px);display:flex;flex-direction:column;gap:18px;align-items:center}
.offer-card .countdown{align-items:center}
.offer-card .offer-note{font-size:.9rem;color:var(--c-muted)}
@media (max-width:860px){.offer-grid{grid-template-columns:1fr}}
@media (max-width:420px){.cd-box{min-width:0;flex:1}}`,
  testimonials: `
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:24px}
.quote{position:relative;background:var(--c-surface);border:var(--card-bd);border-radius:var(--r);box-shadow:var(--sh);padding:30px 28px 26px;display:flex;flex-direction:column;gap:18px}
.quote::before{content:'★★★★★';content:'★★★★★' / '';color:var(--c-accent);letter-spacing:3px;font-size:1rem;line-height:1}
.quote.r4::before{content:'★★★★☆';content:'★★★★☆' / ''}
.quote.r3::before{content:'★★★☆☆';content:'★★★☆☆' / ''}
.quote.r2::before{content:'★★☆☆☆';content:'★★☆☆☆' / ''}
.quote.r1::before{content:'★☆☆☆☆';content:'★☆☆☆☆' / ''}
.quote-text{color:var(--c-text);flex:1}
.quote-by{display:flex;align-items:center;gap:14px}
.quote-who{display:flex;flex-direction:column;line-height:1.35}
.quote-name{font-weight:600;color:var(--c-heading)}
.quote-meta{font-size:.88rem;color:var(--c-muted)}
.spot{max-width:900px;margin:0 auto clamp(36px,5vw,56px);text-align:center;display:flex;flex-direction:column;gap:22px;align-items:center}
.spot::before{content:'★★★★★';content:'★★★★★' / '';color:var(--c-accent);letter-spacing:4px;font-size:1.15rem}
.spot-text{font-family:var(--f-head);font-size:clamp(1.35rem,1.1rem + 1.1vw,2rem);line-height:1.45;color:var(--c-heading);letter-spacing:var(--t-head)}
.spot .quote-by{justify-content:center}
.spot .quote-who{text-align:left}`,
  gallery: `
.gal{display:grid;gap:14px}
.gal figure{overflow:hidden;border-radius:var(--r-img);position:relative}
.gal img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.gal figure:hover img{transform:scale(1.04)}
.gal figcaption{position:absolute;left:12px;bottom:12px;margin:0;background:color-mix(in srgb,var(--c-dark) 78%,transparent);color:var(--c-on-dark);font-size:.82rem;padding:4px 12px;border-radius:999px}
.g-grid{grid-template-columns:repeat(4,1fr);grid-auto-rows:220px}
.g-grid figure:first-child{grid-column:span 2;grid-row:span 2}
.g-masonry{display:block;columns:3 260px;column-gap:14px}
.g-masonry figure{break-inside:avoid;margin-bottom:14px}
.g-masonry figure:nth-child(3n+1) img{aspect-ratio:3/4}
.g-masonry figure:nth-child(3n+2) img{aspect-ratio:1/1}
.g-masonry figure:nth-child(3n) img{aspect-ratio:4/3}
.g-strip{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:16px;padding-bottom:12px;scrollbar-width:thin}
.g-strip figure{flex:0 0 min(78vw,320px);scroll-snap-align:start}
.g-strip img{aspect-ratio:4/5}
@media (max-width:860px){.g-grid{grid-template-columns:repeat(2,1fr);grid-auto-rows:180px}}`,
  team: `
.team{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:22px}
.member{display:flex;flex-direction:column}
.member-img{aspect-ratio:4/5;overflow:hidden}
.member-img img{width:100%;height:100%;object-fit:cover}
.member .avatar{width:100%;height:auto;aspect-ratio:4/5;border-radius:0;font-size:3rem;font-family:var(--f-head)}
.member-body{padding:20px 22px 24px;display:flex;flex-direction:column;gap:4px}
.member-role{color:var(--c-primary-text);font-weight:600;font-size:.92rem}
.member-bio{color:var(--c-muted);font-size:.94rem;margin-top:6px}
.s-team.v-round .member{background:transparent;border:0;box-shadow:none;text-align:center;align-items:center}
.s-team.v-round .member-img,.s-team.v-round .member .avatar{width:170px;height:170px;aspect-ratio:1;border-radius:50%;box-shadow:var(--sh);border:4px solid var(--c-surface)}
.s-team.v-round .member-body{align-items:center}`,
  faq: `
.faq{max-width:840px;margin-inline:auto;display:flex;flex-direction:column}
.faq details{border-bottom:1px solid var(--c-border);padding:0}
.faq details:first-child{border-top:1px solid var(--c-border)}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 0;font-family:var(--f-head);font-weight:var(--w-head);font-size:1.1rem;color:var(--c-heading)}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';flex:none;width:34px;height:34px;border-radius:50%;background:var(--c-tint);color:var(--c-primary-text);display:grid;place-items:center;font-family:var(--f-body);font-size:1.3rem;font-weight:400;transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details > p{padding:0 0 22px;color:var(--c-muted);max-width:70ch}
.faq-split{display:grid;grid-template-columns:.85fr 1.15fr;gap:clamp(32px,6vw,80px);align-items:start}
.faq-split .faq{margin:0;max-width:none}
.faq-intro{display:flex;flex-direction:column;gap:18px;align-items:flex-start;position:sticky;top:96px}
@media (max-width:860px){.faq-split{grid-template-columns:1fr}.faq-intro{position:static}}`,
  contact: `
.contact-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:clamp(32px,6vw,80px);align-items:start}
.contact-info{display:flex;flex-direction:column;gap:20px}
.ci-list{display:flex;flex-direction:column;gap:18px;margin-top:8px}
.contact-solo{max-width:680px;margin-inline:auto}
@media (max-width:900px){.contact-grid{grid-template-columns:1fr}}`,
  map: `
.map-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);gap:24px;align-items:stretch}
.map-info{padding:clamp(24px,4vw,40px);display:flex;flex-direction:column;gap:20px}
.hours{display:grid;grid-template-columns:auto 1fr;gap:10px 24px;padding:18px 0;border-top:1px solid var(--c-border);border-bottom:1px solid var(--c-border)}
.hours .h-l{color:var(--c-muted)}
.hours .h-v{font-weight:600;color:var(--c-heading);text-align:right}
.map-frame{border-radius:var(--r);overflow:hidden;min-height:380px;background:var(--c-bg-alt);border:var(--card-bd)}
.map-frame iframe{display:block;width:100%;height:100%;min-height:380px;border:0}
.map-ph{height:100%;min-height:380px;display:grid;place-items:center;text-align:center;padding:24px;color:var(--c-muted);background:repeating-linear-gradient(45deg,var(--c-bg-alt),var(--c-bg-alt) 14px,var(--c-tint) 14px,var(--c-tint) 28px)}
.map-card{max-width:720px;margin-inline:auto}
@media (max-width:860px){.map-grid{grid-template-columns:1fr}}`,
  footer: `
.site-foot{background:var(--c-dark);color:var(--c-on-dark-muted);padding:clamp(56px,7vw,80px) 0 28px;font-size:.95rem}
.site-foot a{color:var(--c-on-dark-muted);text-decoration:none}
.site-foot a:hover{color:var(--c-on-dark)}
.site-foot h3{color:var(--c-on-dark);font-size:1rem;font-family:var(--f-body);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.foot-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:40px}
.foot-col{display:flex;flex-direction:column;gap:10px}
.foot-name{font-family:var(--f-head);font-weight:var(--w-head);font-size:1.5rem;color:var(--c-on-dark);letter-spacing:var(--t-head);line-height:1.2}
.foot-copy{border-top:1px solid color-mix(in srgb,var(--c-on-dark) 14%,transparent);margin-top:44px;padding-top:24px;text-align:center;font-size:.86rem}
.site-foot.v-simple .foot-simple{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
.foot-links{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 22px}
@media (max-width:900px){.foot-grid{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.foot-grid{grid-template-columns:1fr}}`,
};

/** WordPress adapter: neutralise core defaults that would fight the design. */
const WORDPRESS = `
.wp-site-blocks{padding:0}
.wp-site-blocks > *{margin-block:0}
.wp-site-blocks > main{margin:0}
.lp main .wp-block-group,.lp .site-foot .wp-block-group{margin-block:0}
.wp-block-image{margin:0}
.wp-block-image img{box-sizing:border-box}
.wp-block-details summary{cursor:pointer}
/* No display here: core hides the toggle from 600px with a rule of equal specificity that loads first. */
.site-head .wp-block-navigation__responsive-container-open{width:44px;height:44px;border:1px solid var(--c-border);border-radius:var(--r-sm);place-items:center;color:var(--c-heading)}
@media (max-width:599.98px){.site-head .wp-block-navigation__responsive-container-open:not(.always-shown){display:grid}}
.site-head .wp-block-navigation__responsive-container.is-menu-open{background:var(--c-bg);padding:24px}
.site-head .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation-item__content{font-size:1.15rem;padding:10px 0}
@media (max-width:599.98px){.site-head .head-cta{display:none}}
.content-area{max-width:820px;margin:0 auto;padding:56px 20px 88px;display:flex;flex-direction:column;gap:20px}
.content-area .wp-block-post-title{font-size:clamp(1.8rem,1.3rem + 2vw,2.6rem)}
.content-area .wp-block-post-featured-image{border-radius:var(--r-img);overflow:hidden;margin:0}
.content-area .wp-block-post-content{display:flex;flex-direction:column;gap:1.1em}
.content-area .wp-block-post-date,.content-area .wp-block-post-terms{color:var(--c-muted);font-size:.9rem}
.archive{padding-block:56px 88px;display:flex;flex-direction:column;gap:32px}
.post-grid .wp-block-post-template{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px;list-style:none;margin:0;padding:0}
.post-grid .wp-block-post-template > li{margin:0}
.post-grid .card{height:100%;display:flex;flex-direction:column}
.post-grid .wp-block-post-featured-image{margin:0;aspect-ratio:16/10;overflow:hidden}
.post-grid .wp-block-post-featured-image img{width:100%;height:100%;object-fit:cover}
.post-grid .wp-block-post-title{font-size:1.15rem}
.post-grid .wp-block-post-title a{color:var(--c-heading);text-decoration:none}
.post-grid .wp-block-post-excerpt{color:var(--c-muted);font-size:.95rem}
.wp-block-query-pagination{justify-content:center;gap:10px}
`;

export interface CssOptions {
  palette: SitePalette;
  style: BuilderStyle;
  sections: SectionType[];
  icons: Set<string>;
  fontUrl: (file: string) => string;
  wordpress?: boolean;
  floating?: boolean;
}

/** The whole stylesheet of a generated site, limited to the sections it uses. */
export function siteCss(o: CssOptions): string {
  const t = STYLE_TOKENS[o.style];
  const parts = [
    fontFaceCss(t.fonts, o.fontUrl),
    tokensCss(o.palette, o.style),
    BASE,
    HEADER,
    iconCss(o.icons),
    o.sections.includes('contact') ? FORM : '',
    o.floating ? FLOATING : '',
    ...o.sections.map((s) => SECTIONS[s]),
    o.wordpress ? WORDPRESS : '',
  ];
  return parts
    .filter(Boolean)
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
