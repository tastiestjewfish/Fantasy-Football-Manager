import { callClaudeSearch, extractJSON, aiWeekKey } from "./ai.js";
import { loadKey, saveKey } from "./storage.js";
import { lk, resolveNextOpponent } from "./league.js";
import {
  activeRoster,
  localLineup,
  enrichRosterWithRanks,
  applyKeepMargin,
  slotEligible,
  FALLBACK_NOTE,
} from "./lineup.js";
import { getMyStarters, getNflPlayers, sleeperPlayerDisplayName } from "../sleeper.js";

const PLAN_KIND = "plan:week";

function nameEq(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export function weeklyPlanStoreKey(leagueId) {
  return leagueId ? lk(leagueId, PLAN_KIND) : PLAN_KIND;
}

export async function loadWeeklyPlan(leagueId) {
  return loadKey(weeklyPlanStoreKey(leagueId), null, true);
}

export async function saveWeeklyPlan(leagueId, plan) {
  await saveKey(weeklyPlanStoreKey(leagueId), plan, true);
  return plan;
}

/** Resolve current starters aligned to slot order (Sleeper). */
export async function readCurrentStarters({ cfg, members, slots, roster }) {
  const me = (members || []).find((m) => m.mine);
  if ((cfg.platform || "Sleeper") !== "Sleeper" || !cfg.leagueId || !me || me.rosterId == null) {
    return (slots || []).map(() => null);
  }
  const ids = await getMyStarters(cfg.leagueId, me.rosterId);
  if (!ids) return (slots || []).map(() => null);
  let pool = {};
  try { pool = await getNflPlayers(); } catch { pool = {}; }
  return (slots || []).map((_, i) => {
    const pid = ids[i];
    if (pid == null || pid === "" || pid === "0") return null;
    const id = String(pid);
    const fromRoster = (roster || []).find((p) => p.player_id != null && String(p.player_id) === id);
    if (fromRoster) return { name: fromRoster.name, pos: fromRoster.pos || "", playerId: id };
    const p = pool[id];
    if (p) return { name: sleeperPlayerDisplayName(p, id), pos: p.position || "", playerId: id };
    return { name: id, pos: "", playerId: id };
  });
}

function validatePlanLineup(slots, roster, aiLineup) {
  const used = new Set();
  return (slots || []).map((s, i) => {
    const row = Array.isArray(aiLineup) ? aiLineup[i] : null;
    const nm = row && row.player;
    if (!nm || used.has(nm)) return null;
    const p = (roster || []).find((x) => nameEq(x.name, nm));
    if (!p || !slotEligible(s, p.pos) || used.has(p.name)) return null;
    used.add(p.name);
    return { slot: s, player: p.name, why: (row && row.why) || "" };
  });
}

function fillGapsFromLocal(slots, roster, partial, localAssign) {
  const used = new Set(partial.filter(Boolean).map((r) => r.player));
  return (slots || []).map((s, i) => {
    if (partial[i] && partial[i].player) return partial[i];
    let nm = localAssign[i];
    if (nm && used.has(nm)) nm = null;
    if (!nm) {
      const cand = (roster || [])
        .filter((p) => !used.has(p.name) && slotEligible(s, p.pos))
        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))[0];
      nm = cand ? cand.name : null;
    }
    if (nm) used.add(nm);
    return { slot: s, player: nm || "", why: nm ? "Best available by rank" : "" };
  });
}

