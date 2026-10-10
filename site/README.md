# Landing page (lares.thocode.dev)

Static HTML/CSS, no build step. The only third-party request is Cloudflare Web Analytics (cookieless; allowed in the CSP in `_headers`). Deployed as a Cloudflare Worker with static assets.

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

Deployed by GitHub Actions (`.github/workflows/site.yml`), not by Cloudflare's Git integration:

- a push to `main` that changes `site/` runs `wrangler deploy`, then checks the page answers;
- a pull request that changes `site/` only runs `wrangler deploy --dry-run` (no token, nothing uploaded);
- **Actions → Landing page → Run workflow** deploys `main` by hand.

Repository secrets: `CLOUDFLARE_API_TOKEN` (an API token with *Account → Workers Scripts → Edit* and
*Zone → Workers Routes → Edit* on `thocode.dev`) and `CLOUDFLARE_ACCOUNT_ID`. The Worker must not also be
connected to the repository in the dashboard (Settings > Build > Git repository: disconnected), or every
branch would be built twice.

The Worker name in the dashboard must match `name` in `wrangler.jsonc`.

No DNS change is needed: `lares.thocode.dev` keeps its proxied placeholder record (`AAAA 100::`). The
Redirect Rules for `/install` and `/uninstall` run before Workers, and the more specific route
`lares.thocode.dev/ping` (telemetry Worker) wins over `/*`. Check after a deploy:

```bash
curl -sI https://lares.thocode.dev/ | head -1                                 # 200
curl -sI https://lares.thocode.dev/install | grep -i location                 # raw.githubusercontent.com/.../install.sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lares.thocode.dev/ping   # 400 (empty body)
```
