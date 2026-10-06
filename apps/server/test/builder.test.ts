import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDER_STYLES,
  SECTION_TYPES,
  SECTION_VARIANTS,
  builderSpecSchema,
  contrast,
  createSiteSchema,
  makePalette,
  paletteContrastPairs,
  slugify,
  type BuilderSpec,
} from '@lares/shared';
import { config } from '../src/config.js';
import { stripBlocks } from '../src/services/builder/blocks.js';
import { builderHomeBlocks, builderVars, deleteBuilderTemplate, listBuilderPresets, manifestFromSpec, resolveAsset, saveBuilderTemplate } from '../src/services/builder/index.js';
import { renderSite } from '../src/services/builder/render.js';
import { fill, getTemplate, installStaticTemplate, listTemplates, renderStaticPage, templateVars, writeWordpressTheme } from '../src/services/templates.js';

config.templatesDir = path.resolve(__dirname, '../../../templates');
const PRESETS = ['spa', 'nha-hang', 'ban-san-pham'];

/** Same structural validator as templates.test.ts: balanced block delimiters + parseable attributes. */
function validateBlocks(html: string) {
  const re = /<!--\s+(\/)?wp:([a-z0-9/-]+)(\s+(\{[\s\S]*?\}))?\s+(\/)?-->/g;
  const stack: string[] = [];
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, closing, name, , json, selfClosing] = m;
    names.add(name!);
    if (json) expect(() => JSON.parse(json), `attributes of wp:${name}`).not.toThrow();
    if (selfClosing) continue;
    if (closing) expect(stack.pop(), `closing wp:${name}`).toBe(name);
    else stack.push(name!);
  }
  expect(stack, 'unclosed blocks').toEqual([]);
  return names;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Balanced HTML elements (outside <script>/<style>), unique ids. */
function validateHtml(html: string) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?>/g)) {
    const [, closing, raw, self] = m;
    const tag = raw!.toLowerCase();
    if (VOID.has(tag) || self) continue;
    if (closing) expect(stack.pop(), `closing </${tag}>`).toBe(tag);
    else stack.push(tag);
  }
  expect(stack).toEqual([]);
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  expect(new Set(ids).size, 'duplicate ids').toBe(ids.length);
}

async function presetSpec(id: string): Promise<BuilderSpec> {
  return (await getTemplate(id)).builder!;
}

/** A spec with every section type enabled in the given variant index. */
async function allSections(variantIndex: number): Promise<BuilderSpec> {
  const base = await presetSpec('spa');
  const byType = new Map(base.sections.map((s) => [s.type, s]));
  const sections = SECTION_TYPES.map((type) => {
    const v = SECTION_VARIANTS[type];
    const content = byType.get(type)?.content ?? (type === 'offer' ? { title: 'Ưu đãi', price: '100.000đ', endsAt: '2030-01-01' } : {});
    return { type, variant: v[variantIndex % v.length]!, enabled: true, content };
  });
  return builderSpecSchema.parse({ ...base, sections });
}

