/**
 * Section library of the site builder. Each section type renders its variants as serialized core
 * blocks (see blocks.ts), so one definition gives the WordPress page and the static HTML.
 * Text comes from the spec (sample copy written per industry in templates/<id>/template.json) and
 * from templates/_builder/strings.json - nothing customer-facing is hard-coded here.
 */
import type { BuilderItem, BuilderSection, BuilderSpec, SectionContent, SectionType } from '@lares/shared';
import { buttons, details, esc, group, heading, html, image, para, type ButtonSpec } from './blocks.js';

export interface Strings {
  [key: string]: string | Record<string, string>;
}

export interface Ctx {
  spec: BuilderSpec;
  /** Strings of the site language (form labels, menu...). */
  s: Strings;
  /** Escaped URL of an image reference. */
  img: (ref: string) => string;
  /** "#" for the static page, "/#" inside WordPress (links must work from every page). */
  hash: string;
  preview: boolean;
  icons: Set<string>;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const VARS: Record<string, string> = { brand: 'SITE_NAME', slogan: 'TAGLINE', phone: 'PHONE', email: 'EMAIL', address: 'ADDRESS', city: 'CITY' };

/** {brand} → {{SITE_NAME}}: filled (and escaped) later by templates.fill(). */
export const vars = (s: string) => s.replace(/\{([a-z]+)\}/g, (m, k: string) => (VARS[k] ? `{{${VARS[k]}}}` : m));

/** Escaped single-line text with placeholders. */
export const plain = (s: string | undefined) => vars(esc(s ?? ''));

/** Escaped inline rich text: **bold**, line breaks, placeholders. */
export const rich = (s: string | undefined) =>
  vars(esc(s ?? ''))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

/** Blank-line separated paragraphs. */
const paras = (s: string | undefined, className?: string) =>
  (s ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => para(rich(p), className));

export function str(ctx: Ctx, key: string, sub?: string): string {
  const v = sub ? (ctx.s[sub] as Record<string, string> | undefined)?.[key] : ctx.s[key];
  return typeof v === 'string' ? v : key;
}

/** Honorifics skipped when building avatar initials. */
const HONORIFICS = new Set(['anh', 'chị', 'cô', 'chú', 'bác', 'em', 'bạn', 'ông', 'bà', 'mr', 'mrs', 'ms', 'dr']); // i18n-ignore

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w && !HONORIFICS.has(w.toLowerCase()));
  const pick = words.length > 1 ? [words[words.length - 2]!, words[words.length - 1]!] : words;
  return pick.map((w) => w[0]!.toUpperCase()).join('') || '•';
}

export function anchorOf(ctx: Ctx, sec: BuilderSection): string {
  return sec.content.anchor || str(ctx, sec.type, 'anchor');
}

export function navOf(ctx: Ctx, sec: BuilderSection): string {
  return sec.content.nav ?? str(ctx, sec.type, 'nav');
}

const enabled = (ctx: Ctx, type: SectionType) => ctx.spec.sections.find((s) => s.type === type && s.enabled);

export const formKind = (ctx: Ctx) => enabled(ctx, 'contact')?.content.formKind ?? (ctx.spec.industry === 'product' ? 'order' : ctx.spec.industry === 'spa' || ctx.spec.industry === 'restaurant' ? 'booking' : 'contact');
const formStrings = (ctx: Ctx) => (formKind(ctx) === 'contact' ? 'contact_form' : formKind(ctx));

/** Label of the main call to action (also used by the header button). */
export function ctaLabel(ctx: Ctx): string {
  const c = enabled(ctx, 'contact')?.content;
  return c?.cta || str(ctx, 'submit', formStrings(ctx));
}

/** Where the main call to action leads: the form when there is one, else a phone call. */
export function ctaHref(ctx: Ctx): string {
  const c = enabled(ctx, 'contact');
  return c ? `${ctx.hash}${anchorOf(ctx, c)}` : 'tel:{{PHONE_LINK}}';
}

function secondaryHref(ctx: Ctx): string {
  for (const t of ['services', 'pricing', 'gallery', 'about'] as const) {
    const s = enabled(ctx, t);
    if (s) return `${ctx.hash}${anchorOf(ctx, s)}`;
  }
  return 'tel:{{PHONE_LINK}}';
}

