# Insight download gate

A Cloudflare Worker that hands out the installer only after someone signs up with a name and email.

- `POST /api/register` `{ name, email, mac?, ref?, hp, turnstile? }` → `{ position, ref }`. Mails a signed link through Resend.
- `GET /api/stats` → `{ people, downloads, mac, recent: [{ n, c, t }] }`. Real counts from KV, used by the website.
- `GET /d/<token>` streams the installer from a private R2 bucket.

The page never sees the link. Links are HMAC-signed with `LINK_SECRET` and expire after 48 hours, so nothing in DevTools skips the form.
Limits: 6 sign-ups per hour per IP, 3 per hour per email, throwaway domains blocked, origin must be in `SITE_ORIGINS`,
optional Turnstile when `TURNSTILE_SECRET` is set. Without `RESEND_API_KEY` sign-ups answer 503 "finishing setup".

## Set up

```
cd worker
npx wrangler login
npx wrangler kv namespace create DB          # paste the id into wrangler.toml
npx wrangler r2 bucket create insight-installers
npx wrangler r2 object put insight-installers/Insight-Setup-0.5.0.exe --file ../dist/Insight-Setup-0.5.0.exe --remote
npx wrangler secret put LINK_SECRET          # any random string, 32+ characters
npx wrangler secret put RESEND_API_KEY       # can wait; sign-ups say "finishing setup" until then
npx wrangler deploy
```

Then, at the top of the script in `site/index.html`, set `const API = 'https://insight-download.<subdomain>.workers.dev'`
and `const DOWNLOADS_OPEN = true`. Until then the download button says "Coming soon" and the counters stay hidden.

- **Mail sender:** set `MAIL_FROM` in `wrangler.toml` to an address on a domain verified in Resend. Until then the
  `onboarding@resend.dev` sender only delivers to your own Resend account address.
- **Turnstile (optional):** create a widget, `npx wrangler secret put TURNSTILE_SECRET`, and put the site key in `TURNSTILE` in `site/index.html`.
- **New release:** upload the new `.exe` to R2 and change `INSTALLER_KEY`, then `npx wrangler deploy`.

## Before launch

The gate only works if the installer isn't public anywhere else. Delete the `.exe` asset from the GitHub release.

## Check

`node scripts/check-gate.mjs` (from the repo root) runs sign-up, download, forged/expired links, stats and rate limits
against in-memory KV and R2.
