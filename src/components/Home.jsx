import React, { useState, useEffect, useRef } from "react";
import { getMyStarters } from "../sleeper";
import { loadKey, saveKey } from "../lib/storage.js";
import { fmtCountdown, fmtGeneratedAt, copyText } from "../lib/format.js";
import { activeRoster } from "../lib/lineup.js";
import { resolveNextOpponent } from "../lib/league.js";
import { callClaudeSearch, extractJSON, advisorError, aiWeekKey } from "../lib/ai.js";
import { AiResultBar, DoMe, useAiResult } from "./shared.jsx";


const COACH_SYS = (teams, scoring, format) =>
  "You are a friendly fantasy football helper for a beginner in a " + teams + "-team " + scoring + " league (" + format + "). Head-to-head. If web_search is available, use it for THIS WEEK's projections, injuries, inactives, and news. Using my roster, my next opponent, and brief notes on other teams, tell me EXACTLY what to do this week — a SHORT prioritized action list, most important first. Only include actions that need doing now; if nothing needs changing, set allSet true and actions []. Write like texting a friend who has never played fantasy. NEVER use abbreviations (no FLEX, WR, RB, TE, QB, PPR, ADP, FAAB) or jargon (no optimize, leverage, matchup edge, ceiling, floor). Spell out positions in full words if needed. For lineup advice, say exactly who to put in the starting lineup. For trades, name the manager and the exact offer. Respond with ONLY JSON, no prose: {\"deadline\":\"e.g. Lineup locks Sun 1:00pm ET\",\"allSet\":false,\"actions\":[{\"type\":\"lineup|trade|waiver|drop|none\",\"priority\":1,\"verdict\":\"plain imperative, e.g. Put Puka Nacua in your starting lineup\",\"why\":\"one or two beginner-friendly sentences\",\"copy\":\"optional text to copy, e.g. a trade message to send\"}]}";

async function fetchCoachAdvice({ cfg, board, members, slots, nextDeadline }) {
  const roster = activeRoster(members, board);
  const opp = await resolveNextOpponent(cfg, members);
  const others = (members || []).filter((m) => !m.mine).map((m) => {
    const names = (m.roster || []).slice(0, 6).map((p) => p.name + " (" + p.pos + ")").join(", ");
    const isOpp = opp && ((m.rosterId != null && m.rosterId === opp.rosterId) || m === opp);
    return (m.teamName || m.name || "Team") + (isOpp ? " [opponent]" : "") + (names ? ": " + names : "");
  }).join("\n");
  const user = [
    "My roster: " + (roster.map((p) => p.name + " (" + p.pos + ")").join(", ") || "not set") + ".",
    "Opponent: " + (opp ? (opp.teamName || opp.name) : "unknown") + ". Opponent roster: " +
      (opp && opp.roster && opp.roster.length ? opp.roster.map((p) => p.name + " (" + p.pos + ")").join(", ") : "unknown") + ".",
    "My slots: " + (slots || []).join(", ") + ".",
    "Scoring: " + cfg.scoring + ".",
    others ? "Other teams (top names):\n" + others : "",
  ].filter(Boolean).join("\n");
  const j = extractJSON(await callClaudeSearch([{ role: "user", content: user }], { system: COACH_SYS(cfg.teams, cfg.scoring, cfg.format) }));
  const actions = (Array.isArray(j.actions) ? j.actions : []).slice().sort((a, b) => (a.priority || 99) - (b.priority || 99));
  return { deadline: j.deadline || (nextDeadline ? nextDeadline.label : ""), allSet: !!j.allSet, actions };
}

function coachActionKey(a) {
  return [String(a.type || ""), String(a.verdict || "").trim()].join("|");
}

/** Best roster player named in a lineup recommendation (longest name match wins). */
function lineupPlayerFromAction(action, roster) {
  const text = [action && action.verdict, action && action.why].filter(Boolean).join(" ");
  if (!text || !(roster || []).length) return null;
  const lower = text.toLowerCase();
  let best = null;
  (roster || []).forEach((p) => {
    const name = String(p && p.name || "").trim();
    if (name.length < 3 || !lower.includes(name.toLowerCase())) return;
    if (!best || name.length > best.name.length) best = p;
  });
  return best;
}

function isLineupAction(a) {
  return String(a && a.type || "").toLowerCase() === "lineup";
}

function isActionDone(a, doneMap, lineupVerify) {
  const key = coachActionKey(a);
  if (isLineupAction(a) && lineupVerify && lineupVerify.results && lineupVerify.results[key]) {
    return !!lineupVerify.results[key].starting;
  }
  return !!(doneMap && doneMap[key]);
}

