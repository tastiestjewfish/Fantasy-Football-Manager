# League HQ Connector

A small read-only service that lets the League HQ app pull league rosters from
platforms whose logins can't live in a browser app. Every platform returns the
same normalized shape:

```json
{ "members": [ { "name": "", "teamName": "", "ownerId": "", "mine": false,
                 "roster": [ { "name": "", "pos": "", "team": "" } ] } ] }
```

## What works where

| Platform | Auth needed | Status |
|----------|-------------|--------|
| Sleeper  | none (public) | Read. Works directly in the app without this service. |
| Yahoo    | OAuth2 (your app keys) | Read **and write** (submit lineups) once you register a Read/Write app and connect. |
| ESPN     | private-league cookies | Read. Public leagues need no setup; private need `ESPN_S2` + `ESPN_SWID`. |
| NFL.com  | — | No supported public API. The app falls back to manual entry. |

## Run locally

```bash
npm install
cp .env.example .env   # fill in the values you need
npm start              # http://localhost:8787
```

Then in League HQ → **League** → set platform, paste `http://localhost:8787`
as the Connector service URL (use your deployed URL in production).

## Deploy

Any Node host works (Render, Railway, Fly.io, a VPS). Set the same env vars
there, set `BASE_URL` to the public URL, and use that URL in the app.

## Environment variables (`.env`)

```
PORT=8787
BASE_URL=https://your-deployed-url.example.com

# Yahoo — register at https://developer.yahoo.com/apps/ (Fantasy Sports: Read)
# Set the app's Redirect URI to  {BASE_URL}/api/yahoo/callback
YAHOO_CLIENT_ID=
YAHOO_CLIENT_SECRET=

# ESPN — only for PRIVATE leagues. Copy these two cookies from your browser
# while logged into fantasy.espn.com (DevTools → Application → Cookies).
ESPN_S2=
ESPN_SWID=
```

## Endpoints

- `GET /api/sleeper/league?leagueId=...`
- `GET /api/yahoo/auth`  → open in a browser once to connect (then Import in the app)
- `GET /api/yahoo/league?leagueId=nfl.l.123456`  (or just the numeric ID)
- `POST /api/yahoo/roster`  → submit a weekly lineup (body: `{ teamKey, players:[{playerKey, slot}] }`)
- `GET /api/espn/league?leagueId=...&season=2026`
- `GET /api/nfl/league?leagueId=...`  → 501 (manual entry)

**Yahoo write access:** to use *Submit to Yahoo* (one-tap lineup submission), your Yahoo app must be registered with **Fantasy Sports: Read/Write** permission, not just Read. Everything else works with Read.

## Security notes

- This service holds credentials — keep it private, use HTTPS, and don't commit
  your `.env`.
- The Yahoo token is kept in memory in this scaffold. For real multi-user use,
  store tokens per user in a database and add auth in front of these endpoints.
- The connector is **read-only**; it never writes to your leagues.
