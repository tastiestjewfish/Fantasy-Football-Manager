import React, { useState, useEffect } from "react";
import { sleeperNextOpponent } from "../lib/league.js";
import { activeRoster, slotEligible } from "../lib/lineup.js";
import { loadKey, saveKey } from "../lib/storage.js";
import { copyText } from "../lib/format.js";
import WeeklyPlanBar from "./WeeklyPlanBar.jsx";

/** Matchup — reads plan.matchup + plan.lineup (no independent AI call). */
function Matchup({
  cfg, slots, board, members, setSavedLineup,
  plan, planBusy, refreshPlan, ensurePlan,
}) {
  const roster = activeRoster(members, board);
  const opponents = (members || []).filter((m) => !m.mine);
  const meMember = (members || []).find((m) => m.mine);
  const oppKeyOf = (m, i) => (m.rosterId != null ? "r" + m.rosterId : "i" + i);
  const [oppKey, setOppKey] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detMsg, setDetMsg] = useState("");
  const [used, setUsed] = useState(false);
  const [assign, setAssign] = useState(() => slots.map(() => null));

  useEffect(() => {
    loadKey("matchup:oppKey", "", false).then((k) => { if (k) setOppKey(k); });
  }, []);

  useEffect(() => {
    if (ensurePlan) ensurePlan();
  }, [ensurePlan]);

  useEffect(() => {
    if (!plan || !Array.isArray(plan.lineup)) return;
    setAssign((slots || []).map((_, i) => (plan.lineup[i] && plan.lineup[i].player) || null));
    setUsed(false);
  }, [plan, slots]);

  const markOpp = (k) => { setOppKey(k); saveKey("matchup:oppKey", k, false); };
  const opp = opponents.find((m, i) => oppKeyOf(m, i) === oppKey);
  const m = plan && plan.matchup ? plan.matchup : null;

  const detectOpponent = async () => {
    if (cfg.platform !== "Sleeper" || !cfg.leagueId || !meMember || meMember.rosterId == null) {
      setDetMsg("Auto-detect needs your Sleeper roster marked as My team in League → Teams. Or pick your opponent here.");
      return null;
    }
    setDetecting(true); setDetMsg("");
    try {
      const r = await sleeperNextOpponent(cfg.leagueId, meMember.rosterId);
      if (r && r.oppRosterId != null) {
        const om = members.find((x) => x.rosterId === r.oppRosterId);
        if (om) {
          markOpp(om.rosterId != null ? "r" + om.rosterId : oppKeyOf(om, opponents.findIndex((x) => x === om)));
          setDetMsg(r.started
            ? (r.label + ": you're facing " + (om.teamName || om.name) + ".")
            : (r.label + ". Projected Week 1 opponent: " + (om.teamName || om.name) + "."));
          return om;
        }
        setDetMsg((r.label ? r.label + ". " : "") + "Found a matchup but couldn't map the opponent — pick them below.");
        return null;
      }
      setDetMsg((r && r.label ? r.label + ". " : "") + "No matchup posted yet — pick your Week 1 opponent below.");
      return null;
    } catch {
      setDetMsg("Couldn't reach Sleeper — pick your opponent below.");
      return null;
    } finally {
      setDetecting(false);
    }
  };

  const swap = (i, name) => {
    const next = [...assign];
    if (name) {
      const j = next.findIndex((a, k) => a === name && k !== i);
      if (j >= 0) next[j] = next[i];
    }
    next[i] = name || null;
    setAssign(next);
    setUsed(false);
  };

  const infoFor = (name, i) => {
    if (plan && plan.lineup && plan.lineup[i] && plan.lineup[i].player === name) {
      return { why: plan.lineup[i].why };
    }
    return null;
  };

  const oppLabel = (m && m.opponent)
    || (opp ? (opp.teamName || opp.name) : "your opponent");
  const lineupText = "Lineup vs " + oppLabel + "\n"
    + slots.map((s, i) => `${s}: ${assign[i] || "—"}`).join("\n");

  const useAsLineup = () => {
    setSavedLineup({
      assign,
      meta: { byPlayer: {}, risks: [], notes: "From this week's plan vs " + oppLabel },
      submitted: false,
      at: Date.now(),
    });
    setUsed(true);
  };

  const wpNum = m ? parseFloat(String(m.winProb || "").replace(/[^\d.]/g, "")) : null;
  const favored = wpNum != null && wpNum >= 50;
  const swaps = m && Array.isArray(m.swaps) ? m.swaps : [];
  const waiverTargets = m && Array.isArray(m.waiverTargets) ? m.waiverTargets : [];
  const block = m && Array.isArray(m.block) ? m.block : [];

  return (
    <div>
      <div className="card">
        <div className="cardhead"><h3>Matchup — beat your next opponent</h3></div>
        <WeeklyPlanBar plan={plan} busy={planBusy || detecting} onRefresh={refreshPlan} />
        <div className="tools">
          <select value={oppKey} onChange={(e) => markOpp(e.target.value)} style={{ flex: 1 }}>
            <option value="">Pick your opponent…</option>
            {opponents.map((x, i) => (
              <option key={oppKeyOf(x, i)} value={oppKeyOf(x, i)}>
                {x.teamName || x.name || ("Team " + (i + 1))}
              </option>
            ))}
          </select>
          {cfg.platform === "Sleeper" && (
            <button className="btn ghost" onClick={detectOpponent} disabled={detecting}>
              {detecting && <span className="spin" />}Detect
            </button>
          )}
        </div>
        {opponents.length === 0 && (
          <div className="note">
            Import your league in the <b>League</b> tab first so I know who you're up against.
          </div>
        )}
        {detMsg && <div className="note">{detMsg}</div>}
        {m && m.opponent && opp && (opp.teamName || opp.name) !== m.opponent && (
          <div className="empty" style={{ paddingTop: 0 }}>
            Plan was built vs {m.opponent}. Refresh this week's plan after picking a different opponent.
          </div>
        )}

        {planBusy && !plan && (
          <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
            <span className="spin" /> Building this week's plan…
          </div>
        )}

        {m && (
          <div className={planBusy ? "airesdim" : undefined} style={{ marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", padding: "6px 0 12px" }}>
              <div>
                <div className="eyebrow">Win probability vs {oppLabel}</div>
                <div className="wp" style={{ color: favored ? "var(--go)" : "var(--now)" }}>
                  {m.winProb || "—"}
                </div>
              </div>
              <div style={{ paddingBottom: 4 }}>
                <span className={"statepill pill-" + (favored ? "go" : "now")}>
                  {favored ? "Favored — protect the floor" : "Underdog — chase ceiling"}
                </span>
                {m.margin && (
                  <div className="heronext" style={{ marginTop: 8 }}>
                    Projected margin: <b>{m.margin}</b>
                  </div>
                )}
              </div>
            </div>
            {m.read && <div className="idea-r">{m.read}</div>}

            <div style={{ marginTop: 10 }}>
              {slots.map((s, i) => {
                const opts = roster.filter((p) => slotEligible(s, p.pos));
                const info = infoFor(assign[i], i);
                return (
                  <div className="lrow" key={i}>
                    <span className="lslot">{s}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <select value={assign[i] || ""} onChange={(e) => swap(i, e.target.value)}>
                        <option value="">— empty —</option>
                        {opts.map((p) => (
                          <option key={p.name} value={p.name}>{p.name} ({p.pos})</option>
                        ))}
                      </select>
                      {info && info.why && <div className="lwhy">{info.why}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn" onClick={useAsLineup}>
                {used ? "Sent to Lineup ✓" : "Use as my lineup"}
              </button>
              <button className="btn ghost" onClick={() => copyText(lineupText)}>Copy</button>
              {used && (
                <span className="empty" style={{ padding: 0 }}>Open the Lineup tab to submit or tweak.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {swaps.length > 0 && (
        <div className="card">
          <h3>Start / sit changes to win</h3>
          {swaps.map((s, i) => (
            <div className="alert" key={i}>
              <div className="bar bar-soon" />
              <div className="body">
                <div className="t">Start {s.in} over {s.out}</div>
                {s.why && <div className="s">{s.why}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {waiverTargets.length > 0 && (
        <div className="card">
          <h3>Waiver targets to exploit this matchup</h3>
          {waiverTargets.map((w, i) => (
            <div className="alert" key={i}>
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
        </div>
      )}
      {block.length > 0 && (
        <div className="card">
          <h3>Block from your opponent</h3>
          {block.map((b, i) => (
            <div className="alert" key={i}>
              <div className="bar bar-now" />
              <div className="body">
                <div className="t">{b.player}</div>
                {b.why && <div className="s">{b.why}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="note">
        Matchup advice comes from this week's shared plan (same lineup as Home and Lineup). Refresh the plan to update every screen at once.
      </div>
    </div>
  );
}

export default Matchup;
