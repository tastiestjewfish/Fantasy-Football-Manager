/**
 * Master-level fantasy football strategy — inject only the section(s)
 * relevant to the decision. Keep strings tight: every sentence earns tokens.
 */

/** Always relevant: how to think about value and uncertainty. */
export const STRATEGY_CORE = [
  "Value players by VORP (value over a freely available replacement at that position), not absolute points — a WR12 can outrank an RB8 in total points yet be less scarce.",
  "Positional scarcity drives draft and trade prices: elite RBs and QBs (in superflex) are harder to replace than mid-tier WRs in deep PPR.",
  "Group players into tiers; decide across tier cliffs, not between nearly identical ranks (RB5 vs RB6 is noise; RB6 vs RB14 is a decision).",
  "Judge process (edge vs market/replacement at decision time), not weekly score outcomes that include variance.",
  "Quantify uncertainty: widen confidence when injuries, role fights, or weather are unclear; size risk accordingly.",
  "Touchdowns regress hard — prefer volume (carries, targets, air yards, red-zone looks) over recent TD rate when projecting.",
  "Treat small samples as weak evidence: 1–3 game spikes need volume confirmation before you treat them as the new baseline.",
].join(" ");

/** Ranking, tiers, and avoiding shiny-name mistakes. */
export const STRATEGY_VALUATION = [
  "Sort by tiers first, then by rank inside a tier; the drop from the last player in a tier to the first in the next is the true cost of waiting.",
  "A one-spot rank gap inside a tier is usually noise; a cross-tier gap is actionable for drafts, trades, and start/sit.",
  "Ignore name recognition and prior seasons unless the current role (snap share, routes, carry share) still supports it.",
  "Pay for durable usage and scarcity, not reputation — aging stars with shrinking roles are traps; unknown volume earners are undervalued.",
].join(" ");

/** Start/sit and weekly lineup construction. */
export const STRATEGY_LINEUP = [
  "Favorites should prioritize floor (high snap/target floors, safer game scripts); underdogs should prioritize ceiling (boom matchups, pass-game leverage, volatile but high-upside plays).",
  "Game script: trailing teams pass more (boost WR/TE/QB); leading teams run more and lean on RB volume — adjust expectations to projected score differential.",
  "Start from matchup-adjusted baselines (opponent vs position, pace, implied team total), then layer role and injury news.",
  "Leading indicators beat last week's points: target share, air yards, red-zone touches/targets, and route participation predict sustainable production.",
  "Discount outdoor skill players and kickers in high wind/heavy precipitation; pace (plays per game) lifts all skill usage — prefer fast environments when undecided.",
].join(" ");

/** Season-long roster construction philosophy. */
export const STRATEGY_ROSTER = [
  "Hero-RB: early elite RB, then WR depth — strong weekly RB floor, weaker WR ceiling if the hero falters.",
  "Zero-RB: load WRs early, hunt RBs mid/late — high upside and flexibility, volatile RB weeks, heavier waiver dependence.",
  "Robust-RB: multiple early/mid RBs — protects against injury and bye, often underweights elite WR scarcity in PPR.",
  "Expect positional runs; jump a tier before a run if the next tier is a cliff, otherwise wait and pivot.",
  "Spread bye weeks across starters so you never empty a position in one week; plan fills before those byes hit.",
  "Handcuff your own high-value RBs when the backup would inherit a featured role; do not handcuff rivals unless the stash blocks them and you have roster space.",
  "Balance: enough reliable starters to survive a week, plus upside benches that can become starters — pure safety caps championship ceiling.",
].join(" ");

/** Negotiation and trade timing. */
export const STRATEGY_TRADES = [
  "Buy low on proven volume with temporary bad TD/efficiency luck; sell high on players riding unsustainable TD or YAC spikes.",
  "After a fluke or TD-inflated explosion, shop the name while perceived value peaks — do not wait for regression to show up on the other manager's screen.",
  "Target rebuilders for aging win-now pieces and contenders for youth/picks you can spare; match the asset to their timeline.",
  "2-for-1 (or 3-for-1) consolidation: trade depth for a stud when your starters are set and their bench is thin — you raise your weekly ceiling.",
  "Never price trades on brand names; price on VORP, remaining schedule, and roster fit for both sides.",
  "Fair offers clear both sides' VORP roughly even; winning offers still look reasonable but solve your scarcest hole and their surplus — never insult with leftover scraps for a difference-maker.",
].join(" ");

