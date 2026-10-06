# AGENTS.md

Lares Panel: a self-hosted hosting control panel (WordPress, Next.js/Node, PHP, static sites) that
installs on a VPS with `curl | bash`. It runs as root on customers' production servers, so treat
every shell command, path and generated config as security-sensitive.

## Layout

- `apps/server` - Fastify API + CLI (`src/cli.ts`), SQLite (`src/db`), system work in `src/services`.
- `apps/web` - React + Vite SPA, plain CSS in `src/styles.css` (no CSS framework).
- `packages/shared` - zod schemas and types shared by server and web (`@lares/shared`).
- `templates/` - site templates; `install.sh` / `uninstall.sh` - the VPS installer; `ops/` - telemetry worker.
- `site/` - the landing page at lares.thocode.dev (static, Cloudflare Worker, see `site/README.md`).
- `docs/vi` and `docs/en`, `README.md` and `README.en.md`, `site/index.html` and `site/en/index.html`
  are pairs: change both.

## Commands

```bash
npm run typecheck   # all workspaces
npm test            # vitest in apps/server (also covers web i18n)
npm run build       # web then server
npm run dev         # server (tsx watch) + vite
```

CI (`.github/workflows/ci.yml`) also runs `bash -n` and `shellcheck -S warning` on `install.sh` and
`uninstall.sh`, then a real install/upgrade/uninstall on Ubuntu 22.04/24.04. Run shellcheck locally
when touching the scripts.

## Dry-run (developing on a laptop)

On anything but Linux the server is in dry-run mode (`LARES_DRY_RUN=1` forces it): commands that
change the system are only logged and all paths live under `LARES_DATA_DIR` (default `./data`).

- Use `host.mutate()` for anything that changes the machine (nginx reload, chown, mysql, certbot);
  `host.exec`/`host.run` are for reads. Code that bypasses `mutate` will really run on a dev machine.
- Site code (wp-cli, npm scripts, artisan) must run through `host.asWebUser()`, never as root.
- Quote every interpolated shell value with `shq()` (`src/lib/shell.ts`).

To run the built panel locally:
`LARES_DATA_DIR=<tmp> LARES_PORT=18990 LARES_HOST=127.0.0.1 LARES_ADMIN_PASSWORD=<pw> NODE_ENV=production node apps/server/dist/index.js`

## i18n (enforced by `apps/server/test/i18n.test.ts`)

- Source strings are **Vietnamese**, written inline: `t('Đã lưu {path}', { path })`. Use `msg()` for
  strings defined outside a render/call (constant tables) and translate them with `t()` when shown.
- Every msgid needs English in the matching dictionary: `apps/web/src/i18n/en/*.ts`,
  `apps/server/src/i18n/en/*.ts` (one file per feature, registered in that folder's `index.ts`), or
  `packages/shared/src/i18n-en.ts`.
- Server: `t()` uses the request's language; `tDefault()` uses the panel default (`LARES_LANG`) for
  text written to disk or logs. Vietnamese outside `t()`/`msg()`/comments fails the test unless the
  line carries `// i18n-ignore`.

## Code conventions

- Validation schemas live in `packages/shared` and are reused by the route (`parse(schema, body)`)
  and the form.
- Pure rules go in a separate I/O-free module (`backupPolicy.ts`, `wpUpdatePolicy.ts`) so they are
  unit-testable; keep that split when adding logic.
- Long or system-changing work runs as a task (`startTask`) whose log the UI follows. Per-site
  backup/restore/WordPress-update jobs share one lock: use `startLocked()` in `services/backups.ts`.
- Comments explain *why* and the security reasoning; match the existing density.

## Things that are easy to break

- **Adminer** (`services/adminer.ts`): the file is pinned by version and SHA-256, served by an nginx
  block on 127.0.0.1 that requires a secret header, and logged in with one-time tickets. Upgrading
  the version means updating `ADMINER_VERSION` and `ADMINER_SHA256` and re-checking the generated
  `index.php` against that version's Adminer API (Adminer 6 only accepts a MySQL socket as `:/path`).
- **Backup roots and site roots** go through the path checks in `backupPolicy.ts`; never build a
  path from a domain or id without them.
- **Secrets** (API tokens, passwords) are encrypted server-side and never sent back to the browser;
  views return masked values only.

## UI work

Load the `lares-design` skill (`.claude/skills/lares-design/SKILL.md`) before any visual change: design
tokens only (no raw colours in `.tsx`), light and dark mode, no overflow at phone width.

To screenshot pages: log in via `POST /api/auth/login`, then set `localStorage.lares_token` through
the Chrome DevTools Protocol (headless Chrome with `--remote-debugging-port`): the panel's CSP blocks
inline scripts, so a script tag or bookmarklet will not work.

## Releases

`CHANGELOG.md` follows Keep a Changelog: add user-facing changes under `[Unreleased]`. The version in
the root `package.json` is what the panel reports (CI checks it).
