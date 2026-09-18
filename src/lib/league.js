import { apiJson } from "../api";
import { importSleeperLeague, sleeperNextOpponentDirect } from "../sleeper";
import { loadKey, saveKey } from "./storage.js";
import { defaultSlots } from "./lineup.js";

const DEFAULT_CFG = {
  league: "Fantasy League #1", platform: "Sleeper", teams: 12, scoring: "PPR",
  format: "Standard (1 QB)", slot: "", draftDate: "", leagueId: "", connectorUrl: "", showDraft: null,
};
const DEFAULT_REM = { lineupDay: 0, lineupTime: "11:00", waiverDay: 2, waiverTime: "22:00", tradeDeadline: "" };
function defaultSources() {
  return { senders: "noreply@sleeper.app", people: "", keywords: "", labels: "" };
}
const LEGACY_KIND = {
  config: "league:config", members: "league:members", board: "draft:board", rem: "reminders:config",
  alerts: "alerts:latest", sources: "league:sources", offers: "trade:offers", slots: "lineup:slots",
  lineup: "lineup:final", roster: "roster:target", lastRefresh: "league:lastRefresh", coach: "ai:coach",
};
const MISSING = { __missing: true };
function lk(leagueId, kind) { return "l:" + leagueId + ":" + kind; }
function newLeagueId() { return "lg_" + Date.now().toString(36); }
function summaryFromCfg(cfg, id) {
  return {
    id,
    name: (cfg && cfg.league) || "Untitled league",
    platform: (cfg && cfg.platform) || "Sleeper",
    leagueId: (cfg && cfg.leagueId) || "",
    teams: (cfg && cfg.teams) || 12,
    scoring: (cfg && cfg.scoring) || "PPR",
  };
}
function emptyLeagueBundle(cfgPatch) {
  const cfg = { ...DEFAULT_CFG, ...(cfgPatch || {}) };
  return {
    cfg,
    members: [],
    board: {},
    rem: { ...DEFAULT_REM },
    alerts: [],
    sources: defaultSources(cfg.platform),
    offers: [],
    slots: defaultSlots(cfg.format),
    savedLineup: null,
    savedRoster: null,
    lastRefresh: null,
  };
}
async function readLeagueValue(leagueId, kind, fallback) {
  const namespaced = await loadKey(lk(leagueId, kind), MISSING);
  if (namespaced !== MISSING) return namespaced;
  if (leagueId === "default") return loadKey(LEGACY_KIND[kind], fallback);
  return fallback;
}
async function loadLeagueBundle(leagueId) {
  const cfg = { ...DEFAULT_CFG, ...(await readLeagueValue(leagueId, "config", DEFAULT_CFG)) };
  return {
    cfg,
    members: await readLeagueValue(leagueId, "members", []),
    board: await readLeagueValue(leagueId, "board", {}),
    rem: { ...DEFAULT_REM, ...(await readLeagueValue(leagueId, "rem", DEFAULT_REM)) },
    alerts: await readLeagueValue(leagueId, "alerts", []),
    sources: { ...defaultSources(cfg.platform), ...(await readLeagueValue(leagueId, "sources", defaultSources(cfg.platform))) },
    offers: await readLeagueValue(leagueId, "offers", []),
    slots: await readLeagueValue(leagueId, "slots", defaultSlots(cfg.format)),
    savedLineup: await readLeagueValue(leagueId, "lineup", null),
    savedRoster: await readLeagueValue(leagueId, "roster", null),
    lastRefresh: await readLeagueValue(leagueId, "lastRefresh", null),
  };
}
async function writeLeagueBundle(leagueId, bundle) {
  await Promise.all([
    saveKey(lk(leagueId, "config"), bundle.cfg),
    saveKey(lk(leagueId, "members"), bundle.members),
    saveKey(lk(leagueId, "board"), bundle.board),
    saveKey(lk(leagueId, "rem"), bundle.rem),
    saveKey(lk(leagueId, "alerts"), bundle.alerts),
    saveKey(lk(leagueId, "sources"), bundle.sources),
    saveKey(lk(leagueId, "offers"), bundle.offers),
    saveKey(lk(leagueId, "slots"), bundle.slots),
    saveKey(lk(leagueId, "lineup"), bundle.savedLineup),
    saveKey(lk(leagueId, "roster"), bundle.savedRoster),
    saveKey(lk(leagueId, "lastRefresh"), bundle.lastRefresh),
  ]);
}
function draftToolsVisible(cfg, members, clock) {
  if (cfg && cfg.showDraft === true) return true;
  if (cfg && cfg.showDraft === false) return false;
  if (cfg && cfg.draftDate) {
    const d = new Date(cfg.draftDate);
    if (!isNaN(+d) && Date.now() > d.getTime() + 6 * 3600000) return false;
  }
  const mine = (members || []).find((m) => m.mine && Array.isArray(m.roster) && m.roster.length >= 8);
  if (mine && clock && (clock.started || clock.seasonType === "regular" || clock.seasonType === "post")) return false;
  if (mine && mine.roster.length >= 12) return false;
  return true;
}

