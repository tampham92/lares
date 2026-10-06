/**
 * Serialized WordPress core blocks. Every section of the site builder is written once with these
 * helpers: the result is valid block markup (editable in Gutenberg), and stripping the block
 * comments gives exactly the HTML WordPress prints on the front end - which is the static page.
 *
 * Only core blocks whose saved HTML is stable across WordPress 6.4+ are used: group, heading,
 * paragraph, buttons/button, image, details and html (for forms, maps and the countdown).
 */

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Block attributes as JSON; "--" is escaped so the comment can never be closed early. */
const attrs = (o: Record<string, unknown>) => {
  const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
  return Object.keys(clean).length ? ' ' + JSON.stringify(clean).replace(/--/g, '\\u002d\\u002d') : '';
};

const cls = (...names: Array<string | false | undefined | null>) => names.filter(Boolean).join(' ');

type GroupTag = 'div' | 'section' | 'article' | 'header' | 'footer' | 'aside' | 'main';

export function group(o: { tag?: GroupTag; className?: string; anchor?: string }, ...inner: string[]): string {
  const tag = o.tag ?? 'div';
  // anchor is sourced from the id attribute, so (like Gutenberg) it is not repeated in the comment
  const a = attrs({ tagName: tag === 'div' ? undefined : tag, className: o.className, layout: { type: 'default' } });
  const id = o.anchor ? ` id="${esc(o.anchor)}"` : '';
  return `<!-- wp:group${a} -->\n<${tag} class="${cls('wp-block-group', o.className)}"${id}>${inner.filter(Boolean).join('\n\n')}</${tag}>\n<!-- /wp:group -->`;
}

/** `html` is already-escaped inline HTML (strong, em, s, a, br). */
export function heading(level: 1 | 2 | 3 | 4, html: string, className?: string): string {
  return `<!-- wp:heading${attrs({ level: level === 2 ? undefined : level, className })} -->\n<h${level} class="${cls('wp-block-heading', className)}">${html}</h${level}>\n<!-- /wp:heading -->`;
}

export function para(html: string, className?: string): string {
  return `<!-- wp:paragraph${attrs({ className })} -->\n<p${className ? ` class="${className}"` : ''}>${html}</p>\n<!-- /wp:paragraph -->`;
}

export interface ButtonSpec {
  label: string; // escaped
  href: string; // escaped
  className?: string;
  newTab?: boolean;
}

export function buttons(items: ButtonSpec[], className?: string): string {
  if (!items.length) return '';
  const inner = items
    .map((b) => {
      const target = b.newTab ? ' target="_blank" rel="noreferrer noopener"' : '';
      return `<!-- wp:button${attrs({ className: b.className })} -->\n<div class="${cls('wp-block-button', b.className)}"><a class="wp-block-button__link wp-element-button" href="${b.href}"${target}>${b.label}</a></div>\n<!-- /wp:button -->`;
    })
    .join('\n\n');
  return `<!-- wp:buttons${attrs({ className })} -->\n<div class="${cls('wp-block-buttons', className)}">${inner}</div>\n<!-- /wp:buttons -->`;
}

/** `src`/`alt`/`caption` are escaped. */
export function image(o: { src: string; alt: string; className?: string; caption?: string }): string {
  const cap = o.caption ? `<figcaption class="wp-element-caption">${o.caption}</figcaption>` : '';
  return `<!-- wp:image${attrs({ sizeSlug: 'large', linkDestination: 'none', className: o.className })} -->\n<figure class="${cls('wp-block-image size-large', o.className)}"><img src="${o.src}" alt="${o.alt}"/>${cap}</figure>\n<!-- /wp:image -->`;
}

export function details(summaryHtml: string, ...inner: string[]): string {
  return `<!-- wp:details -->\n<details class="wp-block-details"><summary>${summaryHtml}</summary>${inner.join('\n\n')}</details>\n<!-- /wp:details -->`;
}

export function html(raw: string): string {
  return `<!-- wp:html -->\n${raw}\n<!-- /wp:html -->`;
}

/** Static HTML of serialized blocks: the block delimiters removed. */
export function stripBlocks(markup: string): string {
  return markup
    .replace(/<!-- \/?wp:[a-z0-9/-]+(?: \{[\s\S]*?\})? \/?-->/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
