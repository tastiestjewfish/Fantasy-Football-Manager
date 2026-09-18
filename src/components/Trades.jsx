import React, { useState } from "react";
import { activeRoster, rosterNeeds } from "../lib/lineup.js";
import { callClaudeSearch, advisorError, extractJSON } from "../lib/ai.js";
import { strategyForTrades } from "../lib/strategy.js";
import { copyText } from "../lib/format.js";
import { AiResultBar, DoMe, Tier, useAiResult } from "./shared.jsx";


/* ---------- Trades ---------- */
function Trades({ cfg, board, members, offers, setOffers, goLeague }) {
  const [sub, setSub] = useState("find");
  const [targetName, setTargetName] = useState("");
  const aiFind = useAiResult("ai:trades");
  const ideas = Array.isArray(aiFind.data) ? aiFind.data : null;
  const [errF, setErrF] = useState("");
  const [offGive, setOffGive] = useState(""); const [offWant, setOffWant] = useState("");
  const aiResp = useAiResult("ai:respond");
  const resp = aiResp.data && typeof aiResp.data === "object" ? aiResp.data : null;
  const [errR, setErrR] = useState("");
  const [nWho, setNWho] = useState(""); const [nGive, setNGive] = useState(""); const [nGet, setNGet] = useState("");

  const roster = activeRoster(members, board);
  const { need, surplus, myList } = rosterNeeds(roster);

  const runFind = async () => {
    const hadPrior = ideas != null;
    aiFind.begin(); setErrF("");
    const target = members.find((m) => m.name === targetName);
    const targetStr = target ? `${target.teamName} (${target.name}) — notes on their roster: ${target.notes || "unknown; infer from a typical roster"}` : "any league team (pick whichever fit is best)";
    const sys = [
      "You are a top-tier fantasy football trade strategist for a "
        + (cfg.teams || 12) + "-team " + (cfg.scoring || "PPR") + " league (" + (cfg.format || "Standard") + ").",
      strategyForTrades(),
      "If web_search is available, use it to check CURRENT player value, role, and injury news before valuing anyone.",
      "Propose realistic trades I could send. For EACH idea give two framings: a 'gentlemans' offer (fair, likely accepted, still net-positive for me) and an 'aggressive' offer (maximum return for me, lower acceptance odds).",
      "Every why/rationale must reflect strategic reasoning (VORP, buy-low/sell-high, roster fit) in plain language — not name recognition.",
      "Respond with ONLY JSON, no prose:",
      "{\"ideas\":[{\"theme\":\"short label\",\"rationale\":\"why it fits both teams' needs\",\"gentlemans\":{\"give\":[\"player\"],\"get\":[\"player\"],\"why\":\"one line\",\"acceptOdds\":\"high|medium|low\"},\"aggressive\":{\"give\":[\"player\"],\"get\":[\"player\"],\"why\":\"one line\",\"acceptOdds\":\"high|medium|low\"}}]}. 2-3 ideas.",
    ].join(" ");
    const user = `My roster: ${myList}. My needs: ${need.join(", ") || "balanced"}. My surplus: ${surplus.join(", ") || "none"}. Trade target: ${targetStr}. Format: ${cfg.format}. Scoring: ${cfg.scoring}. Teams: ${cfg.teams}.`;
    try {
      const j = extractJSON(await callClaudeSearch([{ role: "user", content: user }], { system: sys }));
      await aiFind.succeed(j.ideas || []);
    } catch (e) {
      if (hadPrior) aiFind.failKeep();
      else { setErrF(advisorError(e)); aiFind.end(); }
    }
  };

  const runRespond = async () => {
    const hadPrior = resp != null;
    aiResp.begin(); setErrR("");
    const sys = [
      "You are a top-tier fantasy football trade strategist for a "
        + (cfg.teams || 12) + "-team " + (cfg.scoring || "PPR") + " league (" + (cfg.format || "Standard") + ").",
      strategyForTrades(),
      "If web_search is available, use it for CURRENT values, roles, and injuries.",
      "Evaluate the incoming offer from MY perspective and return a verdict plus two counter-offers.",
      "Every why/read must use strategic reasoning in plain language — prefer EV and roster fit over brand names.",
      "Respond with ONLY JSON, no prose:",
      "{\"verdict\":\"accept|decline|counter\",\"read\":\"plainly, who wins and by how much\",\"gentlemans\":{\"counter\":\"give X, get Y\",\"why\":\"one line\",\"acceptOdds\":\"high|medium|low\",\"message\":\"a friendly message I can send them\"},\"aggressive\":{\"counter\":\"give X, get Y\",\"why\":\"one line\",\"acceptOdds\":\"high|medium|low\",\"message\":\"a firm message I can send them\"}}.",
    ].join(" ");
    const user = `My roster: ${myList}. Incoming offer — they GIVE me: ${offGive || "(nothing entered)"}; they WANT from me: ${offWant || "(nothing entered)"}. Format: ${cfg.format}. Scoring: ${cfg.scoring}. Teams: ${cfg.teams}.`;
    try {
      await aiResp.succeed(extractJSON(await callClaudeSearch([{ role: "user", content: user }], { system: sys })));
    } catch (e) {
      if (hadPrior) aiResp.failKeep();
      else { setErrR(advisorError(e)); aiResp.end(); }
    }
  };

  const addOffer = () => {
    if (!nWho && !nGive && !nGet) return;
    setOffers([{ who: nWho, give: nGive, get: nGet, status: "open", at: Date.now() }, ...offers]);
    setNWho(""); setNGive(""); setNGet("");
  };
  const setStatus = (i, status) => setOffers(offers.map((o, j) => j === i ? { ...o, status } : o));
  const delOffer = (i) => setOffers(offers.filter((_, j) => j !== i));

  return (
    <div>
      <div className="card">
        <div className="cardhead">
          <h3>Trade desk</h3>
          <div className="posfilter">
            <button className={sub === "find" ? "on" : ""} onClick={() => setSub("find")}>Find a trade</button>
            <button className={sub === "respond" ? "on" : ""} onClick={() => setSub("respond")}>Respond to offer</button>
            <button className={sub === "pending" ? "on" : ""} onClick={() => setSub("pending")}>Pending</button>
          </div>
        </div>

        {sub === "find" && (
          <div>
            <div className="tools">
              <select value={targetName} onChange={(e) => setTargetName(e.target.value)} style={{ flex: 1 }}>
                <option value="">Any team — find the best fit</option>
                {members.map((m, i) => <option key={i} value={m.name}>{m.teamName || m.name}</option>)}
              </select>
              <DoMe onClick={runFind} busy={aiFind.busy} working="Finding trades…" />
            </div>
            {members.length === 0 && <div className="note">Tip: import your league in <b onClick={goLeague} style={{ cursor: "pointer", textDecoration: "underline" }}>League → Teams</b> so suggestions can target real managers.</div>}
            <AiResultBar at={aiFind.at} busy={aiFind.busy} refreshFail={aiFind.refreshFail} onRefresh={ideas ? runFind : null} show={!!(ideas || aiFind.at)} />
            {errF && !ideas && <div className="note" style={{ borderColor: "var(--now)" }}>{errF}</div>}
            <div className={aiFind.busy && ideas ? "airesdim" : undefined}>
              {ideas && ideas.length === 0 && <div className="empty">No clean fits found right now. Try a specific target team, or check back after roster news moves.</div>}
              {ideas && ideas.map((idea, i) => (
                <div className="idea" key={i}>
                  <div className="idea-h">{idea.theme || "Trade idea"}</div>
                  {idea.rationale && <div className="idea-r">{idea.rationale}</div>}
                  <Tier label="Gentleman's" tone="go" d={idea.gentlemans} />
                  <Tier label="Aggressive" tone="now" d={idea.aggressive} />
                </div>
              ))}
              {ideas && <div className="note">Values checked against live news at run time. Always eyeball the names before you send — injuries move fast.</div>}
            </div>
          </div>
        )}

        {sub === "respond" && (
          <div>
            <div className="obf"><label>They give me</label><input value={offGive} onChange={(e) => setOffGive(e.target.value)} placeholder="e.g. Ladd McConkey, Tony Pollard" /></div>
            <div className="obf"><label>They want from me</label><input value={offWant} onChange={(e) => setOffWant(e.target.value)} placeholder="e.g. Chase Brown" /></div>
            <DoMe onClick={runRespond} busy={aiResp.busy} working="Evaluating…" />
            <AiResultBar at={aiResp.at} busy={aiResp.busy} refreshFail={aiResp.refreshFail} onRefresh={resp ? runRespond : null} show={!!(resp || aiResp.at)} />
            {errR && !resp && <div className="note" style={{ borderColor: "var(--now)", marginTop: 12 }}>{errR}</div>}
            {resp && (
              <div className={"idea" + (aiResp.busy ? " airesdim" : "")} style={{ marginTop: 14 }}>
                <div className="idea-h">Verdict: <span className={"verdict " + (resp.verdict === "accept" ? "go" : resp.verdict === "decline" ? "now" : "soon")}>{(resp.verdict || "").toUpperCase()}</span></div>
                {resp.read && <div className="idea-r">{resp.read}</div>}
                <Tier label="Gentleman's counter" tone="go" d={resp.gentlemans} />
                <Tier label="Aggressive counter" tone="now" d={resp.aggressive} />
              </div>
            )}
          </div>
        )}

        {sub === "pending" && (
          <div>
            <div className="tools">
              <input placeholder="Manager" value={nWho} onChange={(e) => setNWho(e.target.value)} style={{ flex: "0 0 110px" }} />
              <input placeholder="They give" value={nGive} onChange={(e) => setNGive(e.target.value)} />
              <input placeholder="They get" value={nGet} onChange={(e) => setNGet(e.target.value)} />
              <button className="btn sm" onClick={addOffer}>Log</button>
            </div>
            {offers.length === 0 ? <div className="empty">No open offers logged. Track live trade talks here so you and your co-manager stay in sync.</div> :
              offers.map((o, i) => (
                <div className="alert" key={i}>
                  <div className={"bar bar-" + (o.status === "open" ? "soon" : o.status === "accepted" ? "go" : "now")} />
                  <div className="body">
                    <div className="t">{o.who || "Someone"}: get {o.give || "—"} / give {o.get || "—"}</div>
                    <div className="meta"><span>{o.status}</span></div>
                  </div>
                  <div style={{ flex: "none", display: "flex", gap: 5 }}>
                    <button className="btn ghost sm" onClick={() => setStatus(i, "accepted")}>✓</button>
                    <button className="btn ghost sm" onClick={() => setStatus(i, "declined")}>✕</button>
                    <button className="btn ghost sm" onClick={() => delOffer(i)}>🗑</button>
                  </div>
                </div>
              ))}
            <div className="note">Pending offers are <b>shared</b> — your co-manager sees the same board and can weigh in before you respond.</div>
          </div>
        )}
      </div>
    </div>
  );
}


export default Trades;