const zaloHref = () => '{{ZALO_LINK}}';

function sectionGroup(ctx: Ctx, sec: BuilderSection, extra: string, ...inner: string[]): string {
  const anchor = sec.type === 'hero' || sec.type === 'footer' ? undefined : anchorOf(ctx, sec);
  return group({ tag: 'section', className: `sec s-${sec.type} v-${sec.variant}${extra ? ' ' + extra : ''}`, anchor }, ...inner);
}

const wrap = (...inner: string[]) => group({ className: 'wrap' }, ...inner);

function head(c: SectionContent, opts: { start?: boolean } = {}): string {
  if (!c.eyebrow && !c.title && !c.text) return '';
  return group(
    { className: `sec-head${opts.start ? ' start' : ''}` },
    c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
    c.title ? heading(2, rich(c.title)) : '',
    ...paras(c.text, 'lead'),
  );
}

const items = (ctx: Ctx, c: SectionContent): BuilderItem[] => c.items ?? ctx.spec.business.items;

const icon = (ctx: Ctx, name: string) => {
  ctx.icons.add(name);
  return `ic-${name}`;
};

const points = (list: string[] | undefined, className = 'points') => (list?.length ? group({ className }, ...list.map((p) => para(plain(p), 'pt'))) : '');

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function hero(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const btns: ButtonSpec[] = [{ label: plain(c.cta || ctaLabel(ctx)), href: ctaHref(ctx), className: 'btn-primary' }];
  if (c.cta2) btns.push({ label: plain(c.cta2), href: secondaryHref(ctx), className: 'btn-ghost' });
  const copy = group(
    { className: 'hero-copy' },
    c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
    heading(1, rich(c.title || '{brand}')),
    ...paras(c.text || '{slogan}', 'lead'),
    buttons(btns),
    points(c.points, 'hero-points'),
  );
  const alt = plain(c.title ? c.title.replace(/\*\*/g, '') : '{brand}');
  const pic = (className: string) => (c.image ? image({ src: ctx.img(c.image), alt, className }) : '');
  if (sec.variant === 'overlay') return sectionGroup(ctx, sec, 'on-dark', pic('hero-bg'), group({ className: 'wrap hero-inner' }, copy));
  if (sec.variant === 'centered') return sectionGroup(ctx, sec, '', wrap(copy, pic('hero-wide')));
  return sectionGroup(ctx, sec, '', wrap(group({ className: 'hero-grid' }, copy, pic('hero-img'))));
}

function about(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const copy = group(
    { className: 'about-copy' },
    c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
    c.title ? heading(2, rich(c.title)) : '',
    c.text ? group({ className: 'prose' }, ...paras(c.text)) : '',
    points(c.points),
    c.cta ? buttons([{ label: plain(c.cta), href: ctaHref(ctx), className: 'btn-primary' }]) : '',
  );
  const pic = c.image ? image({ src: ctx.img(c.image), alt: plain((c.title ?? '').replace(/\*\*/g, '')), className: 'about-img' }) : '';
  if (sec.variant === 'stats' && c.stats?.length) {
    const stats = group({ className: 'stats' }, ...c.stats.map((st) => group({ className: 'stat' }, para(plain(st.value), 'stat-v'), para(plain(st.label), 'stat-l'))));
    return sectionGroup(ctx, sec, 'alt', wrap(group({ className: 'about-grid' }, copy, stats)));
  }
  return sectionGroup(ctx, sec, '', wrap(group({ className: 'about-grid' }, pic, copy)));
}

