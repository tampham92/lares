# Landing page (lares.thocode.dev)

Static HTML/CSS, no build step and no third-party requests. Deployed as a Cloudflare Worker with static assets.

- `index.html` (Vietnamese) and `en/index.html` (English) are a pair: change both.
- `assets/site.css` reuses the panel's design tokens (see `.claude/skills/lares-design/SKILL.md`).
- `_headers` sets a strict CSP: no inline scripts or styles, nothing loaded from other origins.
- Every VPS install clones the whole repo, so keep this folder small (WebP screenshots, a few hundred KB).

## Screenshots

`assets/shots/{vi,en}/*.webp` are taken from a dry-run panel with demo sites (1440 px wide at 2x,
re-encoded with `cwebp -q 80`; the feature shots have the sidebar cropped off). `assets/og-*.jpg` are
the 1200x630 share images. Retake them when the panel UI changes noticeably.

## Deploy (Cloudflare Workers, static assets)

`wrangler.jsonc` serves this folder as a Worker named `lares-site` on the route `lares.thocode.dev/*`.
`.assetsignore` keeps the config and this README out of the public files.

Dashboard (Workers & Pages > the Worker > Settings > Build):

- Git repository `tampham92/lares`, branch `main`
- Root directory `site`, build command empty, deploy command `npx wrangler deploy`
- Build watch paths: include `site/*`

The Worker name in the dashboard must match `name` in `wrangler.jsonc`.

No DNS change is needed: `lares.thocode.dev` keeps its proxied placeholder record (`AAAA 100::`). The
Redirect Rules for `/install` and `/uninstall` run before Workers, and the more specific route
`lares.thocode.dev/ping` (telemetry Worker) wins over `/*`. Check after a deploy:

```bash
curl -sI https://lares.thocode.dev/ | head -1                                 # 200
curl -sI https://lares.thocode.dev/install | grep -i location                 # raw.githubusercontent.com/.../install.sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lares.thocode.dev/ping   # 400 (empty body)
```
