/** Direct Sleeper API — public and CORS-enabled, so import works without Cloud Functions. */

const SLEEPER = "https://api.sleeper.app/v1";

async function sleeperJson(path) {
  const res = await fetch(SLEEPER + path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Sleeper HTTP " + res.status);
  return res.json();
}

let playersCache = null;
let playersPromise = null;

export async function getNflPlayers() {
  if (playersCache) return playersCache;
  if (!playersPromise) {
    playersPromise = fetch(SLEEPER + "/players/nfl")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        playersCache = data && typeof data === "object" ? data : {};
        return playersCache;
      })
      .catch(() => {
        playersPromise = null;
        return {};
      });
  }
  return playersPromise;
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

export async function importSleeperLeague(leagueId) {
  const id = String(leagueId || "").trim();
  if (!id) throw new Error("Enter a Sleeper league ID");

  const [league, users, rosters, players] = await Promise.all([
    sleeperJson("/league/" + encodeURIComponent(id)),
    sleeperJson("/league/" + encodeURIComponent(id) + "/users"),
    sleeperJson("/league/" + encodeURIComponent(id) + "/rosters"),
    getNflPlayers(),
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
  const superflex = positions.includes("SUPER_FLEX") || positions.filter((p) => p === "QB").length >= 2;

  return {
    members,
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