function services(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const list = items(ctx, c);
  let body: string;
  if (sec.variant === 'icons') {
    body = group(
      { className: 'tiles' },
      ...list.map((it) => group({ className: `tile${it.icon ? ' ' + icon(ctx, it.icon) : ''}` }, heading(3, plain(it.title)), it.text ? para(rich(it.text)) : '')),
    );
  } else if (sec.variant === 'menu') {
    body = group(
      { className: 'menu-list' },
      ...list.map((it) =>
        group(
          { className: 'menu-item' },
          it.image ? image({ src: ctx.img(it.image), alt: plain(it.title), className: 'menu-thumb' }) : '',
          group(
            { className: 'menu-main' },
            group({ className: 'menu-row' }, heading(3, plain(it.title)), para(plain(it.price || str(ctx, 'contactPrice')), 'menu-price')),
            it.text ? para(rich(it.text), 'menu-desc') : '',
            it.meta ? para(plain(it.meta), 'menu-tag') : '',
          ),
        ),
      ),
    );
  } else {
    body = group(
      { className: 'cards' },
      ...list.map((it) =>
        group(
          { tag: 'article', className: 'card svc' },
          it.image ? image({ src: ctx.img(it.image), alt: plain(it.title), className: 'svc-img' }) : '',
          group({ className: 'card-body' }, heading(3, plain(it.title)), it.text ? para(rich(it.text), 'desc') : '', it.price ? para(plain(it.price), 'price') : ''),
        ),
      ),
    );
  }
  const note = c.note ? para(plain(c.note), 'price-note') : '';
  return sectionGroup(ctx, sec, sec.variant === 'icons' ? 'alt' : '', wrap(head(c), body, note));
}

function pricing(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const list = items(ctx, c);
  let body: string;
  if (sec.variant === 'plans') {
    body = group(
      { className: 'plans' },
      ...list.map((it) =>
        group(
          { className: `plan${it.featured ? ' featured' : ''}` },
          it.featured ? para(esc(str(ctx, 'featured')), 'plan-badge') : '',
          heading(3, plain(it.title)),
          it.meta ? para(plain(it.meta), 'plan-meta') : '',
          para(plain(it.price || str(ctx, 'contactPrice')), 'plan-price'),
          it.text
            ? group(
                { className: 'plan-feats' },
                ...it.text
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l) => para(rich(l), 'pt')),
              )
            : '',
          buttons([{ label: plain(c.cta || str(ctx, 'choosePlan')), href: ctaHref(ctx), className: it.featured ? 'btn-primary' : 'btn-ghost' }]),
        ),
      ),
    );
  } else {
    body = group(
      { className: `price-list${list.length > 6 ? ' two' : ''}` },
      ...list.map((it) =>
        group(
          { className: 'price-row' },
          group({ className: 'price-main' }, heading(3, plain(it.title)), it.text ? para(rich(it.text)) : ''),
          para(plain(it.price || str(ctx, 'contactPrice')), 'price-val'),
        ),
      ),
    );
  }
  const note = c.note ? para(plain(c.note), 'price-note') : '';
  return sectionGroup(ctx, sec, sec.variant === 'table' ? 'alt' : '', wrap(head(c), body, note));
}

function countdown(ctx: Ctx, c: SectionContent): string {
  const target = c.endsAt ? (c.endsAt.length === 10 ? `${c.endsAt}T23:59:59+07:00` : c.endsAt) : 'daily';
  const box = (k: string, label: string) => `<span class="cd-box"><b data-cd="${k}">00</b><small>${esc(str(ctx, label))}</small></span>`;
  return html(
    `<div class="countdown" data-countdown="${esc(target)}">\n` +
      `<p class="cd-label" data-live="${esc(str(ctx, c.endsAt ? 'cdUntil' : 'cdDaily'))}" data-ended="${esc(str(ctx, 'cdEnded'))}">${esc(str(ctx, 'cdFallback'))}</p>\n` +
      `<div class="cd-boxes" role="timer">${box('d', 'cdDays')}${box('h', 'cdHours')}${box('m', 'cdMinutes')}${box('s', 'cdSeconds')}</div>\n</div>`,
  );
}

