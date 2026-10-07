# Troubleshooting

[Tiếng Việt](../vi/troubleshooting.md) · [Docs index](../README.md)

## Where the logs are

| What | Where |
|---|---|
| Panel (API, tasks, startup errors) | `journalctl -u lares -n 200 --no-pager` (live: `journalctl -u lares -f`) |
| Site traffic / nginx errors | `/var/log/lares/sites/<domain>/access.log`, `error.log` (also in the site's **Logs** tab) |
| nginx itself | `sudo nginx -t`, `/var/log/nginx/error.log`, `journalctl -u nginx` |
| PHP-FPM | `journalctl -u php8.3-fpm` (use your version), `/var/log/php8.3-fpm.log` |
| Next.js apps | `journalctl -u lares-app-<domain>` (also in the site's app log view) |
| Let's Encrypt | `/var/log/letsencrypt/letsencrypt.log` |
| MySQL / MariaDB | `journalctl -u mariadb` (or `mysql`) |
| Migrations | the migration's detail page (per-site log); temp files in `/var/lib/lares/migrations` |
| Installer | the terminal output; to keep it: `curl -sSL https://lares.thocode.dev/install \| sudo bash 2>&1 \| tee install.log` |

## Panel not reachable

Work from the server outwards:

```bash
systemctl status lares                        # running?
journalctl -u lares -n 100 --no-pager         # why not?
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8686/api/auth/me   # 401 = panel is fine
ss -ltnp | grep 8686                          # listening? (or your --port)
```

- **401 locally but nothing from outside**: it is a firewall. Check `sudo ufw status` and your cloud
  provider's firewall or security group.
- **Use `https://`**, not `http://`. A browser warning about the certificate is normal with the
  self-signed certificate.
- **"Access denied" / blocked before login**: the IP allowlist does not include your current IP.
  Run `sudo lares allowlist show`, then `sudo lares allowlist add <your-ip>` (or `clear`). Or use the
  SSH tunnel: `ssh -L 8686:127.0.0.1:8686 root@VPS` and open `https://127.0.0.1:8686`.
- **Lost 2FA device**: `sudo lares disable-2fa [user]`.
- **Forgot password / account locked**: `sudo lares reset-password [user]`. This also clears the
  lockout.
- **Panel domain stopped working**: check that DNS still points to the VPS and that the record is
  grey-cloud in Cloudflare. You can always log in at `https://<ip>:8686` (certificate warning).
- **Service crash-loops after an upgrade**: read `journalctl -u lares`. Run the install command
  again; if that fails too, restore the pre-upgrade backup (see [Backups](backups.md#panel-data)).

## `nginx -t` failures

```bash
sudo nginx -t        # shows the file and line
```

- Lares vhosts are `/etc/nginx/sites-available/<domain>.conf` (first line `# Managed by Lares`).
  Lares regenerates them, so don't edit them by hand.
- **duplicate default server / conflicting server name**: another vhost (often an old panel's, or
  nginx's `default` site) uses the same `server_name` or `default_server`. Remove or rename the
  duplicate.
- **cannot load certificate**: a vhost points to a certificate that was deleted. Reissue SSL for
  that site, or remove the `ssl_certificate` lines from the other vhost.
- **duplicate "real_ip_header"**: another panel already sets it. Turn off **Cloudflare real IP** in
  Settings, or remove the other directive.
- The installer refuses to run while `nginx -t` already fails, because it cannot tell existing
  errors from its own. Fix the config first.
- **Port 80/443 taken** by Apache, OpenLiteSpeed or another panel's nginx: Lares installed its nginx
  in *coexist mode* and left it stopped. Check with `ss -ltnp 'sport = :80'`. When you are ready,
  stop the old server and run `systemctl enable --now nginx`.

## SSL issuance failures

Let's Encrypt has to reach `http://<domain>/.well-known/acme-challenge/…` on **this** server.

1. **DNS**: `dig +short example.com A` and `dig +short example.com AAAA` must return this VPS. A stale
   AAAA (IPv6) record is a common cause. Delete it or point it here. Do the same for every alias
   (`www`).
2. **Port 80** open from the internet (ufw and the provider firewall), with nginx running (not in
   coexist mode).
3. **Test the path**: `curl -i http://example.com/.well-known/acme-challenge/test` should return
   nginx's **404**, not a redirect to another server, a Cloudflare error, or a timeout.
4. **Cloudflare**: HTTP-01 also works through the proxy, but "Always Use HTTPS" combined with SSL mode
   Full/Strict can break the first issuance. Grey-cloud the record or turn that off while you issue,
   then switch it back.
5. **Rate limits**: too many attempts for the same domain hit Let's Encrypt limits. Use the
   **staging** option while you experiment, and read `/var/log/letsencrypt/letsencrypt.log` for the
   exact reason.

## Migration failures

Open the migration's detail page: each site has its own log, and a failed site is rolled back
automatically (the source is never changed). Fix the cause, then use **Retry failed sites**.

- **SSH connection / authentication**: check the IP, port, user, password or key, and the sudo
  password. The source firewall must allow SSH from this VPS.
- **Host key changed**: the source's SSH key differs from the pinned one. Check it is really the
  same server, then run *Test connection* again.
- **Database dump**: the source DB credentials (from `wp-config.php` / `.env`) must work on the
  source. When routines can't be dumped (missing privilege), Lares retries without them.
- **Disk space**: check `df -h` on both servers. Lares stages files in `/var/lib/lares/migrations`.
  When the source is full, choose transfer mode **stream** (no temp files on the source).
- **Site works but shows the old server**: DNS still points to the old server. Update the records,
  then issue SSL.
- **Next.js build fails**: read the build log in the migration and app logs. Secret environment
  variables that lived outside the code (for example in PM2) must be entered again.

## Cloudflare: redirect loop after turning the proxy on

Keep records **DNS only** (grey cloud) until SSL is installed. Before turning the proxy on (orange cloud), set **SSL/TLS → Full (strict)** in Cloudflare; Flexible together with "force HTTPS" causes a redirect loop. A zone in "pending" state means the nameservers have not moved to Cloudflare yet.

## Adminer does not open

The first time, Lares downloads Adminer from github.com and verifies its SHA-256, so the server needs outbound access to github.com. Adminer needs an installed PHP-FPM version with `mysqli`. It cannot run in coexist mode (nginx stopped).

## Next.js: build or Git clone fails

- **Private repo on GitHub**: connect GitHub once in **Settings → Integrations → GitHub** (Lares
  creates its own GitHub App, then you choose which repos it may read). The site form then lists
  your repos and branches. "Repo missing?" means the App has not been given access to that repo.
- **Private repo elsewhere**: use the `https://` URL and fill in **Access token** when creating the site (or
  under **Build settings** later). On GitHub, create a fine-grained token limited to that repo with
  **Contents: Read-only**. On GitLab use a project access token with `read_repository`; on Bitbucket
  a repository access token (or `username:app-password`). The token is stored encrypted and is never
  written to the clone URL, `.git/config` or the task log. Do not put the token in the Git URL itself.
- **`Cannot find module '@tailwindcss/postcss'`** (or another devDependency): fixed in this version;
  the install step now runs without the panel's `NODE_ENV=production`, so devDependencies are
  installed. Click **Build & start** again.

## A WordPress update was rolled back

Lares restores the backup when the home page breaks, a new PHP fatal error appears, or an active plugin got deactivated. Check **Updates → History** to see which item broke it, then update items one by one. Content created during the update (orders, comments) is lost on restore.

## Reporting a bug

Open an issue at https://github.com/tampham92/lares/issues with your Lares version (sidebar
footer), OS (`cat /etc/os-release`), what you did, and the relevant log lines. Remove domains,
IPs and passwords first.
