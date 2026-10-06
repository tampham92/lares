/**
 * Site builder service: turns a builder spec into a template the existing pipeline understands.
 * A template folder whose template.json carries a "builder" spec (the three industry presets, or a
 * design saved from the wizard) is rendered from that spec instead of index.html/home.html.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { builderSpecSchema, makePalette, slugify, type BuilderIndustry, type BuilderPreset, type BuilderSpec, type SaveBuilderTemplateInput, type TemplateInfo } from '@lares/shared';
import { config } from '../../config.js';
import { t } from '../../i18n/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { host, type HostLogger } from '../host.js';
import { fill, getTemplate, listTemplates, templateDir, type TemplateManifest, type TemplateVars } from '../templates.js';
import { loadStrings, renderSite, themeTemplates, type AssetRef } from './render.js';

/** Built-in template that holds the sample copy + images of each industry. */
export const PRESET_TEMPLATE: Record<BuilderIndustry, string> = { spa: 'spa', restaurant: 'nha-hang', product: 'ban-san-pham' };

const ID_RE = /^[a-z0-9-]{1,40}$/;
const ASSET_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,79}\.(webp|jpe?g|png|woff2)$/;

/** Validates the spec of a template.json and derives the manifest fields from it. */
export function normalizeBuilderManifest(raw: Partial<TemplateManifest> & { builder?: unknown }, id: string): TemplateManifest {
  const spec = builderSpecSchema.parse(raw.builder);
  const p = makePalette(spec.style.color, spec.style.preset);
  const b = spec.business;
  return {
    ...raw,
    id,
    name: raw.name || b.name,
    description: raw.description ?? '',
    types: raw.types ?? ['wordpress', 'static'],
    colors: raw.colors ?? { primary: p.primary, accent: p.accent },
    previewImage: raw.previewImage ?? `tpl:${PRESET_TEMPLATE[spec.industry]}/thumb.webp`,
    defaults: { siteName: b.name, tagline: b.slogan, phone: b.phone, email: b.email, address: b.address, ...raw.defaults },
    font: '',
    builder: spec,
  } as TemplateManifest;
}

/** In-memory template for a site created straight from the wizard. */
export function manifestFromSpec(spec: BuilderSpec): TemplateManifest {
  return normalizeBuilderManifest({ builder: spec, name: spec.business.name, description: '' }, slugify(spec.business.name) || 'site');
}

/** Public URL of a template thumbnail ("assets/x.webp" or "tpl:id/x.webp"); other values unchanged. */
export function publicPreviewImage(id: string, img: string | null | undefined): string | null {
  if (!img) return null;
  if (img.startsWith('assets/')) return `/api/builder/asset/${id}/${img.slice(7)}`;
  const m = img.match(/^tpl:([a-z0-9-]+)\/(.+)$/);
  return m ? `/api/builder/asset/${m[1]}/${m[2]}` : img;
}

const cityOf = (address: string) => address.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? '';

/** Variables only builder pages use: city, URL-encoded address, Zalo. */
export function builderVars(spec: BuilderSpec, vars: TemplateVars): TemplateVars {
  const b = spec.business;
  const address = vars.ADDRESS ?? '';
  const city = address && address !== b.address ? cityOf(address) : b.city || cityOf(address);
  const zalo = (b.zalo || vars.PHONE || '').trim();
  return {
    ...vars,
    CITY: city,
    ADDRESS_Q: encodeURIComponent(address || vars.SITE_NAME || ''),
    ZALO: zalo,
    ZALO_LINK: `https://zalo.me/${zalo.replace(/\D/g, '')}`,
  };
}

const staticAssetUrl = (ref: AssetRef) =>
  ref.kind === 'font' ? `assets/fonts/${ref.file}` : ref.kind === 'logo' ? `assets/logo.${ref.ext}` : `assets/${ref.tpl}-${ref.file}`;

/** Asset URLs inside the panel preview (authenticated with the session token, see routes/builder.ts). */
export function previewAssetUrl(token: string | undefined, logo?: string) {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return (ref: AssetRef) =>
    ref.kind === 'font' ? `/api/builder/asset/_fonts/${ref.file}${q}` : ref.kind === 'logo' ? (logo ?? '') : `/api/builder/asset/${ref.tpl}/${ref.file}${q}`;
}

function spec(tpl: TemplateManifest): BuilderSpec {
  if (!tpl.builder) throw badRequest(t('Giao diện "{id}" không phải giao diện tự tạo', { id: tpl.id }));
  return tpl.builder;
}