function offer(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const price = c.price ? para(`${c.oldPrice ? `<s>${plain(c.oldPrice)}</s> ` : ''}<strong>${plain(c.price)}</strong>`, 'offer-price') : '';
  const btn = buttons([{ label: plain(c.cta || ctaLabel(ctx)), href: ctaHref(ctx), className: 'btn-primary' }]);
  if (sec.variant === 'card') {
    return sectionGroup(
      ctx,
      sec,
      'alt',
      wrap(
        group(
          { className: 'offer-card' },
          c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
          c.title ? heading(2, rich(c.title)) : '',
          ...paras(c.text, 'lead'),
          price,
          countdown(ctx, c),
          btn,
          c.note ? para(plain(c.note), 'offer-note') : '',
        ),
      ),
    );
  }
  return sectionGroup(
    ctx,
    sec,
    'dark',
    wrap(
      group(
        { className: 'offer-grid' },
        group({ className: 'offer-copy' }, c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '', c.title ? heading(2, rich(c.title)) : '', ...paras(c.text), price),
        group({ className: 'offer-act' }, countdown(ctx, c), btn, c.note ? para(plain(c.note), 'offer-note') : ''),
      ),
    ),
  );
}

function quoteBy(it: BuilderItem): string {
  return group(
    { className: 'quote-by' },
    para(esc(initials(it.title)), 'avatar'),
    group({ className: 'quote-who' }, para(plain(it.title), 'quote-name'), it.meta ? para(plain(it.meta), 'quote-meta') : ''),
  );
}

function testimonials(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const list = c.items ?? [];
  const card = (it: BuilderItem) => group({ tag: 'article', className: `quote r${it.rating ?? 5}` }, para(rich(it.text), 'quote-text'), quoteBy(it));
  if (sec.variant === 'spotlight' && list.length) {
    const [first, ...rest] = list as [BuilderItem, ...BuilderItem[]];
    return sectionGroup(
      ctx,
      sec,
      '',
      wrap(head(c), group({ tag: 'article', className: 'spot' }, para(rich(first.text), 'spot-text'), quoteBy(first)), rest.length ? group({ className: 'quotes' }, ...rest.map(card)) : ''),
    );
  }
  return sectionGroup(ctx, sec, 'alt', wrap(head(c), group({ className: 'quotes' }, ...list.map(card))));
}

function gallery(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const list = (c.items ?? []).filter((it) => it.image);
  const kind = sec.variant === 'masonry' ? 'g-masonry' : sec.variant === 'strip' ? 'g-strip' : 'g-grid';
  return sectionGroup(
    ctx,
    sec,
    '',
    wrap(head(c), group({ className: `gal ${kind}` }, ...list.map((it) => image({ src: ctx.img(it.image!), alt: plain(it.title), caption: it.meta ? plain(it.meta) : undefined })))),
  );
}

function team(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const cardCls = sec.variant === 'round' ? 'member' : 'card member';
  return sectionGroup(
    ctx,
    sec,
    sec.variant === 'round' ? 'alt' : '',
    wrap(
      head(c),
      group(
        { className: 'team' },
        ...(c.items ?? []).map((it) =>
          group(
            { className: cardCls },
            it.image ? image({ src: ctx.img(it.image), alt: plain(it.title), className: 'member-img' }) : para(esc(initials(it.title)), 'avatar'),
            group({ className: 'member-body' }, heading(3, plain(it.title)), it.meta ? para(plain(it.meta), 'member-role') : '', it.text ? para(rich(it.text), 'member-bio') : ''),
          ),
        ),
      ),
    ),
  );
}

function faq(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const list = group({ className: 'faq' }, ...(c.items ?? []).map((it) => details(plain(it.title), ...paras(it.text))));
  if (sec.variant === 'split') {
    const intro = group(
      { className: 'faq-intro' },
      c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
      c.title ? heading(2, rich(c.title)) : '',
      ...paras(c.text, 'lead'),
      buttons([
        { label: esc(str(ctx, 'call')), href: 'tel:{{PHONE_LINK}}', className: 'btn-primary' },
        { label: esc(str(ctx, 'zalo')), href: zaloHref(), className: 'btn-ghost', newTab: true },
      ]),
    );
    return sectionGroup(ctx, sec, 'alt', wrap(group({ className: 'faq-split' }, intro, list)));
  }
  return sectionGroup(ctx, sec, 'alt', wrap(head(c), list));
}

