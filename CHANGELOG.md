# Changelog

All notable changes to Lares Panel are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor versions may contain
breaking changes; upgrading is always the install command run again
(`curl -sSL https://lares.thocode.dev/install | sudo bash`).

## [Unreleased]

### Changed
- Malware scan: unknown mu-plugins are reported on the first scan too, instead of being trusted. A cloned
  or migrated site used to bring its implant along unreported. Drop-ins (`db.php`, `object-cache.php`,
  `advanced-cache.php`...) are now tracked the same way; the acknowledge button covers them. After
  upgrading, a site's existing drop-ins (from a cache plugin, say) are reported once: check them and
  press the acknowledge button.

### Added
- Malware scan finds the parts that let an implant come back after cleaning:
  - PHP in hidden folders or files of `wp-content`;
  - hidden files and zips placed directly in `wp-content` or a theme folder;
  - drop-ins that write into `mu-plugins`;
  - every file named after, or mentioning, an unacknowledged mu-plugin (its plugin folder, marker
    files, a loader in the theme);
  - WP-Cron jobs no code registers (with a generated-looking name) or registered only by flagged files.
- Cleaning moves all of these out and deletes the flagged WP-Cron jobs directly in the database. When a
  bought theme or plugin loses a file, it says to reinstall a clean copy.

## [0.4.5-beta] - 2026-10-12

### Fixed
- Creating or cloning a site without a domain failed with "/var/www/site8001.localhost/public_html
  already exists and is not empty" when an earlier port-based site had since been given a real domain
  (its files stay in the old folder) or was deleted with its files kept. Lares now skips port numbers
  whose `siteNNNN.localhost` folder still exists.
- Cloning a WordPress site migrated from Webinoly left the old panel's `wp-config.php` (next to
  `public_html`) with the source site's database name and password. Every `wp-config.php` in the
  clone now points at the clone's own database.

## [0.4.4-beta] - 2026-10-12

### Fixed
- Deleting a site, changing its domain or turning SSL off no longer deletes a Let's Encrypt
  certificate that another nginx config still uses. After a same-VPS migration from Webinoly the old
  panel's vhost loads the same `/etc/letsencrypt/live/<domain>/` files, and deleting them made every
  later nginx change (new domain, SSL) fail with "cannot load certificate". Lares now keeps the
  certificate and says which file uses it.

## [0.4.3-beta] - 2026-10-12

### Fixed
- Cloning a WordPress site to a port (`siteNNNN.localhost`) failed with "Permission denied" on
  `wp-config.php` and rolled back. The copied files are now handed to the clone's user before Lares
  edits them, and `wp-config.php`/`.env` are written as that user instead of root.

## [0.4.2-beta] - 2026-10-11

### Added
- Security tab: **Not malware** on a finding (a false positive) after checking the file. Lares
  remembers the file's sha256; the finding no longer counts or blocks the release, and comes back if
  the file changes. Recorded in the security history.
- Optional **automatic quarantine** when the daily scan finds something new and critical (off by
  default), with a Telegram/webhook alert.
- Cleaning also resets `home`/`siteurl` pointing at another domain and sets random passwords for the
  remaining WordPress administrators (both on by default). `<script>` found in the database is listed
  in the to-do-by-hand list with a pointer to Adminer.
- An infected scan result now says what to do next and links to the quarantine.

### Fixed
- The scan never reported unknown `wp-*.php` files in the WordPress root (a common disguise for a
  backdoor) and never searched `wp-config.php` for malware code: both were treated as verified core
  files. Unknown root `wp-*.php` files are now reported (and moved out by cleaning); `wp-config.php` is
  checked but never moved.
- An image carrying PHP code was reported once and then disappeared from the next daily scan; cleaning
  could leave it in place. It is now reported until dealt with, and cleaning reads every media file.
- A quarantine whose nginx, firewall or process step failed still reported success, and could not be
  run again. Every step is now attempted, a failed one fails the task and shows on the Security tab
  with **Run quarantine again**. Cron jobs are removed before the site's processes are killed, and the
  kill is checked.