/** Full static page (filled). `assetUrl` defaults to the panel preview URLs. */
export async function renderBuilderPage(tpl: TemplateManifest, vars: TemplateVars, opts: { token?: string; preview?: boolean } = {}): Promise<string> {
  const sp = spec(tpl);
  const site = await renderSite(sp, { mode: 'static', preview: opts.preview ?? true, assetUrl: previewAssetUrl(opts.token, sp.business.logo) });
  return fill(site.page, builderVars(sp, vars));
}

async function copyAssets(site: Awaited<ReturnType<typeof renderSite>>, destDir: string, log?: HostLogger) {
  await fs.mkdir(path.join(destDir, 'fonts'), { recursive: true });
  for (const f of site.fonts) await fs.copyFile(path.join(config.templatesDir, '_builder', 'fonts', f), path.join(destDir, 'fonts', f));
  for (const img of site.images) {
    try {
      await fs.copyFile(path.join(await templateDir(img.tpl), 'assets', img.file), path.join(destDir, `${img.tpl}-${img.file}`));
    } catch {
      log?.(t('Cảnh báo: không tìm thấy ảnh {file} của giao diện {id}', { file: img.file, id: img.tpl }));
    }
  }
  if (site.logo) await fs.writeFile(path.join(destDir, `logo.${site.logo.ext}`), site.logo.data);
}

export async function installBuilderStatic(tpl: TemplateManifest, webRoot: string, vars: TemplateVars, log: HostLogger) {
  const sp = spec(tpl);
  const site = await renderSite(sp, { mode: 'static', assetUrl: staticAssetUrl });
  await host.writeFile(path.join(webRoot, 'index.html'), fill(site.page, builderVars(sp, vars)));
  await copyAssets(site, path.join(webRoot, 'assets'), log);
  log(t('Đã tạo website từ trình tạo giao diện ({count} khối, {images} ảnh)', { count: sp.sections.filter((s) => s.enabled).length, images: site.images.length }));
}

const themeSlug = (tpl: TemplateManifest) => `lares-${tpl.id}`;
const wpAssetUrl = (slug: string, inCss: boolean) => (ref: AssetRef) => (inCss && ref.kind === 'font' ? '' : `/wp-content/themes/${slug}/`) + staticAssetUrl(ref);