/** Lead form following the FORM CONTRACT of the /_lares/lead endpoint (works without JavaScript). */
export function leadForm(ctx: Ctx, c: SectionContent): string {
  const fk = formStrings(ctx);
  const f = (k: string) => esc(vars(str(ctx, k, fk)));
  const g = (k: string) => esc(vars(str(ctx, k)));
  const options = ctx.spec.business.items.map((it) => `<option>${plain(it.title)}</option>`).join('');
  const service = options
    ? `<label>${f('service')}<select name="service"><option value="">${g('formChoose')}</option>${options}</select></label>`
    : '';
  return [
    `<form class="lead-form" method="post" action="/_lares/lead" data-lares-form>`,
    `<div class="lares-msg ok" id="lares-sent" role="status" tabindex="-1">${f('sent')}</div>`,
    `<div class="lares-msg err" id="lares-error" role="alert" tabindex="-1"><span data-msg>${g('formError')}</span></div>`,
    `<div class="row2"><label>${g('formName')} <span class="req" aria-hidden="true">*</span><input name="name" required maxlength="100" autocomplete="name"></label>`,
    `<label>${g('formPhone')} <span class="req" aria-hidden="true">*</span><input name="phone" type="tel" required maxlength="20" autocomplete="tel" inputmode="tel" pattern="[0-9+ .()\\-]{8,20}"></label></div>`,
    `<label>${g('formEmail')}<input name="email" type="email" maxlength="120" autocomplete="email"></label>`,
    service,
    `<label>${f('message')}<textarea name="message" rows="4" maxlength="2000" placeholder="${f('messagePlaceholder')}"></textarea></label>`,
    `<input type="hidden" name="page" value="/">`,
    `<div class="hp" aria-hidden="true"><label>${g('formHp')}<input name="_hp" tabindex="-1" autocomplete="off"></label></div>`,
    `<button type="submit" data-sending="${g('formSending')}">${plain(c.cta || str(ctx, 'submit', fk))}</button>`,
    `<p class="form-note">${g('formPrivacy')}</p>`,
    `</form>`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Phone / Zalo / email / address / hours as icon rows. */
function contactRows(ctx: Ctx, withHours: boolean): string[] {
  const b = ctx.spec.business;
  const row = (ic: string, label: string, value: string) => para(`<strong>${esc(str(ctx, label))}</strong>${value}`, `ci ${icon(ctx, ic)}`);
  const rows = [row('phone', 'hotline', '<a href="tel:{{PHONE_LINK}}">{{PHONE}}</a>'), row('chat', 'zalo', `<a href="${zaloHref()}" target="_blank" rel="noreferrer noopener">{{ZALO}}</a>`)];
  if (b.email) rows.push(row('mail', 'email', '<a href="mailto:{{EMAIL}}">{{EMAIL}}</a>'));
  if (b.address) rows.push(row('pin', 'address', '{{ADDRESS}}'));
  if (withHours && b.hours.length) rows.push(row('clock', 'hours', b.hours.map((h) => `${esc(h.label)}: ${esc(h.value)}`).join('<br>')));
  return rows;
}

function contact(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const form = html(leadForm(ctx, c));
  if (sec.variant === 'centered') return sectionGroup(ctx, sec, 'alt', wrap(head(c), group({ className: 'contact-solo' }, form)));
  const info = group(
    { className: 'contact-info' },
    c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
    c.title ? heading(2, rich(c.title)) : '',
    c.text ? group({ className: 'prose' }, ...paras(c.text)) : '',
    group({ className: 'ci-list' }, ...contactRows(ctx, !enabled(ctx, 'map'))),
  );
  return sectionGroup(ctx, sec, '', wrap(group({ className: 'contact-grid' }, info, form)));
}

function hours(ctx: Ctx): string {
  const list = ctx.spec.business.hours;
  return list.length ? group({ className: 'hours' }, ...list.flatMap((h) => [para(esc(h.label), 'h-l'), para(esc(h.value), 'h-v')])) : '';
}

function map(ctx: Ctx, sec: BuilderSection): string {
  const c = sec.content;
  const info = group(
    { className: 'card map-info' },
    c.eyebrow ? para(plain(c.eyebrow), 'eyebrow') : '',
    heading(2, rich(c.title || str(ctx, 'hours'))),
    ...paras(c.text),
    ctx.spec.business.address ? para(`<strong>${esc(str(ctx, 'address'))}</strong>{{ADDRESS}}`, `ci ${icon(ctx, 'pin')}`) : '',
    hours(ctx),
    buttons([
      { label: esc(str(ctx, 'directions')), href: 'https://www.google.com/maps/search/?api=1&amp;query={{ADDRESS_Q}}', className: 'btn-primary', newTab: true },
      { label: esc(str(ctx, 'callUs').replace('{phone}', '\u0000')).replace('\u0000', '{{PHONE}}'), href: 'tel:{{PHONE_LINK}}', className: 'btn-ghost' },
    ]),
  );
  if (sec.variant === 'card') return sectionGroup(ctx, sec, 'alt', wrap(group({ className: 'map-card' }, info)));
  const title = esc(vars(str(ctx, 'mapTitle')));
  const frame = ctx.preview
    ? `<div class="map-frame"><div class="map-ph">${esc(str(ctx, 'mapPreview'))}</div></div>`
    : `<div class="map-frame"><iframe title="${title}" src="https://maps.google.com/maps?q={{ADDRESS_Q}}&amp;z=16&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>`;
  return sectionGroup(ctx, sec, 'alt', wrap(group({ className: 'map-grid' }, info, html(frame))));
}

/** Footer: the WordPress footer template part, or the end of the static page. */
export function footer(ctx: Ctx, sec: BuilderSection, nav: Array<{ label: string; href: string }>): string {
  const c = sec.content;
  const b = ctx.spec.business;
  const copyright = para(`© {{YEAR}} {{SITE_NAME}}. ${esc(str(ctx, 'rights'))}`, 'foot-copy');
  const link = (n: { label: string; href: string }) => `<a href="${n.href}">${esc(n.label)}</a>`;
  if (sec.variant === 'simple') {
    const contactLine = ['<a href="tel:{{PHONE_LINK}}">{{PHONE}}</a>', b.email ? '<a href="mailto:{{EMAIL}}">{{EMAIL}}</a>' : '', b.address ? '{{ADDRESS}}' : ''].filter(Boolean).join(' · ');
    return group(
      { className: `site-foot v-simple` },
      wrap(
        group(
          { className: 'foot-simple' },
          para('{{SITE_NAME}}', 'foot-name'),
          c.text ? para(rich(c.text)) : para('{{TAGLINE}}'),
          nav.length ? para(nav.map(link).join(' '), 'foot-links') : '',
          para(contactLine),
        ),
        copyright,
      ),
    );
  }
  const cols = [
    group({ className: 'foot-col foot-brand' }, para('{{SITE_NAME}}', 'foot-name'), para(c.text ? rich(c.text) : '{{TAGLINE}}')),
    group(
      { className: 'foot-col' },
      heading(3, esc(str(ctx, 'contact'))),
      b.address ? para('{{ADDRESS}}') : '',
      para('<a href="tel:{{PHONE_LINK}}">{{PHONE}}</a>'),
      b.email ? para('<a href="mailto:{{EMAIL}}">{{EMAIL}}</a>') : '',
    ),
    b.hours.length ? group({ className: 'foot-col' }, heading(3, esc(str(ctx, 'hours'))), ...b.hours.map((h) => para(`${esc(h.label)}: ${esc(h.value)}`))) : '',
    nav.length ? group({ className: 'foot-col' }, heading(3, esc(str(ctx, 'explore'))), ...nav.map((n) => para(link(n)))) : '',
  ];
  return group({ className: 'site-foot v-columns' }, wrap(group({ className: 'foot-grid' }, ...cols), copyright));
}

const RENDERERS: Record<Exclude<SectionType, 'footer'>, (ctx: Ctx, sec: BuilderSection) => string> = {
  hero,
  about,
  services,
  pricing,
  offer,
  testimonials,
  gallery,
  team,
  faq,
  contact,
  map,
};

export function renderSection(ctx: Ctx, sec: BuilderSection): string {
  return sec.type === 'footer' ? '' : RENDERERS[sec.type](ctx, sec);
}
