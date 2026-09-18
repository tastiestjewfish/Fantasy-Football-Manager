import { PLAYERS, TEAM_BYE, tierOf } from "./players.js";
import { getNflPlayers, sleeperPlayerDisplayName } from "../sleeper.js";
import { callClaudeSearch, extractJSON } from "./ai.js";

const RANK_MARGIN = 15; // don't swap if ranks are within this many spots
const FALLBACK_NOTE = "Using our backup ranking — live advice was unavailable";

function activeRoster(members, board) {
  const me = (members || []).find((m) => m.mine && m.roster && m.roster.length);
  if (me) {
    return me.roster.map((p) => ({
      name: p.name,
      pos: p.pos,
      team: p.team,
      bye: TEAM_BYE[p.team],
      playerKey: p.playerKey,
      player_id: p.player_id,
    }));
  }
  return PLAYERS.filter((p) => board[p.id] === "mine").map((p) => ({
    name: p.name, pos: p.pos, team: p.team, bye: p.bye, player_id: p.id,
  }));
}

function rosterNeeds(roster) {
  const c = (pos) => roster.filter((p) => p.pos === pos).length;
  const need = [];
  if (c("RB") < 3) need.push("RB");
  if (c("WR") < 3) need.push("WR");
  if (c("TE") < 1) need.push("TE");
  if (c("QB") < 1) need.push("QB");
  const surplus = [];
  if (c("RB") > 4) surplus.push("RB");
  if (c("WR") > 4) surplus.push("WR");
  return { need, surplus, myList: roster.map((p) => `${p.name} (${p.pos})`).join(", ") || "not set" };
}

function defaultSlots(fmt) {
  return (fmt && fmt.toLowerCase().includes("super"))
    ? ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF"]
    : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
}

/** Prefer imported starting slots; otherwise format-based hardcoded fallback. */
function resolveSlots(imported, fmt) {
  if (Array.isArray(imported) && imported.length) return imported.slice();
  return defaultSlots(fmt);
}

function slotEligible(slot, pos) {
  const P = (pos || "").toUpperCase();
  const S = String(slot || "").toUpperCase();
  if (S === "BN") return true;
  // Kickers and defenses only in their own slots — never FLEX
  if (P === "K" || P === "PK") return S === "K";
  if (P === "DEF" || P === "DST") return S === "DEF";
  if (S === "FLEX") return ["RB", "WR", "TE"].includes(P);
  if (S === "SUPERFLEX" || S === "SFLEX") return ["QB", "RB", "WR", "TE"].includes(P);
  if (S === "K") return ["K", "PK"].includes(P);
  if (S === "DEF") return ["DEF", "DST"].includes(P);
  return P === S;
}

function nameEq(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function slotFillPriority(slot) {
  const S = String(slot || "").toUpperCase();
  if (S === "FLEX" || S === "SUPERFLEX" || S === "SFLEX") return 2;
  if (S === "BN") return 3;
  return 1; // fixed positions first
}

/** Attach a numeric rank (lower = better) using live search_rank, else static ADP. */
async function enrichRosterWithRanks(roster) {
  const byName = new Map();
  const byId = new Map();
  PLAYERS.forEach((p) => {
    byName.set(String(p.name).toLowerCase(), Number(p.adp));
  });
  try {
    const pool = await getNflPlayers();
    Object.entries(pool || {}).forEach(([id, p]) => {
      const rank = Number(p && p.search_rank);
      if (!Number.isFinite(rank)) return;
      byId.set(String(id), rank);
      const nm = sleeperPlayerDisplayName(p, id).toLowerCase();
      if (nm) byName.set(nm, rank);
    });
  } catch { /* static ADP only */ }

  return (roster || []).map((p) => {
    let rank = Infinity;
    if (p.player_id != null && byId.has(String(p.player_id))) rank = byId.get(String(p.player_id));
    else {
      const hit = byName.get(String(p.name || "").toLowerCase());
      if (hit != null) rank = hit;
    }
    if (!Number.isFinite(rank)) rank = 9999;
    return { ...p, rank };
  });
}

function rankOfName(roster, name) {
  const p = (roster || []).find((x) => nameEq(x.name, name));
  return p && Number.isFinite(p.rank) ? p.rank : 9999;
}

/**
 * Rank-aware lineup fill. Required slots first, then FLEX/SUPERFLEX from leftovers.
 * Never puts K/DEF in FLEX. Uses lower rank = better.
 */
function localLineup(roster, slots) {
  const ranked = (roster || [])
    .filter((p) => p && p.name)
    .slice()
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || String(a.name).localeCompare(String(b.name)));
  const used = new Set();
  const fill = (slots || []).map(() => null);
  const order = (slots || []).map((s, i) => ({ s, i }))
    .sort((a, b) => slotFillPriority(a.s) - slotFillPriority(b.s) || a.i - b.i);

  order.forEach(({ s, i }) => {
    const cand = ranked.find((p) => !used.has(p.name) && slotEligible(s, p.pos));
    if (!cand) return;
    used.add(cand.name);
    fill[i] = cand;
  });

  const lineup = (slots || []).map((s, i) => {
    const p = fill[i];
    if (!p) return { slot: s, player: "", proj: "", why: "", rank: null };
    return {
      slot: s,
      player: p.name,
      proj: "",
      why: [p.pos, p.team, p.rank < 9999 ? "rank " + p.rank : null].filter(Boolean).join(" · "),
      rank: p.rank,
    };
  });
  const bench = ranked.filter((p) => !used.has(p.name)).map((p) => ({
    player: p.name,
    why: "bench",
    rank: p.rank,
  }));
  return {
    lineup,
    assign: lineup.map((l) => l.player || null),
    bench,
    risks: [],
    roster_notes: "Ranked from Sleeper search_rank (or ADP) — best available per slot.",
  };
}

