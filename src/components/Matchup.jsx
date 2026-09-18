import React, { useState, useEffect, useRef } from "react";
import { resolveNextOpponent, sleeperNextOpponent } from "../lib/league.js";
import { activeRoster, localLineup, slotEligible } from "../lib/lineup.js";
import { callClaudeSearch, advisorError, extractJSON } from "../lib/ai.js";
import { loadKey, saveKey } from "../lib/storage.js";
import { copyText } from "../lib/format.js";
import { AiResultBar, DoMe, useAiResult } from "./shared.jsx";


/* ---------- Matchup (beat your next opponent) ---------- */
function Matchup({ cfg, slots, board, members, setSavedLineup }) {
  const roster = activeRoster(members, board);
  const opponents = (members || []).filter((m) => !m.mine);
  const meMember = (members || []).find((m) => m.mine);
  const oppKeyOf = (m, i) => (m.rosterId != null ? "r" + m.rosterId : "i" + i);
  const [oppKey, setOppKey] = useState("");
  const ai = useAiResult("ai:matchup");
  const res = ai.data && ai.data.res ? ai.data.res : null;
  const [assign, setAssign] = useState(() => (ai.data && ai.data.assign) || slots.map(() => null));
  const [err, setErr] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detMsg, setDetMsg] = useState("");
  const [used, setUsed] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    loadKey("matchup:oppKey", "", false).then((k) => { if (k) setOppKey(k); });
  }, []);
  useEffect(() => {
    if (!ai.hydrated || hydratedRef.current) return;
    hydratedRef.current = true;
    if (ai.data && ai.data.assign) setAssign(ai.data.assign);
  }, [ai.hydrated, ai.data]);
  const markOpp = (k) => { setOppKey(k); saveKey("matchup:oppKey", k, false); };

  const opp = opponents.find((m, i) => oppKeyOf(m, i) === oppKey);

  const detectOpponent = async () => {
    if (cfg.platform !== "Sleeper" || !cfg.leagueId || !meMember || meMember.rosterId == null) {
      setDetMsg("Auto-detect needs your Sleeper roster marked as My team in League → Teams. Or pick your opponent here.");
      return null;
    }
    setDetecting(true); setDetMsg("");
    try {
      const r = await sleeperNextOpponent(cfg.leagueId, meMember.rosterId);
      if (r && r.oppRosterId != null) {
        const om = members.find((m) => m.rosterId === r.oppRosterId);
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

  const detect = () => { detectOpponent(); };

  const generate = async (forcedOpp) => {
    const target = forcedOpp || opp;
    if (!roster.length) { setErr("Set your roster first — League tab → mark your team, or draft in Draft Room."); return; }
    if (!target) { setErr("Pick your next opponent, or tap Do this for me after marking My team."); return; }
    const hadPrior = !!res;
    ai.begin(); setErr(""); setUsed(false);
    const oppList = (target.roster && target.roster.length) ? target.roster.map((p) => `${p.name} (${p.pos})`).join(", ") : ("(roster unknown; notes: " + (target.notes || "none") + ")");
    const sys = "You are a top-tier fantasy football matchup strategist for a " + cfg.teams + "-team " + cfg.scoring + " league. It's a head-to-head week. If web_search is available, use it for THIS WEEK's projections, injuries, and matchups. Compare MY roster to my OPPONENT's and tell me how to WIN THIS SPECIFIC matchup. Strategy: if I'm a clear favorite, prioritize safe floors; if I'm an underdog, prioritize high-ceiling boom/bust to lift win probability. Set my lineup for slots in order: " + slots.join(", ") + ", using ONLY my players. Respond with ONLY JSON, no prose: {\"win_prob\":\"e.g. 58%\",\"margin\":\"projected +/- pts\",\"read\":\"edges and gaps vs this opponent\",\"lineup\":[{\"slot\":\"\",\"player\":\"\",\"why\":\"\"}],\"swaps\":[{\"out\":\"\",\"in\":\"\",\"why\":\"\"}],\"waiver_targets\":[{\"player\":\"\",\"pos\":\"\",\"why\":\"exploit their weakness or a better matchup\"}],\"block\":[{\"player\":\"\",\"why\":\"grab so the opponent can't\"}]}. lineup length exactly " + slots.length + ".";
    const user = "My roster: " + roster.map((p) => `${p.name} (${p.pos})`).join(", ") + ". Opponent " + (target.teamName || target.name) + " roster: " + oppList + ".";
    try {
      const j = extractJSON(await callClaudeSearch([{ role: "user", content: user }], { system: sys }));
      const names = roster.map((p) => p.name);
      const nextAssign = slots.map((s, i) => (j.lineup && j.lineup[i] && names.includes(j.lineup[i].player)) ? j.lineup[i].player : null);
      setAssign(nextAssign);
      await ai.succeed({ res: j, assign: nextAssign, oppKey });
    } catch (e) {
      if (hadPrior) {
        ai.failKeep();
        setErr(advisorError(e));
      } else {
        const j = localLineup(roster, slots);
        const fallback = {
          win_prob: "—",
          margin: "",
          read: advisorError(e) + " This is a naive lineup from your roster vs " + (target.teamName || target.name) + ". Retry Do this for me for a live matchup read.",
          lineup: j.lineup,
          swaps: [],
          waiver_targets: [],
          block: [],
        };
        const nextAssign = slots.map((s, i) => (j.lineup[i] && j.lineup[i].player) ? j.lineup[i].player : null);
        setAssign(nextAssign);
        await ai.succeed({ res: fallback, assign: nextAssign, oppKey });
        setErr("");
      }
    }
  };

  const doMe = async () => {
    let target = opp;
    if (!target) target = await detectOpponent();
    await generate(target);
  };

  const swap = (i, name) => { const next = [...assign]; if (name) { const j = next.findIndex((a, k) => a === name && k !== i); if (j >= 0) next[j] = next[i]; } next[i] = name || null; setAssign(next); setUsed(false); };
  const infoFor = (name) => res && res.lineup ? res.lineup.find((l) => l.player === name) : null;
  const lineupText = "Lineup vs " + (opp ? (opp.teamName || opp.name) : "") + "\n" + slots.map((s, i) => `${s}: ${assign[i] || "—"}`).join("\n");
  const useAsLineup = () => { setSavedLineup({ assign, meta: { byPlayer: {}, risks: [], notes: "Tuned to beat " + (opp.teamName || opp.name) }, submitted: false, at: Date.now() }); setUsed(true); };
  const wpNum = res ? parseFloat(String(res.win_prob).replace(/[^\d.]/g, "")) : null;
  const favored = wpNum != null && wpNum >= 50;

  return (
    <div>
      <div className="card">
        <div className="cardhead"><h3>Matchup — beat your next opponent</h3></div>
        <div className="tools">
          <select value={oppKey} onChange={(e) => markOpp(e.target.value)} style={{ flex: 1 }}>
            <option value="">Pick your opponent…</option>
            {opponents.map((m, i) => (
              <option key={oppKeyOf(m, i)} value={oppKeyOf(m, i)}>{m.teamName || m.name || ("Team " + (i + 1))}</option>
            ))}
          </select>
          {cfg.platform === "Sleeper" && <button className="btn ghost" onClick={detect} disabled={detecting}>{detecting && <span className="spin" />}Detect</button>}
          <DoMe onClick={doMe} busy={ai.busy || detecting} working="Planning…" />
        </div>
        {opponents.length === 0 && <div className="note">Import your league in the <b>League</b> tab first so I know who you're up against. After import, every other manager shows up in this menu.</div>}
        {detMsg && <div className="note">{detMsg}</div>}
        <AiResultBar at={ai.at} busy={ai.busy} refreshFail={ai.refreshFail} onRefresh={res ? () => generate() : null} show={!!(res || ai.at)} />
        {err && <div className="note" style={{ borderColor: "var(--now)" }}>{err}</div>}

        {res && (
          <div className={ai.busy ? "airesdim" : undefined} style={{ marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", padding: "6px 0 12px" }}>
              <div>
                <div className="eyebrow">Win probability vs {opp && (opp.teamName || opp.name)}</div>
                <div className="wp" style={{ color: favored ? "var(--go)" : "var(--now)" }}>{res.win_prob || "—"}</div>
              </div>
              <div style={{ paddingBottom: 4 }}>
                <span className={"statepill pill-" + (favored ? "go" : "now")}>{favored ? "Favored — protect the floor" : "Underdog — chase ceiling"}</span>
                {res.margin && <div className="heronext" style={{ marginTop: 8 }}>Projected margin: <b>{res.margin}</b></div>}
              </div>
            </div>
            {res.read && <div className="idea-r">{res.read}</div>}

            <div style={{ marginTop: 10 }}>
              {slots.map((s, i) => {
                const opts = roster.filter((p) => slotEligible(s, p.pos));
                const info = infoFor(assign[i]);
                return (
                  <div className="lrow" key={i}>
                    <span className="lslot">{s}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <select value={assign[i] || ""} onChange={(e) => swap(i, e.target.value)}>
                        <option value="">— empty —</option>
                        {opts.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.pos})</option>)}
                      </select>
                      {info && info.why && <div className="lwhy">{info.why}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn" onClick={useAsLineup}>{used ? "Sent to Lineup ✓" : "Use as my lineup"}</button>
              <button className="btn ghost" onClick={() => copyText(lineupText)}>Copy</button>
              {used && <span className="empty" style={{ padding: 0 }}>Open the Lineup tab to submit or tweak.</span>}
            </div>
          </div>
        )}
      </div>

      {res && res.swaps && res.swaps.length > 0 && (
        <div className="card">
          <h3>Start / sit changes to win</h3>
          {res.swaps.map((s, i) => (
            <div className="alert" key={i}><div className="bar bar-soon" /><div className="body"><div className="t">Start {s.in} over {s.out}</div>{s.why && <div className="s">{s.why}</div>}</div></div>
          ))}
        </div>
      )}
      {res && res.waiver_targets && res.waiver_targets.length > 0 && (
        <div className="card">
          <h3>Waiver targets to exploit this matchup</h3>
          {res.waiver_targets.map((w, i) => (
            <div className="alert" key={i}><div className="bar bar-go" /><div className="body"><div className="t">{w.player} <span style={{ color: "var(--muted)", fontWeight: 600 }}>{w.pos}</span></div>{w.why && <div className="s">{w.why}</div>}</div></div>
          ))}
        </div>
      )}
      {res && res.block && res.block.length > 0 && (
        <div className="card">
          <h3>Block from your opponent</h3>
          {res.block.map((b, i) => (
            <div className="alert" key={i}><div className="bar bar-now" /><div className="body"><div className="t">{b.player}</div>{b.why && <div className="s">{b.why}</div>}</div></div>
          ))}
        </div>
      )}
      <div className="note">Reads live projections and both rosters at run time to tilt the week your way. Give it a final look — then "Use as my lineup" to carry it to the Lineup tab and submit.</div>
    </div>
  );
}


export default Matchup;
