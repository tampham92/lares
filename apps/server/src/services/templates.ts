import fs from 'node:fs/promises';
import path from 'node:path';
import type { Branding, TemplateInfo } from '@lares/shared';
import { config } from '../config.js';
import { t } from '../i18n/index.js';
import { randomSuffix } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';
import { wpCli } from './wordpress.js';

interface NavLink {
  label: string;
  url: string;
}

interface TemplateManifest extends TemplateInfo {
  font: string;
  wordpress?: {
    nav: NavLink[];
    categories: Array<{ slug: string; name: string }>;
    posts: Array<{ title: string; category: string; tags?: string[]; image?: string; excerpt: string; content: string }>;
    /** contactForm: append the theme's contact form (wordpress/contact-form.html) to the page. */
    pages: Array<{ title: string; slug: string; content: string; contactForm?: boolean }>;
  };
}

const ID_RE = /^[a-z0-9-]{1,40}$/;
const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Custom templates (survive upgrades) win over built-in ones with the same id. */
const templateDirs = () => [config.customTemplatesDir, config.templatesDir];

async function dir(id: string): Promise<string> {
  for (const base of templateDirs()) {
    const d = path.join(base, id);
    if (await exists(path.join(d, 'template.json'))) {
      return d;
    }
  }
  throw notFound(t('Template "{id}" không tồn tại', { id }));
}

