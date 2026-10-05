---
name: lares-design
description: Lares Panel design system - brand, logo, colour tokens, typography, spacing and component rules for the web UI (apps/web). Use before changing anything visual in the panel: styles.css, a page or component layout, colours, icons, the logo/favicon, a new card/form/table/modal, or when fixing broken or overflowing UI. Also use when reviewing UI changes made by other agents.
---

# Lares Panel design system

Lares Panel by ThoCode is a hosting control panel. Its users are freelancers, agencies and SME
owners who keep production websites on it, so the UI must feel **calm, trustworthy and precise**:
quiet neutrals, one brand colour used sparingly, dense but readable data, no decoration for its own
sake. Lares were the Roman guardians of the home; the brand story is "the guardian of your websites".

All styles live in `apps/web/src/styles.css` (plain CSS, design tokens as CSS variables, light and
dark mode via `prefers-color-scheme`). There is no CSS framework - keep it that way.

## Golden rules

1. **Use tokens, never raw colours** in components. If a colour is missing, add a token (light AND
   dark value) to `:root` in `styles.css`. `grep -rnE "#[0-9a-f]{3,8}|rgba?\(" apps/web/src --include=*.tsx`
   should return only the logo, the 2FA QR code (must stay black on white for scanners) and the
   article-preview iframe CSS in `AiWriter.tsx` (it imitates a white WordPress page).
2. **Contrast**: body text ≥ 4.5:1, filled buttons use `--primary-solid` (dark-mode `--primary` is for text/links only - white on it is 3.6:1).
3. **Brand colour is for action and selection only**: primary buttons, links, focus rings, the active
   nav item, progress, selected states. Never for large backgrounds or decorative text.
4. **Status colours mean status**: `ok` green, `warn` amber, `err` red, `info` brand. Don't reuse
   them for decoration.
5. **Every control is styled**: any new `input` type (time, date, url, search, file...) must be
   covered by the form-control selector in `styles.css` - unstyled native controls look broken in
   dark mode.
6. **Nothing overflows**: long paths, domains, tokens and IPs wrap (`overflow-wrap: anywhere`) or
   truncate with a title tooltip. Grid/flex children that hold such text need `min-width: 0`.
7. **Light and dark mode both** - check both before finishing.
8. **i18n**: every visible string goes through `t()` (see the i18n rules in the repo; English lives in
   `apps/web/src/i18n/en/*`). Design changes must not hard-code text.

## Brand

- **Name**: "Lares Panel" in titles/marketing, "Lares" in the UI chrome, "Lares Panel by ThoCode"
  on the login page and docs.
- **Logo**: `apps/web/src/components/Logo.tsx`.
  - `LogoMark` - the symbol: a rounded square in the brand gradient with a white house outline whose
    doorway holds an amber "hearth" flame. The flame is the only place amber is used decoratively.
  - `Logo` - mark + wordmark ("Lares", weight 700, letter-spacing -0.02em).
  - Favicon `apps/web/public/favicon.svg` is the same mark; keep them in sync.
  - Minimum mark size 20 px. Never recolour, stretch, add shadows or put the mark on the brand colour.

## Tokens (light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f7fb` | `#0b0d14` | page background |
| `--panel` | `#ffffff` | `#12151f` | cards, inputs, menus |
| `--panel-2` | `#f8f9fc` | `#171b27` | subtle fills: table head, code chips, hover |
| `--border` | `#e4e7ef` | `#232838` | 1 px borders, dividers |
| `--border-strong` | `#cfd4e0` | `#30364a` | input borders, hover borders |
| `--text` | `#111827` | `#e7e9f0` | body text |
| `--muted` | `#5b6478` | `#949bb0` | secondary text, labels |
| `--primary` | `#4f46e5` | `#7c74ff` | brand / action |
| `--primary-2` | `#4338ca` | `#958fff` | primary hover |
| `--primary-soft` | `#eef0ff` | `#7c74ff26` | selected / info backgrounds |
| `--on-primary` | `#ffffff` | `#ffffff` | text on primary |
| `--primary-solid` / `-2` | `#4f46e5` / `#4338ca` | `#6359f0` / `#6a61f5` | filled primary buttons (white text ≥ 4.5:1) |
| `--ok` / `--ok-soft` | `#15803d` / `#e9f8ef` | `#4ade80` / `#4ade801f` | success |
| `--warn` / `--warn-soft` | `#b45309` / `#fff6e5` | `#fbbf24` / `#fbbf241f` | warning |
| `--err` / `--err-soft` | `#c62828` / `#fdecec` | `#f87171` / `#f871711f` | error / destructive |
| `--sidebar` | `#0e1220` | `#080a10` | sidebar (dark in both modes) |
| `--sidebar-text` | `#a7aec2` | same | nav text |
| `--sidebar-active` | `#ffffff14` | same | active nav background |
| `--flame` | `#f59e0b` | same | logo hearth only |
| `--ring` | `0 0 0 3px var(--primary-soft)` | same | focus ring |
| `--shadow-sm` | subtle 1-2 px | none-ish | cards |
| `--shadow-lg` | modal/popover | | overlays |

