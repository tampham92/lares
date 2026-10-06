# Contact leads: website forms → panel → Telegram / webhook

Every site managed by Lares accepts forms at `POST /_lares/lead` on its own domain. nginx forwards the request to the panel over `127.0.0.1`, so forms keep working when the panel IP allowlist is on. The built-in templates (Real estate, Business, Spa, Restaurant, Product landing page) already use it.

## Where leads show up

- **Contact leads** in the sidebar: leads from every site. Filter by site and status (new, contacted, done), search, notes, CSV export (opens in Excel).
- The **Contact leads** tab of each site: that site's leads, per-site notification override, and an HTML snippet for custom pages.

## Notifications

Configure them in **Settings → Contact leads**, or override per site.

- **Telegram**: create a bot with @BotFather, paste the bot token, send the bot a message, click **Find chat ID**, then **Send test**. Phone numbers are formatted as `+84…` so they are tap-to-call.
- **Webhook**: Lares POSTs JSON (with an optional secret header) to your URL. Use it for Google Sheets (an Apps Script snippet is in the card), Make or n8n.
- **Zalo**: not integrated directly. The Zalo OA API needs a verified OA, tokens that must be refreshed, and can only message people who interacted recently. Use webhook → Make/n8n → Zalo OA API instead.

A lead is always stored before any notification is sent. Failed deliveries are retried (30 s, 2 min, 10 min, 30 min, 2 h), also across panel restarts.

## Adding a form to your own page

```html
<form method="post" action="/_lares/lead">
  <input name="name" placeholder="Name">
  <input name="phone" placeholder="Phone" required>
  <input name="email" type="email" placeholder="Email">
  <textarea name="message" placeholder="Message"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button>Send</button>
</form>
```

Accepted fields: `name`, `phone`, `email`, `message`, `service`, `company`, `page` (filled in automatically when empty). At least `phone` or `email` is required. `_hp` is a spam trap and must stay empty. Without JavaScript the browser comes back to the page with `#lares-sent` or `#lares-error`. With `fetch` and `Accept: application/json` the answer is `{"ok":true}`.

## Limits and data

- Spam limits: 5/minute and 50/day per IP; 30/minute and 1000/day per site.
- Leads stay in the panel database and are only sent to the notification targets you configured. They are deleted after 12 months (configurable, 0 = keep forever).
- If you set `LARES_HOST` to something other than `127.0.0.1`/`0.0.0.0`, nginx cannot reach the panel and forms fail.