export async function getTemplate(id: string): Promise<TemplateManifest> {
  if (!ID_RE.test(id)) throw notFound(t('Template không tồn tại'));
  const d = await dir(id);
  try {
    const t = JSON.parse(await fs.readFile(path.join(d, 'template.json'), 'utf8')) as TemplateManifest;
    return { ...t, id, custom: d.startsWith(config.customTemplatesDir) };
  } catch (err) {
    throw notFound(t('template.json của "{id}" không hợp lệ: {error}', { id, error: err instanceof Error ? err.message : String(err) }));
  }
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const ids = new Set<string>();
  for (const base of templateDirs()) {
    for (const e of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && !e.name.startsWith('_') && ID_RE.test(e.name)) ids.add(e.name);
    }
  }
  const out: TemplateInfo[] = [];
  for (const id of ids) {
    const t = await getTemplate(id).catch(() => null);
    if (!t) continue;
    out.push({ id: t.id, name: t.name, description: t.description, types: t.types, colors: t.colors, previewImage: t.previewImage ?? null, defaults: t.defaults, custom: t.custom });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

export type TemplateVars = Record<string, string>;

export function templateVars(t: TemplateInfo, branding: Branding): TemplateVars {
  const pick = <K extends keyof TemplateInfo['defaults']>(k: K) => (branding[k] || t.defaults[k]).trim();
  const phone = pick('phone');
  return {
    SITE_NAME: pick('siteName'),
    TAGLINE: pick('tagline'),
    PHONE: phone,
    PHONE_LINK: phone.replace(/[^0-9+]/g, ''),
    EMAIL: pick('email'),
    ADDRESS: pick('address'),
    YEAR: String(new Date().getFullYear()),
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Replace {{KEY}} with HTML-escaped values; unknown keys are left untouched. */
export function fill(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => (key in vars ? escapeHtml(vars[key]!) : m));
}

async function readCss(id: string, forWordpress: boolean): Promise<string> {
  // the shared design system always comes from the built-in folder
  const parts = [path.join(config.templatesDir, '_base.css'), path.join(await dir(id), 'style.css')];
  if (forWordpress) parts.push(path.join(config.templatesDir, '_wp.css'));
  return (await Promise.all(parts.map((p) => fs.readFile(p, 'utf8')))).join('\n');
}

// ---- Lead capture: shared form script + WordPress contact form part ----
/** templates/_lead.js: sends form[data-lares-lead] to /_lares/lead without a reload ({{LEAD_JS}} in index.html). */
const readLeadJs = () => fs.readFile(path.join(config.templatesDir, '_lead.js'), 'utf8').catch(() => '');
const contactFormFile = async (id: string) => path.join(await dir(id), 'wordpress', 'contact-form.html');
/** Block that renders the theme's contact-form part inside a page (theme attribute: post content gets none injected). */
export const contactFormBlock = (themeSlug: string) => `<!-- wp:template-part ${attrs({ slug: 'contact-form', theme: themeSlug })} /-->`;

// ---------------------------------------------------------------------------
// Static HTML
// ---------------------------------------------------------------------------

export async function renderStaticPage(id: string, vars: TemplateVars): Promise<string> {
  const html = await fs.readFile(path.join(await dir(id), 'index.html'), 'utf8');
  const css = await readCss(id, false);
  const leadJs = await readLeadJs();
  return fill(html, vars).replace('{{CSS}}', () => css).replace('{{LEAD_JS}}', () => leadJs);
}

export async function installStaticTemplate(id: string, webRoot: string, vars: TemplateVars, log: HostLogger) {
  await host.writeFile(path.join(webRoot, 'index.html'), await renderStaticPage(id, vars));
  log(t('Đã áp dụng giao diện "{id}"', { id }));
}

// ---------------------------------------------------------------------------
// WordPress block theme + demo content
// ---------------------------------------------------------------------------

/** Tiny markdown subset (blank-line paragraphs, line breaks, **bold**) -> paragraph blocks. */
export function textToBlocks(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((par) => {
      const inner = par
        .split('\n')
        .map((l) => escapeHtml(l).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'))
        .join('<br>');
      return `<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->`;
    })
    .join('\n\n');
}

/** Theme text written into the customer's WordPress site: Vietnamese, like the templates' demo content (not panel UI). */
const THEME_TEXT = {
  home: 'Trang chủ', // i18n-ignore
  contact: 'Liên hệ', // i18n-ignore
  links: 'Liên kết', // i18n-ignore
  rights: 'Bảo lưu mọi quyền.', // i18n-ignore
  readMore: 'Xem chi tiết →', // i18n-ignore
  noResults: 'Chưa có nội dung phù hợp.', // i18n-ignore
};

const attrs = (o: Record<string, unknown>) => JSON.stringify(o).replace(/--/g, '\\u002d\\u002d');

function headerPart(nav: NavLink[]): string {
  const links = nav.map((n) => `<!-- wp:navigation-link ${attrs({ label: n.label, url: n.url, kind: 'custom', isTopLevelLink: true })} /-->`).join('\n');
  return `<!-- wp:group {"className":"site-header","layout":{"type":"default"}} -->
<div class="wp-block-group site-header"><!-- wp:group {"className":"container nav","layout":{"type":"flex","flexWrap":"nowrap"}} -->
<div class="wp-block-group container nav"><!-- wp:site-title {"className":"logo"} /-->

<!-- wp:navigation {"className":"wp-menu","overlayMenu":"mobile","layout":{"type":"flex","justifyContent":"right"}} -->
${links}
<!-- /wp:navigation -->

<!-- wp:buttons {"className":"nav-cta"} -->
<div class="wp-block-buttons nav-cta"><!-- wp:button {"className":"btn-accent"} -->
<div class="wp-block-button btn-accent"><a class="wp-block-button__link wp-element-button" href="tel:{{PHONE_LINK}}">{{PHONE}}</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->`;
}

function footerPart(nav: NavLink[]): string {
  const links = nav
    .map((n) => `<!-- wp:paragraph -->\n<p><a href="${escapeHtml(n.url)}">${escapeHtml(n.label)}</a></p>\n<!-- /wp:paragraph -->`)
    .join('\n\n');
  return `<!-- wp:group {"className":"site-footer","layout":{"type":"default"}} -->
<div class="wp-block-group site-footer"><!-- wp:group {"className":"container","layout":{"type":"default"}} -->
<div class="wp-block-group container"><!-- wp:columns {"className":"footer-grid"} -->
<div class="wp-block-columns footer-grid"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:site-title {"className":"logo"} /-->

<!-- wp:paragraph -->
<p>{{TAGLINE}}</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">${THEME_TEXT.contact}</h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>{{ADDRESS}}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><a href="tel:{{PHONE_LINK}}">{{PHONE}}</a></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><a href="mailto:{{EMAIL}}">{{EMAIL}}</a></p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">${THEME_TEXT.links}</h4>
<!-- /wp:heading -->

${links}</div>
<!-- /wp:column --></div>
<!-- /wp:columns -->

<!-- wp:paragraph {"className":"copyright"} -->
<p class="copyright">© {{YEAR}} {{SITE_NAME}}. ${THEME_TEXT.rights}</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->`;
}

const HEADER = '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->';
const FOOTER = '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->';
const CARD = `<!-- wp:group {"className":"card","layout":{"type":"default"}} -->
<div class="wp-block-group card"><!-- wp:post-terms {"term":"post_tag","className":"badge"} /-->

<!-- wp:post-featured-image {"isLink":true} /-->

<!-- wp:group {"className":"card-body","layout":{"type":"default"}} -->
<div class="wp-block-group card-body"><!-- wp:post-title {"level":3,"isLink":true} /-->

<!-- wp:post-excerpt {"moreText":"${THEME_TEXT.readMore}","excerptLength":30} /--></div>
<!-- /wp:group --></div>
<!-- /wp:group -->`;

const THEME_TEMPLATES: Record<string, string> = {
  'front-page.html': `${HEADER}

<!-- wp:group {"tagName":"main","layout":{"type":"default"}} -->
<main class="wp-block-group"><!-- wp:post-content {"className":"front-content","layout":{"type":"default"}} /--></main>
<!-- /wp:group -->

${FOOTER}`,
  'index.html': `${HEADER}

<!-- wp:group {"tagName":"main","className":"container","layout":{"type":"default"}} -->
<main class="wp-block-group container"><!-- wp:group {"className":"archive-head","layout":{"type":"default"}} -->
<div class="wp-block-group archive-head"><!-- wp:query-title {"type":"archive","showPrefix":false} /-->

<!-- wp:query-title {"type":"search"} /--></div>
<!-- /wp:group -->

<!-- wp:group {"className":"section","layout":{"type":"default"}} -->
<div class="wp-block-group section"><!-- wp:query {"queryId":0,"query":{"inherit":true},"className":"post-grid"} -->
<div class="wp-block-query post-grid"><!-- wp:post-template -->
${CARD}
<!-- /wp:post-template -->

<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->

<!-- wp:query-pagination-numbers /-->

<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination -->

<!-- wp:query-no-results -->
<!-- wp:paragraph -->
<p>${THEME_TEXT.noResults}</p>
<!-- /wp:paragraph -->
<!-- /wp:query-no-results --></div>
<!-- /wp:query --></div>
<!-- /wp:group --></main>
<!-- /wp:group -->

${FOOTER}`,
  'single.html': `${HEADER}

<!-- wp:group {"tagName":"main","className":"content-area","layout":{"type":"default"}} -->
<main class="wp-block-group content-area"><!-- wp:post-terms {"term":"category"} /-->

<!-- wp:post-title {"level":1} /-->

<!-- wp:post-date /-->

<!-- wp:post-featured-image /-->

<!-- wp:post-content {"layout":{"type":"default"}} /--></main>
<!-- /wp:group -->

${FOOTER}`,
  'page.html': `${HEADER}

<!-- wp:group {"tagName":"main","className":"content-area","layout":{"type":"default"}} -->
<main class="wp-block-group content-area"><!-- wp:post-title {"level":1} /-->

<!-- wp:post-content {"layout":{"type":"default"}} /--></main>
<!-- /wp:group -->

${FOOTER}`,
};

/** Write the block theme into wp-content/themes. Pure file generation (testable without WordPress). */
export async function writeWordpressTheme(t: TemplateManifest, webRoot: string, vars: TemplateVars): Promise<string> {
  const slug = `lares-${t.id}`;
  const themeDir = path.join(webRoot, 'wp-content', 'themes', slug);
  const nav = t.wordpress?.nav ?? [{ label: THEME_TEXT.home, url: '/' }];
  const header = `/*
Theme Name: Lares ${t.name}
Author: Lares
Description: ${t.description.replace(/\*\//g, '')}
Version: 1.0.0
Requires at least: 6.4
Text Domain: ${slug}
*/
`;
  const font = t.font.replace(/'/g, '');
  const contactForm = await fs.readFile(await contactFormFile(t.id), 'utf8').catch(() => null);
  const files: Record<string, string> = {
    'style.css': header + (await readCss(t.id, true)) + '\n.front-content > *{margin-block:0!important}\n.wp-block-columns.footer-grid{display:grid!important}\n',
    'functions.php': `<?php
// Generated by Lares
add_action('wp_enqueue_scripts', function () {
\twp_enqueue_style('${slug}-font', '${font}', [], null);
\twp_enqueue_style('${slug}', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
\twp_enqueue_script('${slug}-lead', get_theme_file_uri('lares-lead.js'), [], wp_get_theme()->get('Version'), true);
});
add_action('after_setup_theme', function () {
\tadd_theme_support('post-thumbnails');
\tadd_theme_support('editor-styles');
\tadd_editor_style('style.css');
});
`,
    'theme.json': JSON.stringify(
      {
        $schema: 'https://schemas.wp.org/wp/6.4/theme.json',
        version: 2,
        settings: {
          appearanceTools: true,
          useRootPaddingAwareAlignments: false,
          layout: { contentSize: '860px', wideSize: '1180px' },
          color: {
            palette: [
              { slug: 'primary', color: t.colors.primary, name: 'Primary' },
              { slug: 'accent', color: t.colors.accent, name: 'Accent' },
            ],
          },
          typography: { fontFamilies: [{ slug: 'be-vietnam', name: 'Be Vietnam Pro', fontFamily: "'Be Vietnam Pro', system-ui, sans-serif" }] },
        },
        styles: {
          spacing: { blockGap: '1rem', padding: { top: '0', right: '0', bottom: '0', left: '0' } },
          typography: { fontFamily: 'var(--wp--preset--font-family--be-vietnam)' },
        },
        templateParts: [
          { name: 'header', title: 'Header', area: 'header' },
          { name: 'footer', title: 'Footer', area: 'footer' },
          ...(contactForm !== null ? [{ name: 'contact-form', title: 'Contact form', area: 'uncategorized' }] : []),
        ],
      },
      null,
      2,
    ),
    'parts/header.html': fill(headerPart(nav), vars),
    'parts/footer.html': fill(footerPart(nav), vars),
    ...Object.fromEntries(Object.entries(THEME_TEMPLATES).map(([f, c]) => [`templates/${f}`, c])),
    'lares-lead.js': await readLeadJs(),
    ...(contactForm !== null ? { 'parts/contact-form.html': `<!-- wp:html -->\n${fill(contactForm.trim(), vars)}\n<!-- /wp:html -->\n` } : {}),
  };
  for (const [rel, content] of Object.entries(files)) await host.writeFile(path.join(themeDir, rel), content);
  return slug;
}

/** Fill the {{CAT:slug}} placeholders of the home page with real term ids. */
export function fillCategoryIds(html: string, ids: Record<string, string>): string {
  return html.replace(/\{\{CAT:([a-z0-9-]+)\}\}/g, (_m, slug: string) => (ids[slug] && /^\d+$/.test(ids[slug]) ? ids[slug] : '0'));
}

/**
 * Activate the theme and create demo content. Runs on a fresh WordPress that Lares itself just
 * installed (no third-party code yet), so wp-cli as root is acceptable here.
 */
export async function installWordpressTemplate(id: string, webRoot: string, vars: TemplateVars, log: HostLogger) {
  const tpl = await getTemplate(id);
  const slug = await writeWordpressTheme(tpl, webRoot, vars);
  const wp = (args: string) => host.mutate(wpCli(webRoot, args), { log, timeoutMs: 5 * 60_000 });
  const tmp = path.join(config.dataDir, `wp-seed-${randomSuffix(8)}`);
  await fs.mkdir(tmp, { recursive: true, mode: 0o700 });
  try {
    await wp(`theme activate ${shq(slug)}`);
    log(t('Đã kích hoạt theme {slug}', { slug }));
    for (const [k, v] of [
      ['blogname', vars.SITE_NAME!],
      ['blogdescription', vars.TAGLINE!],
      ['timezone_string', 'Asia/Ho_Chi_Minh'],
      ['date_format', 'd/m/Y'],
    ] as const) {
      await wp(`option update ${k} ${shq(v)}`);
    }
    await wp(`rewrite structure ${shq('/%postname%/')}`);
    // "Hello world!" post and "Sample Page" from the core install
    await wp('post delete 1 2 --force').catch(() => undefined);

    const catIds: Record<string, string> = {};
    for (const c of tpl.wordpress?.categories ?? []) {
      catIds[c.slug] = (await wp(`term create category ${shq(c.name)} --slug=${shq(c.slug)} --porcelain`)).trim();
    }

    const writeContent = async (name: string, content: string) => {
      const f = path.join(tmp, name);
      await fs.writeFile(f, content, { mode: 0o600 });
      return f;
    };

    let i = 0;
    for (const p of tpl.wordpress?.posts ?? []) {
      i++;
      const file = await writeContent(`post-${i}.html`, fill(textToBlocks(p.content), vars));
      const cat = catIds[p.category];
      const postId = (
        await wp(
          `post create ${shq(file)} --post_type=post --post_status=publish --post_title=${shq(fill(p.title, vars))} --post_excerpt=${shq(fill(p.excerpt, vars))}` +
            (cat ? ` --post_category=${shq(cat)}` : '') +
            (p.tags?.length ? ` --tags_input=${shq(p.tags.join(','))}` : '') +
            ' --porcelain',
        )
      ).trim();
      if (p.image && /^\d+$/.test(postId)) {
        // Download ourselves: wp media import rejects extension-less URLs like Unsplash's.
        const img = path.join(tmp, `image-${i}.jpg`);
        try {
          await host.mutate(`curl -fsSL --max-time 60 -o ${shq(img)} ${shq(`${p.image}&fm=jpg`)}`, { log });
          await wp(`media import ${shq(img)} --post_id=${postId} --featured_image --title=${shq(p.title)}`);
        } catch {
          log(t('Cảnh báo: không tải được ảnh minh hoạ cho "{title}" (VPS không truy cập được images.unsplash.com?)', { title: p.title }));
        }
      }
    }
    if (tpl.wordpress?.posts.length) log(t('Đã tạo {count} bài viết mẫu', { count: tpl.wordpress.posts.length }));

    for (const pg of tpl.wordpress?.pages ?? []) {
      const form = pg.contactForm && (await fs.access(await contactFormFile(tpl.id)).then(() => true, () => false)) ? `\n\n${contactFormBlock(slug)}` : '';
      const file = await writeContent(`page-${pg.slug}.html`, fill(textToBlocks(pg.content), vars) + form);
      await wp(`post create ${shq(file)} --post_type=page --post_status=publish --post_title=${shq(pg.title)} --post_name=${shq(pg.slug)}`);
    }

    const homeHtml = await fs.readFile(path.join(await dir(tpl.id), 'wordpress', 'home.html'), 'utf8');
    const homeFile = await writeContent('home.html', fillCategoryIds(fill(homeHtml, vars), catIds));
    const homeId = (await wp(`post create ${shq(homeFile)} --post_type=page --post_status=publish --post_title=${shq(THEME_TEXT.home)} --post_name=trang-chu --porcelain`)).trim();
    if (/^\d+$/.test(homeId)) {
      await wp('option update show_on_front page');
      await wp(`option update page_on_front ${homeId}`);
    }
    log(t('Đã tạo trang chủ, {count} trang và menu theo giao diện "{name}"', { count: tpl.wordpress?.pages.length ?? 0, name: tpl.name }));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
