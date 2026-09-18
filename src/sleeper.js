/** Direct Sleeper API — public and CORS-enabled, so import works without Cloud Functions. */

const SLEEPER = "https://api.sleeper.app/v1";

async function sleeperJson(path) {
  const res = await fetch(SLEEPER + path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Sleeper HTTP " + res.status);
  return res.json();
}

let playersCache = null;
let playersFetchedAt = null;
let playersPromise = null;

/** Session-cached Sleeper NFL players map (~5MB). One fetch; pass { force: true } to refresh. */
export async function getNflPlayers({ force = false } = {}) {
  if (!force && playersCache) return playersCache;
  if (!force && playersPromise) return playersPromise;

  const run = (async () => {
    try {
      const res = await fetch(SLEEPER + "/players/nfl");
      if (!res.ok) throw new Error("Sleeper players HTTP " + res.status);
      const data = await res.json();
      if (!data || typeof data !== "object") throw new Error("Sleeper players: bad payload");
      // Real map is huge; reject tiny/empty responses so callers can fall back.
      if (Object.keys(data).length < 100) throw new Error("Sleeper players: sparse payload");
      playersCache = data;
      playersFetchedAt = Date.now();
      return playersCache;
    } catch (e) {
      if (playersCache) return playersCache; // keep last good map on refresh failure
      throw e;
    } finally {
      playersPromise = null;
    }
  })();

  playersPromise = run;
  return run;
}

export function getNflPlayersAt() {
  return playersFetchedAt;
}

export function sleeperPlayerDisplayName(p, id) {
  return (p && (p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim())) || String(id || "");
}

export function sleeperPlayerIsActive(p) {
  if (!p) return false;
  if (p.active === false) return false;
  const st = String(p.status || "").toLowerCase();
  if (st === "inactive" || st === "retired" || st === "na") return false;
  return true;
}

export function sleeperFantasyPos(p) {
  const pos = p && p.position === "DST" ? "DEF" : ((p && p.position) || "");
  if (pos === "PK") return "K";
  return pos;
}

const FANTASY_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/**
 * Ranked fantasy board from the live Sleeper players map (search_rank ascending).
 * Returns [] if pool is empty/unusable.
 */
export function fantasyBoardFromLive(pool, limit = 200) {
  if (!pool || typeof pool !== "object") return [];
  const rows = [];
  Object.entries(pool).forEach(([id, p]) => {
    if (!sleeperPlayerIsActive(p)) return;
    const pos = sleeperFantasyPos(p);
    if (!FANTASY_POS.has(pos)) return;
    const rank = Number(p.search_rank);
    rows.push({
      id: String(id),
      player_id: String(id),
      name: sleeperPlayerDisplayName(p, id),
      pos,
      team: (p && p.team) || "",
      bye: p && p.bye_week != null ? Number(p.bye_week) : null,
      adp: Number.isFinite(rank) ? rank : Infinity,
      rank: Number.isFinite(rank) ? rank : Infinity,
      source: "live",
    });
  });
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function resolvePlayer(pid, players) {
  const p = players[pid];
  if (p) {
    const name = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || pid;
    return { name, pos: p.position || "", team: p.team || "", player_id: pid };
  }
  if (/^[A-Z]{2,3}$/.test(String(pid))) return { name: `${pid} DEF`, pos: "DEF", team: pid, player_id: pid };
  return { name: String(pid), pos: "", team: "", player_id: pid };
}

function scoringLabel(league) {
  const s = league.scoring_settings || {};
  const rec = Number(s.rec);
  if (rec >= 1) return "PPR";
  if (rec > 0) return "Half-PPR";
  return "Standard";
}

/** Map a Sleeper roster_positions code to an app slot label. Returns null for bench/reserve. */
export function mapSleeperSlot(code) {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "BN" || raw === "IR" || raw === "TAXI") return null;
  const map = {
    QB: "QB",
    RB: "RB",
    WR: "WR",
    TE: "TE",
    K: "K",
    PK: "K",
    DEF: "DEF",
    DST: "DEF",
    FLEX: "FLEX",
    SUPER_FLEX: "SUPERFLEX",
    SUPERFLEX: "SUPERFLEX",
    WRRB_FLEX: "FLEX",
    REC_FLEX: "FLEX",
    WRT_FLEX: "FLEX",
    OP: "SUPERFLEX",
  };
  if (map[raw]) return map[raw];
  // IDP and other custom slots: keep a clean label
  return raw.replace(/_/g, "");
}

/** Starting lineup slots from Sleeper roster_positions (order preserved; BN/IR/TAXI dropped). */
export function startingSlotsFromRosterPositions(positions) {
  if (!Array.isArray(positions) || !positions.length) return null;
  const slots = [];
  positions.forEach((code) => {
    const mapped = mapSleeperSlot(code);
    if (mapped) slots.push(mapped);
  });
  return slots.length ? slots : null;
}

export async function importSleeperLeague(leagueId) {
  const id = String(leagueId || "").trim();
  if (!id) throw new Error("Enter a Sleeper league ID");

  const [league, users, rosters, players] = await Promise.all([
    sleeperJson("/league/" + encodeURIComponent(id)),
    sleeperJson("/league/" + encodeURIComponent(id) + "/users"),
    sleeperJson("/league/" + encodeURIComponent(id) + "/rosters"),
    getNflPlayers().catch(() => ({})),
  ]);

  if (!league || !league.league_id) {
    throw new Error("Sleeper didn't find that league. Copy the ID from sleeper.com/leagues/ID/…");
  }
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error("That league has no managers yet.");
  }

  const byOwner = {};
  const rosterIdByOwner = {};
  (rosters || []).forEach((r) => {
    rosterIdByOwner[r.owner_id] = r.roster_id;
    byOwner[r.owner_id] = (r.players || []).map((pid) => resolvePlayer(pid, players)).filter((x) => x.pos);
  });

  const members = users.map((u) => ({
    name: u.display_name || "Manager",
    teamName: (u.metadata && u.metadata.team_name) || u.display_name || "Team",
    ownerId: u.user_id || "",
    rosterId: rosterIdByOwner[u.user_id],
    mine: false,
    roster: byOwner[u.user_id] || [],
    notes: "",
  }));

  const positions = league.roster_positions || [];
  const slots = startingSlotsFromRosterPositions(positions);
  const superflex = positions.includes("SUPER_FLEX") || positions.filter((p) => p === "QB").length >= 2;

  return {
    members,
    slots: slots || null,
    league: {
      name: String(league.name || "").trim(),
      teams: league.total_rosters || (league.settings && league.settings.num_teams) || members.length,
      scoring: scoringLabel(league),
      format: superflex ? "Superflex / 2-QB" : "Standard (1 QB)",
      leagueId: id,
    },
  };
}

