/**
 * League HQ API — Firebase Cloud Function
 * Hosts the fantasy-league connector and a server-side Anthropic proxy.
 * Browser calls same-origin /api/... ; Hosting rewrites those to this function.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, ".secret.local") });

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const functionsV1 = require("firebase-functions/v1");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

function resolveProjectId() {
  if (process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID) {
    return process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  }
  try {
    return require("../.firebaserc").projects.default;
  } catch {
    return undefined;
  }
}

if (!admin.apps.length) {
  const projectId = resolveProjectId();
  admin.initializeApp(projectId ? { projectId } : {});
}

const app = express();
app.use(cors({ origin: true, allowedHeaders: ["Content-Type", "Authorization", "X-Firebase-ID-Token"] }));
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8787;

function publicBase(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

const tokens = new Map();

const ok = (res, members) => res.json({ members });
const fail = (res, code, message) => res.status(code).json({ error: message, members: [] });

const PUBLIC_PATHS = new Set(["/api/yahoo/auth", "/api/yahoo/callback"]);

async function requireAuth(req, res, next) {
  const pathOnly = (req.originalUrl || req.url || "").split("?")[0];
  if (PUBLIC_PATHS.has(pathOnly)) return next();
  const header = req.get("x-firebase-id-token") || req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired sign-in" });
  }
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  return requireAuth(req, res, next);
});

/* =========================================================================
   AI  — secret key stays on the server
   ========================================================================= */
app.post("/api/ai", async (req, res) => {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
    const body = req.body || {};
    if (!Array.isArray(body.messages) || !body.messages.length) {
      return res.status(400).json({ error: "messages required" });
    }
    const payload = {
      model: body.model || "claude-sonnet-4-6",
      max_tokens: body.max_tokens || 2000,
      messages: body.messages,
    };
    if (body.system) payload.system = body.system;
    if (body.tools) payload.tools = body.tools;
    if (body.tool_choice) payload.tool_choice = body.tool_choice;
    if (body.temperature != null) payload.temperature = body.temperature;
    if (body.mcp_servers) payload.mcp_servers = body.mcp_servers;

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    const workspaceId = String(process.env.ANTHROPIC_WORKSPACE_ID || body.workspaceId || "").trim();
    if (workspaceId) headers["anthropic-workspace-id"] = workspaceId;
    const betas = [];
    if (payload.tools) betas.push("web-search-2025-03-05");
    if (payload.mcp_servers) betas.push("mcp-client-2025-04-04");
    if (betas.length) headers["anthropic-beta"] = betas.join(",");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const raw = data && data.error;
      const msg = (raw && (raw.message || raw.type)) || data.message || ("Anthropic " + r.status);
      return res.status(r.status).json({ error: typeof msg === "string" ? msg : String(msg) });
    }
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Anthropic request failed: " + e.message });
  }
});

/* =========================================================================
   SLEEPER
   ========================================================================= */
app.get("/api/sleeper/league", async (req, res) => {
  try {
    const leagueId = String(req.query.leagueId || "").trim();
    if (!leagueId) return fail(res, 400, "leagueId required");
    const base = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}`;
    const league = await fetch(base).then((r) => (r.ok ? r.json() : null));
    if (!league || !league.league_id) return fail(res, 404, "Sleeper didn't find that league ID");
    const [users, rosters, players] = await Promise.all([
      fetch(`${base}/users`).then((r) => r.json()),
      fetch(`${base}/rosters`).then((r) => r.json()),
      fetch(`https://api.sleeper.app/v1/players/nfl`).then((r) => r.json()).catch(() => ({})),
    ]);
    if (!Array.isArray(users)) return fail(res, 404, "Sleeper didn't return managers for that league");
    const resolve = (pid) => {
      const p = players[pid];
      if (p) return { name: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || pid, pos: p.position || "", team: p.team || "" };
      if (/^[A-Z]{2,3}$/.test(pid)) return { name: `${pid} DEF`, pos: "DEF", team: pid };
      return { name: pid, pos: "", team: "" };
    };
    const byOwner = {};
    const rosterIdByOwner = {};
    (rosters || []).forEach((r) => {
      byOwner[r.owner_id] = (r.players || []).map(resolve).filter((x) => x.pos);
      rosterIdByOwner[r.owner_id] = r.roster_id;
    });
    ok(res, (users || []).map((u) => ({
      name: u.display_name || "Manager",
      teamName: (u.metadata && u.metadata.team_name) || u.display_name || "Team",
      ownerId: u.user_id,
      rosterId: rosterIdByOwner[u.user_id],
      mine: false,
      roster: byOwner[u.user_id] || [],
    })));
  } catch (e) { fail(res, 502, "Sleeper fetch failed: " + e.message); }
});