/** Block theme for a builder template: same CSS and sections, assets bundled in the theme. */
export async function writeBuilderTheme(tpl: TemplateManifest, webRoot: string, vars: TemplateVars): Promise<string> {
  const sp = spec(tpl);
  const slug = themeSlug(tpl);
  const themeDir = path.join(webRoot, 'wp-content', 'themes', slug);
  // fonts are referenced relative to style.css; everything else by absolute path (post content has no base URL)
  const site = await renderSite(sp, { mode: 'wordpress', assetUrl: (ref) => wpAssetUrl(slug, ref.kind === 'font')(ref) });
  const v = builderVars(sp, vars);
  const p = makePalette(sp.style.color, sp.style.preset);
  const header = `/*
Theme Name: Lares ${tpl.name.replace(/\*\//g, '')}
Author: Lares
Description: ${(tpl.description || tpl.name).replace(/\*\//g, '')}
Version: 1.0.0
Requires at least: 6.4
Text Domain: ${slug}
*/
`;
  const files: Record<string, string> = {
    'style.css': header + site.css + '\n',
    'assets/site.js': site.js,
    'functions.php': `<?php
// Generated by Lares (site builder)
add_action('wp_enqueue_scripts', function () {
\twp_enqueue_style('${slug}', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
\twp_enqueue_script('${slug}', get_theme_file_uri('assets/site.js'), [], wp_get_theme()->get('Version'), ['in_footer' => true, 'strategy' => 'defer']);
});
add_filter('body_class', function ($classes) {
\t$classes[] = 'lp';
\t$classes[] = 'style-${sp.style.preset}';
\treturn $classes;
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
          layout: { contentSize: '820px', wideSize: '1180px' },
          color: {
            palette: [
              { slug: 'primary', color: p.primary, name: 'Primary' },
              { slug: 'accent', color: p.accent, name: 'Accent' },
              { slug: 'heading', color: p.heading, name: 'Heading' },
              { slug: 'text', color: p.text, name: 'Text' },
              { slug: 'background', color: p.bg, name: 'Background' },
              { slug: 'background-alt', color: p.bgAlt, name: 'Background alt' },
              { slug: 'dark', color: p.dark, name: 'Dark' },
            ],
          },
        },
        styles: {
          color: { background: p.bg, text: p.text },
          spacing: { blockGap: '0px', padding: { top: '0', right: '0', bottom: '0', left: '0' } },
        },
        templateParts: [
          { name: 'header', title: 'Header', area: 'header' },
          { name: 'footer', title: 'Footer', area: 'footer' },
        ],
      },
      null,
      2,
    ),
    'parts/header.html': fill(site.header, v),
    'parts/footer.html': fill(site.footer, v),
    ...Object.fromEntries(Object.entries(themeTemplates(await loadStrings(sp.lang))).map(([f, c]) => [`templates/${f}`, c])),
  };
  for (const [rel, content] of Object.entries(files)) await host.writeFile(path.join(themeDir, rel), content);
  await copyAssets(site, path.join(themeDir, 'assets'));
  return slug;
}

/** Content of the WordPress home page (filled, without category ids - builder pages have none). */
export async function builderHomeBlocks(tpl: TemplateManifest, vars: TemplateVars): Promise<string> {
  const sp = spec(tpl);
  const site = await renderSite(sp, { mode: 'wordpress', assetUrl: wpAssetUrl(themeSlug(tpl), false) });
  return fill(site.home, builderVars(sp, vars));
}

/** File behind /api/builder/asset/:scope/:file ("_fonts" or a template id). */
export async function resolveAsset(scope: string, file: string): Promise<string> {
  if (!ASSET_FILE_RE.test(file)) throw notFound(t('Không tìm thấy tệp'));
  if (scope === '_fonts') {
    if (!file.endsWith('.woff2')) throw notFound(t('Không tìm thấy tệp'));
    return path.join(config.templatesDir, '_builder', 'fonts', file);
  }
  if (!ID_RE.test(scope) || file.endsWith('.woff2')) throw notFound(t('Không tìm thấy tệp'));
  const p = path.join(await templateDir(scope), 'assets', file);
  await fs.access(p).catch(() => {
    throw notFound(t('Không tìm thấy tệp'));
  });
  return p;
}

/** Industry presets (built-in) and designs saved from the wizard, with their specs. */
export async function listBuilderPresets(): Promise<BuilderPreset[]> {
  const out: BuilderPreset[] = [];
  for (const info of await listTemplates()) {
    const tpl = await getTemplate(info.id).catch(() => null);
    if (!tpl?.builder) continue;
    out.push({ id: tpl.id, name: tpl.name, description: tpl.description, industry: tpl.builder.industry, custom: !!tpl.custom, previewImage: info.previewImage, spec: tpl.builder });
  }
  const order = Object.values(PRESET_TEMPLATE);
  return out.sort((a, b) => Number(a.custom) - Number(b.custom) || order.indexOf(a.id) - order.indexOf(b.id) || a.name.localeCompare(b.name, 'vi'));
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Writes the spec as a template in the custom folder (kept across upgrades). Same id = update. */
export async function saveBuilderTemplate(input: SaveBuilderTemplateInput & { id?: string }): Promise<TemplateInfo> {
  let id = input.id;
  if (id) {
    const current = await getTemplate(id).catch(() => null);
    if (!current?.custom || !current.builder) throw badRequest(t('Chỉ cập nhật được giao diện tự tạo đã lưu'));
  } else {
    const base = slugify(input.name, 34) || 'giao-dien';
    id = base;
    for (let i = 2; (await exists(path.join(config.customTemplatesDir, id))) || (await exists(path.join(config.templatesDir, id))); i++) id = `${base}-${i}`;
  }
  const manifest = { id, name: input.name, description: input.description, types: ['wordpress', 'static'], builder: input.spec };
  await host.writeFile(path.join(config.customTemplatesDir, id, 'template.json'), JSON.stringify(manifest, null, 2) + '\n');
  const tpl = await getTemplate(id);
  return { id, name: tpl.name, description: tpl.description, types: tpl.types, colors: tpl.colors, previewImage: publicPreviewImage(id, tpl.previewImage), defaults: tpl.defaults, custom: true };
}

export async function deleteBuilderTemplate(id: string) {
  const tpl = await getTemplate(id);
  if (!tpl.custom || !tpl.builder) throw badRequest(t('Chỉ xoá được giao diện tự tạo đã lưu'));
  await fs.rm(path.join(config.customTemplatesDir, id), { recursive: true, force: true });
}

/** Empty page the live preview iframe starts from; the panel then posts rendered pages into it. */
export function previewFrameHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;font:14px system-ui,sans-serif;color:#5b6478;background:#fff}</style></head><body><p>${t('Đang dựng bản xem trước…')}</p><script>addEventListener('message',function(e){if(e.source!==window.parent||!e.data||e.data.type!=='lares-preview')return;document.open();document.write(e.data.html);document.close()});</script></body></html>`;
}
