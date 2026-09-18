import React, { useState } from "react";
import { activeRoster } from "../lib/lineup.js";
import { callClaude, advisorError, MODEL_FAST } from "../lib/ai.js";
import { AiResultBar, DoMe, useAiResult } from "./shared.jsx";
import WaiversList from "./WaiversList.jsx";


function Moves({ cfg, board, members, pane = "start" }) {
  const tabm = pane;
  const [qStart, setQStart] = useState("");
  const ai = useAiResult("ai:startsit");
  const outStart = typeof ai.data === "string" ? ai.data : "";
  const [errStart, setErrStart] = useState("");

  const active = activeRoster(members, board);
  const roster = active.map((p) => `${p.name} (${p.pos})`).join(", ") || "not set yet";

  const byeMap = {};
  active.forEach((p) => { if (p.bye) (byeMap[p.bye] = byeMap[p.bye] || []).push(p); });
  const byeWeeks = Object.keys(byeMap).map(Number).sort((a, b) => a - b);

  const startSit = async () => {
    const hadPrior = outStart != null && outStart !== "";
    ai.begin(); setErrStart("");
    const sys = "You are a fantasy football start/sit advisor for a 12-team PPR league. Give a clear START or SIT verdict for each player named, with one line of reasoning each, weighing matchup and PPR volume. Be decisive. 5 sentences max.";
    const q = qStart.trim() || "Set my full lineup this week. For every starting spot, tell me who to START and who to SIT from my roster. Be decisive.";
    try {
      const out = await callClaude([{ role: "user", content: `My roster: ${roster}. Format: ${cfg.format}. Question: ${q}` }], { system: sys, model: MODEL_FAST, max_tokens: 600 });
      await ai.succeed(out || "No response.");
    } catch (e) {
      if (hadPrior) ai.failKeep();
      else { setErrStart(advisorError(e)); ai.end(); }
    }
  };

  return (
    <div className="card">
      <div className="cardhead">
        <h3>{tabm === "start" ? "Start / Sit" : tabm === "waiver" ? "Waivers" : "Bye weeks"}</h3>
      </div>
      {tabm === "start" && (
        <div className="advisor">
          <textarea placeholder="e.g. Start Chase Brown or Bucky Irving at flex?" value={qStart} onChange={(e) => setQStart(e.target.value)} />
          <div style={{ marginTop: 10 }}>
            <DoMe onClick={startSit} busy={ai.busy} working="Calling…" />
          </div>
          <AiResultBar at={ai.at} busy={ai.busy} refreshFail={ai.refreshFail} onRefresh={outStart ? startSit : null} show={!!(outStart || ai.at)} />
          {errStart && !outStart && <div className="note" style={{ borderColor: "var(--now)" }}>{errStart}</div>}
          {outStart && <div className={"out" + (ai.busy ? " airesdim" : "")}>{outStart}</div>}
        </div>
      )}
      {tabm === "waiver" && <WaiversList cfg={cfg} members={members} />}
      {tabm === "byes" && (
        <div>
          {byeWeeks.length === 0 ? (
            <div className="empty">Import your league and mark <b>My team</b> (or draft players in Draft) and your bye-week map appears here.</div>
          ) : (
            byeWeeks.map((w) => {
              const list = byeMap[w];
              const heavy = list.length >= 3;
              return (
                <div className="alert" key={w}>
                  <div className={"bar bar-" + (heavy ? "now" : list.length === 2 ? "soon" : "go")} />
                  <div className="body">
                    <div className="t">Week {w} — {list.length} player{list.length > 1 ? "s" : ""} on bye {heavy ? "⚠ conflict" : ""}</div>
                    <div className="s">{list.map((p) => `${p.name} (${p.pos})`).join(", ")}</div>
                  </div>
                </div>
              );
            })
          )}
          <div className="note">Weeks with 3+ starters on bye are flagged red — plan a waiver or trade so you're not scrambling that week.</div>
        </div>
      )}
      {tabm !== "waiver" && (
        <div className="note">Uses your live roster from League → Teams (mark My team). Advice is AI-generated — sanity-check live injury news before you lock it in.</div>
      )}
    </div>
  );
}


export default Moves;
