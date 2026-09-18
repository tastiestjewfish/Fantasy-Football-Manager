import React from "react";
import { fmtGeneratedAt } from "../lib/storage.js";

/** Single refresh control for the shared weekly plan. */
export default function WeeklyPlanBar({ plan, busy, onRefresh, show = true }) {
  if (!show && !plan && !busy) return null;
  return (
    <div className="airesbar">
      <div className="airesrow">
        <span className="eyebrow" style={{ margin: 0 }}>
          {busy && !plan
            ? "Building this week's plan…"
            : plan && plan.generatedAt
              ? "This week's plan · " + fmtGeneratedAt(plan.generatedAt)
                + (plan.source === "local" ? " · backup" : "")
              : "No plan yet"}
        </span>
        {onRefresh && (
          <button type="button" className="btn ghost sm" onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "↻ Refresh this week's plan"}
          </button>
        )}
      </div>
      {plan && plan.note ? (
        <div className="note" style={{ borderColor: "var(--soon)", marginTop: 8 }}>{plan.note}</div>
      ) : null}
    </div>
  );
}
