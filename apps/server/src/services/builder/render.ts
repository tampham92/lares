/**
 * Assembles a builder spec into a full static page or into the parts of a WordPress block theme.
 * Output still contains {{SITE_NAME}}-style placeholders: templates.fill() replaces them with the
 * branding values (escaped), exactly like hand-written templates.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { makePalette, type BuilderSection, type BuilderSpec, type SectionType } from '@lares/shared';
import { config } from '../../config.js';
import { buttons, esc, group, html, image, para, stripBlocks } from './blocks.js';
import { siteCss, STYLE_TOKENS } from './css.js';
import { anchorOf, ctaHref, ctaLabel, footer, navOf, renderSection, str, type Ctx, type Strings } from './sections.js';

/** Where an asset is referenced from: bundled font, template image, or the uploaded logo. */
export type AssetRef = { kind: 'font'; file: string } | { kind: 'image'; tpl: string; file: string } | { kind: 'logo'; ext: string };

export interface RenderOptions {
  mode: 'static' | 'wordpress';
  assetUrl: (ref: AssetRef) => string;
  /** Panel preview: map placeholder instead of the Google embed + the live-update bridge. */
  preview?: boolean;
}

export interface RenderedSite {
  css: string;
  js: string;
  /** Static: the whole page. */
  page: string;
  /** WordPress: home page content, header and footer template parts. */
  home: string;
  header: string;
  footer: string;
  images: Array<{ tpl: string; file: string }>;
  fonts: string[];
  logo: { ext: string; data: Buffer } | null;
}

let stringsCache: { file: string; data: Record<string, Strings> } | null = null;

export async function loadStrings(lang: 'vi' | 'en'): Promise<Strings> {
  const file = path.join(config.templatesDir, '_builder', 'strings.json');
  if (stringsCache?.file !== file) stringsCache = { file, data: JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, Strings> };
  return stringsCache.data[lang] ?? stringsCache.data.vi!;
}

const LOGO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function decodeLogo(dataUrl: string | undefined): { ext: string; data: Buffer } | null {
  const m = dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  return m ? { ext: LOGO_EXT[m[1]!]!, data: Buffer.from(m[2]!, 'base64') } : null;
}

/** Tiny vanilla script: mobile menu, countdown, progressive-enhancement lead forms. No top-level let/const (the preview re-runs it in the same global). */
export const SITE_JS = `(function(){
var d=document;
var t=d.querySelector('.menu-toggle'),m=d.getElementById('menu');
if(t&&m){t.addEventListener('click',function(){var o=m.classList.toggle('open');t.setAttribute('aria-expanded',o?'true':'false')});
m.addEventListener('click',function(e){if(e.target.tagName==='A'){m.classList.remove('open');t.setAttribute('aria-expanded','false')}})}
function pad(n){return(n<10?'0':'')+n}
[].forEach.call(d.querySelectorAll('[data-countdown]'),function(el){
var spec=el.getAttribute('data-countdown'),lab=el.querySelector('.cd-label');
function target(){if(spec==='daily'){var n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate()+1).getTime()}return Date.parse(spec)}
var end=target();if(isNaN(end))return;
function set(k,v){var b=el.querySelector('[data-cd="'+k+'"]');if(b)b.textContent=pad(v)}
function tick(){var left=end-Date.now();
if(left<=0){if(spec==='daily'){end=target();left=end-Date.now()}else{el.classList.remove('is-live');if(lab)lab.textContent=lab.getAttribute('data-ended')||'';return}}
var s=Math.floor(left/1000);set('d',Math.floor(s/86400));set('h',Math.floor(s%86400/3600));set('m',Math.floor(s%3600/60));set('s',s%60);setTimeout(tick,1000)}
if(lab&&lab.getAttribute('data-live'))lab.textContent=lab.getAttribute('data-live');
el.classList.add('is-live');tick()});
[].forEach.call(d.querySelectorAll('form[data-lares-form]'),function(f){
var page=f.querySelector('input[name="page"]');if(page)page.value=location.pathname;
var ok=f.querySelector('.lares-msg.ok'),err=f.querySelector('.lares-msg.err'),msg=err&&err.querySelector('[data-msg]'),def=msg?msg.textContent:'',btn=f.querySelector('button[type="submit"]'),label=btn?btn.textContent:'';
function show(el){el.classList.add('show');if(el.focus)el.focus()}
f.addEventListener('submit',function(e){
if(!window.fetch||!window.URLSearchParams||!window.FormData)return;
e.preventDefault();ok.classList.remove('show');err.classList.remove('show');if(msg)msg.textContent=def;
btn.disabled=true;btn.textContent=btn.getAttribute('data-sending')||label;
fetch(f.action,{method:'POST',credentials:'same-origin',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(f)).toString()})
.then(function(r){return r.json().catch(function(){return{ok:false}})})
.then(function(j){if(j&&j.ok){f.reset();if(page)page.value=location.pathname;show(ok)}else{if(j&&j.error&&msg)msg.textContent=j.error;show(err)}})
.catch(function(){show(err)})
.then(function(){btn.disabled=false;btn.textContent=label})})});
})();`;

