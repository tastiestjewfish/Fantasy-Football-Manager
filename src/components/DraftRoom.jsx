import React, { useState } from "react";
import { PLAYERS, tierOf } from "../lib/players.js";
import { callClaude, advisorError, MODEL_FAST } from "../lib/ai.js";
import { strategyForDraft } from "../lib/strategy.js";
import { AiResultBar, DoMe, useAiResult } from "./shared.jsx";


/* ---------- Draft Room ---------- */
function DraftRoom({ cfg, board, setBoard }) {
  const [q, setQ] = useState("");
  const [posf, setPosf] = useState("ALL");
  const [advQ, setAdvQ] = useState("");
  const ai = useAiResult("ai:draft");
  const advOut = typeof ai.data === "string" ? ai.data : "";
  const [advErr, setAdvErr] = useState("");

  const mark = (id, state) => {
    const next = { ...board };
    if (next[id] === state) delete next[id]; else next[id] = state;
    setBoard(next);
  };

  const filtered = PLAYERS
    .filter((p) => posf === "ALL" || p.pos === posf)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.team.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.adp - b.adp);

  const mine = PLAYERS.filter((p) => board[p.id] === "mine").sort((a, b) => a.adp - b.adp);
  const byPos = (pos) => mine.filter((p) => p.pos === pos);

  let lastTier = null;

  const askAdvisor = async () => {
    const hadPrior = !!advOut;
    ai.begin(); setAdvErr("");
    const available = PLAYERS.filter((p) => !board[p.id]).slice(0, 24).map((p) => `${p.name} (${p.pos}, ADP ${p.adp})`).join("; ");
    const roster = mine.map((p) => `${p.name} (${p.pos})`).join(", ") || "none yet";
    const sys = [
      "You are a sharp fantasy football draft advisor for a "
        + (cfg.teams || 12) + "-team " + (cfg.scoring || "PPR") + " league (" + (cfg.format || "Standard") + ").",
      strategyForDraft(),
      "Be concise and specific: recommend the single best pick and one or two alternates, each with a one-line strategic reason.",
      "Prefer scarcity and expected value over name recognition. 4 sentences max.",
    ].join(" ");
    const user = `My draft slot: ${cfg.slot || "unknown"}. Format: ${cfg.format}. Scoring: ${cfg.scoring}. Teams: ${cfg.teams}. My roster so far: ${roster}. Best available (by ADP): ${available}. Question: ${advQ || "Who should I take next?"}`;
    try {
      const out = await callClaude([{ role: "user", content: user }], { system: sys, model: MODEL_FAST, max_tokens: 500 });
      await ai.succeed(out || "No response.");
    } catch (e) {
      if (hadPrior) ai.failKeep();
      else { setAdvErr(advisorError(e)); ai.end(); }
    }
  };

  return (
    <>
      <div className="grid g2">
        <div className="card">
          <div className="cardhead">
            <h3>Draft board · 2026 PPR</h3>
            <span className="rcount mono">{Object.values(board).filter((v) => v === "gone" || v === "mine").length} off board</span>
          </div>
          <div className="tools">
            <input placeholder="Search player or team…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="tools posfilter">
            {["ALL", "RB", "WR", "QB", "TE", "DEF", "PK"].map((p) => (
              <button key={p} className={posf === p ? "on" : ""} onClick={() => setPosf(p)}>{p}</button>
            ))}
          </div>
          <div className="plist">
            {filtered.map((p) => {
              const t = tierOf(p.adp);
              const showTier = t !== lastTier; lastTier = t;
              const st = board[p.id];
              return (
                <React.Fragment key={p.id}>
                  {showTier && posf === "ALL" && !q && <div className="tier">{t}</div>}
                  <div className={"prow " + (st === "gone" ? "gone" : st === "mine" ? "mine" : "")}>
                    <span className="rank">{p.adp}</span>
                    <span className={"posbadge pb-" + p.pos}>{p.pos}</span>
                    <span className="pname">{p.name}<br /><span className="sub">{p.team} · bye {p.bye} · rd {p.round}</span></span>
                    <span className="pactions">
                      <button className="btn sm" onClick={() => mark(p.id, "mine")} title="Add to my roster">{st === "mine" ? "✓ Mine" : "Mine"}</button>
                      <button className="btn ghost sm" onClick={() => mark(p.id, "gone")} title="Mark drafted by someone else">{st === "gone" ? "Gone" : "Out"}</button>
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>My roster</h3>
            {["QB", "RB", "WR", "TE", "DEF", "PK"].map((pos) => (
              <div className="rslot" key={pos}>
                <span className="lab">{pos} <span className="rcount">({byPos(pos).length})</span></span>
                <span style={{ textAlign: "right", fontSize: 13 }}>{byPos(pos).map((p) => p.name).join(", ") || <span style={{ color: "var(--muted2)" }}>—</span>}</span>
              </div>
            ))}
          </div>

          <div className="card advisor">
            <h3>Ask the draft advisor</h3>
            <textarea placeholder="e.g. RB or WR here? Should I take a QB now?" value={advQ} onChange={(e) => setAdvQ(e.target.value)} />
            <div style={{ marginTop: 10 }}>
              <DoMe onClick={askAdvisor} busy={ai.busy} working="Picking…" />
            </div>
            <AiResultBar at={ai.at} busy={ai.busy} refreshFail={ai.refreshFail} onRefresh={advOut ? askAdvisor : null} show={!!(advOut || ai.at)} />
            {advErr && !advOut && <div className="note" style={{ borderColor: "var(--now)" }}>{advErr}</div>}
            {advOut && <div className={"out" + (ai.busy ? " airesdim" : "")}>{advOut}</div>}
            <div className="note">Reads your slot, roster, and who's still available, then recommends a pick. Mark players <b>Mine</b> or <b>Out</b> as the draft unfolds to keep it accurate.</div>
          </div>
        </div>
      </div>
    </>
  );
}


export default DraftRoom;
