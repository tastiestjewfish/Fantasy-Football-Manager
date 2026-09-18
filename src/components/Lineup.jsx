import React, { useState, useEffect } from "react";
import { apiFetch, errFromApiBody } from "../api";
import { activeRoster, defaultSlots } from "../lib/lineup.js";
import { copyText } from "../lib/format.js";
import WeeklyPlanBar from "./WeeklyPlanBar.jsx";

function nameEq(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/** Lineup — reads plan.lineup / plan.changes (no independent AI call). */
function Lineup({
  cfg, board, members, slots, setSlots, saved, setSaved,
  plan, planBusy, refreshPlan, ensurePlan,
}) {
  const roster = activeRoster(members, board);
  const platform = cfg.platform || "Sleeper";
  const isSleeper = platform === "Sleeper";
  const isYahoo = platform === "Yahoo";
  const meMember = (members || []).find((m) => m.mine);
  const canYahoo = isYahoo && meMember && meMember.teamKey && roster.some((p) => p.playerKey);

  const [submitted, setSubmitted] = useState(!!(saved && saved.submitted));
  const [editSlots, setEditSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [subMsg, setSubMsg] = useState("");
  const [subErr, setSubErr] = useState("");

  useEffect(() => {
    if (ensurePlan) ensurePlan();
  }, [ensurePlan]);

  const lineup = (plan && Array.isArray(plan.lineup)) ? plan.lineup : [];
  const current = (plan && Array.isArray(plan.currentStarters)) ? plan.currentStarters : [];
  const assign = (slots || []).map((_, i) => (lineup[i] && lineup[i].player) || null);
  const whyFor = (name, i) => {
    if (lineup[i] && lineup[i].player && nameEq(lineup[i].player, name)) return lineup[i].why || "";
    return "";
  };

  const changeCount = (plan && Array.isArray(plan.changes)) ? plan.changes.length : 0;
  const hasSuggestions = assign.some(Boolean);
  const comparable = current.some((c) => c && c.name && !c.unavailable);
  const summaryLine = !plan
    ? (planBusy ? "Building this week's plan…" : "Waiting for this week's plan…")
    : !hasSuggestions
      ? "No lineup in this week's plan yet — refresh the plan."
      : !comparable
        ? (changeCount === 0 ? "Suggestions ready — we couldn't compare to your live lineup." : "Suggestions ready.")
        : changeCount === 0
          ? "You're set — no changes needed."
          : changeCount + " change" + (changeCount === 1 ? "" : "s") + " to make.";

  const removeSlot = (i) => { setSlots(slots.filter((_, j) => j !== i)); };
  const addSlot = (pos) => { if (!pos) return; setSlots([...slots, pos]); };
  const resetSlots = () => { setSlots(defaultSlots(cfg.format)); };

  const lineupText = "Lineup — " + cfg.league + "\n" + slots.map((s, i) => {
    const sug = assign[i] || "—";
    const cur = current[i] && current[i].name ? current[i].name : "—";
    return `${s}: now ${cur} → ${sug}`;
  }).join("\n");

  const finalize = () => {
    setSaved({ assign, meta: { notes: "From this week's plan" }, submitted: true, at: Date.now() });
    setSubmitted(true);
  };

  const submitYahoo = async () => {
    if (!canYahoo) return;
    const nameToKey = {};
    roster.forEach((p) => { if (p.playerKey) nameToKey[p.name] = p.playerKey; });
    const starters = slots.map((s, i) => (assign[i] && nameToKey[assign[i]])
      ? { playerKey: nameToKey[assign[i]], slot: s } : null).filter(Boolean);
    const benchP = roster.filter((p) => !assign.includes(p.name) && p.playerKey)
      .map((p) => ({ playerKey: p.playerKey, slot: "BN" }));
    setSubmitting(true); setSubErr(""); setSubMsg("");
    try {
      const r = await apiFetch("/api/yahoo/roster", {
        method: "POST",
        body: JSON.stringify({ teamKey: meMember.teamKey, players: [...starters, ...benchP] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(errFromApiBody(j, "HTTP " + r.status));
      setSubMsg("Submitted to Yahoo" + (j.week ? " for week " + j.week : "") + ".");
      setSaved({ assign, meta: { notes: "From this week's plan" }, submitted: true, at: Date.now() });
      setSubmitted(true);
    } catch (e) {
      setSubErr("Couldn't submit to Yahoo: " + e.message + ". Check that your Yahoo app has write access and you're connected.");
    }
    setSubmitting(false);
  };

  return (
    <div>
      <div className="card">
        <div className="cardhead">
          <h3>Lineup</h3>
        </div>
        <div className="v" style={{ marginBottom: 8 }}>{summaryLine}</div>
        <WeeklyPlanBar plan={plan} busy={planBusy} onRefresh={refreshPlan} />

        <div className="slotedit">
          <button className="btn ghost sm" onClick={() => setEditSlots((v) => !v)}>
            {editSlots ? "Done editing slots" : "Edit slots"}
          </button>
          {editSlots && (
            <div style={{ marginTop: 10 }}>
              {slots.map((s, i) => (
                <span className="slotchip" key={i}>
                  {s}<button onClick={() => removeSlot(i)} aria-label="remove">✕</button>
                </span>
              ))}
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select onChange={(e) => { addSlot(e.target.value); e.target.value = ""; }} defaultValue="">
                  <option value="" disabled>+ add slot…</option>
                  {["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF"].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button className="btn ghost sm" onClick={resetSlots}>
                  Reset to {cfg.format.includes("Super") ? "Superflex" : "standard"} default
                </button>
              </div>
              <div className="empty" style={{ paddingTop: 8 }}>
                After editing slots, refresh this week's plan so lineup rows match.
              </div>
            </div>
          )}
        </div>

        {planBusy && !plan && (
          <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
            <span className="spin" /> Building this week's plan…
          </div>
        )}

        {plan && (
          <div className={"lcomptable" + (planBusy ? " airesdim" : "")}>
            <div className="lcomphead">
              <span>Position</span>
              <span>Your lineup now</span>
              <span>Suggested</span>
            </div>
            {slots.map((s, i) => {
              const sug = assign[i];
              const cur = current[i] || null;
              const curName = cur && cur.name ? cur.name : "—";
              const same = sug && cur && !cur.unavailable && nameEq(cur.name, sug);
              const different = sug && cur && !cur.unavailable && !nameEq(cur.name, sug);
              const why = sug ? whyFor(sug, i) : "";
              return (
                <div className={"lcomprow" + (different ? " lcompchange" : "")} key={i}>
                  <span className="lslot">{s}</span>
                  <span className="lcompcur">{curName}</span>
                  <span className="lcompsug">
                    {!sug ? "—"
                      : same ? <span className="lcompkeep">✓ Keep</span>
                        : different ? <span className="lcompstart">▸ Start {sug} instead</span>
                          : <span className="lcompstart">▸ Start {sug}</span>}
                    {why && different && <div className="lwhy">{why}</div>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {roster.length > 0 && plan && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {canYahoo && (
              <button className="btn" onClick={submitYahoo} disabled={submitting}>
                {submitting && <span className="spin" />}
                {submitting ? "Submitting…" : "Submit to Yahoo"}
              </button>
            )}
            <button className={"btn " + (canYahoo ? "ghost" : "")} onClick={finalize}>
              {submitted ? "Locked in ✓" : "Lock in lineup"}
            </button>
            <button className="btn ghost" onClick={() => copyText(lineupText)}>Copy lineup</button>
            {submitted && !subMsg && (
              <span className="empty" style={{ padding: 0 }}>Saved &amp; shared with your co-manager.</span>
            )}
          </div>
        )}
        {subMsg && <div className="note" style={{ borderColor: "var(--go)" }}>{subMsg}</div>}
        {subErr && <div className="note" style={{ borderColor: "var(--now)" }}>{subErr}</div>}
        {isSleeper && (
          <div className="note">
            Make these changes in the Sleeper app — we'll confirm them next time the weekly plan refreshes.
          </div>
        )}
        {isYahoo && (
          <div className="note">
            Yahoo can push the suggested lineup with <b>Submit to Yahoo</b>. Live starters aren't readable here yet — set or confirm in Yahoo if needed.
          </div>
        )}
      </div>
    </div>
  );
}

export default Lineup;
