# Lares Panel

**Lares Panel by [ThoCode](https://thocode.dev)** · Tiếng Việt: [README.md](README.md)

> Formerly TPanel. On a server that runs TPanel, just run the install command again: the installer moves the data to Lares (`/etc/lares`, `/var/lib/lares`, service `lares`) and keeps every site.

A hosting control panel written in TypeScript for Ubuntu/Debian VPS: manage **WordPress** and **Next.js** websites (plus plain PHP and static HTML), SSL, traffic logs, databases, and **migrate sites from another VPS/panel**.

## Installation

On the target VPS (Ubuntu 20.04/22.04/24.04, Debian 11/12), run as root:

```bash
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en
# options:
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en --port 9443 --php "8.3 8.2"
```

`lares.thocode.dev/install` redirects to `install.sh` on GitHub. If that domain is unreachable, use the direct link: `https://raw.githubusercontent.com/tampham92/lares/main/install.sh`.

The script installs Nginx, MariaDB, PHP-FPM (several versions), Node.js LTS, Certbot and WP-CLI. It then downloads and builds Lares, creates the `lares` service (systemd), and prints the URL `https://IP:8686` with the admin password. Run the same command again to **upgrade**; data and passwords are kept.

### Language

Lares comes in **Vietnamese** (the default) and **English**.

- `--lang vi|en` sets the installer's language and the panel's default language (saved as `LARES_LANG` in `/etc/lares/lares.env`, used for startup logs and the `sudo lares` command). Without `--lang`, an upgrade keeps the saved language. `uninstall.sh` accepts `--lang` too.
- The web UI has a language switcher in the sidebar and on the login page. On first visit it follows the browser language (Vietnamese if the browser prefers neither Vietnamese nor English); the choice is remembered in that browser.

### VPS that already runs Nginx / MySQL / MariaDB / Apache

The installer **detects and reuses** existing services instead of installing over them:

| Already installed | What happens |
|---|---|
| MariaDB / MySQL / Percona (from apt or built by another panel) | No second server is installed; a dedicated `lares` user is created. Admin login goes through the unix socket, `/etc/mysql/debian.cnf`, or `--mysql-root-password 'xxx'` if root has a password. The `test` database and existing users are left alone |
| nginx (apt) | Reused; existing vhosts and the `default` site are kept. The catch-all is skipped if the server already has a `default_server`. If `nginx -t` currently fails, the installer stops and asks you to fix it first |
| Another web server holding port 80/443 (Apache, OpenLiteSpeed, aaPanel's nginx…) | **Coexist mode**: Lares's nginx is installed but not started. You can still create/migrate sites as usual; when ready, stop the old web server and run `systemctl enable --now nginx` |
| PHP-FPM | Reused; `php.ini` of existing versions is not modified |
| Node.js older than 20 in `/usr/bin` | Upgraded to Node 22 (Lares needs ≥ 20). Node installed via nvm is not affected |

> By default the script fetches the source from `https://github.com/tampham92/lares` (branch `main`). To use a fork or another branch: `--repo <git-url> --branch <branch>`, or `--tarball <.tar.gz url>`.

### Does updating Lares lose data?

No. Run the exact install command again; the installer finds `/etc/lares/lares.env` and switches to **upgrade** mode:

- Only the source code in `/opt/lares/src` is replaced, rebuilt, and the `lares` service restarted (the panel is down for a few seconds, **websites keep running**).
- Kept as is: websites in `/var/www`, MySQL databases, nginx vhosts, SSL, Next.js services, the admin account, the decryption key and the SQLite data in `/var/lib/lares`. Lares's database schema is upgraded automatically on startup.
- Before restarting, the installer backs up `/etc/lares` + the SQLite database + your custom templates to `/var/lib/lares/backups/` (the 5 most recent are kept).
- Don't edit files in `/opt/lares/src` directly (they are overwritten on update); put custom templates in `/var/lib/lares/templates/`.

### Admin account

`install.sh` prints the `admin` password exactly once. It is stored only as a bcrypt hash in `/var/lib/lares/lares.db`; the plaintext is removed from `lares.env` right after installation.

```bash
sudo lares users                       # list accounts
sudo lares reset-password              # reset the admin password (random, printed on screen)
sudo lares reset-password admin --password 'NewPassword123'
```

To change the password in the UI: **Settings → Change admin password**.

### Uninstall

```bash
# Remove the panel, KEEP the running websites (reinstalling picks the sites up again):
curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --lang en

# Remove the panel + every site, database, SSL certificate and log Lares created (asks you to type DELETE to confirm):
curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --lang en --purge
```

Neither mode removes nginx/MariaDB/MySQL/PHP/Node.js, and neither touches sites or databases Lares did not create (including databases "shared" with another panel).

## Features

| Area | Details |
| --- | --- |
| Websites | Add/delete/suspend sites, aliases, switch PHP version. Site types: **WordPress** (downloads WP, creates the DB, wp-config, runs `wp core install` if you enter an admin), **Next.js** (systemd service + Nginx reverse proxy, automatic port, clone from Git, build/restart), PHP, static HTML |
| Templates | When creating a **WordPress** or **static HTML** site, pick a ready-made design (currently *Real estate* and *Business*, previewable right in the panel) and just enter the brand name, phone, email and address. Static HTML: a complete responsive page with project filtering and a contact form. WordPress: a dedicated block theme with realistic sample content (project posts with images, About/Contact pages, menu, home page), editable in wp-admin; the admin account is created automatically. Add your own templates in `/var/lib/lares/templates/` on the VPS (kept across updates), see [templates/README.en.md](templates/README.en.md) |
| Sites without a domain | Enter `localhost` (or leave it empty) instead of a domain: Lares assigns a port (from 8001), nginx listens on it, and the site is reachable at `http://VPS-IP:8001`. The port is opened in ufw if it is active. Once the design is done, click **Assign a domain** on the site page: the vhost switches to the domain, the port is closed, traffic logs are kept, and every WordPress URL is rewritten. Then install SSL (WordPress switches its URLs to `https://` automatically) |
| Clone site | The **Clone** tab on the site page: copy the site to another domain or a new port (for staging, trying plugins/themes). The whole site directory and database are copied to a new database (new user/password). WordPress: wp-config points to the new database and every URL is changed to the new address. Laravel/PHP: `DB_*` and `APP_URL` in `.env` are updated. Next.js: its own service on a new internal port. The source site is not modified; a failure midway rolls back automatically |
| AI Writer (WordPress) | The **AI Writer** tab of a WordPress site: enter a topic + keyword and the AI (Claude, Gemini or OpenAI/compatible API) writes an SEO-ready article: title ≤ 60 characters, slug, meta description, H2/H3, FAQ, internal links to existing posts. Preview, edit, watch the SEO checklist update live, then save as draft or publish directly (with categories, tags, and meta for Yoast SEO / Rank Math). Publishing needs wp-cli |
| One-click WP Admin login | The **WP Admin** button in the site list and on the site page opens wp-admin already logged in (as the first administrator), no password needed. The link is single-use and expires after 60 seconds (mu-plugin `tpanel-sso.php`, the token is stored only as SHA-256 outside the web root) |
| AI API key | **Settings → AI Writer**: choose the provider and model, enter the API key (encrypted with AES-256-GCM in SQLite, never sent back to the browser), connection test button |
| Next.js | No database required; JSON data lives in the app directory and is kept across redeploys. Detects npm/yarn/pnpm from the lockfile, lets you edit the install/build/start commands and environment variables (`.env.production.local`, values encrypted in the DB), and shows the application log (journald) |
| SSL | Let's Encrypt (shared HTTP-01 webroot, works with Next.js proxy sites too), including aliases, staging, renewal; or upload your own certificate (checks that the key matches). Toggle forced HTTPS + HSTS, warnings when DNS does not point here yet or a certificate is about to expire |
| Traffic logs | Separate access/error logs per site. Stats for 1h/24h/7 days/30 days: requests, unique IPs, bandwidth, average response time, 2xx–5xx, hourly/daily charts, top URLs/IPs/referrers/user agents (rotated `.gz` logs are read too). Tail + filter, download, delete, logrotate settings |
| Databases | Create/delete MySQL/MariaDB databases; passwords are encrypted and shown only on click |
| Migration | See below |

## Migrating sites from another VPS / panel

**Migration** → enter the source server (IP, SSH user, password or private key, sudo), choose the source panel → **Scan sites** → select sites and adjust options → **Start**.

Supported and auto-detected panels: **aaPanel, CyberPanel, HestiaCP/VestaCP, cPanel, DirectAdmin, CloudPanel, Plesk, Webinoly**, plain Nginx/Apache VPS, or manual entry.

For each site:

1. **Prepare**: check the source directory, target domain and source DB login, estimate the size, choose the transfer method.
2. **Dump & compress the database**: `mysqldump --single-transaction --routines --triggers | pigz/gzip`. If the user lacks the privilege to dump routines, the dump is retried without them.
3. **Compress the source code**: `tar | gzip`, skipping paths in excludes (`wp-content/cache`, `node_modules`, `.next`, nested addon domains...).
4. **Transfer**: *archive* (compress on the source → SFTP, sha256 check) or *stream* (compress and send straight over SSH, no free space needed on the source). *auto* mode picks one based on free space.
5. **Verify integrity**: sha256, `gzip -t`, and the dump file must contain the `Dump completed` line.
6. **Create the site, restore files, import the DB** into a new database with the site's own user. `DEFINER` clauses are stripped and collations converted between MySQL 8 ↔ MariaDB.
7. **Reconfigure**: update `DB_*` in `wp-config.php`/`.env`, run a WordPress search-replace of the domain with wp-cli if the domain changes. For Next.js: install, build, then start the service.
8. **Finalize & clean up**: set permissions, reload nginx, delete temp files on both sides (files containing DB passwords are always deleted). On failure, the newly created site/DB is **rolled back** automatically.

Progress is updated in real time (SSE), with cancel and retry for failed sites. Data on the source is **never modified**.

### When the source panel runs on the same VPS as Lares

Lares detects this through `machine-id` or local IPs, even if you enter the VPS's own public IP:

- SSH is skipped and the work happens directly on the machine. Files are copied straight over, without compression or network transfer.
- By default the database is **dumped into a new database** so the old site keeps running side by side. On the same MySQL server you can choose to **reuse** the old database instead (Lares checks `@@hostname/@@port/@@datadir`). A reused database is never deleted by Lares, and it is not search-replaced either, to avoid breaking the source site.
- Warns when port 80 is held by the old panel's web server (e.g. CyberPanel's OpenLiteSpeed, aaPanel's nginx), or when a `server_name` may clash.
- Webinoly keeps `wp-config.php` outside `htdocs`: the file is brought into the site directory automatically.

## Development

```bash
npm install
npm run dev          # server :8686 (tsx watch) + web :5173 (Vite, proxies /api)
npm test             # parser unit tests (nginx/apache/cPanel/Hestia, wp-config, .env, access log)
npm run typecheck
npm run build
```

If nginx is installed locally (`brew install nginx`), Lares runs a **dev nginx** (no root needed) that serves port-based sites, so you can view HTML sites at `http://localhost:8001`. WordPress/PHP sites only really run on a VPS (they need PHP-FPM + MySQL).

Outside Linux, Lares always runs in dry-run mode: every system-changing command (nginx reload, systemctl, certbot, mysql, chown) is only **logged**, and site/vhost files are written to `./data`. The initial admin password is printed to the log (or set `LARES_ADMIN_PASSWORD`). Configuration variables are listed in [.env.example](.env.example); set `LARES_LANG=en` for English startup logs and CLI output.

## Layout

```
packages/shared      Zod schemas + types shared by server and web (and the i18n core)
apps/server          Fastify API (runs as root on the VPS)
  src/executors      Run commands locally / over SSH (ssh2): streaming, SFTP, cancel, host-key pinning
  src/services       nginx, php, mysql, sites, nodeapp (Next.js), wordpress, ssl, logs, tasks
  src/migration      panels/ (adapters + parsers), appDetect, source (connect/scan), runner (pipeline), repo
  src/routes         REST + SSE
templates/           Templates: _base.css, _wp.css + <id>/{template.json, style.css, index.html, wordpress/home.html}
apps/web             React 19 + Vite + TanStack Query
install.sh           One-command installer
```

Locations on the VPS: data `/var/lib/lares` (SQLite, secret), sites `/var/www/<domain>/{public_html|app}`, logs `/var/log/lares/sites/<domain>/`, vhosts `/etc/nginx/sites-available/<domain>.conf`, Next.js services `tpanel-app-<domain>.service`.

## Security

- Source SSH/DB passwords, DB passwords and Next.js environment variables are encrypted with AES-256-GCM in SQLite.
- Every shell argument is quoted; domains, paths and excludes are validated with Zod on both server and web.
- Code and SQL dumps from migrated sites are treated as **untrusted**: SQL is imported with the site's own user (never root), wp-cli/artisan/npm run as `www-data`, setuid/setgid bits are stripped, and archives are extracted with `--no-same-owner`.
- The SSH host key is pinned after the first *Test connection*; if the key changes, the migration stops.
- The admin panel runs over HTTPS (self-signed certificate, replaceable via `LARES_TLS_CERT/KEY`), login is rate-limited, and SSE tokens are masked in logs.

## Current limitations

- All sites run as the same `www-data` user (no per-site user/PHP-FPM pool yet).
- Database migration supports MySQL/MariaDB only; Next.js sites using an external DB (Postgres, Mongo...) need that DB moved by hand.
- Secret Next.js environment variables that are not in the source code (e.g. kept in the old panel's process manager) must be entered again.
