# FAQ

[Tiếng Việt](../vi/faq.md) · [Docs index](../README.md)

**Is Lares free? What is the license?**
Yes. Lares is free software under the [GNU AGPL-3.0](../../LICENSE). You can use, modify and
redistribute it. If you modify Lares and let other people use it over a network (for example as a
hosting service), you must offer them the source code of your modified version.

**Which systems are supported?**
Ubuntu 22.04 / 24.04 and Debian 12 (x86_64, arm64). Debian 13 installs with a "not yet tested"
warning. Ubuntu 20.04 and Debian 11 are end of life and refused unless you pass
`--force-unsupported`. See [Installation](installation.md#supported-systems).

**Can I install it on a server that already has sites or another panel?**
Yes. Existing nginx, MySQL/MariaDB and PHP-FPM are reused, not replaced. If another web server
holds port 80/443, Lares's nginx stays stopped (coexist mode) until you switch over. Then use
**Migration** to move the sites.

**Does upgrading cause downtime?**
Only for the panel, a few seconds. Websites keep running. Upgrade by running the install command
again. See [Upgrade](installation.md#upgrade).

**How do I know there is a new version?**
The sidebar shows **New version x.y.z** with the upgrade command. The version you run is shown at
the bottom of the sidebar.

**What does Lares send home?**
Only an anonymous counter: a random install id, the Lares version, the event
(install/upgrade/heartbeat), OS + version, architecture and panel language. No IPs, domains or site
data. Turn it off with `--no-telemetry` or `LARES_TELEMETRY=0`. See
[Telemetry](installation.md#telemetry). The daily update check only reads the list of release
tags from GitHub. Turn it off in **Settings → Updates**, or with `LARES_UPDATE_CHECK=0`.

**How do I change the panel port?**
`curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --port 9443`. This is an upgrade, so
everything else is kept. Open the new port in your firewall.

**I forgot the password, lost my 2FA phone, or locked myself out with the allowlist.**
From SSH: `sudo lares reset-password`, `sudo lares disable-2fa`, `sudo lares allowlist clear`. An SSH
tunnel (`ssh -L 8686:127.0.0.1:8686 root@VPS`) always gets past the allowlist.

**Can I put the panel behind Cloudflare?**
Not on port 8686: Cloudflare does not proxy that port, so the panel domain record must be DNS-only.
Your **websites** can be behind Cloudflare, and Lares restores the real visitor IP in their logs.

**Does Lares do email, DNS hosting, Docker or reseller accounts?**
Not at the moment. Lares focuses on websites (WordPress, Next.js, PHP, static), SSL, databases, logs,
backups and migration.

**Where is my data?**
Sites are in `/var/www/<domain>`, panel data in `/var/lib/lares`, config and the encryption key in
`/etc/lares/lares.env`, logs in `/var/log/lares`, backups in `/var/backups/lares`.

**Do I lose my sites when I uninstall?**
Not by default: `uninstall.sh` removes only the panel and the sites keep running. `--purge` removes
everything Lares created except backups.