function planFromLocal({
  withRanks, slots, currentStarters, opponent, clock, nextDeadline, note,
}) {
  const local = localLineup(withRanks, slots);
  const currentNames = (currentStarters || []).map((c) => (c && !c.unavailable ? c.name : null));
  const { assign, changes } = applyKeepMargin(slots, withRanks, local.assign, currentNames);
  const lineup = (slots || []).map((s, i) => ({
    slot: s,
    player: assign[i] || "",
    why: (local.lineup[i] && local.lineup[i].why) || "",
  }));
  const changeRows = (changes || []).map((c) => ({
    slot: c.slot,
    current: c.from,
    recommended: c.to,
    why: c.why,
  }));
  const toDo = changeRows.map((c, i) => ({
    type: "lineup",
    priority: i + 1,
    verdict: "Put " + c.recommended + " in your starting lineup"
      + (c.current ? " (instead of " + c.current + ")" : ""),
    why: c.why,
    copy: "",
    slot: c.slot,
    from: c.current,
    to: c.recommended,
  }));
  const oppName = opponent ? (opponent.teamName || opponent.name || "") : "";
  return {
    generatedAt: Date.now(),
    week: aiWeekKey(clock),
    deadline: nextDeadline ? nextDeadline.label : "",
    lineup,
    changes: changeRows,
    toDo,
    matchup: {
      opponent: oppName,
      winProb: "—",
      margin: "",
      read: note || FALLBACK_NOTE,
      swaps: changeRows.map((c) => ({ out: c.current, in: c.recommended, why: c.why })),
      waiverTargets: [],
      block: [],
    },
    currentStarters: currentStarters || [],
    allSet: toDo.length === 0,
    source: "local",
    note: note || FALLBACK_NOTE,
  };
}

/**
 * ONE AI call for the whole week. Returns a validated plan used by Home, Lineup,
 * Matchup, Start/Sit, and Waivers. Falls back to deterministic ranking on failure.
 */
