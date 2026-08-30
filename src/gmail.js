import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirebase } from "./firebase";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_KEY = "leaguehq:gmailToken";

const PLATFORM_SENDERS = [
  "noreply@sleeper.app",
  "sleeper.app",
  "fantasy@email.espn.com",
  "email.espn.com",
  "noreply@fantasy.yahoo.com",
  "comms.yahoo.com",
  "fantasy.yahoo.com",
];

const MAIL_NOISE = /oauth|unused client|google developers|accounts\.google|security alert|password reset|verify your email|invoice|receipt|shipping|order confirmation|newsletter|unsubscribe|promo code/i;
const MAIL_SIGNAL = /sleeper|espn|yahoo fantasy|fantasy football|commissioner|waiver|trade offer|trade proposed|lineup|draft|injury|questionable|inactive|doubtful|suspension|faab|free agent|commish|league/i;

export function hasGmailToken() {
  try {
    return Boolean(sessionStorage.getItem(TOKEN_KEY));
  } catch {
    return false;
  }
}

export async function connectGmail() {
  const ctx = getFirebase();
  if (!ctx?.auth?.currentUser) throw new Error("Sign in with Google first.");
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_SCOPE);
  provider.setCustomParameters({
    prompt: "consent",
    login_hint: ctx.auth.currentUser.email || "",
  });
  const result = await signInWithPopup(ctx.auth, provider);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  const token = cred?.accessToken;
  if (!token) throw new Error("Google didn’t grant Gmail access. Try again, or paste emails below.");
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
  return token;
}

