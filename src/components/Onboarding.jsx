import React, { useState } from "react";
import { getWorkspaceId } from "../firebase";
import { defaultSlots, resolveSlots } from "../lib/lineup.js";
import { runLeagueImport, leagueImportError } from "../lib/league.js";


/* ---------- Onboarding (first run) ---------- */
function Onboarding({ cfg, setCfg, members, setMembers, setSlots, onDone, goHome }) {
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState(cfg.platform || "Sleeper");
  const [leagueId, setLeagueId] = useState(cfg.leagueId || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [importOk, setImportOk] = useState(false);
  const total = 6;
  const workspace = getWorkspaceId();
  const isSleeper = platform === "Sleeper";
  const hasTeams = (members || []).length > 0;
  const hasMine = (members || []).some((m) => m.mine);
  const teamCountOpts = [...new Set([8, 10, 12, 14, Number(cfg.teams)].filter((n) => n > 0))].sort((a, b) => a - b);

  const next = () => {
    if (step === 2) setCfg({ ...cfg, platform, leagueId });
    setStep((s) => Math.min(s + 1, total - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const set = (patch) => {
    const nextCfg = { ...cfg, ...patch };
    setCfg(nextCfg);
    if (patch.format) setSlots(defaultSlots(patch.format));
  };
  const setMine = (i) => setMembers((members || []).map((m, j) => ({ ...m, mine: j === i })));

  const doImport = async () => {
    setBusy(true); setMsg(""); setImportOk(false);
    try {
      const result = await runLeagueImport(platform, leagueId, cfg);
      setMembers(result.members);
      setCfg(result.cfg);
      setSlots(resolveSlots(result.slots, result.cfg.format));
      const withRosters = result.members.filter((x) => x.roster && x.roster.length).length;
      setMsg("Imported " + result.members.length + " managers" + (withRosters ? " with live rosters" : "") + " ✓");
      setImportOk(true);
      setStep(3);
    } catch (e) {
      setCfg({ ...cfg, platform, leagueId });
      setMsg(leagueImportError(platform, e));
    }
    setBusy(false);
  };

  const finish = () => {
    onDone();
    goHome();
  };

  const canNext = step !== 3 || !hasTeams || hasMine;

  return (
    <div className="ob" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="obcard">
        <div className="obsteps">{Array.from({ length: total }).map((_, i) => <span key={i} className={"obdot " + (i <= step ? "on" : "")} />)}</div>
        <div className="obstepnum">Step {step + 1} of {total}</div>

        {step === 0 && (
          <>
            <h2 id="ob-title">Welcome to League HQ</h2>
            <div className="lead">Three quick steps and your team runs itself.</div>
            <div className="note">After this, <b>Home</b> tells you what to do each week — tap nothing, just follow the list.</div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 id="ob-title">Your workspace code</h2>
            <div className="lead">This workspace can hold every league you run — Sleeper, Yahoo, or ESPN. You already entered the code at sign-in.</div>
            <div className="obcode">{workspace || "—"}</div>
            <div className="note">A co-manager who enters the <b>same</b> code sees the same leagues. Solo? You can ignore this. Add more leagues later from the name in the header.</div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 id="ob-title">Connect your league</h2>
            <div className="lead">Import this first league so we know your team. You can add others from the header afterward.</div>
            <div className="obf">
              <label>Platform</label>
              <select value={platform} onChange={(e) => { setPlatform(e.target.value); set({ platform: e.target.value }); }}>
                {["Sleeper", "Yahoo", "ESPN", "NFL"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="obf">
              <label>League ID</label>
              <input
                value={leagueId}
                onChange={(e) => setLeagueId(e.target.value)}
                placeholder={isSleeper ? "e.g. 112233445566" : platform + " league ID"}
              />
              <div className="hint">Find it in your league's web address: sleeper.com/leagues/THIS-NUMBER/… (grab it from a browser — easier than the app).</div>
            </div>
            <button className="btn" onClick={doImport} disabled={busy}>{busy && <span className="spin" />}{busy ? "Importing…" : "Import"}</button>
            {!isSleeper && (
              <div className="note">Yahoo, ESPN, and NFL need the connector or manual entry. Sleeper is the one-tap automated option.</div>
            )}
            {msg && <div className="note" style={importOk ? { borderColor: "var(--go)" } : { borderColor: "var(--now)" }}>{msg}</div>}
          </>
        )}

        {step === 3 && (
          <>
            <h2 id="ob-title">Pick your team</h2>
            {importOk && msg && <div className="note" style={{ borderColor: "var(--go)" }}>{msg}</div>}
            <div className="note">This is the step everyone forgets — we need to know which team is yours.</div>
            {hasTeams ? (
              <div style={{ marginTop: 12 }}>
                {(members || []).map((m, i) => (
                  <button type="button" key={i} className={"obteam" + (m.mine ? " on" : "")} onClick={() => setMine(i)}>
                    <span>
                      <div className="tn">{m.teamName || m.name || ("Team " + (i + 1))}</div>
                      <div className="sub">{m.name}{m.roster && m.roster.length ? " · " + m.roster.length + " players" : ""}</div>
                    </span>
                    <span className="mark">{m.mine ? "★ My team" : "My team"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">No teams imported. You can set yours later in the League tab.</div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <h2 id="ob-title">Confirm settings</h2>
            <div className="lead">Import usually gets these right. Change anything that's off.</div>
            <div className="obf">
              <label>Scoring</label>
              <select value={cfg.scoring} onChange={(e) => set({ scoring: e.target.value })}>
                {[...new Set(["PPR", "Half-PPR", "Standard", cfg.scoring].filter(Boolean))].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="obf">
              <label>Teams</label>
              <select value={cfg.teams} onChange={(e) => set({ teams: Number(e.target.value) })}>
                {teamCountOpts.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="obf">
              <label>Roster format</label>
              <select value={cfg.format} onChange={(e) => set({ format: e.target.value })}>
                {["Standard (1 QB)", "Superflex / 2-QB"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 id="ob-title">You're set</h2>
            <div className="lead">From now on, just open the app — Home tells you what to do.</div>
          </>
        )}

        <div className="obnav">
          {step > 0 ? <button className="btn ghost" onClick={back}>Back</button> : <span />}
          {step < total - 1
            ? <button className="btn" onClick={next} disabled={!canNext}>Next</button>
            : <button className="btn" onClick={finish}>Go to Home</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Weekly advisor (Home to-do list) ---------- */

export default Onboarding;
