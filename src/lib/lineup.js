import { PLAYERS, TEAM_BYE, tierOf } from "./players.js";

function activeRoster(members, board) {
  const me = (members || []).find((m) => m.mine && m.roster && m.roster.length);
  if (me) return me.roster.map((p) => ({ name: p.name, pos: p.pos, team: p.team, bye: TEAM_BYE[p.team], playerKey: p.playerKey }));
  return PLAYERS.filter((p) => board[p.id] === "mine").map((p) => ({ name: p.name, pos: p.pos, team: p.team, bye: p.bye }));
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
  if (slot === "BN") return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(P);
  if (slot === "SUPERFLEX" || slot === "SFLEX") return ["QB", "RB", "WR", "TE"].includes(P);
  if (slot === "K") return ["K", "PK"].includes(P);
  if (slot === "DEF") return ["DEF", "DST"].includes(P);
  return P === slot;
}
function localLineup(roster, slots) {
  const used = new Set();
  const lineup = (slots || []).map((s) => {
    const cand = (roster || []).find((p) => p.name && !used.has(p.name) && slotEligible(s, p.pos));
    if (!cand) return { slot: s, player: "", proj: "", why: "" };
    used.add(cand.name);
    return { slot: s, player: cand.name, proj: "", why: [cand.pos, cand.team].filter(Boolean).join(" · ") };
  });
  const bench = (roster || []).filter((p) => !used.has(p.name)).map((p) => ({ player: p.name, why: "bench" }));
  return { lineup, bench, risks: [], roster_notes: "Filled from your imported roster without live projections." };
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
  // you can't roster anyone realistically gone before your first pick
  const avail = pool.filter((p) => Number(p.adp) >= firstPick).sort((a, b) => Number(a.adp) - Number(b.adp));
  const used = new Set();
  const fill = fullSlots.map(() => null);
  // fill starters first, then K/DEF, then bench — each takes the best still available
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
};