function splitList(raw) {
  return String(raw || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function quotePhrase(s) {
  const t = String(s || "").replace(/"/g, "").trim();
  return t.includes(" ") ? `"${t}"` : t;
}

export function buildGmailQuery(sources, cfg) {
  const parts = ["newer_than:14d", "-category:promotions", "-category:social"];
  const clauses = [];
  const froms = new Set(PLATFORM_SENDERS);
  splitList(sources?.senders).forEach((s) => froms.add(s.replace(/^from:/i, "")));
  froms.forEach((s) => clauses.push("from:" + s));

  const league = String(cfg?.league || "").trim();
  if (league && !/^fantasy league #\d+$/i.test(league)) {
    clauses.push("subject:" + quotePhrase(league));
    clauses.push(quotePhrase(league));
  }

  splitList(sources?.people).forEach((p) => {
    if (p.includes("@")) clauses.push("from:" + p);
    else clauses.push("(" + quotePhrase(p) + " (fantasy OR sleeper OR espn OR yahoo OR commissioner OR waiver OR trade))");
  });

  splitList(sources?.labels).forEach((s) => parts.push("label:" + s.replace(/\s+/g, "-")));
  parts.push("(" + clauses.join(" OR ") + ")");
  return parts.join(" ");
}

function headerVal(headers, name) {
  const hit = (headers || []).find((h) => String(h.name || "").toLowerCase() === name.toLowerCase());
  return hit ? hit.value : "";
}

function decodeB64Url(raw) {
  try {
    const pad = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad);
    try {
      return decodeURIComponent(Array.from(bin, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    } catch {
      return bin;
    }
  } catch {
    return "";
  }
}

function textFromPayload(payload) {
  if (!payload) return "";
  const walk = (p) => {
    if (!p) return "";
    if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data);
    if (p.parts) return p.parts.map(walk).filter(Boolean).join("\n");
    return "";
  };
  let t = walk(payload);
  if (!t && payload.body?.data) t = decodeB64Url(payload.body.data);
  return t.replace(/\s+/g, " ").trim().slice(0, 700);
}

export function isLeagueMail(message, cfg) {
  const hay = [message?.from, message?.subject, message?.snippet, message?.body].filter(Boolean).join(" ");
  if (!hay.trim()) return false;
  if (MAIL_NOISE.test(hay)) return false;
  if (MAIL_SIGNAL.test(hay)) return true;
  const league = String(cfg?.league || "").trim().toLowerCase();
  if (league && league.length > 3 && !/^fantasy league #\d+$/i.test(league) && hay.toLowerCase().includes(league)) return true;
  const from = String(message?.from || "").toLowerCase();
  return PLATFORM_SENDERS.some((s) => from.includes(s.toLowerCase()));
}

export function isNoiseIntel(item) {
  const hay = [item?.summary, item?.subject, item?.from, item?.action].filter(Boolean).join(" ");
  return MAIL_NOISE.test(hay);
}

export async function fetchGmailMessages(sources, cfg) {
  let token;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch { token = ""; }
  if (!token) token = await connectGmail();

  const headers = { Authorization: "Bearer " + token };
  const q = encodeURIComponent(buildGmailQuery(sources, cfg));
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=" + q,
    { headers }
  );
  if (listRes.status === 401) {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    throw new Error("Gmail permission expired. Click Connect Gmail and scan again.");
  }
  if (listRes.status === 403) {
    const err = await listRes.json().catch(() => ({}));
    const msg = err?.error?.message || "";
    if (/API has not been used|access not configured|disabled/i.test(msg)) {
      throw new Error("Gmail API isn’t enabled yet. Paste emails below, or turn on Gmail API at console.cloud.google.com → APIs → Gmail API (project fantasy-football-manager-210cc).");
    }
    throw new Error(msg || "Gmail access was denied. Paste emails below, or add this account as a test user in Google Cloud → OAuth consent.");
  }
  if (!listRes.ok) throw new Error("Gmail HTTP " + listRes.status);

  const list = await listRes.json();
  const ids = (list.messages || []).map((m) => m.id).slice(0, 12);
  const messages = await Promise.all(ids.map(async (id) => {
    const r = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "?format=full",
      { headers }
    );
    if (!r.ok) return null;
    const m = await r.json();
    const hs = m.payload?.headers || [];
    return {
      from: headerVal(hs, "From"),
      subject: headerVal(hs, "Subject"),
      date: headerVal(hs, "Date"),
      snippet: m.snippet || "",
      body: textFromPayload(m.payload),
    };
  }));
  return messages.filter(Boolean).filter((m) => isLeagueMail(m, cfg)).slice(0, 8);
}

export function messagesToDump(messages) {
  return (messages || []).map((m) =>
    `From: ${m.from || ""}\nSubject: ${m.subject || ""}\n${m.body || m.snippet || ""}`
  ).join("\n---\n");
}

export function triageLocal(messages, cfg) {
  return (messages || []).filter((m) => isLeagueMail(m, cfg)).map((m) => {
    const hay = `${m.from} ${m.subject} ${m.snippet || m.body || ""}`.toLowerCase();
    let category = "league";
    let urgency = "fyi";
    if (/trade/.test(hay)) { category = "trade"; urgency = "now"; }
    else if (/waiver|deadline|lock|faab/.test(hay)) { category = "waiver"; urgency = "soon"; }
    else if (/injur|questionable|inactive|out for|doubtful|suspension/.test(hay)) { category = "injury"; urgency = "soon"; }
    else if (/draft/.test(hay)) { category = "draft"; urgency = "soon"; }
    else if (/lineup|start|sit/.test(hay)) { category = "lineup"; urgency = "soon"; }
    return {
      category,
      urgency,
      summary: m.snippet || m.subject || "League update",
      action: urgency === "now" ? "Act on this before it expires." : "Check whether this changes your lineup or waivers.",
      deadline: "",
      player: "",
    };
  });
}

export function parsePastedMail(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const chunks = text.split(/\n---\n|\n\n(?=From:)/).map((c) => c.trim()).filter(Boolean);
  if (chunks.length > 1) {
    return chunks.map((c) => {
      const from = (c.match(/^From:\s*(.+)$/im) || [])[1] || "";
      const subject = (c.match(/^Subject:\s*(.+)$/im) || [])[1] || "";
      return { from, subject, snippet: c, body: c };
    });
  }
  return [{ from: "", subject: "", snippet: text, body: text }];
}