/**
 * Compare current starters to a recommended assign. Only count a change when the
 * recommended player is clearly better-ranked (by RANK_MARGIN) and slot-eligible.
 */
function applyKeepMargin(slots, roster, recommendedAssign, currentNames) {
  const display = (slots || []).map((s, i) => {
    const best = recommendedAssign && recommendedAssign[i];
    const cur = currentNames && currentNames[i];
    if (!best) return cur || null;
    if (!cur) return best;
    if (nameEq(cur, best)) return best;
    const curPlayer = (roster || []).find((p) => nameEq(p.name, cur));
    if (curPlayer && !slotEligible(s, curPlayer.pos)) return best; // current illegal for slot — must change
    const bestRank = rankOfName(roster, best);
    const curRank = rankOfName(roster, cur);
    if (bestRank + RANK_MARGIN < curRank) return best;
    return cur; // Keep — too close to call
  });

  const changes = [];
  (slots || []).forEach((s, i) => {
    const cur = currentNames && currentNames[i];
    const sug = display[i];
    if (cur && sug && !nameEq(cur, sug)) {
      const toPlayer = (roster || []).find((p) => nameEq(p.name, sug));
      if (toPlayer && !slotEligible(s, toPlayer.pos)) return;
      changes.push({
        slot: s,
        from: cur,
        to: sug,
        type: "lineup",
        priority: changes.length + 1,
        verdict: "Put " + sug + " in your starting lineup" + (cur ? " (instead of " + cur + ")" : ""),
        why: "Higher on the rankings than " + cur + " for this spot.",
      });
    }
  });

  return { assign: display, changes };
}

function validateAiAssign(slots, roster, aiLineup) {
  const names = new Set((roster || []).map((p) => String(p.name)));
  const used = new Set();
  return (slots || []).map((s, i) => {
    const row = aiLineup && aiLineup[i];
    const nm = row && row.player;
    if (!nm || !names.has(nm) || used.has(nm)) return null;
    const p = (roster || []).find((x) => nameEq(x.name, nm));
    if (!p || !slotEligible(s, p.pos)) return null;
    used.add(nm);
    return nm;
  });
}

/**
 * Shared lineup source of truth for Home + Lineup.
 * Returns recommended starters per slot and the list of actual changes vs current.
 */
