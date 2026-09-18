import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  getAnthropicWorkspaceId, setAnthropicWorkspaceId,
  getUseWebSearch, setUseWebSearch,
} from "../lib/ai.js";
import { aiResultBoot, loadAiResult, saveAiResult, fmtGeneratedAt } from "../lib/storage.js";
import { DEFAULT_CFG, runLeagueImport, leagueImportError, newLeagueId, summaryFromCfg } from "../lib/league.js";
import { resolveSlots } from "../lib/lineup.js";
import { copyText } from "../lib/format.js";

function SpearMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 12.2h9.4l-2.1-3.2L21 12.2l-10.7 3.2 2.1-3.2H3z"/>
    </svg>
  );
}

function AiResultBar({ at, busy, refreshFail, onRefresh, show }) {
  if (!show && !at && !busy && !refreshFail) return null;
  return (
    <div className="airesbar">
      <div className="airesrow">
        {at ? <span className="eyebrow" style={{ margin: 0 }}>Generated {fmtGeneratedAt(at)}</span> : <span />}
        {onRefresh && (
          <button type="button" className="btn ghost sm" onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "↻ Refresh"}
          </button>
        )}
      </div>
      {refreshFail && at ? (
        <div className="note" style={{ borderColor: "var(--soon)", marginTop: 8 }}>
          Couldn't refresh — showing last result from {fmtGeneratedAt(at)}
        </div>
      ) : null}
    </div>
  );
}