/** Receives re-rendered pages from the panel and swaps them in place, keeping the scroll position. */
export const PREVIEW_BRIDGE = `(function(){var y=window.__laresY||0;window.__laresY=0;if(y){window.scrollTo(0,y);addEventListener('load',function(){window.scrollTo(0,y)})}
addEventListener('message',function(e){if(e.source!==window.parent||!e.data||e.data.type!=='lares-preview')return;window.__laresY=window.scrollY;document.open();document.write(e.data.html);document.close()})})();`;

function navItems(ctx: Ctx, sections: BuilderSection[]): Array<{ label: string; href: string }> {
  return sections
    .filter((s) => !['hero', 'footer', 'contact', 'offer'].includes(s.type))
    .map((s) => ({ label: navOf(ctx, s), href: `${ctx.hash}${anchorOf(ctx, s)}` }))
    .filter((n) => n.label)
    .slice(0, 5);
}

const imgRe = /^tpl:([a-z0-9-]+)\/(.+)$/;

export async function renderSite(spec: BuilderSpec, opts: RenderOptions): Promise<RenderedSite> {
  const s = await loadStrings(spec.lang);
  const images = new Map<string, { tpl: string; file: string }>();
  const ctx: Ctx = {
    spec,
    s,
    hash: opts.mode === 'wordpress' ? '/#' : '#',
    preview: !!opts.preview,
    icons: new Set(),
    img: (ref) => {
      const m = ref.match(imgRe);
      if (!m) return esc(ref);
      images.set(ref, { tpl: m[1]!, file: m[2]! });
      return esc(opts.assetUrl({ kind: 'image', tpl: m[1]!, file: m[2]! }));
    },
  };
  const on = spec.sections.filter((x) => x.enabled);
  const body = on.filter((x) => x.type !== 'footer');
  const foot = on.find((x) => x.type === 'footer') ?? ({ type: 'footer', variant: 'columns', enabled: true, content: {} } as BuilderSection);
  const nav = navItems(ctx, body);
  const sectionsHtml = body.map((sec) => renderSection(ctx, sec));
  const footerBlocks = footer(ctx, foot, nav);
  const logo = decodeLogo(spec.business.logo);
  const logoUrl = logo ? esc(opts.assetUrl({ kind: 'logo', ext: logo.ext })) : '';
  if (spec.floatingContact) ctx.icons.add('phone');

  const floating = spec.floatingContact
    ? `<div class="fab-stack"><a class="fab fab-zalo" href="{{ZALO_LINK}}" target="_blank" rel="noreferrer noopener" aria-label="${esc(str(ctx, 'zalo'))}">Zalo</a>` +
      `<a class="fab fab-call ic-phone" href="tel:{{PHONE_LINK}}" aria-label="${esc(str(ctx, 'call'))}"></a></div>`
    : '';

  const types = [...new Set([...body.map((x) => x.type), 'footer'])] as SectionType[];
  const palette = makePalette(spec.style.color, spec.style.preset);
  const fonts = STYLE_TOKENS[spec.style.preset].fonts.map((f) => f.file);
  const css = siteCss({
    palette,
    style: spec.style.preset,
    sections: types,
    icons: ctx.icons,
    fontUrl: (file) => opts.assetUrl({ kind: 'font', file }),
    wordpress: opts.mode === 'wordpress',
    floating: spec.floatingContact,
  });

  // --- WordPress parts -------------------------------------------------------
  const brandBlocks = group(
    { className: 'brand' },
    logo ? image({ src: logoUrl, alt: '{{SITE_NAME}}', className: 'logo-img' }) : '',
    '<!-- wp:site-title {"level":0} /-->',
  );
  const navLinks = nav.map((n) => `<!-- wp:navigation-link ${JSON.stringify({ label: n.label, url: n.href, kind: 'custom', isTopLevelLink: true }).replace(/--/g, '\\u002d\\u002d')} /-->`).join('\n');
  const header = group(
    { className: 'site-head' },
    group(
      { className: 'wrap head-in' },
      brandBlocks,
      nav.length ? `<!-- wp:navigation {"overlayMenu":"mobile","layout":{"type":"flex","justifyContent":"right"}} -->\n${navLinks}\n<!-- /wp:navigation -->` : '',
      buttons([{ label: esc(ctaLabel(ctx)), href: ctaHref(ctx), className: 'btn-primary' }], 'head-cta'),
    ),
  );
  const footerPart = [footerBlocks, floating ? html(floating) : ''].filter(Boolean).join('\n\n');

  // --- Static page -----------------------------------------------------------
  const staticSections = sectionsHtml.map((h, i) => {
    const out = stripBlocks(h);
    return i === 0 ? out.replace('<img ', '<img fetchpriority="high" ') : out.replace(/<img /g, '<img loading="lazy" decoding="async" ');
  });
  const menu = nav.map((n) => `<a href="${n.href}">${esc(n.label)}</a>`).join('');
  const staticHeader =
    `<header class="site-head"><div class="wrap head-in">` +
    `<a class="brand" href="#main">${logo ? `<img class="brand-logo" src="${logoUrl}" alt="">` : ''}<span class="brand-name">{{SITE_NAME}}</span></a>` +
    (nav.length ? `<nav class="menu" id="menu" aria-label="${esc(str(ctx, 'mainNav'))}">${menu}</nav>` : '') +
    `<div class="head-cta"><a class="head-phone" href="tel:{{PHONE_LINK}}">{{PHONE}}</a><a class="btn-head" href="${ctaHref(ctx)}">${esc(ctaLabel(ctx))}</a></div>` +
    (nav.length ? `<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu"><span class="sr-only">${esc(str(ctx, 'openMenu'))}</span><span class="bars" aria-hidden="true"></span></button>` : '') +
    `</div></header>`;
  const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${palette.primary}'/></svg>`)}`;
  const page = [
    '<!doctype html>',
    `<html lang="${spec.lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>{{SITE_NAME}} – {{TAGLINE}}</title>',
    '<meta name="description" content="{{TAGLINE}}">',
    `<meta name="theme-color" content="${palette.primary}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="{{SITE_NAME}}">',
    '<meta property="og:description" content="{{TAGLINE}}">',
    `<link rel="icon" href="${logo ? logoUrl : esc(favicon)}">`,
    `<style>\n${css}\n</style>`,
    '</head>',
    `<body class="lp static style-${spec.style.preset}">`,
    `<a class="skip" href="#main">${esc(str(ctx, 'skip'))}</a>`,
    staticHeader,
    `<main id="main">\n${staticSections.join('\n')}\n</main>`,
    `<footer>\n${stripBlocks(footerBlocks)}\n</footer>`,
    floating,
    `<script>\n${SITE_JS}\n</script>`,
    opts.preview ? `<script>${PREVIEW_BRIDGE}</script>` : '',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    css,
    js: SITE_JS,
    page,
    home: sectionsHtml.join('\n\n'),
    header,
    footer: footerPart,
    images: [...images.values()],
    fonts,
    logo,
  };
}