app.get("/api/sleeper/matchup", async (req, res) => {
  try {
    const leagueId = String(req.query.leagueId || "").trim();
    const rosterId = Number(req.query.rosterId);
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    const state = await fetch("https://api.sleeper.app/v1/state/nfl").then((r) => r.json()).catch(() => ({}));
    const type = state.season_type || "off";
    const raw = Number(state.week || state.display_week || 1) || 1;
    const week = type === "regular" || type === "post" ? raw : 1;
    const started = type === "regular" || type === "post";
    const label = type === "regular"
      ? ("Week " + week)
      : type === "post"
        ? "Playoffs"
        : type === "pre"
          ? ("Fantasy Week 1 hasn’t started — NFL preseason week " + raw)
          : "Fantasy Week 1 hasn’t started";
    const matchups = await fetch(
      `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${week}`
    ).then((r) => r.json());
    const mine = (matchups || []).find((m) => m.roster_id === rosterId);
    if (!mine) return res.json({ week, oppRosterId: null, started, label, seasonType: type });
    const opp = (matchups || []).find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== rosterId);
    res.json({ week, oppRosterId: opp ? opp.roster_id : null, started, label, seasonType: type });
  } catch (e) {
    res.status(502).json({ error: "Sleeper matchup failed: " + e.message });
  }
});

/* =========================================================================
   YAHOO
   ========================================================================= */
const YAHOO_AUTH = "https://api.login.yahoo.com/oauth2/request_auth";
const YAHOO_TOKEN = "https://api.login.yahoo.com/oauth2/get_token";

function yahooRedirectUri(req) {
  if (process.env.YAHOO_REDIRECT_URI) return process.env.YAHOO_REDIRECT_URI.replace(/\/$/, "");
  return publicBase(req) + "/api/yahoo/callback";
}

app.get("/api/yahoo/auth", (req, res) => {
  if (!process.env.YAHOO_CLIENT_ID || !process.env.YAHOO_CLIENT_SECRET) {
    return res.status(500).send("Set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET first.");
  }
  const u = new URL(YAHOO_AUTH);
  u.searchParams.set("client_id", process.env.YAHOO_CLIENT_ID.trim());
  u.searchParams.set("redirect_uri", yahooRedirectUri(req));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("language", "en-us");
  res.redirect(u.toString());
});

app.get("/api/yahoo/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Missing code. Add this Redirect URI in your Yahoo app: " + yahooRedirectUri(req));
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: yahooRedirectUri(req),
      code,
    });
    const auth = Buffer.from(`${process.env.YAHOO_CLIENT_ID.trim()}:${process.env.YAHOO_CLIENT_SECRET.trim()}`).toString("base64");
    const tok = await fetch(YAHOO_TOKEN, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }).then((r) => r.json());
    if (!tok.access_token) {
      return res.status(502).send("Token exchange failed. " + (tok.error_description || tok.error || JSON.stringify(tok)));
    }
    tokens.set("yahoo", { ...tok, expires_at: Date.now() + (tok.expires_in || 3600) * 1000 });
    try {
      await admin.firestore().doc("system/yahooOAuth").set({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || "",
        expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
      }, { merge: true });
    } catch (e) { console.error("yahoo persist", e.message); }
    const wantsJson = (req.get("accept") || "").includes("application/json") || req.query.format === "json";
    if (wantsJson) return res.json({ ok: true });
    res.send("<h2>Yahoo connected.</h2><p>You can close this tab. In League HQ open League → Teams, choose Yahoo, paste your league key, and Import.</p>");
  } catch (e) { res.status(502).send("Yahoo auth failed: " + e.message); }
});

