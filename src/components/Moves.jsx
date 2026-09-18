import React, { useEffect, Suspense, lazy } from "react";
import { activeRoster } from "../lib/lineup.js";
import WeeklyPlanBar from "./WeeklyPlanBar.jsx";

const WaiversList = lazy(() => import("./WaiversList.jsx"));

function WaiversFallback() {
  return (
    <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
      <span className="spin" /> Loading…
    </div>
  );
}

/** Start/Sit + Waivers — plan slices only (no independent AI). Byes stay local. */
function Moves({
  cfg, board, members, pane = "start",
  plan, planBusy, refreshPlan, ensurePlan,
}) {
  const tabm = pane;
  const active = activeRoster(members, board);

  useEffect(() => {
    if ((tabm === "start" || tabm === "waiver") && ensurePlan) ensurePlan();
  }, [tabm, ensurePlan]);

  const byeMap = {};
  active.forEach((p) => { if (p.bye) (byeMap[p.bye] = byeMap[p.bye] || []).push(p); });
  const byeWeeks = Object.keys(byeMap).map(Number).sort((a, b) => a - b);

  const changes = (plan && Array.isArray(plan.changes)) ? plan.changes : [];
  const lineupToDo = (plan && Array.isArray(plan.toDo))
    ? plan.toDo.filter((a) => String(a.type || "").toLowerCase() === "lineup")
    : [];
  const waiverToDo = (plan && Array.isArray(plan.toDo))
    ? plan.toDo.filter((a) => {
      const t = String(a.type || "").toLowerCase();
      return t === "waiver" || t === "drop";
    })
    : [];
  const waiverTargets = (plan && plan.matchup && Array.isArray(plan.matchup.waiverTargets))
    ? plan.matchup.waiverTargets
    : [];
  const block = (plan && plan.matchup && Array.isArray(plan.matchup.block))
    ? plan.matchup.block
    : [];

  return (
    <div className="card">
      <div className="cardhead">
        <h3>{tabm === "start" ? "Start / Sit" : tabm === "waiver" ? "Waivers" : "Bye weeks"}</h3>
      </div>

      {(tabm === "start" || tabm === "waiver") && (
        <WeeklyPlanBar plan={plan} busy={planBusy} onRefresh={refreshPlan} />
      )}

      {tabm === "start" && (
        <div>
          {planBusy && !plan && (
            <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
              <span className="spin" /> Building this week's plan…
            </div>
          )}
          {plan && changes.length === 0 && lineupToDo.length === 0 && (
            <div className="empty" style={{ paddingTop: 0 }}>
              You're set — this week's plan has no start/sit changes.
            </div>
          )}
          {plan && (changes.length > 0 || lineupToDo.length > 0) && (
            <div className={planBusy ? "airesdim" : undefined}>
              {changes.map((c, i) => (
                <div className="alert" key={"c" + i}>
                  <div className="bar bar-soon" />
                  <div className="body">
                    <div className="t">
                      START {c.recommended}
                      {c.current ? <> · SIT {c.current}</> : null}
                      {c.slot ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {c.slot}</span> : null}
                    </div>
                    {c.why && <div className="s">{c.why}</div>}
                  </div>
                </div>
              ))}
              {lineupToDo.length > 0 && changes.length === 0 && lineupToDo.map((a, i) => (
                <div className="alert" key={"t" + i}>
                  <div className="bar bar-soon" />
                  <div className="body">
                    <div className="t">{a.verdict}</div>
                    {a.why && <div className="s">{a.why}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="note">
            Start/sit comes from this week's shared plan — same decisions as Home and Lineup.
          </div>
        </div>
      )}

      {tabm === "waiver" && (
        <div>
          {(waiverToDo.length > 0 || waiverTargets.length > 0 || block.length > 0) && (
            <div className={planBusy ? "airesdim" : undefined} style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>From this week's plan</div>
              {waiverToDo.map((a, i) => (
                <div className="alert" key={"w" + i}>
                  <div className="bar bar-go" />
                  <div className="body">
                    <div className="t">{a.verdict}</div>
                    {a.why && <div className="s">{a.why}</div>}
                  </div>
                </div>
              ))}
              {waiverTargets.map((w, i) => (
                <div className="alert" key={"wt" + i}>
                  <div className="bar bar-go" />
                  <div className="body">
                    <div className="t">
                      {w.player}{" "}
                      <span style={{ color: "var(--muted)", fontWeight: 600 }}>{w.pos}</span>
                    </div>
                    {w.why && <div className="s">{w.why}</div>}
                  </div>
                </div>
              ))}
              {block.map((b, i) => (
                <div className="alert" key={"b" + i}>
                  <div className="bar bar-now" />
                  <div className="body">
                    <div className="t">Block: {b.player}</div>
                    {b.why && <div className="s">{b.why}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Suspense fallback={<WaiversFallback />}>
            <WaiversList cfg={cfg} members={members} />
          </Suspense>
        </div>
      )}

      {tabm === "byes" && (
        <div>
          {byeWeeks.length === 0 ? (
            <div className="empty">
              Import your league and mark <b>My team</b> (or draft players in Draft) and your bye-week map appears here.
            </div>
          ) : (
            byeWeeks.map((w) => {
              const list = byeMap[w];
              const heavy = list.length >= 3;
              return (
                <div className="alert" key={w}>
                  <div className={"bar bar-" + (heavy ? "now" : list.length === 2 ? "soon" : "go")} />
                  <div className="body">
                    <div className="t">
                      Week {w} — {list.length} player{list.length > 1 ? "s" : ""} on bye {heavy ? "⚠ conflict" : ""}
                    </div>
                    <div className="s">{list.map((p) => `${p.name} (${p.pos})`).join(", ")}</div>
                  </div>
                </div>
              );
            })
          )}
          <div className="note">
            Weeks with 3+ starters on bye are flagged red — plan a waiver or trade so you're not scrambling that week.
          </div>
        </div>
      )}
    </div>
  );
}

export default Moves;
