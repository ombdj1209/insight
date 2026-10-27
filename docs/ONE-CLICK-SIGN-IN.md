# One-click Google and Microsoft sign-in

Users connect accounts with one button when this copy of Insight ships its own app credentials in
`insight.config.json` (repo root in dev; copied into the installer's resources by `npm run dist`). Without the file,
Settings shows the old "use your own app" fields. A user's own client ID in Settings always wins.

```json
{ "googleClientId": "…apps.googleusercontent.com", "googleClientSecret": "GOCSPX-…", "msClientId": "…", "msTenant": "common" }
```

The file is git-ignored. Desktop OAuth clients are public clients (PKCE); their "secret" is not confidential by design,
so shipping it inside the app is the documented pattern.

## Google (once, by the publisher)

1. Google Cloud Console → new project "Insight" → **APIs & Services → OAuth consent screen**: External, app name,
   support email, logo, privacy policy URL.
2. Enable the APIs: Gmail, Google Calendar, Google Drive, Google Chat, People, Tasks, and the Workspace MCP APIs for
   the services you offer.
3. **Credentials → Create OAuth client**. Insight signs in through `http://127.0.0.1:47820/oauth/callback`.
   - The Workspace MCP servers need a client marked **Use this client for an AI-powered agent** (Web application type)
     with that redirect URI. Use that type if you offer Gmail/Drive/Chat answers.
   - Calendar-only works with a **Desktop app** client.
4. Put the client ID and secret in `insight.config.json`.
5. **Publishing:** Gmail and Drive read scopes are *restricted*. Until Google verifies the app (brand review, and a
   security assessment for restricted scopes), only accounts added as test users (up to 100) can sign in, and
   they see an "unverified app" screen. Plan for verification before a public launch.

## Microsoft 365 (once, by the publisher)

1. Microsoft Entra admin center → **App registrations → New registration**: name "Insight", supported account types
   **Accounts in any organizational directory and personal Microsoft accounts**.
2. **Authentication → Add a platform → Mobile and desktop applications**, redirect URI `http://localhost`, and turn
   on **Allow public client flows**.
3. **API permissions** (delegated): `User.Read`, `Mail.Read`, `Calendars.Read`, `offline_access`, plus
   `Mail.ReadWrite`, `Calendars.ReadWrite`, `Tasks.ReadWrite` for "Allow actions".
4. Put the Application (client) ID in `insight.config.json` (`msTenant`: `common`).
5. **Publishing:** complete **Publisher verification** (Microsoft Partner Network ID) so users see a verified
   publisher. Some companies require an admin to approve third-party apps; the welcome wizard tells users to ask IT.