function useAiResult(storageKey) {
  const boot = aiResultBoot[storageKey];
  const [data, setData] = useState(() => (boot && boot.data !== undefined && boot.data !== null ? boot.data : null));
  const [at, setAt] = useState(() => (boot && boot.at) || null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(storageKey in aiResultBoot);
  const [refreshFail, setRefreshFail] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;
    loadAiResult(storageKey).then((rec) => {
      if (cancelled) return;
      if (rec) {
        setData(rec.data);
        setAt(rec.at);
        aiResultBoot[storageKey] = rec;
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  const begin = useCallback(() => {
    setBusy(true);
    setRefreshFail(false);
  }, []);

  const succeed = useCallback(async (next) => {
    const ts = await saveAiResult(storageKey, next);
    setData(next);
    setAt(ts);
    aiResultBoot[storageKey] = { data: next, at: ts };
    setBusy(false);
    setRefreshFail(false);
    return ts;
  }, [storageKey]);

  const failKeep = useCallback(() => {
    setBusy(false);
    if (dataRef.current != null) setRefreshFail(true);
  }, []);

  const end = useCallback(() => { setBusy(false); }, []);

  return { data, at, busy, hydrated, refreshFail, begin, succeed, failKeep, end };
}

function DoMe({ onClick, busy, disabled, working, label }) {
  return (
    <button className="btn" onClick={onClick} disabled={disabled || busy}>
      {busy && <span className="spin" />}
      {busy ? (working || "Working…") : (label || "Do this for me")}
    </button>
  );
}

function LeaguePicker({ leagues, activeId, cfg, open, setOpen, onSelect, onAdd }) {
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen]);
  return (
    <div className="lgpick" ref={box}>
      <button type="button" className="leaguechip" onClick={() => setOpen(!open)} title="Switch or add a league">
        <b>{cfg.league}</b> · {cfg.platform || "Sleeper"} · {cfg.teams}-team {cfg.scoring}
        <span className="lgcaret">▾</span>
      </button>
      {open && (
        <div className="lgmenu" role="listbox">
          {(leagues || []).map((l) => (
            <button key={l.id} type="button" className={"lgopt" + (l.id === activeId ? " on" : "")} onClick={() => onSelect(l.id)}>
              <b>{l.name}</b>
              <span>{l.platform}{l.teams ? " · " + l.teams + "-team " + (l.scoring || "") : ""}</span>
            </button>
          ))}
          <button type="button" className="lgopt add" onClick={onAdd}>+ Add league</button>
        </div>
      )}
    </div>
  );
}

function AddLeague({ onCancel, onSave }) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("Sleeper");
  const [leagueId, setLeagueId] = useState("");
  const [members, setMembers] = useState([]);
  const [slots, setSlots] = useState(null);
  const [cfg, setCfg] = useState({ ...DEFAULT_CFG, platform: "Sleeper" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [importOk, setImportOk] = useState(false);
  const hasTeams = members.length > 0;
  const hasMine = members.some((m) => m.mine);
  const isSleeper = platform === "Sleeper";

  const doImport = async () => {
    setBusy(true); setMsg(""); setImportOk(false);
    try {
      const result = await runLeagueImport(platform, leagueId, { ...DEFAULT_CFG, platform, leagueId, league: name || DEFAULT_CFG.league });
      setMembers(result.members);
      setCfg({ ...result.cfg, league: name || result.cfg.league });
      setSlots(resolveSlots(result.slots, result.cfg.format));
      const withRosters = result.members.filter((x) => x.roster && x.roster.length).length;
      setMsg("Imported " + result.members.length + " managers" + (withRosters ? " with live rosters" : "") + " ✓");
      setImportOk(true);
    } catch (e) {
      setCfg((s) => ({ ...s, platform, leagueId, league: name || s.league }));
      setMsg(leagueImportError(platform, e));
    }
    setBusy(false);
  };

  const finish = () => {
    onSave({
      cfg: { ...cfg, platform, leagueId, league: name.trim() || cfg.league || "New league" },
      members,
      slots: resolveSlots(slots, cfg.format),
    });
  };

  return (
    <div className="ob" role="dialog" aria-modal="true" aria-labelledby="add-lg-title">
      <div className="obcard">
        <h2 id="add-lg-title">Add a league</h2>
        <div className="lead">Sleeper, Yahoo, or ESPN — each league keeps its own roster, lineup, and coach notes.</div>
        <div className="obf">
          <label>League name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work league" />
        </div>
        <div className="obf">
          <label>Platform</label>
          <select value={platform} onChange={(e) => { setPlatform(e.target.value); setCfg((s) => ({ ...s, platform: e.target.value })); }}>
            {["Sleeper", "Yahoo", "ESPN"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="obf">
          <label>League ID</label>
          <input
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            placeholder={isSleeper ? "e.g. 112233445566" : platform + " league ID"}
          />
          {isSleeper && <div className="hint">From sleeper.com/leagues/THIS-NUMBER/…</div>}
        </div>
        <button className="btn" onClick={doImport} disabled={busy || !leagueId.trim()}>{busy && <span className="spin" />}{busy ? "Importing…" : "Import"}</button>
        {!isSleeper && (
          <div className="note">Yahoo needs Connect in League → Teams after you add this. ESPN public leagues import with the numeric ID.</div>
        )}
        {msg && <div className="note" style={importOk ? { borderColor: "var(--go)" } : { borderColor: "var(--now)" }}>{msg}</div>}
        {hasTeams && (
          <div style={{ marginTop: 14 }}>
            <div className="eyebrow">Pick your team</div>
            {members.map((m, i) => (
              <button type="button" key={i} className={"obteam" + (m.mine ? " on" : "")} onClick={() => setMembers(members.map((x, j) => ({ ...x, mine: j === i })))}>
                <span>
                  <div className="tn">{m.teamName || m.name || ("Team " + (i + 1))}</div>
                  <div className="sub">{m.name}{m.roster && m.roster.length ? " · " + m.roster.length + " players" : ""}</div>
                </span>
                <span className="mark">{m.mine ? "★ My team" : "My team"}</span>
              </button>
            ))}
          </div>
        )}
        <div className="obnav">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={finish} disabled={hasTeams && !hasMine}>{hasTeams ? "Add league" : "Add without import"}</button>
        </div>
      </div>
    </div>
  );
}


function AnthropicWorkspaceCard() {
  const [id, setId] = useState(getAnthropicWorkspaceId);
  const [searchOn, setSearchOn] = useState(getUseWebSearch);
  const save = () => setAnthropicWorkspaceId(id);
  const toggleSearch = () => {
    const next = !searchOn;
    setSearchOn(next);
    setUseWebSearch(next);
  };
  return (
    <div className="card">
      <h3>Advisor cost</h3>
      <div className="empty" style={{ paddingTop: 0 }}>
        Draft, start/sit, intel, chat, and the roster builder use a cheaper model. Home, lineup, matchup, and trades use Sonnet — and only when you tap. Weekly Home advice stays saved until you refresh.
      </div>
      <div className="remctl" style={{ marginTop: 10 }}>
        <button className={"btn sm " + (searchOn ? "" : "ghost")} onClick={toggleSearch}>
          {searchOn ? "Live web search on" : "Live web search off"}
        </button>
      </div>
      <div className="note">
        Web search is the expensive part (Home, lineup, matchup, trades). Turn it off to skip search bills; those tools still run on the model's own knowledge.
      </div>
      <h3 style={{ marginTop: 18 }}>Anthropic workspace</h3>
      <div className="empty" style={{ paddingTop: 0 }}>
        Open <b>console.anthropic.com → Settings → Workspaces</b> (not claude.ai). Copy the ID column — it starts with <b>wrkspc_</b>. Or create an API key scoped to one workspace and you can leave this blank.
      </div>
      <div className="remctl" style={{ marginTop: 10 }}>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          onBlur={save}
          placeholder="wrkspc_…"
          autoComplete="off"
          spellCheck={false}
          style={{ minWidth: 220, flex: 1 }}
        />
        <button className="btn ghost sm" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function Tier({ label, tone, d }) {
  if (!d) return null;
  return (
    <div className="tblock">
      <div className={"ttag " + tone}>{label}{d.acceptOdds && <span className="todds">· {d.acceptOdds} acceptance</span>}</div>
      {d.give && <div className="tline"><span className="tk">Give</span> {(d.give || []).join(", ") || "—"}</div>}
      {d.get && <div className="tline"><span className="tk">Get</span> {(d.get || []).join(", ") || "—"}</div>}
      {d.counter && <div className="tline"><span className="tk">Counter</span> {d.counter}</div>}
      {d.why && <div className="twhy">{d.why}</div>}
      {d.message && (
        <div className="tmsg">
          <div className="tmsg-l">Message to send</div>
          <div>{d.message}</div>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => copyText(d.message)}>Copy message</button>
        </div>
      )}
    </div>
  );
}


function PlayerDataBar({ at, source, busy, onRefresh }) {
  const label = source === "live" && at
    ? "Player data as of " + fmtGeneratedAt(at)
    : source === "static"
      ? "Player data: offline fallback (preseason board)"
      : at
        ? "Player data as of " + fmtGeneratedAt(at)
        : "Player data";
  return (
    <div className="airesbar">
      <div className="airesrow">
        <span className="eyebrow" style={{ margin: 0 }}>{label}</span>
        {onRefresh && (
          <button type="button" className="btn ghost sm" onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "↻ Refresh"}
          </button>
        )}
      </div>
    </div>
  );
}


export {
  SpearMark, AiResultBar, useAiResult, DoMe, PlayerDataBar,
  LeaguePicker, AddLeague, AnthropicWorkspaceCard, Tier,
};
