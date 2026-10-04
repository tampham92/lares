# Backups

[Tiếng Việt](../vi/backups.md) · [Docs index](../README.md)

Lares keeps two kinds of backups.

## Site backups

Each site has a **Backups** tab. A backup holds the site's files and its MySQL/MariaDB database(s),
and is stored **on the same server**:

```
/var/backups/lares/<domain>/<YYYYMMDD-HHMMSS>/
    files.tar.gz          site directory
    db-<name>.sql.gz      one dump per database
    manifest.json         what was backed up, when, sizes
```

- **Back up now**: a manual backup, for example before updating plugins. Manual backups are never
  deleted automatically.
- **Daily schedule**: **Settings → Backups**. Set the time (HH:MM, server local time) and how many
  scheduled backups to keep per site (default 7). Individual sites can opt out. Only scheduled
  backups are pruned.
- **Download**: you get a signed link valid for 5 minutes. The file is a `.tar` that contains the
  gzipped parts above.
- **Restore**: pick a backup and confirm by typing the site's domain. Lares first takes an automatic
  safety backup of the current state, then replaces the files and databases. If the restore fails,
  it rolls back.
- **Deleting a site keeps its backups.** Create a site with the same domain again to restore one.
- **Backup folder**: `/var/backups/lares` (mode 0700, root only). You can change it in Settings, or
  with `LARES_BACKUP_DIR` in `/etc/lares/lares.env`. After a change, older backups no longer show in
  the panel, but they stay in the old folder.
- `uninstall.sh`, even with `--purge`, never deletes the backup folder. It prints the path so you
  can remove it yourself.

Backups are **local only** for now (remote destinations come later). Copy them off the server
yourself, as described below.

### Keep a copy off the server

A backup on the same disk does not survive a lost disk, a deleted VPS or a compromised server.
Copy `/var/backups/lares` elsewhere regularly, for example with rsync to another machine:

```bash
# on the backup machine, daily via cron
rsync -a root@YOUR_VPS:/var/backups/lares/ /srv/lares-backups/YOUR_VPS/
```

You can also use `rclone sync /var/backups/lares remote:lares-backups` to S3, Backblaze B2,
Google Drive and so on. Backups contain databases, so store them encrypted or in a private place.

Check free space (`df -h /var/backups`). Backups of large sites add up quickly.

## Panel data

Every upgrade (re-running the installer) first saves Lares's state to
`/var/lib/lares/backups/lares-YYYYMMDD-HHMMSS.tar.gz`, and keeps the 5 newest. It contains:

- `/etc/lares/` (`lares.env` with **`LARES_SECRET`**, the panel certificate, Next.js start scripts,
  custom site certificates)
- `/var/lib/lares/lares.db*` (sites, settings, encrypted credentials, migration history)
- `/var/lib/lares/templates/` (your templates)

Restore it if an upgrade went wrong:

```bash
sudo systemctl stop lares
sudo tar -xzf /var/lib/lares/backups/lares-YYYYMMDD-HHMMSS.tar.gz -C /
sudo systemctl start lares
```

**Keep a copy of `/etc/lares/lares.env` off the server.** Without `LARES_SECRET`, the stored DB, SSH
and API passwords cannot be decrypted. The installer refuses to reuse old data whose env file is
missing.

## Moving to a new server

The simplest way is to install Lares on the new server and use **Migration** with the old server as
the source. It copies files and databases and rewrites the configuration. Then switch DNS and
issue SSL on the new server.
