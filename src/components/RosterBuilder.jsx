import React, { useState, useEffect, useRef, useCallback } from "react";
import { PLAYERS, loadFantasyBoard } from "../lib/players.js";
import { localRoster, slotEligible, activeRoster } from "../lib/lineup.js";
import { callClaude, advisorError, extractJSON, MODEL_FAST } from "../lib/ai.js";
import { copyText } from "../lib/format.js";
import { AiResultBar, DoMe, PlayerDataBar, useAiResult } from "./shared.jsx";


/* ---------- Roster Builder (consensus-driven roster architect) ---------- */
function RosterBuilder({ cfg, slots, board, setBoard, members, saved, setSaved }) {
  const fullSlots = [...slots, "BN", "BN", "BN", "BN", "BN", "BN"];
  const ai = useAiResult("ai:build");
  const [mode, setMode] = useState("draft");
  const [res, setRes] = useState(() => (ai.data && ai.data.res) || (saved && saved.res) || null);
  const [assign, setAssign] = useState(() => (ai.data && ai.data.assign) || (saved && saved.assign) || fullSlots.map(() => null));
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [pinned, setPinned] = useState(false);
  const [fantasyBoard, setFantasyBoard] = useState(null);
  const [boardMeta, setBoardMeta] = useState({ at: null, source: null });
  const [boardBusy, setBoardBusy] = useState(false);
  const hydratedRef = useRef(false);

  const loadBoard = useCallback(async (force = false) => {
    setBoardBusy(true);
    try {
      const next = await loadFantasyBoard({ force, limit: 200 });
      setFantasyBoard(next.board);
      setBoardMeta({ at: next.at, source: next.source });
    } finally {
      setBoardBusy(false);
    }
  }, []);

  useEffect(() => {
    loadBoard(false);
  }, [loadBoard]);

  useEffect(() => {
    if (!ai.hydrated || hydratedRef.current) return;
    hydratedRef.current = true;
    if (ai.data && ai.data.res) {
      setRes(ai.data.res);
      if (ai.data.assign) setAssign(ai.data.assign);
    }
  }, [ai.hydrated, ai.data]);

  const current = activeRoster(members, board);
  const boardForAi = fantasyBoard && fantasyBoard.length ? fantasyBoard : null;

  const generate = async () => {
    const hadPrior = !!res;
    ai.begin(); setErr(""); setNote(""); setPinned(false);
    const where = mode === "draft"
      ? `Build the optimal DRAFT-TARGET roster to aim for from draft slot ${cfg.slot || "unknown"}. Make it realistically draftable — each player's ADP/rank should be reachable at the round I'd actually pick.`
      : `Given my current roster (${current.map((p) => `${p.name} (${p.pos})`).join(", ") || "empty"}), build the optimal roster I should end up with after realistic adds, drops, and trades. Note which are new targets.`;
    const live = boardForAi && boardMeta.source === "live";
    const top = (boardForAi || PLAYERS).slice(0, 50);
    const boardLine = top.map((p) => {
      const rank = p.adp != null ? p.adp : p.rank;
      return live
        ? `${p.name} (${p.pos}, rank ${rank})`
        : `${p.name} (${p.pos}, ADP ${rank})`;
    }).join("; ");
    const boardLabel = live ? "current Sleeper search_rank board" : "cached ADP board";
    const sys = "You are a fantasy football roster architect for a " + cfg.teams + "-team " + cfg.scoring + " league (" + cfg.format + "). " + where + " Fill every slot in order: " + fullSlots.join(", ") + " using the " + boardLabel + " in the user message. Keep each 'why' to a few words. Respond with ONLY JSON, no prose: {\"roster\":[{\"slot\":\"\",\"player\":\"\",\"pos\":\"\",\"tier\":\"\",\"adp\":\"\",\"why\":\"\"}],\"alternates\":[{\"player\":\"\",\"pos\":\"\",\"note\":\"\"}],\"avoid\":[{\"player\":\"\",\"why\":\"\"}],\"sources\":[\"" + (live ? "Sleeper search_rank" : "ADP board") + "\"],\"summary\":\"one line strategy\"}. roster must have exactly " + fullSlots.length + " entries in slot order.";
    try {
      const j = extractJSON(await callClaude([{ role: "user", content: (live ? "Rank board" : "ADP board") + " (best available first): " + boardLine }], { system: sys, model: MODEL_FAST, max_tokens: 1500 }));
      if (!j || !Array.isArray(j.roster) || !j.roster.length) throw new Error("empty");
      const nextAssign = fullSlots.map((s, i) => (j.roster[i] && j.roster[i].player) ? j.roster[i].player : null);
      setRes(j);
      setAssign(nextAssign);
      await ai.succeed({ res: j, assign: nextAssign, mode });
    } catch (e) {
      if (hadPrior) {
        ai.failKeep();
        setErr(advisorError(e));
      } else {
        const local = localRoster(cfg, fullSlots, boardForAi || PLAYERS);
        const nextAssign = fullSlots.map((s, i) => (local.roster[i] && local.roster[i].player) ? local.roster[i].player : null);
        setRes(local);
        setAssign(nextAssign);
        await ai.succeed({ res: local, assign: nextAssign, mode });
        setNote(advisorError(e) + (live
          ? " Using a lineup built from live Sleeper ranks until advice works."
          : " Using League HQ's cached 2026 consensus ADP until live advice works."));
      }
    }
  };

  const poolFor = (slot) => {
    const fromRoster = (res && res.roster ? res.roster : []).map((r) => ({ name: r.player, pos: r.pos }));
    const fromAlt = (res && res.alternates ? res.alternates : []).map((a) => ({ name: a.player, pos: a.pos }));
    const seen = new Set();
    return [...fromRoster, ...fromAlt].filter((p) => p.name && !seen.has(p.name) && seen.add(p.name) && slotEligible(slot, p.pos));
  };
  const swap = (i, name) => {
    const next = [...assign];
    if (name) { const j = next.findIndex((a, k) => a === name && k !== i); if (j >= 0) next[j] = next[i]; }
    next[i] = name || null; setAssign(next); setPinned(false);
  };
  const infoFor = (name) => (res && res.roster ? res.roster.find((r) => r.player === name) : null);

  const pinToBoard = () => {
    const next = { ...board };
    const pool = boardForAi || PLAYERS;
    assign.forEach((nm) => {
      if (!nm) return;
      let p = PLAYERS.find((pp) => pp.name.toLowerCase() === nm.toLowerCase());
      if (!p) {
        const live = pool.find((pp) => pp.name.toLowerCase() === nm.toLowerCase());
        if (live) {
          const id = String(live.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
          next[id] = "mine";
          return;
        }
      }
      if (p) next[p.id] = "mine";
    });
    setBoard(next); setPinned(true);
  };
  const save = () => setSaved({ res, assign, at: Date.now() });
  const rosterText = "Target roster — " + cfg.league + "\n" + fullSlots.map((s, i) => `${s}: ${assign[i] || "—"}`).join("\n");

  return (
    <div>
      <div className="card">
        <div className="cardhead">
          <h3>Roster builder</h3>
          <DoMe onClick={generate} busy={ai.busy} working="Building…" />
        </div>
        <div className="posfilter" style={{ marginBottom: 10 }}>
          <button className={mode === "draft" ? "on" : ""} onClick={() => setMode("draft")}>Draft target</button>
          <button className={mode === "current" ? "on" : ""} onClick={() => setMode("current")}>From my roster</button>
        </div>
        <div className="empty" style={{ paddingTop: 0 }}>
          Builds a recommended roster for your {cfg.teams}-team {cfg.scoring} league from {boardMeta.source === "live" ? "live Sleeper player ranks" : "the in-app ADP board"}. Every spot is editable, and you can push the picks into your Draft Room.
        </div>
        <PlayerDataBar
          at={boardMeta.at}
          source={boardMeta.source}
          busy={boardBusy}
          onRefresh={() => loadBoard(true)}
        />
        <AiResultBar at={ai.at} busy={ai.busy} refreshFail={ai.refreshFail} onRefresh={res ? generate : null} show={!!(res || ai.at)} />
        {err && <div className="note" style={{ borderColor: "var(--now)" }}>{err}</div>}
        {note && <div className="note" style={{ borderColor: "var(--soon)" }}>{note}</div>}
        <div className={ai.busy && res ? "airesdim" : undefined}>
          {res && res.summary && <div className="idea-r" style={{ marginTop: 10 }}>{res.summary}</div>}

          {res && (
            <div style={{ marginTop: 8 }}>
              {fullSlots.map((s, i) => {
                const pool = poolFor(s);
                const info = infoFor(assign[i]);
                return (
                  <div className="lrow" key={i}>
                    <span className="lslot">{s}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <select value={assign[i] || ""} onChange={(e) => swap(i, e.target.value)}>
                        <option value="">— empty —</option>
                        {assign[i] && !pool.some((p) => p.name === assign[i]) && <option value={assign[i]}>{assign[i]}</option>}
                        {pool.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.pos})</option>)}
                      </select>
                      {info && info.why && <div className="lwhy">{info.why}{info.tier ? " · " + info.tier : ""}</div>}
                    </div>
                    {info && info.adp && <span className="lproj">{info.adp}</span>}
                  </div>
                );
              })}
              <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={pinToBoard}>{pinned ? "Pinned to Draft Room ✓" : "Pin targets to Draft Room"}</button>
                <button className="btn ghost" onClick={save}>Save roster</button>
                <button className="btn ghost" onClick={() => copyText(rosterText)}>Copy</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {res && res.alternates && res.alternates.length > 0 && (
        <div className={"card" + (ai.busy ? " airesdim" : "")}>
          <h3>Sleepers &amp; upside alternates</h3>
          {res.alternates.map((a, i) => (
            <div className="alert" key={i}><div className="bar bar-go" /><div className="body"><div className="t">{a.player} <span style={{ color: "var(--muted)", fontWeight: 600 }}>{a.pos}</span></div>{a.note && <div className="s">{a.note}</div>}</div></div>
          ))}
        </div>
      )}
      {res && res.avoid && res.avoid.length > 0 && (
        <div className={"card" + (ai.busy ? " airesdim" : "")}>
          <h3>Fade / avoid</h3>
          {res.avoid.map((a, i) => (
            <div className="alert" key={i}><div className="bar bar-now" /><div className="body"><div className="t">{a.player}</div>{a.why && <div className="s">{a.why}</div>}</div></div>
          ))}
        </div>
      )}
      {res && res.sources && res.sources.length > 0 && (
        <div className="note">Synthesized from: {res.sources.join(", ")}. Rankings shift daily — rebuild before your draft, and always sanity-check the latest injury news.</div>
      )}
    </div>
  );
}


export default RosterBuilder;
