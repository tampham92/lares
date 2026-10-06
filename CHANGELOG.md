# Changelog

All notable changes to Lares Panel are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor versions may contain
breaking changes; upgrading is always the install command run again
(`curl -sSL https://lares.thocode.dev/install | sudo bash`).

## [Unreleased]

### Added
- **Site builder** ("Tự tạo giao diện"): answer a few questions (industry, business info, brand
  colour, style, sections) and get a complete static or WordPress site with a live preview. 12
  section types / 27 layouts, a palette generated from one colour with WCAG AA contrast, 4 styles
  with bundled fonts (no external CDN). Save a design as your own template, import/export JSON.
- **Three new free templates**: Spa, Restaurant / café (`nha-hang`) and Single-product landing page
  (`ban-san-pham`), built with the site builder.
- **Contact leads**: forms on every site post to `/_lares/lead`; leads land in a "Contact leads"
  inbox (filters, notes, CSV export) and are sent to Telegram and/or a webhook (Make, n8n, Google
  Sheets). Retention is configurable (default 12 months). The built-in templates use it.
- **Safe WordPress updates**: core/plugin/theme inventory with a "Updates" tab; updates run after a
  backup, the site is health-checked afterwards and automatically restored if it broke. History of
  every run.
- **Cloudflare DNS**: connect an API token; creating a site or assigning a domain creates the A/AAAA
  records (DNS only), with conflict protection, DNS status and a proxy toggle in the SSL tab.
- **Per-site PHP settings** (upload size, memory, execution time, input vars) with presets; nginx
  `client_max_body_size` follows the upload size.
- **Adminer** with one-click login from the Databases page, reachable only through the panel.
- **Getting started checklist** on the dashboard (allowlist, 2FA, panel domain, first site, backups).

## [0.2.0-beta] - 2026-10-04

First public beta under the name **Lares Panel by ThoCode**.

### Added
- **Login protection**: at most 10 login attempts per minute per IP, and a username is locked for
  15 minutes after 5 failures in 15 minutes. `sudo lares reset-password` clears the lockout.
- **Session revocation**: **Log out everywhere** in Settings. Changing the password logs out the
  other sessions. Security headers for the panel (CSP, frame, content-type and referrer policies).
- **Two-factor authentication (TOTP)** with 10 single-use recovery codes. Recovery from SSH:
  `sudo lares disable-2fa [user]`.
- **Panel IP allowlist** (IPs or CIDR ranges): `sudo lares allowlist show|add|remove|clear`.
  Loopback is always allowed, so an SSH tunnel always gets in.
- `LARES_TRUST_PROXY` to trust `X-Forwarded-For` from a reverse proxy you choose.
- **Cloudflare real visitor IP** in nginx (on by default, toggle in Settings). Ranges are refreshed
  daily and rolled back if `nginx -t` fails.
- **Panel domain**: a Let's Encrypt certificate for the panel (`lares-panel`, auto-renewed and
  reloaded with SIGHUP / `systemctl reload lares`).
- **Site backups**: manual and daily scheduled backups of files and databases under
  `/var/backups/lares`, with download, retention and restore (a safety backup is taken first and a
  failed restore is rolled back).
- **Websites**: WordPress (download, database, `wp-config.php`, optional `wp core install`), Next.js
  (systemd service + nginx reverse proxy, Git clone, install/build/start commands, encrypted
  environment variables, app logs), plain PHP and static HTML; aliases, PHP version switch,
  suspend/resume.
- **Sites without a domain**: served on a port (8001+), later moved to a real domain with
  **Assign a domain** (vhost, logs, Next.js service and every WordPress URL follow).
- **Templates**: ready-made *Real estate* and *Business* designs as static HTML or as a generated
  WordPress block theme with sample content; your own templates in `/var/lib/lares/templates`.
- **Clone site** to another domain or port (files + a copy of the database, URLs rewritten,
  automatic rollback on failure).
- **AI Writer** for WordPress: SEO articles with Claude, Gemini or an OpenAI-compatible API,
  live SEO checklist, publish as draft or post with categories, tags and Yoast / Rank Math meta.
- **One-click WP Admin** login (single-use link, expires after 60 s).
- **SSL**: Let's Encrypt (shared HTTP-01 webroot, aliases, staging, renewal) or your own certificate;
  forced HTTPS + HSTS; DNS and expiry warnings.
- **Traffic logs**: per-site access/error logs, statistics (requests, unique IPs, bandwidth, status
  codes, top URLs/IPs/referrers/user agents), tail, download, logrotate settings.
- **Databases**: create/delete MySQL/MariaDB databases, encrypted passwords.
- **Migration** from another server or panel over SSH: aaPanel, CyberPanel, HestiaCP/VestaCP,
  cPanel, DirectAdmin, CloudPanel, Plesk, Webinoly, plain nginx/Apache, or manual. Includes a
  same-VPS mode that copies directly, can reuse the existing database, and rolls back on failure.
- **English UI** alongside Vietnamese: language switcher, server messages and logs follow the
  chosen language, `--lang vi|en` for the installer and uninstaller.
- **One-line installer** that detects and reuses existing nginx / MySQL / MariaDB / PHP-FPM,
  coexists with another web server on port 80/443, upgrades in place with a backup of Lares's own
  data, and an `uninstall.sh` that keeps sites by default (`--purge` removes everything Lares created).
- `sudo lares` admin CLI: `users`, `reset-password`.
- **Version and update notice**: the running version is shown in the sidebar; the panel checks
  GitHub once a day and shows "New version x.y.z" with the upgrade command.
- **Anonymous install counter** (opt-out): one ping on install/upgrade and one heartbeat per day
  with a random install id, version, OS, architecture and panel language only. Disable with
  `--no-telemetry` or `LARES_TELEMETRY=0`. See [docs/en/installation.md](docs/en/installation.md#telemetry).
- Documentation in `docs/` (Vietnamese and English), CI (typecheck, tests, build, ShellCheck,
  install smoke test on Ubuntu 22.04 and 24.04).
- License: GNU AGPL-3.0.

### Changed
- `X-Forwarded-For` is no longer trusted by default.
- Upgrading logs every user out once (sessions now support revocation).
- `uninstall.sh --purge` also removes the panel certificate and the Cloudflare/panel nginx files,
  but never the site backups.
- Officially supported systems: **Ubuntu 22.04 / 24.04 and Debian 12**. Debian 13 installs with a
  "not yet tested" warning. Ubuntu 20.04 and Debian 11 (end of life) are refused unless
  `--force-unsupported` is given.
- `install.sh --tarball` also accepts a local path or `file://` URL and flat archives.

### Fixed
- Re-running the installer (upgrade) no longer resets a custom `--port` to 8686, and no longer
  installs the default PHP versions again: the saved port and PHP list are kept.

[Unreleased]: https://github.com/tampham92/lares/compare/v0.2.0-beta...HEAD
[0.2.0-beta]: https://github.com/tampham92/lares/releases/tag/v0.2.0-beta