/** Templates of the block theme (front page, archive, single post, page). */
export function themeTemplates(s: Strings): Record<string, string> {
  const HEADER = '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->';
  const FOOTER = '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->';
  const readMore = typeof s.readMore === 'string' ? s.readMore : '';
  const noResults = typeof s.noResults === 'string' ? s.noResults : '';
  const card = `<!-- wp:group {"className":"card","layout":{"type":"default"}} -->
<div class="wp-block-group card"><!-- wp:post-featured-image {"isLink":true} /-->

<!-- wp:group {"className":"card-body","layout":{"type":"default"}} -->
<div class="wp-block-group card-body"><!-- wp:post-title {"level":3,"isLink":true} /-->

<!-- wp:post-excerpt ${JSON.stringify({ moreText: readMore, excerptLength: 26 })} /--></div>
<!-- /wp:group --></div>
<!-- /wp:group -->`;
  const single = (inner: string) => `${HEADER}

<!-- wp:group {"tagName":"main","className":"content-area","layout":{"type":"default"}} -->
<main class="wp-block-group content-area">${inner}</main>
<!-- /wp:group -->

${FOOTER}`;
  return {
    'front-page.html': `${HEADER}

<!-- wp:group {"tagName":"main","layout":{"type":"default"}} -->
<main class="wp-block-group"><!-- wp:post-content {"layout":{"type":"default"}} /--></main>
<!-- /wp:group -->

${FOOTER}`,
    'index.html': `${HEADER}

<!-- wp:group {"tagName":"main","className":"wrap archive","layout":{"type":"default"}} -->
<main class="wp-block-group wrap archive"><!-- wp:query-title {"type":"archive","showPrefix":false} /-->

<!-- wp:query {"queryId":0,"query":{"inherit":true},"className":"post-grid"} -->
<div class="wp-block-query post-grid"><!-- wp:post-template -->
${card}
<!-- /wp:post-template -->

<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->

<!-- wp:query-pagination-numbers /-->

<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination -->

<!-- wp:query-no-results -->
${para(esc(noResults))}
<!-- /wp:query-no-results --></div>
<!-- /wp:query --></main>
<!-- /wp:group -->

${FOOTER}`,
    'single.html': single(`<!-- wp:post-terms {"term":"category"} /-->

<!-- wp:post-title {"level":1} /-->

<!-- wp:post-date /-->

<!-- wp:post-featured-image /-->

<!-- wp:post-content {"layout":{"type":"default"}} /-->`),
    'page.html': single(`<!-- wp:post-title {"level":1} /-->

<!-- wp:post-content {"layout":{"type":"default"}} /-->`),
  };
}