function sleeperHowTo(type) {
  const t = String(type || "").toLowerCase();
  if (t === "lineup") {
    return [
      "Open the Sleeper app on your phone.",
      "Tap your team, then open Lineup.",
      "Make the change above, then tap to save.",
    ];
  }
  if (t === "waiver" || t === "drop") {
    return [
      "Open the Sleeper app.",
      "Go to Players (or Waivers).",
      "Find the player, tap Claim or Drop, and confirm before the deadline.",
    ];
  }
  return [
    "Open the Sleeper app.",
    "Find the screen that matches this task.",
    "Make the change and confirm.",
  ];
}

function isLeagueSetup(cfg, members) {
  const hasMine = (members || []).some((m) => m.mine);
  const hasImport = !!(cfg && cfg.leagueId) || (members || []).length > 0;
  return hasMine && hasImport;
}

/* ---------- Home (weekly to-do — only screen beginners need) ---------- */
function Home({
  cfg, board, members, slots, nextDeadline, clock, lastRefresh, go,
  onStartSetup, onOpenTools,
}) {
  const setup = isLeagueSetup(cfg, members);
  const ai = useAiResult("ai:home");
  const data = ai.data;
  const [err, setErr] = useState("");
  const [openWhy, setOpenWhy] = useState({});
  const [openHow, setOpenHow] = useState({});
  const [copied, setCopied] = useState(null);
  const [doneMap, setDoneMap] = useState({});
  const [lineupVerify, setLineupVerify] = useState(null);
  const [lineupCheckBusy, setLineupCheckBusy] = useState(false);
  const doneStoreKey = "home:done:" + aiWeekKey(clock);
  const verifyStoreKey = "home:lineupCheck:" + aiWeekKey(clock);
  const verifyRanRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadKey(doneStoreKey, {}, false),
      loadKey(verifyStoreKey, null, false),
    ]).then(([done, verify]) => {
      if (cancelled) return;
      setDoneMap(done && typeof done === "object" ? done : {});
      if (verify && typeof verify === "object" && verify.at) setLineupVerify(verify);
    });
    return () => { cancelled = true; };
  }, [doneStoreKey, verifyStoreKey]);

  const run = async () => {
    const hadPrior = data != null;
    ai.begin(); setErr(""); setOpenWhy({}); setOpenHow({}); setCopied(null);
    try {
      const next = await fetchCoachAdvice({ cfg, board, members, slots, nextDeadline });
      await ai.succeed(next);
    } catch (e) {
      if (hadPrior) ai.failKeep();
      else { setErr(advisorError(e)); ai.end(); }
    }
  };

  const toggleDone = (key) => {
    setDoneMap((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveKey(doneStoreKey, next, false);
      return next;
    });
  };

  const meMember = (members || []).find((m) => m.mine);
  const myRoster = meMember && Array.isArray(meMember.roster) ? meMember.roster : [];

  useEffect(() => {
    if (!setup || !ai.hydrated || !data) return;
    if ((cfg.platform || "Sleeper") !== "Sleeper" || !cfg.leagueId) return;
    if (!meMember || meMember.rosterId == null) return;
    const lineupActions = (Array.isArray(data.actions) ? data.actions : []).filter(isLineupAction);
    if (!lineupActions.length) return;

    const runKey = [cfg.leagueId, meMember.rosterId, aiWeekKey(clock), lastRefresh || 0, lineupActions.map(coachActionKey).join(",")].join("|");
    if (verifyRanRef.current === runKey) return;
    verifyRanRef.current = runKey;

    let cancelled = false;
    (async () => {
      setLineupCheckBusy(true);
      const starters = await getMyStarters(cfg.leagueId, meMember.rosterId);
      if (cancelled) return;
      if (!starters) {
        setLineupVerify((prev) => {
          if (!prev || !prev.at) return prev;
          const next = { ...prev, ok: false };
          saveKey(verifyStoreKey, next, false);
          return next;
        });
        setLineupCheckBusy(false);
        return;
      }
      const starterSet = new Set(starters.map(String));
      const results = {};
      lineupActions.forEach((a) => {
        const key = coachActionKey(a);
        const player = lineupPlayerFromAction(a, myRoster);
        if (!player || !player.player_id) {
          results[key] = { name: "", playerId: "", starting: false, unmatched: true };
          return;
        }
        const starting = starterSet.has(String(player.player_id));
        results[key] = { name: player.name, playerId: String(player.player_id), starting };
      });
      const rec = { at: Date.now(), ok: true, results };
      setLineupVerify(rec);
      saveKey(verifyStoreKey, rec, false);
      setDoneMap((prev) => {
        const nextDone = { ...prev };
        let changed = false;
        Object.keys(results).forEach((key) => {
          const r = results[key];
          if (r.unmatched) return;
          if (r.starting && !nextDone[key]) { nextDone[key] = true; changed = true; }
          if (!r.starting && nextDone[key]) { nextDone[key] = false; changed = true; }
        });
        if (changed) saveKey(doneStoreKey, nextDone, false);
        return changed ? nextDone : prev;
      });
      setLineupCheckBusy(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, ai.hydrated, data, cfg.leagueId, cfg.platform, meMember && meMember.rosterId, clock, lastRefresh, verifyStoreKey, doneStoreKey]);

  if (!setup) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div className="homestatus">You have 1 thing to do.</div>
        <div className="v" style={{ marginTop: 12 }}>Let's connect your team (2 minutes)</div>
        <div className="empty" style={{ paddingTop: 8 }}>
          Import your league and mark which team is yours. After that, this screen tells you exactly what to do each week.
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={onStartSetup}>Get started</button>
      </div>
    );
  }

  const rawActions = (data && Array.isArray(data.actions) ? data.actions : []).filter((a) => String(a.type || "").toLowerCase() !== "none");
  const pending = rawActions.filter((a) => !isActionDone(a, doneMap, lineupVerify));
  const listEmpty = ai.hydrated && data && (data.allSet || rawActions.length === 0);
  const todoCount = listEmpty || pending.length === 0 ? 0 : pending.length;
  const deadlineLabel = (data && data.deadline) || (nextDeadline ? nextDeadline.label + (nextDeadline.when ? " · " + fmtCountdown(nextDeadline.when) : "") : "");
  let statusLine = "Checking what you need to do…";
  if (data || err) {
    statusLine = todoCount === 0
      ? "✓ You're all set for this week — nothing to do."
      : "You have " + todoCount + " thing" + (todoCount === 1 ? "" : "s") + " to do.";
  } else if (ai.hydrated && !ai.busy) {
    statusLine = "Tap below to check your week.";
  } else if (ai.busy) {
    statusLine = "Checking what you need to do…";
  }

  const deadlineShort = (data && data.deadline)
    || (nextDeadline ? nextDeadline.label + (nextDeadline.when ? " (" + fmtCountdown(nextDeadline.when) + ")" : "") : "the next deadline");

  const actionControls = (a, i) => {
    const type = String(a.type || "").toLowerCase();
    const hasCopy = !!(a.copy && String(a.copy).trim());
    if (type === "trade" || (hasCopy && type !== "lineup" && type !== "waiver" && type !== "drop")) {
      return (
        <button className="btn sm" onClick={() => { copyText(a.copy); setCopied(i); }}>
          {copied === i ? "Copied" : "Copy message"}
        </button>
      );
    }
    if (type === "lineup") {
      return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm ghost" onClick={() => setOpenHow((s) => ({ ...s, [i]: !s[i] }))}>
            How to do this {openHow[i] ? "▴" : "▾"}
          </button>
          {go && (
            <button type="button" className="btn sm ghost" onClick={() => go("week", "lineup")}>
              Open lineup
            </button>
          )}
        </div>
      );
    }
    if (type === "waiver" || type === "drop") {
      return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm ghost" onClick={() => setOpenHow((s) => ({ ...s, [i]: !s[i] }))}>
            How to claim {openHow[i] ? "▴" : "▾"}
          </button>
          {go && (
            <button type="button" className="btn sm ghost" onClick={() => go("moves", "waiver")}>
              Open Moves
            </button>
          )}
        </div>
      );
    }
    if (hasCopy) {
      return (
        <button className="btn sm" onClick={() => { copyText(a.copy); setCopied(i); }}>
          {copied === i ? "Copied" : "Copy message"}
        </button>
      );
    }
    return (
      <button type="button" className="btn sm ghost" onClick={() => setOpenHow((s) => ({ ...s, [i]: !s[i] }))}>
        How to do this {openHow[i] ? "▴" : "▾"}
      </button>
    );
  };

  const hasLineupTodos = rawActions.some(isLineupAction);
  const verifyLine = (() => {
    if (!hasLineupTodos) return null;
    if (lineupCheckBusy) return "Checking your Sleeper lineup…";
    if (lineupVerify && lineupVerify.at && lineupVerify.ok) return "Lineup checked: " + fmtGeneratedAt(lineupVerify.at);
    if (lineupVerify && lineupVerify.at && !lineupVerify.ok) {
      return "Couldn't check your lineup just now — showing last check from " + fmtGeneratedAt(lineupVerify.at);
    }
    if (lineupVerify && lineupVerify.at) return "Lineup checked: " + fmtGeneratedAt(lineupVerify.at);
    return null;
  })();

  return (
    <div>
      {todoCount > 0 && (
        <div className="homebanner" role="status">
          ⚠ You have {todoCount} thing{todoCount === 1 ? "" : "s"} to do before {deadlineShort}
        </div>
      )}
      <div className="homestatus" style={{ marginTop: todoCount > 0 ? 12 : 16 }}>{statusLine}</div>

      <AiResultBar at={ai.at} busy={ai.busy} refreshFail={ai.refreshFail} onRefresh={data || err ? run : null} show={!!(data || err || ai.at)} />

      {ai.busy && !data && (
        <div className="card">
          <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
            <span className="spin" /> Checking what you need to do this week…
          </div>
        </div>
      )}

      {!ai.busy && !ai.hydrated && (
        <div className="card"><div className="empty">Loading…</div></div>
      )}

      {ai.hydrated && !data && !err && !ai.busy && (
        <div className="card">
          <div className="empty" style={{ paddingTop: 0 }}>
            Tap below once and we'll build this week's to-do list. It stays saved until you refresh.
          </div>
          <DoMe onClick={run} busy={ai.busy} working="Checking…" label="Check my week" />
        </div>
      )}

      {err && !ai.busy && !data && (
        <div className="card">
          <div className="note" style={{ borderColor: "var(--now)", marginTop: 0 }}>{err}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={run}>Try again</button>
        </div>
      )}

      <div className={ai.busy && data ? "airesdim" : undefined}>
        {listEmpty && !err && (
          <div className="card homeallset">
            <div className="v" style={{ color: "var(--go)" }}>You're winning-ready this week. Check back after Wednesday.</div>
            {deadlineLabel && <div className="empty" style={{ paddingTop: 10 }}>Next deadline: {deadlineLabel}</div>}
          </div>
        )}

        {data && !data.allSet && rawActions.length > 0 && (
          <>
            {hasLineupTodos && (
              <div className="empty" style={{ paddingTop: 0, marginBottom: 8 }}>
                We check your Sleeper lineup each time you open the app. We can't change it for you — Sleeper doesn't allow that — so you'll still set it in Sleeper, and we'll confirm it here.
                {verifyLine && <div className="eyebrow" style={{ marginTop: 8 }}>{verifyLine}</div>}
              </div>
            )}
            <div className="grid" style={{ gap: 12 }}>
              {rawActions.map((a, i) => {
                const key = coachActionKey(a);
                const isDone = isActionDone(a, doneMap, lineupVerify);
                const type = String(a.type || "").toLowerCase();
                const howForTradeCopy = type === "trade" || (a.copy && type !== "lineup" && type !== "waiver" && type !== "drop");
                const lineupResult = type === "lineup" && lineupVerify && lineupVerify.results ? lineupVerify.results[key] : null;
                const showNotDone = type === "lineup" && lineupResult && !lineupResult.starting && !lineupResult.unmatched;
                const manualToggle = type !== "lineup" || !lineupResult || lineupResult.unmatched;
                return (
                  <div className={"card" + (isDone ? " homedone-card" : "")} key={key + "-" + i}>
                    <div className="hometodorow">
                      {manualToggle ? (
                        <label className="homedone">
                          <input type="checkbox" checked={isDone} onChange={() => toggleDone(key)} />
                          <span>Mark done</span>
                        </label>
                      ) : (
                        <span className={"homedone " + (isDone ? "" : "homewarn")}>
                          {isDone ? "✓ Confirmed in Sleeper" : "⚠ Not done yet"}
                        </span>
                      )}
                      <span className="homenum">{i + 1}</span>
                    </div>
                    <div className="v" style={{ marginTop: 8 }}>{a.verdict || "—"}</div>
                    {showNotDone && (
                      <div className="empty" style={{ paddingTop: 6, color: "var(--now)" }}>
                        Still not in your starting lineup on Sleeper.
                      </div>
                    )}
                    {a.why && (
                      <>
                        <button type="button" className="coachwhybtn" onClick={() => setOpenWhy((s) => ({ ...s, [i]: !s[i] }))}>
                          Why? {openWhy[i] ? "▴" : "▾"}
                        </button>
                        {openWhy[i] && <div className="coachwhy">{a.why}</div>}
                      </>
                    )}
                    {!isDone && <div style={{ marginTop: 12 }}>{actionControls(a, i)}</div>}
                    {!isDone && openHow[i] && !howForTradeCopy && (
                      <ol className="howto">
                        {sleeperHowTo(type).map((step, si) => <li key={si}>{step}</li>)}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <button type="button" className="hometools" onClick={onOpenTools}>
        Tools ▸
      </button>
    </div>
  );
}


export default Home;