export async function buildWeeklyPlan({
  cfg,
  members,
  slots,
  board,
  clock,
  nextDeadline,
  opponent: opponentHint,
  useAi = true,
} = {}) {
  const roster = activeRoster(members, board);
  const withRanks = await enrichRosterWithRanks(roster);
  const currentStarters = await readCurrentStarters({ cfg, members, slots, roster: withRanks });
  const opponent = opponentHint || await resolveNextOpponent(cfg, members);
  const local = localLineup(withRanks, slots);

  if (!useAi || !withRanks.length) {
    return planFromLocal({
      withRanks, slots, currentStarters, opponent, clock, nextDeadline,
      note: FALLBACK_NOTE,
    });
  }

  const oppName = opponent ? (opponent.teamName || opponent.name || "unknown") : "unknown";
  const oppRoster = opponent && Array.isArray(opponent.roster) && opponent.roster.length
    ? opponent.roster.map((p) => p.name + " (" + p.pos + ")").join(", ")
    : "unknown";
  const currentLine = (slots || []).map((s, i) => {
    const c = currentStarters[i];
    return s + ": " + (c && c.name ? c.name : "empty");
  }).join("; ");

  const sys = [
    "You are a fantasy football co-manager for a " + (cfg.teams || 12) + "-team "
      + (cfg.scoring || "PPR") + " league (" + (cfg.format || "Standard") + ").",
    "Use live news if web_search is available. Give ONE complete weekly plan.",
    "Slots in order: " + (slots || []).join(", ") + ".",
    "FLEX = RB/WR/TE only (never K or DEF). SUPERFLEX = QB/RB/WR/TE. K only in K. DEF only in DEF.",
    "Use ONLY players from my roster. Each player at most once.",
    "Respond with ONLY JSON, no prose:",
    JSON.stringify({
      deadline: "e.g. Lineup locks Sun 1pm ET",
      lineup: [{ slot: "", player: "exact roster name", why: "one line" }],
      toDo: [{ type: "lineup|waiver|drop|trade|none", priority: 1, verdict: "plain imperative", why: "", copy: "" }],
      matchup: {
        winProb: "e.g. 55%",
        margin: "e.g. +3.2",
        read: "edges vs this opponent",
        swaps: [{ out: "", in: "", why: "" }],
        waiverTargets: [{ player: "", pos: "", why: "" }],
        block: [{ player: "", why: "" }],
      },
      allSet: false,
    }),
    "lineup length must equal " + (slots || []).length + " in slot order.",
  ].join(" ");

  const user = [
    "My roster: " + withRanks.map((p) => p.name + " (" + p.pos + (p.team ? ", " + p.team : "") + ")").join("; ") + ".",
    "Current starters by slot: " + currentLine + ".",
    "Opponent: " + oppName + ". Opponent roster: " + oppRoster + ".",
    "League: " + (cfg.league || "") + " on " + (cfg.platform || "Sleeper") + ".",
  ].join("\n");

  try {
    const j = extractJSON(await callClaudeSearch(
      [{ role: "user", content: user }],
      { system: sys, max_tokens: 3500 },
    ));

    let partial = validatePlanLineup(slots, withRanks, j.lineup);
    const lineupRows = fillGapsFromLocal(slots, withRanks, partial, local.assign);
    const recommendAssign = lineupRows.map((r) => r.player || null);
    const currentNames = (currentStarters || []).map((c) => (c && c.name ? c.name : null));
    const { assign, changes } = applyKeepMargin(slots, withRanks, recommendAssign, currentNames);

    const lineup = (slots || []).map((s, i) => ({
      slot: s,
      player: assign[i] || "",
      why: (lineupRows[i] && lineupRows[i].why) || "",
    }));

    const changeRows = (changes || []).map((c) => ({
      slot: c.slot,
      current: c.from,
      recommended: c.to,
      why: c.why,
    }));

    const aiToDo = (Array.isArray(j.toDo) ? j.toDo : [])
      .filter((a) => {
        const t = String(a.type || "").toLowerCase();
        return t && t !== "none" && t !== "lineup";
      })
      .map((a, i) => ({
        type: String(a.type || "waiver").toLowerCase(),
        priority: 100 + i,
        verdict: a.verdict || "—",
        why: a.why || "",
        copy: a.copy || "",
      }));

    const lineupToDo = changeRows.map((c, i) => ({
      type: "lineup",
      priority: i + 1,
      verdict: "Put " + c.recommended + " in your starting lineup"
        + (c.current ? " (instead of " + c.current + ")" : ""),
      why: c.why,
      copy: "",
      slot: c.slot,
      from: c.current,
      to: c.recommended,
    }));

    const toDo = [...lineupToDo, ...aiToDo].sort((a, b) => (a.priority || 99) - (b.priority || 99));

    const m = j.matchup && typeof j.matchup === "object" ? j.matchup : {};
    const matchup = {
      opponent: oppName,
      winProb: m.winProb || m.win_prob || "—",
      margin: m.margin || "",
      read: m.read || "",
      swaps: Array.isArray(m.swaps) ? m.swaps : changeRows.map((c) => ({
        out: c.current, in: c.recommended, why: c.why,
      })),
      waiverTargets: Array.isArray(m.waiverTargets) ? m.waiverTargets
        : (Array.isArray(m.waiver_targets) ? m.waiver_targets : []),
      block: Array.isArray(m.block) ? m.block : [],
    };

    return {
      generatedAt: Date.now(),
      week: aiWeekKey(clock),
      deadline: j.deadline || (nextDeadline ? nextDeadline.label : ""),
      lineup,
      changes: changeRows,
      toDo,
      matchup,
      currentStarters,
      allSet: toDo.length === 0 || !!j.allSet && changeRows.length === 0,
      source: "ai",
      note: null,
    };
  } catch {
    return planFromLocal({
      withRanks, slots, currentStarters, opponent, clock, nextDeadline,
      note: FALLBACK_NOTE,
    });
  }
}

/** Load cached plan if it matches this week; otherwise null. */
export async function getFreshWeeklyPlan(leagueId, clock) {
  const plan = await loadWeeklyPlan(leagueId);
  if (!plan || typeof plan !== "object") return null;
  if (plan.week && clock && plan.week !== aiWeekKey(clock)) return null;
  return plan;
}

/**
 * Ensure a plan exists for this week. Builds + persists if missing or force.
 * ctx.activeId is the app league id used for namespaced storage.
 */
export async function ensureWeeklyPlan(ctx, { force = false } = {}) {
  const id = ctx.activeId || "default";
  if (!force) {
    const existing = await getFreshWeeklyPlan(id, ctx.clock);
    if (existing) return existing;
  }
  const plan = await buildWeeklyPlan(ctx);
  await saveWeeklyPlan(id, plan);
  return plan;
}
