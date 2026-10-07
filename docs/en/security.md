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
  the web user without the panel's environment variables (secret key, admin and MySQL passwords).
- **GitHub App**: each panel registers its own App (Settings → Integrations → GitHub) with read-only
  access to code. Its private key stays on the server; git only receives a one-hour token scoped to
  the one repo being cloned, through a temporary file that is deleted afterwards.
- `X-Forwarded-For` is **not trusted** by default (see [Reverse proxy](#running-the-panel-behind-a-reverse-proxy)).

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