describe('builder palette', () => {
  it('reaches WCAG AA for every text/background pair, whatever the brand colour', () => {
    const colors = ['#ffffff', '#000000', '#ffff00', '#00ff00', '#ff0000', '#0000ff', '#888888', '#f5c518', '#2f6b4f', '#b5452a', '#c27c0e', '#ff7a45', '#7c3aed', '#00bcd4', '#fce4ec'];
    let seed = 7;
    for (let i = 0; i < 80; i++) {
      seed = (seed * 16807) % 2147483647;
      colors.push('#' + (seed % 0xffffff).toString(16).padStart(6, '0'));
    }
    for (const c of colors) {
      for (const style of BUILDER_STYLES) {
        const p = makePalette(c, style);
        for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
        for (const [name, fg, bg] of paletteContrastPairs(p)) expect(contrast(fg, bg), `${c} ${style} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the brand colour when it already carries white text', () => {
    expect(makePalette('#2f6b4f', 'minimal').primary).toBe('#2f6b4f');
    expect(makePalette('#2f6b4f', 'minimal').onPrimary).toBe('#ffffff');
    expect(makePalette('#f5c518', 'young').primary).toBe('#f5c518'); // light brand: dark text instead
  });

  it('slugifies Vietnamese names', () => {
    expect(slugify('Hoa Mộc Spa – Đà Lạt')).toBe('hoa-moc-spa-da-lat');
  });
});

describe('builder spec validation', () => {
  it('accepts the three presets and rejects bad specs', async () => {
    for (const id of PRESETS) expect(builderSpecSchema.safeParse((await getTemplate(id)).builder).success).toBe(true);
    const spec = await presetSpec('spa');
    const bad = (patch: (s: BuilderSpec) => unknown) => builderSpecSchema.safeParse(patch(structuredClone(spec))).success;
    expect(bad((s) => ({ ...s, sections: s.sections.map((x, i) => (i === 0 ? { ...x, variant: 'nope' } : x)) }))).toBe(false);
    expect(bad((s) => ({ ...s, sections: [...s.sections, s.sections[0]] }))).toBe(false);
    expect(bad((s) => ({ ...s, style: { ...s.style, color: 'red' } }))).toBe(false);
    expect(bad((s) => ({ ...s, business: { ...s.business, logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }))).toBe(false);
    expect(bad((s) => ({ ...s, business: { ...s.business, name: '<b>x</b>' } }))).toBe(false);
    expect(bad((s) => ({ ...s, sections: s.sections.map((x, i) => (i === 0 ? { ...x, content: { ...x.content, title: 'Chào {brnad}' } } : x)) }))).toBe(false);
    expect(bad((s) => ({ ...s, sections: s.sections.map((x, i) => (i === 0 ? { ...x, content: { ...x.content, image: 'javascript:alert(1)' } } : x)) }))).toBe(false);
    expect(bad((s) => ({ ...s, sections: s.sections.map((x) => ({ ...x, enabled: x.type === 'footer' })) }))).toBe(false);
  });

  it('is accepted by the site creation schema', async () => {
    const r = createSiteSchema.parse({ type: 'static', domain: 'localhost', builder: await presetSpec('ban-san-pham') });
    expect(r.type === 'static' && r.builder?.industry).toBe('product');
  });
});

describe('builder static render', () => {
  it('renders every preset in every style as a complete, valid page', async () => {
    for (const id of PRESETS) {
      const tpl = await getTemplate(id);
      for (const preset of BUILDER_STYLES) {
        const t2 = { ...tpl, builder: { ...tpl.builder!, style: { ...tpl.builder!.style, preset } } };
        const html = await renderStaticPage(t2, templateVars(t2, { siteName: 'Tiệm <Test> & Co', phone: '0909 111 222' }), { token: 'tok' });
        expect(html).toMatch(/^<!doctype html>\n<html lang="vi">/);
        expect(html).toContain('Tiệm &lt;Test&gt; &amp; Co');
        expect(html).not.toMatch(/\{\{[A-Z_:a-z-]+\}\}/);
        expect(html).not.toMatch(/\{(brand|slogan|phone|email|address|city)\}/);
        expect(html).not.toContain('<!-- wp:');
        expect(html.match(/<h1[ >]/g)).toHaveLength(1);
        for (const img of html.matchAll(/<img\b[^>]*>/g)) expect(img[0]).toMatch(/\salt="/);
        expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
        validateHtml(html);
      }
    }
  });

  it('builds lead forms that follow the form contract', async () => {
    for (const id of PRESETS) {
      const tpl = await getTemplate(id);
      const html = await renderStaticPage(tpl, templateVars(tpl, {}));
      const form = html.match(/<form[\s\S]*?<\/form>/)![0];
      expect(form).toMatch(/method="post"/);
      expect(form).toMatch(/action="\/_lares\/lead"/);
      for (const name of ['name', 'phone', 'email', 'message', 'service', 'page', '_hp']) expect(form, name).toMatch(new RegExp(`name="${name}"`));
      expect(form).toMatch(/id="lares-sent"/);
      expect(form).toMatch(/id="lares-error"/);
      expect(html).toMatch(/\.lares-msg:target/);
      expect(html).toMatch(/'Accept':'application\/json'/);
    }
  });

  it('renders every section variant, and static HTML equals the stripped block markup', async () => {
    for (let v = 0; v < 3; v++) {
      const spec = await allSections(v);
      const site = await renderSite(spec, { mode: 'static', assetUrl: () => 'x.webp' });
      for (const type of SECTION_TYPES.filter((t) => t !== 'footer' && t !== 'hero')) expect(site.page).toContain(`s-${type} v-${SECTION_VARIANTS[type][v % SECTION_VARIANTS[type].length]}`);
      validateHtml(fill(site.page, builderVars(spec, templateVars(manifestFromSpec(spec), {}))));
      const norm = (s: string) => s.replace(/<img (?:fetchpriority="high" |loading="lazy" decoding="async" )/g, '<img ');
      expect(norm(site.page)).toContain(stripBlocks(site.home));
    }
  });
});

describe('builder WordPress output', () => {
  it('produces structurally valid core-block markup for every variant', async () => {
    const allowed = new Set(['group', 'heading', 'paragraph', 'buttons', 'button', 'image', 'details', 'html', 'site-title', 'navigation', 'navigation-link']);
    for (let v = 0; v < 3; v++) {
      const site = await renderSite(await allSections(v), { mode: 'wordpress', assetUrl: () => '/x.webp' });
      for (const part of [site.home, site.header, site.footer]) {
        const names = validateBlocks(part);
        for (const n of names) expect(allowed.has(n), `wp:${n}`).toBe(true);
      }
      // wp:html only for things core blocks cannot express
      for (const m of site.home.matchAll(/<!-- wp:html -->\n([\s\S]*?)\n<!-- \/wp:html -->/g)) expect(m[1]).toMatch(/^<(form|div class="countdown"|div class="map-frame")/);
      expect(site.home).toContain('href="/#');
    }
  });

  it('writes a complete block theme with bundled assets and fills the home page', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lares-builder-'));
    try {
      const tpl = await getTemplate('spa');
      const vars = templateVars(tpl, { siteName: 'Spa Test' });
      const slug = await writeWordpressTheme(tpl, dir, vars);
      expect(slug).toBe('lares-spa');
      const theme = path.join(dir, 'wp-content/themes', slug);
      expect(await fs.readFile(path.join(theme, 'style.css'), 'utf8')).toMatch(/^\/\*\nTheme Name: Lares Spa & Thẩm mỹ viện/);
      const tj = JSON.parse(await fs.readFile(path.join(theme, 'theme.json'), 'utf8'));
      expect(tj.styles.spacing.blockGap).toBe('0px');
      expect(await fs.readFile(path.join(theme, 'functions.php'), 'utf8')).toContain("get_theme_file_uri('assets/site.js')");
      for (const f of ['parts/header.html', 'parts/footer.html', 'templates/front-page.html', 'templates/index.html', 'templates/single.html', 'templates/page.html']) {
        const html = await fs.readFile(path.join(theme, f), 'utf8');
        validateBlocks(html);
        expect(html, f).not.toMatch(/\{\{[A-Z_]+\}\}/);
      }
      await fs.access(path.join(theme, 'assets/fonts/playfair-display-vietnamese-600-normal.woff2'));
      await fs.access(path.join(theme, 'assets/spa-hero.webp'));
      const home = await builderHomeBlocks(tpl, vars);
      validateBlocks(home);
      expect(home).toContain('/wp-content/themes/lares-spa/assets/spa-hero.webp');
      expect(home).not.toMatch(/\{\{[A-Z_]+\}\}/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('builder templates pipeline', () => {
  it('lists the presets as normal templates with thumbnails', async () => {
    const list = await listTemplates();
    for (const id of PRESETS) {
      const t = list.find((x) => x.id === id)!;
      expect(t.types).toEqual(['wordpress', 'static']);
      expect(t.previewImage).toBe(`/api/builder/asset/${id}/thumb.webp`);
      await fs.access(await resolveAsset(id, 'thumb.webp'));
    }
    const presets = await listBuilderPresets();
    expect(presets.slice(0, 3).map((p) => p.industry)).toEqual(['spa', 'restaurant', 'product']);
  });

  it('installs a static site with its images and fonts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lares-builder-'));
    try {
      const tpl = manifestFromSpec(await presetSpec('nha-hang'));
      await installStaticTemplate(tpl, dir, templateVars(tpl, {}), () => {});
      const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
      expect(html).toContain('src="assets/nha-hang-hero.webp"');
      expect(html).toContain('url(assets/fonts/lora-latin-600-normal.woff2)');
      await fs.access(path.join(dir, 'assets/nha-hang-hero.webp'));
      await fs.access(path.join(dir, 'assets/fonts/lora-vietnamese-600-normal.woff2'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects path traversal in asset requests', async () => {
    await expect(resolveAsset('_fonts', '../secret.woff2')).rejects.toThrow();
    await expect(resolveAsset('spa', '..%2Ftemplate.json')).rejects.toThrow();
    await expect(resolveAsset('spa', 'template.json')).rejects.toThrow();
  });

  it('saves, updates and deletes a custom builder template', async () => {
    const prev = config.customTemplatesDir;
    config.customTemplatesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lares-custom-'));
    try {
      const spec = await presetSpec('spa');
      const saved = await saveBuilderTemplate({ name: 'Spa Agency', description: '', spec });
      expect(saved.id).toBe('spa-agency');
      expect(saved.custom).toBe(true);
      const again = await saveBuilderTemplate({ name: 'Spa', description: '', spec });
      expect(again.id).toBe('spa-2'); // never shadows the built-in "spa"
      await saveBuilderTemplate({ id: 'spa-agency', name: 'Spa Agency v2', description: '', spec: { ...spec, style: { ...spec.style, preset: 'minimal' } } });
      const tpl = await getTemplate('spa-agency');
      expect(tpl.name).toBe('Spa Agency v2');
      expect(tpl.builder?.style.preset).toBe('minimal');
      await expect(saveBuilderTemplate({ id: 'spa', name: 'x', description: '', spec })).rejects.toThrow();
      await deleteBuilderTemplate('spa-agency');
      await expect(getTemplate('spa-agency')).rejects.toThrow();
    } finally {
      await fs.rm(config.customTemplatesDir, { recursive: true, force: true });
      config.customTemplatesDir = prev;
    }
  });
});