async function yahooToken(req) {
  let t = tokens.get("yahoo");
  if (!t) {
    try {
      const snap = await admin.firestore().doc("system/yahooOAuth").get();
      if (snap.exists) t = snap.data();
    } catch {}
  }
  if (!t || !t.access_token) throw new Error("not connected — open /api/yahoo/auth first");
  tokens.set("yahoo", t);
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  const auth = Buffer.from(`${process.env.YAHOO_CLIENT_ID.trim()}:${process.env.YAHOO_CLIENT_SECRET.trim()}`).toString("base64");
  const refreshed = await fetch(YAHOO_TOKEN, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      redirect_uri: yahooRedirectUri(req),
      refresh_token: t.refresh_token,
    }),
  }).then((r) => r.json());
  tokens.set("yahoo", { ...refreshed, expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000 });
  try {
    await admin.firestore().doc("system/yahooOAuth").set({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || t.refresh_token || "",
      expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000,
    }, { merge: true });
  } catch {}
  return refreshed.access_token;
}

app.get("/api/yahoo/league", async (req, res) => {
  try {
    let key = String(req.query.leagueId || "").trim();
    if (/^\d+$/.test(key)) key = `nfl.l.${key}`;
    if (!key) return fail(res, 400, "leagueId (league key) required");
    const token = await yahooToken(req);
    const api = (p) => fetch(`https://fantasysports.yahooapis.com/fantasy/v2/${p}?format=json`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());

    const data = await api(`league/${key}/teams/roster`);
    const league = data.fantasy_content.league[1];
    const teamsObj = league.teams;
    const members = [];
    for (let i = 0; i < teamsObj.count; i++) {
      const team = teamsObj[i].team;
      const meta = team[0];
      const teamName = (meta.find((x) => x && x.name) || {}).name || "Team";
      const teamKey = (meta.find((x) => x && x.team_key) || {}).team_key || "";
      const isMine = !!(meta.find((x) => x && x.is_owned_by_current_login) || {}).is_owned_by_current_login;
      const rosterObj = (team.find((x) => x && x.roster) || {}).roster;
      const players = rosterObj ? rosterObj[0].players : { count: 0 };
      const roster = [];
      for (let j = 0; j < players.count; j++) {
        const pmeta = players[j].player[0];
        const name = (pmeta.find((x) => x && x.name) || {}).name;
        roster.push({
          name: (name && name.full) || "Player",
          pos: (pmeta.find((x) => x && x.display_position) || {}).display_position || "",
          team: (pmeta.find((x) => x && x.editorial_team_abbr) || {}).editorial_team_abbr || "",
          playerKey: (pmeta.find((x) => x && x.player_key) || {}).player_key || "",
        });
      }
      members.push({ name: teamName, teamName, ownerId: "", mine: isMine, roster, teamKey });
    }
    ok(res, members);
  } catch (e) { fail(res, 502, "Yahoo fetch failed: " + e.message); }
});

