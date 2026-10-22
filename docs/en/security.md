# Security hardening

[Tiếng Việt](../vi/security.md) · [Docs index](../README.md)

The panel runs as root and controls every site on the server, so protect it like SSH. After a fresh
install, port 8686 is open to every IP. Work through this checklist:

1. [ ] Change the `admin` password (**Settings → Change admin password**)
2. [ ] Turn on [two-factor authentication](#two-factor-authentication-2fa)
3. [ ] Limit the panel to your IPs with the [IP allowlist](#panel-ip-allowlist)
4. [ ] Set a [panel domain](#panel-domain-and-trusted-certificate) to get a trusted certificate
5. [ ] Configure the [firewall](#firewall) and [SSH](#ssh-basics)
6. [ ] Keep Lares and the OS [up to date](#updates), and set up [backups](backups.md)

## Built-in protection

- HTTPS only. Secrets (DB/SSH passwords, API keys, Next.js env values, Git access tokens, the GitHub App key) are encrypted with
  AES-256-GCM in SQLite. Security headers (HSTS, frame, content-type and referrer policies) are sent.
- **Brute-force protection**: at most 10 login attempts per minute per IP. After 5 failed logins in
  15 minutes, the username is locked for 15 minutes. `sudo lares reset-password [user]` clears the
  lockout.
- **Sessions can be revoked**: **Settings → Sessions → Log out everywhere** ends all sessions. Changing the
  password logs out the other sessions, and `sudo lares reset-password` logs out every session of
  that user.
- **Site code runs with a clean environment**: npm scripts, `next build`, wp-cli and artisan run as
  the site's own user without the panel's environment variables (secret key, admin and MySQL passwords).
- **GitHub App**: each panel registers its own App (Settings → Integrations → GitHub) with read-only
  access to code. Its private key stays on the server; git only receives a one-hour token scoped to
  the one repo being cloned, through a temporary file that is deleted afterwards.
- `X-Forwarded-For` is **not trusted** by default (see [Reverse proxy](#running-the-panel-behind-a-reverse-proxy)).

## Per-site isolation

Every site has its own Linux user (`lares-s<id>`) and its own PHP-FPM, so a site infected with malware
(usually through a vulnerable WordPress plugin) does not spread to the others:

- **Files**: the site folder belongs to the site's user, mode `0750` (files `0640`, `wp-config.php` and
  `.env` `0600`). Other sites cannot enter it. nginx reads static files through the site's group and
  does not follow symlinks to files owned by someone else (`disable_symlinks if_not_owner`).
- **Own PHP-FPM** (`lares-php-<id>.service`): runs as the site's user, with no root process, its own
  OPcache and sessions. systemd keeps it in a sandbox: read-only system, private `/tmp`, the other
  sites' folders hidden, Lares' data and secrets inaccessible, and no executing files dropped in the
  site folder or `/tmp`. Next.js sites get the same sandbox.
- **System commands**: `exec`, `shell_exec`, `proc_open`... are off for new sites. Turn them back on
  in the site page → Overview → Site isolation when a plugin really needs them.
- **Outgoing connections** (nftables, per site user): direct mail on port 25 (spam), the cloud
  metadata service (169.254.169.254) and the panel/Adminer ports on the machine are blocked. Sending
  mail through SMTP (587/465) still works. Each site opens at most about 20 new connections per second
  (botnets, port scans, outgoing DDoS are cut short). Every block goes to the kernel log with the
  site's user (`journalctl -k -g lares-block`), and the malware scan reads it back.
- Site users have no password, no shell, are listed in `/etc/cron.deny` and belong to the group
  `lares-sites`, which sshd refuses (`/etc/ssh/sshd_config.d/lares-sites.conf`): no login, no SSH
  tunnel, no scheduled jobs.
- Under disk contention MySQL and the panel come before the sites (`IOWeight`).

**Resource limits** (when creating the site, or site page → Overview → Resource limits), empty = no limit:

- **Max RAM** and **max CPU** (100% = one core) for the site's PHP-FPM or Next.js app, through cgroups.
  Near the RAM limit the site is slowed down; a request going over it is the only one stopped (502),
  the site keeps running. Swap is not used to go past the limit.
- **PHP workers**: PHP requests handled at the same time (default 8).
- **Max MySQL connections** for the site's database users (`MAX_USER_CONNECTIONS`).

Sites created by an older Lares are converted on upgrade, one at a time. They stay online meanwhile;
if a step fails or the site answers 5xx after the switch, it is put back as it was and the site page
shows why, with a retry button. `LARES_SITE_ISOLATION=0` in `/etc/lares/lares.env` turns the feature
off (new sites then share `www-data` again).

Limit: sites still share the kernel, so a privilege escalation to root bypasses every layer above.
Let the server install security updates automatically (see [Updates](#updates)).

## Malware scan, quarantine and cleaning

Site page → **Security**.

**Malware scan** (daily at 04:30, changeable on that tab). The scan only reads and never runs the
site's code, so it also works on a quarantined site:

- WordPress core and plugin files are compared with the release checksums from wordpress.org:
  modified files, unknown files in `wp-admin`/`wp-includes`, unknown `wp-*.php` files in the root
  (disguised as core), missing core files. `wp-config.php` is searched for malware code too.
- Images carrying PHP code keep being reported by later scans until they are dealt with.
- PHP files in `uploads` and images carrying PHP code; `.user.ini` files with `auto_prepend_file`
  (Wordfence's firewall excepted).
- `mu-plugins` and drop-ins (`db.php`, `object-cache.php`, `advanced-cache.php`...): WordPress loads them
  on every request and wp-admin does not list them. Unknown or modified files are reported until you
  acknowledge them, **the first scan included** (a cloned or migrated site may bring malware along). A
  drop-in with code writing into `mu-plugins` is always reported as critical.
- Malware that reinstalls itself spreads over several parts, each able to rebuild the others. The scan
  looks for:
  - PHP files in hidden folders or files of `wp-content` (e.g. `wp-content/.sc_5e965fa4/`);
  - hidden files and zip files directly in `wp-content` or in a theme folder (re-install kits);
  - every file named after, or with code mentioning, an unacknowledged mu-plugin (a plugin folder of
    the same name, marker files, a loader in the theme's `functions.php`);
  - WP-Cron jobs no code registers and whose name looks generated, or registered only by flagged
    files.
- Code typical of webshells and malware (`eval(base64_decode(...))`, `system($_GET[...])`...); PHP
  files new or modified since the last scan.
- In the database: new administrators, `siteurl`/`home` pointing at another domain, `<script>` injected
  into posts or options.
- Firewall blocks of the site in the last 24 hours (spam, cloud metadata...).

New findings are reported in the notification bell and, when enabled, to the Telegram/webhook set up
under Leads → Notifications. No scanner catches every backdoor: a clean result is not a guarantee.

A false positive (a file of a legitimate plugin) can be marked **Not malware** once you have opened and
checked the file: Lares remembers its content (sha256), the finding becomes informational and no
longer blocks the release. A later change to the file brings it back. The mark is recorded in the
security history.

**Automatic quarantine** (off by default, under the automatic scan schedule): when the daily scan finds
something new and critical, a site with its own user is quarantined at once and you get a
Telegram/webhook alert. A false positive also takes the site offline until you release it.

**Quarantine** (when you suspect an infection): the site serves a 503 maintenance page, every outgoing
connection of the site is blocked, its PHP-FPM/Next.js and any leftover process of its user are
stopped, its cron jobs are removed, then Lares keeps a backup as evidence. That backup is hidden from
the normal restore list and restoring it takes an explicit confirmation. While quarantined the site
cannot be enabled, updated, cloned, have its PHP settings changed or be logged into: all of that runs
the site's code. If a quarantine step fails (nginx, firewall, stopping processes), the task fails, the
Security tab names the step and offers **Run quarantine again**.

**Clean site** (quarantined site; most complete for WordPress): replaces code with clean copies rather
than trusting "scan and delete".

1. WordPress core, plugins and themes are downloaded again from wordpress.org in the versions in use
   (or the latest). Premium or custom plugins/themes are listed for you to upload again.
2. Flagged files are moved to `<site folder>/.lares-quarantine/<time>/`, outside the web root and never
   deleted. Foreign `auto_prepend_file` lines are removed from `.user.ini`. When a bought theme or plugin
   loses a file this way (a `functions.php` loading the malware, say), Lares tells you to reinstall a
   clean copy before releasing the quarantine.
   Flagged WP-Cron jobs are deleted directly in the database, without running the site's code.
3. New salts in `wp-config.php` (every old login session ends), a new database password, the
   administrators you select deleted, application passwords revoked, random passwords for the remaining
   administrators (after the release, open wp-admin with the panel's button or "Lost your password?"
   and set a new one), `home`/`siteurl` reset to the site's domain if they were changed.
4. Scan again. A safety backup is taken first.

What is left to do by hand is listed at the end of the log ("TO DO BY HAND") and in the security
history: premium or custom plugins/themes, suspicious code in `wp-config.php`, `<script>` in the
database (open Adminer on the Overview tab). If the site user cannot write to its own folder (after a
restore whose permission step failed, for example), Lares gives the folder back to it before cleaning.

Lares does not run the site's code while cleaning: the panel downloads the files, then the site's user
unpacks and moves them into place (root never writes into the site folder). Afterwards, change the
admin passwords and related FTP/hosting accounts. **Release** needs a scan after the quarantine without
critical findings; if you checked the site yourself you can release without one (recorded in the
history). For a Next.js site the scanner cannot read the code, so the release always takes that
confirmation; deploys are blocked during the quarantine, so redeploy from git right after releasing.

**Code lock** (optional, per PHP site): the site's code belongs to root, PHP can read it and only write
to the allowed folders (WordPress default: `wp-content/uploads`, `wp-content/cache`,
`wp-content/upgrade`). A hijacked plugin cannot modify the site's own code. Installing or updating
plugins/themes from wp-admin stops working: update from the panel's Updates tab, which unlocks for the
update and locks again.

## Known vulnerabilities in WordPress, plugins and themes

The **Updates** tab of a WordPress site shows whether the installed versions of core, plugins and
themes have published vulnerabilities. Each one comes with its severity (Critical, High, Medium, Low),
the fixed version, CVE ids and a link to the advisory. **Select the vulnerable items that have an
update** picks the items that can be updated, then the usual safe update runs (backup and automatic
rollback). Deactivate or replace an item that has no fix yet. The site list shows the number of
vulnerable items next to the pending updates.

- **Data source:** [WPVulnerability](https://www.wpvulnerability.com), free, no API key. It combines
  Wordfence, WPScan, Patchstack and CVE records, so popular premium themes and plugins are covered too.
  A custom plugin, or one the database does not know, has no data.
- **What is sent:** plugin and theme slugs and the WordPress version. Never the domain, the site's IP
  or anything else. Results are shared by every site on the server and kept for 24 hours, so each slug
  is asked about roughly once a day. A failed lookup is retried after a few hours.
- **When:** every time the panel reads the list of updates (daily, or with **Check again**) and right
  after an update.
- **Alerts:** critical, high and unfixed vulnerabilities show in the bell. With **Send alerts to
  Telegram / webhook** on, each new one is also sent there (webhook event `security.vulnerabilities`).
  Medium and low ones are only shown in the Updates tab.
- **Turn off:** Security tab → Automatic scan schedule → untick **Look up published vulnerabilities**.

Only published vulnerabilities are listed. Seeing none does not mean the site is safe: keep updating
and keep the malware scan on.

## Two-factor authentication (2FA)

**Settings → Two-factor authentication (2FA)**: scan the QR code with any TOTP authenticator app (Google Authenticator,
Aegis, 1Password, Bitwarden…) and confirm with a 6-digit code. You then get **10 recovery codes**,
shown once. Copy or download them and keep them off the server. Each code works once, in place of
the 6-digit code. You can generate a new set of recovery codes with a current code.

Lost the phone and the recovery codes? Turn 2FA off from SSH:

```bash
sudo lares disable-2fa            # the admin account
sudo lares disable-2fa alice      # another account
```

## Panel IP allowlist

When the allowlist is not empty, only the listed addresses (single IPs or CIDR ranges, IPv4 or IPv6)
can open the panel. Everyone else is rejected before the login page. Manage it in **Settings** or
from SSH:

```bash
sudo lares allowlist show
sudo lares allowlist add 203.0.113.10
sudo lares allowlist add 198.51.100.0/24
sudo lares allowlist remove 203.0.113.10
sudo lares allowlist clear        # allow everyone again
```

- Add your current IP **before** you enable the list. If your ISP changes your IP, add a range or use
  the SSH tunnel below.
- **Loopback (127.0.0.1 / ::1) is always allowed**, so an SSH tunnel always works, even when you are
  locked out:

  ```bash
  ssh -L 8686:127.0.0.1:8686 root@YOUR_VPS
  # then open https://127.0.0.1:8686 in your browser
  ```

## Panel domain and trusted certificate

By default, the panel uses a self-signed certificate. Use a real domain to get a trusted one:

1. Create a DNS record, for example `panel.example.com`, pointing to the VPS IP (A, plus AAAA if the
   VPS has IPv6). With Cloudflare, make it **DNS only (grey cloud)**: Cloudflare does not proxy
   port 8686.
2. Port 80 must be reachable from the internet (Let's Encrypt HTTP-01 check).
3. **Settings → Panel domain** ("Tên miền cho trang quản trị"): enter the domain and save. Lares
   asks Let's Encrypt for a certificate through certbot's webroot (certificate name
   `lares-panel`) and reloads the panel.
4. Log in again at `https://panel.example.com:8686`.

Renewal is automatic: a certbot deploy hook sends SIGHUP to the panel
(`systemctl reload lares`), and the panel loads the new certificate without a restart. **Remove
domain** switches back to the self-signed certificate.

## Firewall

The installer opens 22, 80, 443 and the panel port if **ufw** is active. Also check your cloud
provider's firewall (security group).

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# panel only from your IP (instead of "ufw allow 8686/tcp"):
sudo ufw allow from 203.0.113.10 to any port 8686 proto tcp
sudo ufw enable
sudo ufw status numbered
```

Sites without a domain listen on ports from 8001. Lares opens those in ufw for you and closes them
when you assign a domain.

## SSH basics

- Log in with an SSH key and turn off password logins. In `/etc/ssh/sshd_config`:
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password`, then `sudo systemctl reload ssh`.
  **Keep your current session open** and test a new login before closing it.
- Optional: change the SSH port (open it in ufw first), and install `fail2ban`.
- Enable security updates: `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.

## Cloudflare in front of your sites

- **Real visitor IP** is on by default (Settings card with an on/off toggle). Lares writes
  `/etc/nginx/conf.d/lares-cloudflare.conf` with Cloudflare's IP ranges, so site logs and
  statistics show visitors' addresses instead of Cloudflare's. The ranges are refreshed daily from
  cloudflare.com and rolled back if `nginx -t` fails. If another panel already sets its own
  `real_ip_header`, nginx rejects the duplicate and the card shows the error. Turn the toggle off,
  or remove the other directive.
- Once a site has its Let's Encrypt certificate, use Cloudflare SSL mode **Full (strict)**.
- The panel itself cannot sit behind the Cloudflare proxy on port 8686 (see above).

## Running the panel behind a reverse proxy

By default the panel ignores `X-Forwarded-For`. If you put it behind a local reverse proxy, set
`LARES_TRUST_PROXY` in `/etc/lares/lares.env` and run `systemctl restart lares`:

| Value | Meaning |
|---|---|
| empty (default) | Do not trust proxy headers |
| `1` or `true` | Trust any proxy |
| `127.0.0.1,10.0.0.0/8` | Trust only these proxy IPs/CIDRs |

Without it, every request seems to come from 127.0.0.1. The IP allowlist and the per-IP rate limit
then no longer work, because loopback is always allowed.

## Updates

Lares checks GitHub daily and shows **New version x.y.z** in the sidebar. To upgrade, run
`curl -sSL https://lares.thocode.dev/install | sudo bash` again. See [Installation](installation.md#upgrade).

**Operating system security fixes** (nginx, MariaDB, OpenSSL…): a fresh install turns on Ubuntu's
or Debian's `unattended-upgrades` with the package's default policy: security fixes from the OS
repositories only, no third-party repositories, no automatic reboot. A server that already has a setting
(even "off") keeps it, and an upgrade only reports the state. To skip it, install with
`--no-auto-updates`. To turn it off later: `sudo dpkg-reconfigure -plow unattended-upgrades`.

### PHP security updates

PHP is installed from the [ondrej/php](https://launchpad.net/~ondrej/+archive/ubuntu/php) PPA (Ubuntu)
or [packages.sury.org](https://packages.sury.org/php/) (Debian). `unattended-upgrades` installs nothing
from third-party repositories, so Lares takes care of PHP's security fixes under
**Settings → Updates → PHP updates**:

- Once a day Lares refreshes the package lists (`apt-get update`) and dry-runs (`apt-get -s`) an upgrade
  of the installed PHP packages. The card shows, per PHP version, the running release, the available
  update, the number of sites using it and php.net's end of security support. **Check now** checks again.
- **Update PHP** stays within the same version (e.g. 8.3.12 to 8.3.14, never 8.3 to 8.4), keeps
  `php.ini` and the pool settings (`--force-confold`), then restarts that version's PHP-FPM: the shared
  `php<version>-fpm` and the isolated sites' own PHP-FPM. Disabled or quarantined sites are not started.
  Each site is interrupted for a few seconds.
- **Install PHP updates automatically every night** (off by default): installs pending updates between
  2 and 6 am server time, at most once a day. The result (success or error) shows in the bell.
- The bell also shows pending updates (unless the nightly update is on) and sites still running a PHP
  version without security support (7.4, 8.0, and 8.1 since the end of 2025). Move those sites with
  **PHP version** in the **Configuration** card of the site page.

To let `unattended-upgrades` install PHP fixes instead: add the PHP repository to
`Unattended-Upgrade::Origins-Pattern` (e.g. `"origin=LP-PPA-ondrej-php";` on Ubuntu) in
`/etc/apt/apt.conf.d/50unattended-upgrades`.