async function optimizeLineup({
  roster,
  slots,
  currentStarters,
  scoring = "PPR",
  useAi = true,
} = {}) {
  const withRanks = await enrichRosterWithRanks(roster || []);
  const local = localLineup(withRanks, slots || []);
  let assign = local.assign.slice();
  let meta = {
    byPlayer: {},
    risks: local.risks || [],
    notes: local.roster_notes || "",
  };
  local.lineup.forEach((l) => {
    if (l.player) meta.byPlayer[l.player] = { proj: l.proj, why: l.why };
  });
  let source = "local";
  let note = null;

  if (useAi && withRanks.length && (slots || []).length) {
    try {
      const sys = "You are a top-tier fantasy football lineup optimizer for a " + scoring
        + " league. If web_search is available, use it for THIS WEEK's matchups, injuries, inactives, and projections. Using ONLY players from my roster, set the optimal starter for each slot. Slots in order: "
        + (slots || []).join(", ")
        + ". FLEX = RB/WR/TE only (never K or DEF); SUPERFLEX = QB/RB/WR/TE. Respond with ONLY JSON, no prose: {\"lineup\":[{\"slot\":\"\",\"player\":\"exact name from my roster\",\"proj\":\"projected pts\",\"why\":\"one line\"}],\"bench\":[{\"player\":\"\",\"why\":\"\"}],\"risks\":[\"injury/inactive flags\"],\"roster_notes\":\"weak spots and add/drop ideas\"}. Use each player at most once. The lineup array must have exactly "
        + (slots || []).length + " entries in the given slot order.";
      const user = "My roster: " + withRanks.map((p) => `${p.name} (${p.pos}${p.team ? ", " + p.team : ""})`).join("; ") + ".";
      const j = extractJSON(await callClaudeSearch([{ role: "user", content: user }], { system: sys }));
      const aiAssign = validateAiAssign(slots, withRanks, j.lineup);
      const used = new Set(aiAssign.filter(Boolean));
      assign = (slots || []).map((s, i) => {
        if (aiAssign[i]) return aiAssign[i];
        const cand = withRanks
          .filter((p) => !used.has(p.name) && slotEligible(s, p.pos))
          .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))[0];
        if (cand) { used.add(cand.name); return cand.name; }
        return local.assign[i] || null;
      });
      meta = {
        byPlayer: {},
        risks: Array.isArray(j.risks) ? j.risks : [],
        notes: j.roster_notes || "",
      };
      (Array.isArray(j.lineup) ? j.lineup : []).forEach((l) => {
        if (l && l.player) meta.byPlayer[l.player] = { proj: l.proj, why: l.why };
      });
      assign.forEach((nm, i) => {
        if (nm && !meta.byPlayer[nm] && local.lineup[i]) {
          meta.byPlayer[nm] = { proj: local.lineup[i].proj, why: local.lineup[i].why };
        }
      });
      source = "ai";
    } catch {
      note = FALLBACK_NOTE;
      source = "local";
      assign = local.assign.slice();
    }
  }

  const currentNames = (currentStarters || []).map((c) => {
    if (!c) return null;
    if (typeof c === "string") return c;
    if (c.unavailable) return null;
    return c.name || null;
  });

  const { assign: finalAssign, changes } = applyKeepMargin(slots, withRanks, assign, currentNames);

  const lineup = (slots || []).map((s, i) => ({
    slot: s,
    player: finalAssign[i] || "",
    proj: (meta.byPlayer[finalAssign[i]] && meta.byPlayer[finalAssign[i]].proj) || "",
    why: (meta.byPlayer[finalAssign[i]] && meta.byPlayer[finalAssign[i]].why) || "",
  }));

  return {
    assign: finalAssign,
    lineup,
    changes,
    changeCount: changes.length,
    bench: local.bench,
    meta,
    source,
    note,
    roster: withRanks,
  };
}

/* deterministic fallback: build a realistic draft-target roster from cached 2026 ADP */
function myPicks(teams, slotStr, rounds) {
  const raw = parseInt(String(slotStr || "").replace(/\D/g, ""), 10);
  const s = Math.min(Math.max(isNaN(raw) ? Math.ceil(teams / 2) : raw, 1), teams);
  const picks = [];
  for (let r = 1; r <= rounds; r++) picks.push(r % 2 === 1 ? (r - 1) * teams + s : (r - 1) * teams + (teams - s + 1));
  return picks;
}
function localRoster(cfg, fullSlots, board = PLAYERS) {
  const teams = cfg.teams || 12;
  const picks = myPicks(teams, cfg.slot, fullSlots.length);
  const firstPick = picks[0] || 1;
  const pool = Array.isArray(board) && board.length ? board : PLAYERS;
  const avail = pool.filter((p) => Number(p.adp) >= firstPick).sort((a, b) => Number(a.adp) - Number(b.adp));
  const used = new Set();
  const fill = fullSlots.map(() => null);
  const rank = (s) => s === "BN" ? 2 : (s === "K" || s === "DEF") ? 1 : 0;
  const order = fullSlots.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i);
  order.forEach(({ s, i }) => {
    const cand = avail.find((p) => !used.has(p.id) && slotEligible(s, p.pos));
    if (cand) { used.add(cand.id); fill[i] = cand; }
  });
  const live = pool.some((p) => p.source === "live");
  const roster = fullSlots.map((s, i) => {
    const p = fill[i];
    return {
      slot: s,
      player: p ? p.name : "",
      pos: p ? p.pos : "",
      tier: p ? tierOf(p.adp).split(" · ")[0] : "",
      adp: p ? String(p.adp) : "",
      why: p ? `${p.team}${p.bye != null ? " · bye " + p.bye : ""}` : "open",
    };
  });
  const alternates = avail.filter((p) => !used.has(p.id)).slice(0, 8).map((p) => ({
    player: p.name,
    pos: p.pos,
    note: live ? `Rank ${p.adp}` : `ADP ${p.adp} value`,
  }));
  return {
    roster,
    alternates,
    avoid: [],
    sources: [live ? "Sleeper search_rank (live)" : "League HQ cached 2026 consensus ADP"],
    summary: `Draft-target roster from ${cfg.slot || "mid"} in a ${teams}-team ${cfg.scoring} league, built from ${live ? "live Sleeper ranks" : "cached ADP"}.`,
  };
}

function rosterFingerprint(members, board) {
  return activeRoster(members, board).map((p) => p.name).sort().join("|");
}

export {
  activeRoster, rosterNeeds, rosterFingerprint,
  defaultSlots, resolveSlots, slotEligible, localLineup, myPicks, localRoster,
  enrichRosterWithRanks, optimizeLineup, applyKeepMargin, RANK_MARGIN, FALLBACK_NOTE,
};
