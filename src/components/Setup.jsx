import React, { useState } from "react";


/* ---------- Setup ---------- */
function Setup({ cfg, setCfg, resetBoard, restart, leagues, activeId, onAddLeague, onRemoveLeague, showDraft }) {
  const set = (patch) => setCfg({ ...cfg, ...patch });
  const draftMode = cfg.showDraft === true ? "on" : cfg.showDraft === false ? "off" : "auto";
  return (
    <div className="grid g2">
      <div className="card">
        <h3>This league</h3>
        <div className="field"><label>League name</label><input value={cfg.league} onChange={(e) => set({ league: e.target.value })} /></div>
        <div className="field"><label>Platform</label>
          <select value={cfg.platform || "Sleeper"} onChange={(e) => set({ platform: e.target.value })}>
            {["Sleeper", "Yahoo", "ESPN"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field"><label>Teams</label>
          <select value={cfg.teams} onChange={(e) => set({ teams: Number(e.target.value) })}>
            {[8, 10, 12, 14].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field"><label>Scoring</label>
          <select value={cfg.scoring} onChange={(e) => set({ scoring: e.target.value })}>
            {["PPR", "Half-PPR", "Standard"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <h3>Draft</h3>
        <div className="field"><label>Format</label>
          <select value={cfg.format} onChange={(e) => set({ format: e.target.value })}>
            {["Standard (1 QB)", "Superflex / 2-QB"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field"><label>Your draft slot</label>
          <select value={cfg.slot} onChange={(e) => set({ slot: e.target.value })}>
            <option value="">Not set</option>
            {Array.from({ length: 14 }, (_, i) => i + 1).slice(0, cfg.teams).map((n) => <option key={n} value={"Pick " + n}>{"Pick " + n}</option>)}
          </select>
        </div>
        <div className="field"><label>Draft date</label><input type="datetime-local" value={cfg.draftDate} onChange={(e) => set({ draftDate: e.target.value })} /></div>
        <div className="field"><label>Draft tab</label>
          <select value={draftMode} onChange={(e) => set({ showDraft: e.target.value === "auto" ? null : e.target.value === "on" })}>
            <option value="auto">Hide after the draft</option>
            <option value="on">Always show</option>
            <option value="off">Always hide</option>
          </select>
        </div>
        <div className="note">{showDraft ? "Draft tools are visible for this league." : "Draft is hidden for this league — the season (or draft date) has passed."} Shared with your co-manager. The only personal piece is which Gmail the intel scan reads.</div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => { if (confirm("Clear all draft-board picks?")) resetBoard(); }}>Reset draft board</button>
          <button className="btn ghost sm" onClick={restart}>Re-run first-time setup</button>
        </div>
      </div>

      <div className="card">
        <h3>Your leagues</h3>
        <div className="empty" style={{ paddingTop: 0 }}>Switch leagues from the header. Each can be a different platform.</div>
        {(leagues || []).map((l) => (
          <div className="memrow" key={l.id} style={{ paddingTop: 10 }}>
            <div className="memtop">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{l.name}{l.id === activeId ? " · active" : ""}</div>
                <div className="rosterline" style={{ margin: "4px 0 0" }}>{l.platform}{l.teams ? " · " + l.teams + "-team " + (l.scoring || "") : ""}</div>
              </div>
              {leagues.length > 1 && (
                <button className="btn ghost sm" onClick={() => { if (confirm("Remove " + l.name + " from this workspace? Data stays stored but it leaves the switcher.")) onRemoveLeague(l.id); }}>Remove</button>
              )}
            </div>
          </div>
        ))}
        <button className="btn ghost sm" onClick={onAddLeague} style={{ marginTop: 10 }}>+ Add league</button>
      </div>

      <div className="card">
        <h3>Sleeper mail</h3>
        <div className="empty" style={{ paddingTop: 0 }}>League → Intel only reads mail from sleeper.app. It never lists your inbox. Shared with your co-manager.</div>
      </div>
    </div>
  );
}


export default Setup;