const YAHOO_POS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF", FLEX: "W/R/T", SUPERFLEX: "Q/W/R/T", BN: "BN", IR: "IR" };
app.post("/api/yahoo/roster", async (req, res) => {
  try {
    const { teamKey, players } = req.body || {};
    if (!teamKey || !Array.isArray(players) || !players.length) return res.status(400).json({ error: "teamKey and players[] required" });
    const token = await yahooToken(req);
    let week = req.body.week;
    if (!week) {
      const leagueKey = teamKey.split(".t.")[0];
      const meta = await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}?format=json`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      week = meta.fantasy_content.league[0].current_week;
    }
    const rows = players
      .filter((p) => p.playerKey)
      .map((p) => `    <player><player_key>${p.playerKey}</player_key><position>${YAHOO_POS[p.slot] || p.slot}</position></player>`)
      .join("\n");
    const xml = `<?xml version="1.0"?>\n<fantasy_content>\n  <roster>\n    <coverage_type>week</coverage_type>\n    <week>${week}</week>\n    <players>\n${rows}\n    </players>\n  </roster>\n</fantasy_content>`;
    const resp = await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
      body: xml,
    });
    if (!resp.ok) { const t = await resp.text(); return res.status(502).json({ error: "Yahoo write failed: HTTP " + resp.status, detail: t.slice(0, 300) }); }
    res.json({ ok: true, week });
  } catch (e) { res.status(502).json({ error: "Yahoo write failed: " + e.message }); }
});

/* =========================================================================
   ESPN
   ========================================================================= */
app.get("/api/espn/league", async (req, res) => {
  try {
    const leagueId = String(req.query.leagueId || "").trim();
    const season = String(req.query.season || new Date().getFullYear());
    if (!leagueId) return fail(res, 400, "leagueId required");
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mRoster&view=mTeam`;
    const headers = {};
    if (process.env.ESPN_S2 && process.env.ESPN_SWID) headers.Cookie = `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`;
    const data = await fetch(url, { headers }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
    const members = (data.teams || []).map((t) => ({
      name: (t.owners && t.owners[0]) || t.name || "Manager",
      teamName: t.name || `${t.location || ""} ${t.nickname || ""}`.trim() || "Team",
      ownerId: (t.owners && t.owners[0]) || "",
      mine: false,
      roster: ((t.roster && t.roster.entries) || []).map((e) => {
        const p = e.playerPoolEntry ? e.playerPoolEntry.player : e.playerForStats || {};
        return { name: p.fullName || "Player", pos: POS[p.defaultPositionId] || "", team: "" };
      }),
    }));
    ok(res, members);
  } catch (e) { fail(res, 502, "ESPN fetch failed: " + e.message + " (private leagues need ESPN_S2 + ESPN_SWID)"); }
});

app.get("/api/nfl/league", (req, res) => {
  res.status(501).json({ error: "NFL.com has no supported fantasy API — enter this league's teams manually in League HQ.", members: [] });
});

app.get("/", (req, res) => res.json({ ok: true, service: "league-hq-api", platforms: ["sleeper", "yahoo", "espn", "nfl(manual)", "ai"] }));

function startLocal() {
  const server = app.listen(PORT, () => console.log(`League HQ API on http://localhost:${PORT}`));
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${PORT} already in use — reusing the API that is already running.`);
      setInterval(() => {}, 60 * 60 * 1000);
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

exports.app = app;
exports.startLocal = startLocal;
const fnOpts = {
  region: "us-central1",
  cors: true,
  timeoutSeconds: 120,
  memory: "512MiB",
  secrets: [anthropicApiKey],
  invoker: "public",
};
// Keep `api` and `leagueapi` exported so a full deploy does not try to delete stuck leftovers.
exports.api = onRequest(fnOpts, app);
exports.leagueapi = onRequest(fnOpts, app);
// New name: Cloud Run IAM on the older functions returns 403, and their updates 409.
exports.advisor = onRequest(fnOpts, app);
exports.hqapi = onRequest(fnOpts, app);
exports.liveai = onRequest(fnOpts, app);
// 1st gen avoids Cloud Run IAM 403s that block every 2nd-gen HTTPS function in this project.
exports.hqv1 = functionsV1
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB", secrets: ["ANTHROPIC_API_KEY"], invoker: "public" })
  .https.onRequest(app);

if (require.main === module) startLocal();