async function importSleeper(leagueId) {
  return importSleeperLeague(leagueId);
}
function findSavedMember(existing, fresh) {
  const prev = existing || [];
  if (fresh.rosterId != null) {
    const hit = prev.find((p) => p.rosterId === fresh.rosterId);
    if (hit) return hit;
  }
  if (fresh.ownerId) {
    const hit = prev.find((p) => p.ownerId && p.ownerId === fresh.ownerId);
    if (hit) return hit;
  }
  const tn = String(fresh.teamName || "").trim().toLowerCase();
  if (tn) return prev.find((p) => String(p.teamName || "").trim().toLowerCase() === tn) || null;
  return null;
}
function mergeImportedMembers(existing, fresh) {
  return (fresh || []).map((m) => {
    const old = findSavedMember(existing, m);
    return {
      ...m,
      roster: Array.isArray(m.roster) ? m.roster : [],
      mine: old ? !!old.mine : !!m.mine,
      notes: old && old.notes != null ? old.notes : (m.notes || ""),
    };
  });
}
function fmtRefreshAgo(ts) {
  if (!ts) return "";
  const sec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (sec < 45) return "Updated just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return "Updated " + min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return "Updated " + hr + "h ago";
  return "Updated " + Math.floor(hr / 24) + "d ago";
}
async function sleeperNextOpponent(leagueId, myRosterId) {
  try {
    return await sleeperNextOpponentDirect(leagueId, myRosterId);
  } catch {
    return apiJson("/api/sleeper/matchup?leagueId=" + encodeURIComponent(leagueId || "") + "&rosterId=" + encodeURIComponent(myRosterId));
  }
}
async function importViaApi(platform, leagueId) {
  const q = "/api/" + platform + "/league?leagueId=" + encodeURIComponent((leagueId || "").trim());
  const data = await apiJson(q);
  if (!data || !Array.isArray(data.members)) throw new Error("shape");
  return data.members.map((m) => ({
    name: m.name || "Manager", teamName: m.teamName || m.name || "Team", ownerId: m.ownerId || "", teamKey: m.teamKey || "",
    rosterId: m.rosterId, roster: Array.isArray(m.roster) ? m.roster : [], notes: "", mine: !!m.mine,
  }));
}
/** Same import path the League tab uses — Sleeper client import, otherwise /api/{platform}/league. */
async function runLeagueImport(platform, leagueId, cfg) {
  const p = platform || "Sleeper";
  const id = String(leagueId || "").trim();
  if (p === "Sleeper") {
    const result = await importSleeper(id);
    return {
      members: result.members,
      slots: result.slots || null,
      cfg: {
        ...cfg,
        platform: p,
        leagueId: id,
        league: result.league.name || cfg.league,
        teams: result.league.teams || cfg.teams,
        scoring: result.league.scoring || cfg.scoring,
        format: result.league.format || cfg.format,
      },
    };
  }
  const members = await importViaApi(p.toLowerCase(), id);
  return { members, slots: null, cfg: { ...cfg, platform: p, leagueId: id } };
}
function leagueImportError(platform, e) {
  if (platform === "Sleeper") {
    return "Couldn't import from Sleeper. Check the league ID and try again." + (e && e.message ? " (" + e.message + ")" : "");
  }
  return (e && e.message) ? e.message : "Couldn't import this league. For Yahoo, connect your account first, then import.";
}

async function resolveNextOpponent(cfg, members) {
  const list = members || [];
  const meMember = list.find((m) => m.mine);
  if ((cfg.platform || "Sleeper") === "Sleeper" && cfg.leagueId && meMember && meMember.rosterId != null) {
    try {
      const r = await sleeperNextOpponent(cfg.leagueId, meMember.rosterId);
      if (r && r.oppRosterId != null) {
        const om = list.find((m) => m.rosterId === r.oppRosterId);
        if (om) return om;
      }
    } catch { /* fall through to a marked opponent */ }
  }
  const flagged = list.find((m) => !m.mine && m.opponent);
  if (flagged) return flagged;
  try {
    const key = await loadKey("matchup:oppKey", "", false);
    if (key) {
      const others = list.filter((m) => !m.mine);
      const found = others.find((m, i) => (m.rosterId != null ? "r" + m.rosterId : "i" + i) === key);
      if (found) return found;
    }
  } catch { /* no marked opponent */ }
  return null;
}

export {
  DEFAULT_CFG, DEFAULT_REM, defaultSources, LEGACY_KIND, MISSING,
  lk, newLeagueId, summaryFromCfg, emptyLeagueBundle,
  readLeagueValue, loadLeagueBundle, writeLeagueBundle, draftToolsVisible,
  importSleeper, findSavedMember, mergeImportedMembers,
  sleeperNextOpponent, importViaApi, runLeagueImport, leagueImportError,
  resolveNextOpponent,
};
