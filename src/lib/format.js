function fmtGeneratedAt(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "";
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function nextWeekly(weekday, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0 && d <= now) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}
function fmtCountdown(target) {
  if (!target) return "—";
  let s = Math.floor((target - new Date()) / 1000);
  if (s < 0) return "00:00:00";
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (n) => String(n).padStart(2, "0");
  return (d > 0 ? `${d}d ` : "") + `${p(h)}:${p(m)}:${p(s)}`;
}
function urgencyFor(target) {
  if (!target) return "go";
  const hrs = (target - new Date()) / 3600000;
  if (hrs <= 3) return "now";
  if (hrs <= 24) return "soon";
  return "go";
}
function computeDeadlines(rem) {
  const lineupNext = nextWeekly(rem.lineupDay, rem.lineupTime);
  const waiverNext = nextWeekly(rem.waiverDay, rem.waiverTime);
  const tradeNext = rem.tradeDeadline ? new Date(rem.tradeDeadline + "T12:00:00") : null;
  return [
    { key: "lineup", label: "Set your lineup", when: lineupNext },
    { key: "waiver", label: "Submit waiver claims", when: waiverNext },
    ...(tradeNext && tradeNext > new Date() ? [{ key: "trade", label: "Trade deadline", when: tradeNext }] : []),
  ].sort((a, b) => a.when - b.when);
}

/* ---------- ICS calendar export ---------- */
function pad(n){return String(n).padStart(2,"0")}
function toICSDate(d){
  return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+"T"+
    pad(d.getUTCHours())+pad(d.getUTCMinutes())+"00Z";
}
function downloadICS(title, start, opts = {}) {
  const uid = title.replace(/\s+/g,"-").toLowerCase()+"-"+Date.now()+"@leaguehq";
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//League HQ//EN","CALSCALE:GREGORIAN",
    "BEGIN:VEVENT","UID:"+uid,"DTSTAMP:"+toICSDate(new Date()),
    "DTSTART:"+toICSDate(start),
    "DTEND:"+toICSDate(new Date(start.getTime()+30*60000)),
    "SUMMARY:"+title,
    "DESCRIPTION:"+(opts.desc||"League HQ reminder"),
  ];
  if (opts.rrule) lines.push("RRULE:"+opts.rrule);
  lines.push("BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+title,"TRIGGER:-PT0M","END:VALARM");
  lines.push("END:VEVENT","END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = title.replace(/\s+/g,"-").toLowerCase()+".ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmtRefreshAgo(ts) {
  if (!ts) return "";
  const sec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (sec < 45) return "Updated just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return "Updated " + min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return "Updated " + hr + "h ago";
  return "Updated " + Math.floor(hr / 24) + "d ago";
}

function copyText(t) { try { if (navigator.clipboard) navigator.clipboard.writeText(t); } catch {} }

export {
  fmtGeneratedAt,
  DAYS, nextWeekly, fmtCountdown, urgencyFor, computeDeadlines,
  downloadICS,
  fmtRefreshAgo, copyText,
};