- Cleaning failed with "mkdir: cannot create directory '/var/www/<domain>': Permission denied" when
  the site folder was not the site user's any more: cleaning now gives it back first, and names the
  owners and modes along the path when that is not enough.
- A quarantined Next.js site could be released on a "clean" scan, which does not read its code: the
  release now always takes an explicit confirmation.

## [0.4.1-beta] - 2026-10-11

### Fixed
- Isolating a site (and creating one, cleaning, the code lock) failed with "find: Failed to change
  directory: /opt/lares/src/apps/server: Permission denied" on servers where that folder is not
  readable by other users (root umask 027/077): commands run as the site user now start from `/`.

## [0.4.0-beta] - 2026-10-11

### Added
- **Per-site isolation**: every site gets its own Linux user (`lares-s<id>`) and its own PHP-FPM
  (`lares-php-<id>.service`) running as that user inside a systemd sandbox (read-only system, private
  `/tmp`, other sites hidden, no exec from writable folders). Site folders are `0750`, so a site
  infected with malware can no longer read another site's `wp-config.php` or change its files. Next.js
  sites run as their own user with the same sandbox. The site page shows the state (Overview → Site
  isolation).
- `exec`, `shell_exec`, `proc_open`... are disabled for new PHP sites; a switch on the site page turns
  them back on.
- Outgoing firewall for site users (nftables): direct SMTP on port 25, the cloud metadata service and
  the panel/Adminer ports are blocked. The installer now installs `nftables` (the service stays off).
- **Per-site resource limits** (site page → Overview): max RAM and CPU for the site's PHP-FPM or
  Next.js app (cgroups: throttled near the limit, only the offending request is stopped above it, no
  swap), PHP workers (`pm.max_children`) and max MySQL connections (`MAX_USER_CONNECTIONS`), with
  current usage. Empty = no limit.
- **Malware scan** (site page → Security, daily at 04:30): WordPress core and plugin files against the
  wordpress.org checksums, PHP in uploads, `.user.ini` hooks, unknown mu-plugins, malware code
  patterns, files new or changed since the last scan, new administrators, a hijacked site URL,
  `<script>` in the database and the firewall's block log. Read-only, never runs the site's code. New
  findings go to the bell and, optionally, to the Telegram/webhook set up for leads.
- **Emergency quarantine**: 503 maintenance page, every outgoing connection of the site cut, PHP/Node
  and leftover processes stopped, cron removed, evidence backup (hidden from a normal restore, restoring
  it needs an explicit confirmation). Updates, cloning, wp-admin login, PHP settings and enabling the
  site are refused meanwhile.
- **Clean site**: WordPress core, plugins and themes replaced with copies from wordpress.org, flagged
  files moved to `.lares-quarantine/` outside the web root, salts and the database password changed,
  chosen administrators deleted, application passwords revoked, then a new scan. Releasing the
  quarantine needs a clean scan (or an explicit override, recorded).
- **Code lock** (per PHP site): the code belongs to root and PHP may only write to uploads/caches; panel
  updates and cleaning unlock for the job and lock again.
- Site users can no longer log in over SSH, tunnels included (group `lares-sites` in sshd's
  `DenyGroups`): `nologin` alone still allowed `ssh -N` with a key the site wrote into its own home.
- The site firewall logs every block with the site's user and limits each site to about 20 new outgoing
  connections per second.
- Resource limits can be set in the new-site form.
- **Notification bell** in the top bar (also on phones): a new Lares release, sites that could not be
  isolated, and events such as the result of the upgrade's site conversion. Read state is kept per
  account on the server. Features add their own notices (`registerNotificationSource` / `notify` in
  `services/notifications.ts`) without UI changes.

### Changed
- On upgrade, existing sites are converted to their own user and PHP-FPM one at a time, while they stay
  online. A failed step or a site answering 5xx afterwards rolls the site back; the reason is shown on
  the site page with a retry button. `LARES_SITE_ISOLATION=0` turns isolation off.
- nginx no longer follows symlinks whose owner differs from their target's
  (`disable_symlinks if_not_owner`) in PHP and static sites.