Radius: `--radius` 12 px (cards, modals), `--radius-sm` 8 px (buttons, inputs, badges are pills).

## Typography

- Font stack: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  (no web-font download: the panel runs on customers' servers with a strict CSP).
- Base 14 px / 1.5. `h1` 22 px / 650, letter-spacing -0.015em. `h2` (card title) 15 px / 650.
  Labels 13 px / 550. Hints 12 px muted. Table headers 12 px / 600 uppercase, letter-spacing .04em.
- Numbers in stats and tables use `font-variant-numeric: tabular-nums`.
- Monospace (`code`, paths, IPs, logs): `ui-monospace, "SF Mono", Menlo, Consolas, monospace` 12.5 px.

## Spacing and layout

- 4 px grid: 4, 8, 12, 16, 20, 24, 32.
- Sidebar 232 px, dark in both modes. Main content max width none, padding 24 px (16 px on mobile).
- Top bar: 56 px strip above the content with a bottom border; right side holds the language
  switcher and the logout icon button. Page header (`.page-head`): title + subtitle left, actions right.
- Cards: `--panel`, 1 px `--border`, `--radius`, padding 20 px, `--shadow-sm` in light mode. Card
  title is an `h2`. Grid gap 16 px.

## Components

- **Buttons** (`.btn`): 34 px tall, radius 8, weight 550. Variants: default (panel + border),
  `.primary` (brand), `.danger` (red text) and `.danger.solid`, `.sm` (28 px), `.ghost` (no border).
  One primary button per card/form. Disabled = 50% opacity, no hover.
- **Icon buttons** (`.icon-btn`): 34 px square, same border as `.btn`; destructive hover = `--err`.
- **Inputs / selects / textareas**: 36 px tall, `--panel` background, `--border-strong` border,
  radius 8; focus = brand border + `--ring`. Placeholder `--muted`. `select.compact` / `.lang-switch`
  is the small 30 px variant for toolbars and the login footer.
- **Checkboxes/radios**: native, `accent-color: var(--primary)`.
- **Tables**: header row `--panel-2`, rows separated by `--border`, row hover `--panel-2`. Wrap
  in `.table-wrap` for horizontal scroll on mobile.
- **Badges**: pill, 12 px / 600, soft background + strong text of the status colour.
- **Alerts**: soft background, 1 px border of the status colour at low opacity, radius 8.
- **Tabs**: underline style, active = brand text + 2 px brand underline.
- **Console/logs**: always dark (`--code-bg`), monospace; warn amber, error red.
- **Modals**: `--panel`, `--radius`, `--shadow-lg`, backdrop `rgba(5, 8, 18, .6)`.
- **Empty states** (`.empty`): centred muted text, optional action button.

## Checklist before finishing a UI change

1. `npm run typecheck` and `npm run build` pass; `apps/server/test/i18n.test.ts` passes.
2. Screenshot the changed pages in **light and dark** (headless Chrome against a dry-run server works:
   log in via the API, put the token in `localStorage.lares_token` with an external helper script -
   inline scripts are blocked by the CSP).
3. Check at 1280 px and a phone width: no horizontal page scroll, no text spilling out of cards. Headless
   Chrome cannot go below ~500 px wide (narrower windows are cropped, not reflowed) - test 500 px there
   and use real device/devtools emulation for 390 px.
4. No raw colours added in `.tsx` files; new controls covered by the token styles.