export function fantasyWeekFromState(state) {
  const type = (state && state.season_type) || "off";
  const raw = Number((state && (state.week || state.display_week)) || 1) || 1;
  const season = String((state && state.season) || "");
  if (type === "regular") {
    return { week: raw, seasonType: type, season, label: "Week " + raw, started: true };
  }
  if (type === "post") {
    return { week: raw, seasonType: type, season, label: "Playoffs", started: true };
  }
  if (type === "pre") {
    return {
      week: 1,
      seasonType: type,
      season,
      preWeek: raw,
      label: "Fantasy Week 1 hasn’t started — NFL is still preseason (week " + raw + ")",
      started: false,
    };
  }
  return {
    week: 1,
    seasonType: type,
    season,
    label: "Fantasy Week 1 hasn’t started — offseason",
    started: false,
  };
}

export async function nflSeasonClock() {
  const state = (await sleeperJson("/state/nfl")) || {};
  return fantasyWeekFromState(state);
}

export async function sleeperNextOpponentDirect(leagueId, myRosterId) {
  const id = String(leagueId || "").trim();
  const rosterId = Number(myRosterId);
  const clock = await nflSeasonClock();
  const matchups = (await sleeperJson(`/league/${encodeURIComponent(id)}/matchups/${clock.week}`)) || [];
  const mine = Array.isArray(matchups) ? matchups.find((m) => m.roster_id === rosterId) : null;
  if (!mine) return { ...clock, oppRosterId: null };
  const opp = matchups.find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== rosterId);
  return { ...clock, oppRosterId: opp ? opp.roster_id : null };
}

/** Current week's starting player_ids for a roster, or null if Sleeper is unreachable. */
export async function getMyStarters(leagueId, myRosterId) {
  try {
    const id = String(leagueId || "").trim();
    const rosterId = Number(myRosterId);
    if (!id || !Number.isFinite(rosterId)) return null;
    const clock = await nflSeasonClock();
    const week = clock && clock.week;
    if (week == null) return null;
    const matchups = await sleeperJson(`/league/${encodeURIComponent(id)}/matchups/${week}`);
    if (!Array.isArray(matchups)) return null;
    const mine = matchups.find((m) => Number(m.roster_id) === rosterId);
    if (!mine || !Array.isArray(mine.starters)) return null;
    return mine.starters.map((pid) => String(pid));
  } catch {
    return null;
  }
}
