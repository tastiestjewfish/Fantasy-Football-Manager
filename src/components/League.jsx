import React, { useState } from "react";
import { resolveSlots } from "../lib/lineup.js";
import { runLeagueImport, leagueImportError } from "../lib/league.js";


/* ---------- League ---------- */
function League({ cfg, setCfg, members, setMembers, setSlots }) {
  const [platform, setPlatform] = useState(cfg.platform || "Sleeper");
  const [id, setId] = useState(cfg.leagueId || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const isSleeper = platform === "Sleeper";

  const doImport = async () => {
    setBusy(true); setMsg("");
    try {
      const result = await runLeagueImport(platform, id, cfg);
      setMembers(result.members);
      setCfg(result.cfg);
      if (setSlots) setSlots(resolveSlots(result.slots, result.cfg.format));
      const withRosters = result.members.filter((x) => x.roster && x.roster.length).length;
      setMsg("Imported " + result.members.length + " managers" + (withRosters ? " with live rosters" : "") + ". Mark your team below so Matchup, Trades, and Moves use your real roster.");
    } catch (e) {
      setCfg({ ...cfg, platform, leagueId: id });
      setMsg(leagueImportError(platform, e));
    }
    setBusy(false);
  };
  const add = () => setMembers([...members, { name: "", teamName: "", notes: "", roster: [], mine: false }]);
  const upd = (i, patch) => setMembers(members.map((m, j) => j === i ? { ...m, ...patch } : m));
  const del = (i) => setMembers(members.filter((_, j) => j !== i));
  const setMine = (i) => setMembers(members.map((m, j) => ({ ...m, mine: j === i })));

  return (
    <div className="card">
      <h3>Your league</h3>
      <div className="tools">
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {["Sleeper", "Yahoo", "ESPN"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder={isSleeper ? "Sleeper league ID" : platform + " league ID / key"} value={id} onChange={(e) => setId(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
        <button className="btn" onClick={doImport} disabled={busy}>{busy && <span className="spin" />}{busy ? "Importing…" : "Import"}</button>
      </div>

      {isSleeper ? (
        <div className="empty" style={{ paddingTop: 0 }}>Reads Sleeper's public API — every manager and their <b>live roster</b>. Find your league ID in the app URL: sleeper.com/leagues/<b>ID</b>/… First import can take a few seconds while player names load.</div>
      ) : platform === "Yahoo" ? (
        <div>
          <div className="empty" style={{ paddingTop: 0 }}>Yahoo needs a one-time developer app, then Connect, then import.</div>
          <ol style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)", paddingLeft: 20 }}>
            <li>Create an app at <b>developer.yahoo.com/apps</b> (Fantasy Sports API).</li>
            <li>Redirect URI: <b>https://fantasy-football-manager-210cc.web.app/api/yahoo/callback</b></li>
            <li>Put <b>YAHOO_CLIENT_ID</b> and <b>YAHOO_CLIENT_SECRET</b> in the project <b>.env</b>, then restart the App Hosting / API server.</li>
            <li>Click Connect Yahoo, then paste your league key (from the Yahoo league URL, like nfl.l.123456) and Import.</li>
          </ol>
          <button className="btn ghost sm" onClick={() => window.open("/api/yahoo/auth", "_blank")}>Connect Yahoo account</button>
        </div>
      ) : (
        <div>
          <div className="empty" style={{ paddingTop: 0 }}>Public ESPN leagues import with the league ID from the ESPN URL. Private leagues need cookies on the server.</div>
          <ol style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)", paddingLeft: 20 }}>
            <li>Public league: paste the numeric ESPN league ID and Import. No extra API key.</li>
            <li>Private league: in Chrome, open espn.com, DevTools → Application → Cookies. Copy <b>espn_s2</b> and <b>SWID</b>.</li>
            <li>Put them in the project <b>.env</b> as <b>ESPN_S2</b> and <b>ESPN_SWID</b>, restart the API, then Import.</li>
          </ol>
        </div>
      )}
      {msg && <div className="note">{msg}</div>}

      <div style={{ marginTop: 10 }}>
        {members.map((m, i) => (
          <div className="memrow" key={i}>
            <div className="memtop">
              <input placeholder="Team name" value={m.teamName} onChange={(e) => upd(i, { teamName: e.target.value })} />
              <input placeholder="Manager" value={m.name} onChange={(e) => upd(i, { name: e.target.value })} />
              <button className={"btn sm " + (m.mine ? "" : "ghost")} onClick={() => setMine(i)}>{m.mine ? "★ My team" : "My team"}</button>
              <button className="btn ghost sm" onClick={() => del(i)}>✕</button>
            </div>
            {m.roster && m.roster.length > 0 && <div className="rosterline">{m.roster.map((p) => `${p.name} (${p.pos})`).join(" · ")}</div>}
            <input className="memnotes" placeholder="Strengths & needs — e.g. stacked at WR, thin at RB" value={m.notes} onChange={(e) => upd(i, { notes: e.target.value })} />
          </div>
        ))}
        <button className="btn ghost sm" onClick={add} style={{ marginTop: 8 }}>+ Add manager</button>
      </div>
      <div className="note">Mark <b>My team</b> and Trades, Moves, and the bye planner all run off your real roster. This is the active league — switch or add Yahoo / ESPN / Sleeper leagues from the name in the header.</div>
    </div>
  );
}


export default League;