/** FAAB, streaming, and free-agent prioritization. */
export const STRATEGY_WAIVERS = [
  "Bid FAAB as a % of remaining budget by need × scarcity × weeks of usefulness — not by hype alone.",
  "Speculative stashes (handcuffs, breakout traces) get small bids; immediate starter upgrades at a scarce position get aggressive bids.",
  "Stream DST/K by matchup (pace, implied totals, weather, opposing injuries); rarely spend meaningful FAAB on them.",
  "Snipe handcuffs when a lead back's workload or health wobbles and the backup's role would be feature-back worthy.",
  "Spend big when the add locks a starting spot for playoffs or covers a catastrophic injury; hold powder when the board is deep and your starters are stable.",
].join(" ");

/** Rest-of-season and playoff-oriented planning. */
export const STRATEGY_SCHEDULE = [
  "Weight remaining strength of schedule (opponent vs position, pace, implied totals) more as the season shrinks — early-season SOS is weaker signal.",
  "Build explicitly for fantasy playoff weeks (typically 15–17): a stud with a brutal playoff slate is worth less than a slightly worse player with soft title-week matchups.",
  "When trading or waiving late, prefer assets whose best games fall in weeks that decide the championship, even if the next two weeks look mediocre.",
].join(" ");

/** Predatory win-maximizing layer — brutal efficiency on top of sound strategy. */
export const STRATEGY_PREDATOR = [
  "Optimize relentlessly for winning. Every recommendation is the single highest-win-probability move. Don't hedge or list alternatives unless asked.",
  "Attack the opponent: estimate their likely lineup, find their weakest positions, choose moves that beat THEM specifically.",
  "Deny and starve: when cheap, grab players opponents need (streamers, handcuffs, bye fills) to weaken their roster, not just strengthen yours.",
  "Sell inflated, buy discounted: target managers who overvalue names or overreact to one week; extract max value while still getting the offer accepted.",
  "Think ahead ruthlessly: weigh byes and playoff weeks 15-17; sacrifice pretty names for the move that wins the title.",
  "Be decisive and blunt: state the move as a command with the sharp reason, no waffling.",
].join(" ");

/** Reasoning discipline — append after the selected strategy sections. */
export const STRATEGY_DISCIPLINE = [
  "Apply the strategy principles provided.",
  "Identify the decision type, weigh floor vs ceiling and value vs need, account for regression and small samples,",
  "and prefer the highest-expected-value move — not the highest-name-value one.",
].join(" ");

/**
 * Build a prompt block from only the given strategy sections (plus discipline).
 * Pass the exported STRATEGY_* strings you need for this call — never the whole corpus.
 */
export function strategyPrompt(...sections) {
  const body = sections.filter((s) => typeof s === "string" && s.trim()).join(" ");
  if (!body) return STRATEGY_DISCIPLINE;
  return "STRATEGY: " + body + " " + STRATEGY_DISCIPLINE;
}

/** Weekly plan / lineup / matchup / start-sit (+ waiver targets in the same call). */
export function strategyForWeeklyPlan() {
  return strategyPrompt(
    STRATEGY_CORE, STRATEGY_LINEUP, STRATEGY_SCHEDULE, STRATEGY_WAIVERS, STRATEGY_PREDATOR,
  );
}

/** Trade find + respond. */
export function strategyForTrades() {
  return strategyPrompt(STRATEGY_CORE, STRATEGY_VALUATION, STRATEGY_TRADES, STRATEGY_PREDATOR);
}

/** Standalone waiver logic (if ever split from the weekly plan). */
export function strategyForWaivers() {
  return strategyPrompt(STRATEGY_CORE, STRATEGY_WAIVERS, STRATEGY_PREDATOR);
}

/** Draft advisor + roster builder. */
export function strategyForDraft() {
  return strategyPrompt(
    STRATEGY_CORE, STRATEGY_VALUATION, STRATEGY_ROSTER, STRATEGY_SCHEDULE, STRATEGY_PREDATOR,
  );
}
