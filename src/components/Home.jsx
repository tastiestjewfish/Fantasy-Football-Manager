import React, { useState, useEffect } from "react";
import { fmtCountdown, copyText } from "../lib/format.js";
import { loadKey, saveKey } from "../lib/storage.js";
import { aiWeekKey } from "../lib/ai.js";
import WeeklyPlanBar from "./WeeklyPlanBar.jsx";

function coachActionKey(a) {
  return [String(a.type || ""), String(a.verdict || "").trim(), String(a.slot || ""), String(a.to || "")].join("|");
}

function isLineupAction(a) {
  return String(a && a.type || "").toLowerCase() === "lineup";
}

function isActionDone(a, doneMap) {
  return !!(doneMap && doneMap[coachActionKey(a)]);
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

/* ---------- Home — renders plan.toDo only (no AI call) ---------- */
function Home({
  cfg, members, nextDeadline, clock, go,
  onStartSetup, onOpenTools,
  plan, planBusy, refreshPlan, ensurePlan,
}) {
  const setup = isLeagueSetup(cfg, members);
  const [openWhy, setOpenWhy] = useState({});
  const [openHow, setOpenHow] = useState({});
  const [copied, setCopied] = useState(null);
  const [doneMap, setDoneMap] = useState({});
  const doneStoreKey = "home:done:" + aiWeekKey(clock);

  useEffect(() => {
    let cancelled = false;
    loadKey(doneStoreKey, {}, false).then((done) => {
      if (!cancelled) setDoneMap(done && typeof done === "object" ? done : {});
    });
    return () => { cancelled = true; };
  }, [doneStoreKey]);

  useEffect(() => {
    if (!setup || !ensurePlan) return;
    ensurePlan();
  }, [setup, ensurePlan]);

  const toggleDone = (key) => {
    setDoneMap((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveKey(doneStoreKey, next, false);
      return next;
    });
  };

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

  const rawActions = plan && Array.isArray(plan.toDo) ? plan.toDo.filter((a) => String(a.type || "").toLowerCase() !== "none") : [];
  const pending = rawActions.filter((a) => !isActionDone(a, doneMap));
  const listEmpty = plan && (plan.allSet || rawActions.length === 0);
  const todoCount = !plan || listEmpty || pending.length === 0 ? 0 : pending.length;
  const deadlineLabel = (plan && plan.deadline) || (nextDeadline ? nextDeadline.label + (nextDeadline.when ? " · " + fmtCountdown(nextDeadline.when) : "") : "");
  const deadlineShort = (plan && plan.deadline)
    || (nextDeadline ? nextDeadline.label + (nextDeadline.when ? " (" + fmtCountdown(nextDeadline.when) + ")" : "") : "the next deadline");

  let statusLine = "Checking what you need to do…";
  if (planBusy && !plan) statusLine = "Building this week's plan…";
  else if (plan) {
    statusLine = todoCount === 0
      ? "✓ You're all set for this week — nothing to do."
      : "You have " + todoCount + " thing" + (todoCount === 1 ? "" : "s") + " to do.";
  }

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
    return (
      <button type="button" className="btn sm ghost" onClick={() => setOpenHow((s) => ({ ...s, [i]: !s[i] }))}>
        How to do this {openHow[i] ? "▴" : "▾"}
      </button>
    );
  };

  return (
    <div>
      {todoCount > 0 && (
        <div className="homebanner" role="status">
          ⚠ You have {todoCount} thing{todoCount === 1 ? "" : "s"} to do before {deadlineShort}
        </div>
      )}
      <div className="homestatus" style={{ marginTop: todoCount > 0 ? 12 : 16 }}>{statusLine}</div>

      <WeeklyPlanBar plan={plan} busy={planBusy} onRefresh={refreshPlan} />

      {planBusy && !plan && (
        <div className="card">
          <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
            <span className="spin" /> Building this week's plan…
          </div>
        </div>
      )}

      {plan && (
        <div className={planBusy ? "airesdim" : undefined}>
          {listEmpty && (
            <div className="card homeallset">
              <div className="v" style={{ color: "var(--go)" }}>You're winning-ready this week. Check back after Wednesday.</div>
              {deadlineLabel && <div className="empty" style={{ paddingTop: 10 }}>Next deadline: {deadlineLabel}</div>}
            </div>
          )}

          {!listEmpty && rawActions.length > 0 && (
            <>
              {rawActions.some(isLineupAction) && (
                <div className="empty" style={{ paddingTop: 0, marginBottom: 8 }}>
                  Lineup changes come from this week's shared plan — same list as This week → Lineup.
                </div>
              )}
              <div className="grid" style={{ gap: 12 }}>
                {rawActions.map((a, i) => {
                  const key = coachActionKey(a);
                  const isDone = isActionDone(a, doneMap);
                  const type = String(a.type || "").toLowerCase();
                  const howForTradeCopy = type === "trade" || (a.copy && type !== "lineup" && type !== "waiver" && type !== "drop");
                  return (
                    <div className={"card" + (isDone ? " homedone-card" : "")} key={key + "-" + i}>
                      <div className="hometodorow">
                        <label className="homedone">
                          <input type="checkbox" checked={isDone} onChange={() => toggleDone(key)} />
                          <span>Mark done</span>
                        </label>
                        <span className="homenum">{i + 1}</span>
                      </div>
                      <div className="v" style={{ marginTop: 8 }}>{a.verdict || "—"}</div>
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
      )}

      <button type="button" className="hometools" onClick={onOpenTools}>
        Tools ▸
      </button>
    </div>
  );
}

export default Home;
