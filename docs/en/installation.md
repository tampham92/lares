# Installation, upgrade, uninstall

[Tiếng Việt](../vi/installation.md) · [Docs index](../README.md)

## Requirements

| | |
|---|---|
| OS | **Ubuntu 22.04 / 24.04** or **Debian 12**, 64-bit (x86_64 or arm64) |
| Access | root (or a user with `sudo`) over SSH |
| Memory | 1 GB minimum (2 GB recommended; on 1 GB add swap, because the build step needs memory) |
| Disk | ~3 GB for Lares + packages, plus your sites and backups |
| Network | inbound **22** (SSH), **80** and **443** (websites, Let's Encrypt), **8686** (panel, configurable) |

A fresh VPS is best, but servers that already run nginx, MySQL/MariaDB or another panel work too.
See [the README](../../README.en.md#vps-that-already-runs-nginx--mysql--mariadb--apache).

### Supported systems

| System | Status |
|---|---|
| Ubuntu 22.04, Ubuntu 24.04, Debian 12 | Supported (tested in CI on Ubuntu 22.04 and 24.04) |
| Debian 13 | Installs, with a "not yet tested" warning |
| Newer Ubuntu releases (e.g. 26.04) | Installs, with a "not yet tested" warning |
| Ubuntu 20.04, Debian 11 and older | **Refused**: end of life, no security updates. `--force-unsupported` overrides this at your own risk |
| Other distributions | Refused (`--force-unsupported` to try anyway, apt-get is still required) |

## Install

```bash
curl -sSL https://lares.thocode.dev/install | sudo bash
# English installer + English as the panel's default language:
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en
```

`lares.thocode.dev/install` redirects to `install.sh` on GitHub. If the domain is unreachable, use
`https://raw.githubusercontent.com/tampham92/lares/main/install.sh`.

When it finishes, the installer prints `https://<server-ip>:8686`, the user `admin` and a random
password, shown **once**. The certificate is self-signed, so the browser warns until you set a
[panel domain](security.md#panel-domain-and-trusted-certificate).

Right after the first login:

1. Change the password (**Settings → Change admin password**).
2. Turn on two-factor authentication and the IP allowlist. See [Security hardening](security.md).

### Options

| Option | Env variable | Default | Meaning |
|---|---|---|---|
| `--lang vi\|en` | `LARES_LANG` | `vi` | Installer language and the panel's default language |
| `--port <port>` | `LARES_PORT` | `8686` | Panel HTTPS port. An upgrade keeps the saved port |
| `--php "<versions>"` | `PHP_VERSIONS` | `"8.3 8.2 8.1 7.4"` | PHP-FPM versions to install. An upgrade keeps the saved list |
| `--node <major>` | `NODE_MAJOR` | `22` | Node.js major version, used only if `/usr/bin/node` is missing or older than 20 |
| `--mysql-root-user <user>` | `MYSQL_ROOT_USER` | `root` | Admin account of an existing MySQL/MariaDB |
| `--mysql-root-password <pw>` | `MYSQL_ROOT_PASSWORD` | | Its password, when socket login does not work |
| `--repo <url>` / `--branch <name>` | `LARES_REPO` / `LARES_BRANCH` | GitHub `main` | Install from a fork or another branch |
| `--tarball <url\|path>` | `LARES_TARBALL` | | Install from a `.tar.gz` (https://, file:// or a local path) instead of git |
| `--fresh-data` | | | Old data was found without `/etc/lares/lares.env`: move it aside and install fresh |
| `--no-telemetry` | `LARES_TELEMETRY=0` | on | Disable the anonymous install counter (see [Telemetry](#telemetry)) |
| `--force-unsupported` | | | Install on an end-of-life or unsupported OS (no support) |

Example: `curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --port 9443 --php "8.3" --no-telemetry`

### What gets installed

nginx, MariaDB (unless MySQL/MariaDB already exists), PHP-FPM, Node.js 22 (if needed), Certbot and
WP-CLI. Then the installer builds Lares in `/opt/lares/src` and creates the `lares` systemd service
and the `sudo lares` admin CLI. If ufw is active, it opens 22, 80, 443 and the panel port.

| Path | Contents |
|---|---|
| `/etc/lares/lares.env` | Configuration and `LARES_SECRET` (the key that decrypts stored credentials: keep a copy) |
| `/var/lib/lares/` | SQLite database, ACME webroot, custom templates, pre-upgrade backups |
| `/var/www/<domain>/` | Websites |
| `/var/log/lares/sites/<domain>/` | Per-site nginx access/error logs |
| `/var/backups/lares/` | Site backups |

## Upgrade

Run the install command again. The installer finds `/etc/lares/lares.env` and switches to upgrade
mode:

```bash
curl -sSL https://lares.thocode.dev/install | sudo bash
```

- Only `/opt/lares/src` is replaced and rebuilt. The panel restarts and is down for a few seconds.
  **Websites keep running.**
- Sites, databases, vhosts, SSL certificates, accounts, the saved language, port, PHP versions and
  telemetry choice are kept.
- `/etc/lares` + the SQLite database + custom templates are backed up first to
  `/var/lib/lares/backups/` (the 5 newest are kept). See [Backups](backups.md#panel-data).
- The panel checks GitHub once a day. When a newer version exists, the sidebar shows
  **New version x.y.z** with this command. Changes are listed in [CHANGELOG.md](../../CHANGELOG.md).
  To turn the check off, set `LARES_UPDATE_CHECK=0` in `/etc/lares/lares.env`, then run
  `systemctl restart lares`.

Upgrading to 0.2.0-beta logs every user out once, which is expected (sessions now support
revocation).

## Uninstall

```bash
# Remove the panel, KEEP the running websites (reinstalling picks them up again):
curl -sSL https://lares.thocode.dev/uninstall | sudo bash
# Remove the panel and every site, database, certificate and log Lares created:
curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --purge
# Non-interactive (scripts/CI): add --yes
```

nginx, MySQL/MariaDB, PHP and Node.js are never removed, and sites or databases Lares did not
create are never touched. Site backups in `/var/backups/lares` are **always kept**, even with
`--purge`. Delete them yourself when you no longer need them.

## Telemetry

To know how many servers run Lares and which versions and OSes to support, the installer and the
panel send a tiny anonymous ping. **This is all that is sent:**

| Field | Example | Notes |
|---|---|---|
| `install_id` | `0b5c3f9e-2f4b-…` | Random UUID, generated once and stored in `/etc/lares/install-id`. Not derived from the machine |
| `version` | `0.2.0-beta` | Lares version |
| `event` | `install` / `upgrade` / `heartbeat` | |
| `os`, `os_version` | `ubuntu`, `24.04` | From `/etc/os-release` |
| `arch` | `amd64` | CPU architecture |
| `lang` | `vi` | Panel default language |

**When:** once at the end of a successful install or upgrade (by `install.sh`), and at most once a
day while the panel runs (heartbeat).
**Never sent:** IP addresses (the receiving Worker does not read or store them), hostnames,
domains, site counts, usernames, or anything about your sites.
**How:** `POST https://lares.thocode.dev/ping`, with a 3-second timeout. A failure is ignored and
never breaks the install or the panel.

**Disable it:**

```bash
# at install / upgrade time
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --no-telemetry
# or later, on the server
sudo sed -i 's/^LARES_TELEMETRY=.*/LARES_TELEMETRY=0/' /etc/lares/lares.env && sudo systemctl restart lares
```

The choice is saved and kept by upgrades. With telemetry off, no install id is created. You can
read the code: `send_ping` in `install.sh`, `apps/server/src/services/release.ts`, and the
receiving Worker in `ops/telemetry-worker/`.
