import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { fill, fillCategoryIds, getTemplate, listTemplates, renderStaticPage, templateVars, textToBlocks, writeWordpressTheme } from '../src/services/templates.js';
import { renderVhost } from '../src/services/nginx.js';

config.templatesDir = path.resolve(__dirname, '../../../templates');

/** Minimal structural validation of serialized blocks: balanced delimiters + parseable attributes. */
function validateBlocks(html: string) {
  const re = /<!--\s+(\/)?wp:([a-z0-9/-]+)(\s+(\{[\s\S]*?\}))?\s+(\/)?-->/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html))) {
    count++;
    const [, closing, name, , json, selfClosing] = m;
    if (json) expect(() => JSON.parse(json), `attributes of wp:${name}`).not.toThrow();
    if (selfClosing) continue;
    if (closing) expect(stack.pop(), `closing wp:${name}`).toBe(name);
    else stack.push(name!);
  }
  expect(stack, 'unclosed blocks').toEqual([]);
  return count;
}

describe('templates', () => {
  it('lists bundled templates', async () => {
    const list = await listTemplates();
    expect(list.map((t) => t.id)).toEqual(expect.arrayContaining(['bat-dong-san', 'doanh-nghiep']));
    for (const t of list) expect(t.types).toEqual(expect.arrayContaining(['static', 'wordpress']));
  });

  it('escapes branding values and keeps unknown placeholders', () => {
    expect(fill('<h1>{{SITE_NAME}}</h1>{{CAT:x}}', { SITE_NAME: 'A & <B>' })).toBe('<h1>A &amp; &lt;B&gt;</h1>{{CAT:x}}');
  });

  it('builds vars with defaults and phone link', async () => {
    const t = await getTemplate('bat-dong-san');
    const v = templateVars(t, { siteName: 'Nhà Xinh', phone: '0909 111 222' });
    expect(v).toMatchObject({ SITE_NAME: 'Nhà Xinh', PHONE_LINK: '0909111222', EMAIL: t.defaults.email });
  });

  it('renders a complete static page without leftover placeholders', async () => {
    for (const id of ['bat-dong-san', 'doanh-nghiep']) {
      const t = await getTemplate(id);
      const html = await renderStaticPage(id, templateVars(t, { siteName: 'Test Co' }));
      expect(html).toContain('Test Co');
      expect(html).toContain('--primary');
      expect(html).not.toMatch(/\{\{[A-Z_:a-z-]+\}\}/);
    }
  });

  it('converts text to paragraph blocks', () => {
    const b = textToBlocks('Xin **chào**\ndòng 2\n\n<script>');
    expect(b).toBe('<!-- wp:paragraph -->\n<p>Xin <strong>chào</strong><br>dòng 2</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>&lt;script&gt;</p>\n<!-- /wp:paragraph -->');
    validateBlocks(b);
  });

  it('home pages are structurally valid block markup', async () => {
    for (const id of ['bat-dong-san', 'doanh-nghiep']) {
      const raw = await fs.readFile(path.join(config.templatesDir, id, 'wordpress', 'home.html'), 'utf8');
      const html = fillCategoryIds(raw, { 'du-an': '5', 'tin-tuc': '7' });
      expect(html).not.toContain('{{CAT:');
      expect(validateBlocks(html)).toBeGreaterThan(20);
    }
  });

  it('generates a valid block theme', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lares-theme-'));
    try {
      const t = await getTemplate('bat-dong-san');
      const slug = await writeWordpressTheme(t, dir, templateVars(t, {}));
      const theme = path.join(dir, 'wp-content/themes', slug);
      const style = await fs.readFile(path.join(theme, 'style.css'), 'utf8');
      expect(style).toMatch(/^\/\*\nTheme Name: Lares Bất động sản/);
      expect(JSON.parse(await fs.readFile(path.join(theme, 'theme.json'), 'utf8')).version).toBe(2);
      for (const f of ['parts/header.html', 'parts/footer.html', 'templates/front-page.html', 'templates/index.html', 'templates/single.html', 'templates/page.html']) {
        const html = await fs.readFile(path.join(theme, f), 'utf8');
        validateBlocks(html);
        expect(html, f).not.toMatch(/\{\{[A-Z_]+\}\}/);
      }
      expect(await fs.readFile(path.join(theme, 'parts/header.html'), 'utf8')).toContain('"url":"/category/du-an/"');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('port-based vhost', () => {
  it('listens on the port for any host name', () => {
    const conf = renderVhost({ domain: 'site8001.localhost', aliases: [], appType: 'static', webRoot: '/var/www/site8001.localhost/public_html', phpVersion: null, appPort: null, listenPort: 8001, accessLog: true, disabled: false, ssl: null });
    expect(conf).toContain('listen 8001;');
    expect(conf).toContain('listen [::]:8001;');
    expect(conf).toContain('server_name _;');
    expect(conf).not.toContain('listen 80;');
  });
});