- `/var/www` is now `0711`: sites can no longer list each other's domains.
- The new-release notice moved from the sidebar footer to the bell.
- Site units get `IOWeight=50`: under disk contention MySQL and the panel come first.

### Fixed
- New WordPress sites were missing some WordPress 7 core files: `wp core download` unpacks with PHP's
  PharData, which cuts file names longer than 100 characters. Lares now unpacks with the system `tar`.
  Existing sites are repaired by Security → Clean site (core reinstall) or a core update.
- Restoring a backup taken before the database password changed now updates `DB_PASSWORD` in
  `wp-config.php` to the current password.
- `.user.ini` (PHP settings), the one-click-login mu-plugin and the port fix in `wp-config.php` are
  written with the site user's rights instead of root's, so a symlink planted by the site cannot
  redirect the write.
- Settings → Updates could show a "latest version" older than the running one (a check made just
  before a release was tagged, then upgraded). The panel now checks again after its version changes
  and never reports a latest version below its own.

## [0.3.0-beta] - 2026-10-10

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
- **Connect GitHub** (Settings → Integrations): Lares registers its own GitHub App for this server
  in two clicks (manifest flow, no third-party server), you choose which repos it may read, and the
  Next.js site form becomes a repo + branch picker. Clones use one-hour, read-only tokens scoped to
  that repo; the App's private key is stored encrypted and never leaves the server.
- **Private Git repos for Next.js sites**: an optional Access token (GitHub fine-grained token,
  GitLab/Bitbucket access tokens). Stored encrypted, passed to git through a temporary credential
  file, never in the clone URL, `.git/config` or the task log. A clear message when a repo needs one.
- **Upgrade from the panel** (Settings → Updates): **Upgrade to vX.Y.Z** runs the installer of that
  release in its own systemd unit (`lares-upgrade`), shows its log and survives the panel restart. A
  failed upgrade leaves the old version running. **Check now** button and a toggle to turn the daily
  update check off.

### Changed
- **Releases are `vX.Y.Z` tags.** `install.sh` installs the newest release tag instead of the `main`
  branch (`--branch main` or any branch/tag overrides it), and the panel's update check reads the
  tags too, so code pushed to `main` reaches nobody until it is released.

### Fixed
- **Next.js builds failing with `Cannot find module '@tailwindcss/postcss'`** (or any other
  devDependency): commands run as the web user no longer inherit the panel's environment, so
  `npm ci` installs devDependencies. Turbopack's build cache is cleared before each build so a
  failure cached by an earlier build does not repeat.
- **Security**: site code (npm install scripts, `next build`, wp-cli, artisan) could read the
  panel's environment, including `LARES_SECRET` and the admin and MySQL passwords. It now runs with
  a clean environment.
- Changing a Next.js site's Git URL now takes effect on the next deploy.
- Site page: the Domain card points to the DNS section of the SSL tab for the current domain's
  Cloudflare records (it only creates records when the domain changes), and the DNS section can
  create all missing records in one click.
- Failed builds show the actual error (e.g. "Failed to fetch Jost from Google Fonts") instead of
  the last lines of a stack trace.
- **Servers with an IPv6 address but no IPv6 route**: the installer detects it and makes the system
  prefer IPv4 (`/etc/gai.conf`), which fixes `next build` failing to download Google Fonts; the panel
  no longer uses such an address for AAAA records (Let's Encrypt would fail on it).
- `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` set in the panel's env file reach npm, git and builds,
  for servers that only have internet access through a proxy.

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

[Unreleased]: https://github.com/tampham92/lares/compare/v0.4.1-beta...HEAD
[0.4.1-beta]: https://github.com/tampham92/lares/compare/v0.4.0-beta...v0.4.1-beta
[0.4.0-beta]: https://github.com/tampham92/lares/compare/v0.3.0-beta...v0.4.0-beta
[0.3.0-beta]: https://github.com/tampham92/lares/compare/v0.2.0-beta...v0.3.0-beta
[0.2.0-beta]: https://github.com/tampham92/lares/releases/tag/v0.2.0-beta
