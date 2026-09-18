import React, { useState } from "react";
import { DAYS, nextWeekly, downloadICS, urgencyFor, fmtCountdown } from "../lib/format.js";
import { AnthropicWorkspaceCard } from "./shared.jsx";


function Reminders({ rem, setRem, cfg }) {
  const set = (patch) => setRem({ ...rem, ...patch });

  const lineup = nextWeekly(rem.lineupDay, rem.lineupTime);
  const waiver = nextWeekly(rem.waiverDay, rem.waiverTime);
  const trade = rem.tradeDeadline ? new Date(rem.tradeDeadline + "T12:00:00") : null;
  const byDay = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  const daySel = (val, on) => (
    <select value={val} onChange={(e) => on(Number(e.target.value))}>
      {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
    </select>
  );

  return (
    <div className="grid g2">
      <div className="card">
        <h3>Reminders</h3>
        <div className="empty" style={{ paddingTop: 0, marginBottom: 4 }}>
          Add these to your phone's calendar and it'll remind you — even when the app is closed.
        </div>

        <div className="rem">
          <div className="remhead">
            <span className="remtitle">Set your lineup</span>
            <span className="remcd mono" style={{ color: `var(--${urgencyFor(lineup)})` }}>{fmtCountdown(lineup)}</span>
          </div>
          <div className="remctl">
            <label>Every</label>{daySel(rem.lineupDay, (v) => set({ lineupDay: v }))}
            <label>at</label>
            <input type="time" value={rem.lineupTime} onChange={(e) => set({ lineupTime: e.target.value })} />
            <button
              className="btn sm"
              onClick={() => downloadICS("Set fantasy lineup — " + cfg.league, lineup, {
                rrule: "FREQ=WEEKLY;BYDAY=" + byDay[rem.lineupDay],
                desc: "Lock your lineup before games start.",
              })}
            >
              Add to calendar
            </button>
          </div>
        </div>

        <div className="rem">
          <div className="remhead">
            <span className="remtitle">Submit waiver claims</span>
            <span className="remcd mono" style={{ color: `var(--${urgencyFor(waiver)})` }}>{fmtCountdown(waiver)}</span>
          </div>
          <div className="remctl">
            <label>Every</label>{daySel(rem.waiverDay, (v) => set({ waiverDay: v }))}
            <label>at</label>
            <input type="time" value={rem.waiverTime} onChange={(e) => set({ waiverTime: e.target.value })} />
            <button
              className="btn sm"
              onClick={() => downloadICS("Submit waiver claims — " + cfg.league, waiver, {
                rrule: "FREQ=WEEKLY;BYDAY=" + byDay[rem.waiverDay],
                desc: "Get your waiver claims in before they process.",
              })}
            >
              Add to calendar
            </button>
          </div>
        </div>

        <div className="rem">
          <div className="remhead">
            <span className="remtitle">Trade deadline</span>
            <span className="remcd mono" style={{ color: trade ? `var(--${urgencyFor(trade)})` : "var(--muted2)" }}>{trade ? fmtCountdown(trade) : "not set"}</span>
          </div>
          <div className="remctl">
            <label>Date</label>
            <input type="date" value={rem.tradeDeadline} onChange={(e) => set({ tradeDeadline: e.target.value })} />
            {trade && (
              <button
                className="btn sm"
                onClick={() => downloadICS("Trade deadline — " + cfg.league, new Date(trade.getTime() - 24 * 3600000), {
                  desc: "Last day to make trades — get offers in now.",
                })}
              >
                Add to calendar
              </button>
            )}
          </div>
        </div>
      </div>

      <AnthropicWorkspaceCard />
    </div>
  );
}

/* ---------- Moves (start/sit + waivers) ---------- */

export default Reminders;
