import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirebase } from "./firebase";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_KEY = "leaguehq:gmailToken";

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

function gmailQuery(sources) {
  const parts = ["newer_than:21d"];
  const or = [];
  splitList(sources?.senders).forEach((s) => or.push("from:" + s));
  splitList(sources?.people).forEach((s) => or.push("{" + s + "}"));
  splitList(sources?.keywords).forEach((s) => or.push(s.includes(" ") ? `"${s}"` : s));
  splitList(sources?.labels).forEach((s) => parts.push("label:" + s.replace(/\s+/g, "-")));
  if (or.length) parts.push("(" + or.join(" OR ") + ")");
  else parts.push("(sleeper OR fantasy OR waiver OR trade OR lineup OR commissioner)");
  return parts.join(" ");
}

function headerVal(headers, name) {
  const hit = (headers || []).find((h) => String(h.name || "").toLowerCase() === name.toLowerCase());
  return hit ? hit.value : "";
}

export async function fetchGmailMessages(sources) {
  let token;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch { token = ""; }
  if (!token) token = await connectGmail();

  const headers = { Authorization: "Bearer " + token };
  const q = encodeURIComponent(gmailQuery(sources));
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=12&q=" + q,
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
  const ids = (list.messages || []).map((m) => m.id).slice(0, 10);
  const messages = await Promise.all(ids.map(async (id) => {
    const r = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id +
        "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date",
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
    };
  }));
  return messages.filter(Boolean);
}

export function messagesToDump(messages) {
  return (messages || []).map((m) =>
    `From: ${m.from || ""}\nSubject: ${m.subject || ""}\n${m.snippet || m.body || ""}`
  ).join("\n---\n");
}

export function triageLocal(messages) {
  return (messages || []).map((m) => {
    const hay = `${m.from} ${m.subject} ${m.snippet || m.body || ""}`.toLowerCase();
    let category = "league";
    let urgency = "fyi";
    if (/trade/.test(hay)) { category = "trade"; urgency = "now"; }
    else if (/waiver|deadline|lock/.test(hay)) { category = "waiver"; urgency = "soon"; }
    else if (/injur|questionable|inactive|out for|doubtful/.test(hay)) { category = "injury"; urgency = "soon"; }
    else if (/draft/.test(hay)) { category = "draft"; urgency = "soon"; }
    return {
      from: m.from || "",
      subject: m.subject || "",
      category,
      urgency,
      summary: m.subject || m.snippet || "League email",
      action: urgency === "now" ? "Open this and respond today." : "",
      deadline: "",
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
      return { from, subject, snippet: c };
    });
  }
  return [{ from: "", subject: "", snippet: text, body: text }];
}
