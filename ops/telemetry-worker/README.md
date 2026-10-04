# Lares telemetry Worker

Cloudflare Worker behind `https://lares.thocode.dev/ping`: the anonymous install counter that
`install.sh` (on install / upgrade) and the panel (one heartbeat per day) post to.

It accepts exactly this payload and stores nothing else. It never reads the client IP or any other
request header, and unknown fields are dropped:

```json
{ "install_id": "0b5c3f9e-…", "version": "0.2.0-beta", "event": "install|upgrade|heartbeat",
  "os": "ubuntu", "os_version": "24.04", "arch": "amd64", "lang": "vi" }
```

## Why D1 (and not Workers Analytics Engine)

- **Exact counts.** Analytics Engine samples data and keeps it for 3 months. D1 is plain SQLite:
  installs and active installs are exact, and there is no time limit.
- **Idempotent.** `daily` has a `(day, install_id, event)` primary key, so retries, restarts and
  repeated installs on the same day count once.
- **Cheap.** Each ping costs 2 row writes. The free plan covers 100k writes a day, which is about
  50k active installs. Old `daily` rows are deleted by a daily cron (400 days kept). `installs` keeps
  one row per install.
- **Easy to query** with `wrangler d1 execute` (see below). No extra API token or dashboard needed.

## Deploy (one time)

You need a Cloudflare account that has the `thocode.dev` zone, Node 20+ and `npx wrangler login`.

```bash
cd ops/telemetry-worker
npx wrangler d1 create lares-telemetry            # copy the printed database_id into wrangler.toml
npx wrangler d1 execute lares-telemetry --remote --file=schema.sql
npx wrangler deploy
```

- The route `lares.thocode.dev/ping` (in `wrangler.toml`) sends **only** `/ping` to the Worker.
  The existing Redirect Rules for `/install` and `/uninstall` keep working.
- `lares.thocode.dev` must stay a **proxied** (orange cloud) DNS record. The Redirect Rules already
  need that.
- Workers Logs are turned off (`[observability] enabled = false`) so request metadata such as the
  client IP is not kept.
- Optional anti-spam: add a WAF rate-limiting rule for `lares.thocode.dev/ping`, for example 30
  requests per 10 s per IP. Cloudflare applies it at the edge, and the Worker still stores no IP.

Smoke test after deploying (this creates one test row, delete it afterwards):

```bash
curl -i -X POST https://lares.thocode.dev/ping -H 'Content-Type: application/json' \
  -d '{"install_id":"00000000-0000-4000-8000-000000000000","version":"0.2.0-beta","event":"install","os":"ubuntu","os_version":"24.04","arch":"amd64","lang":"en"}'
# -> HTTP/2 204
npx wrangler d1 execute lares-telemetry --remote --command \
  "DELETE FROM installs WHERE install_id='00000000-0000-4000-8000-000000000000'; DELETE FROM daily WHERE install_id='00000000-0000-4000-8000-000000000000';"
```

To test against another endpoint before the route exists, point an install at it with
`LARES_TELEMETRY_URL=https://<worker>.workers.dev/ping`. Both install.sh and the panel read this
variable, but `workers_dev` is off by default.

## Queries

```bash
q() { npx wrangler d1 execute lares-telemetry --remote --command "$1"; }

# Installs ever seen
q "SELECT COUNT(*) AS installs FROM installs"

# Active installs: any ping in the last 7 / 30 days
q "SELECT COUNT(DISTINCT install_id) AS active_7d  FROM daily WHERE day >= date('now','-7 day')"
q "SELECT COUNT(DISTINCT install_id) AS active_30d FROM daily WHERE day >= date('now','-30 day')"

# New installs and upgrades per day
q "SELECT day, SUM(event='install') AS installs, SUM(event='upgrade') AS upgrades
   FROM daily GROUP BY day ORDER BY day DESC LIMIT 30"

# Active installs by version / OS / language (last 7 days)
q "SELECT version, COUNT(*) AS n FROM installs WHERE last_seen >= date('now','-7 day') GROUP BY version ORDER BY n DESC"
q "SELECT os || ' ' || os_version AS os, arch, COUNT(*) AS n FROM installs
   WHERE last_seen >= date('now','-7 day') GROUP BY 1, 2 ORDER BY n DESC"
q "SELECT lang, COUNT(*) AS n FROM installs WHERE last_seen >= date('now','-7 day') GROUP BY lang"
```

An install counts as active when its daily heartbeat arrives. Installs with `LARES_TELEMETRY=0` never
show up at all.
