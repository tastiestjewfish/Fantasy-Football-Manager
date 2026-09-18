import { apiFetch, errText, errFromApiBody } from "../api";
import storage, { loadKey, saveKey } from "./storage.js";

const MODEL_FAST = "claude-haiku-4-5";
const MODEL_SMART = "claude-sonnet-4-6";
const AI_INPUT_CHARS = 6000;
const AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let anthropicWorkspaceId = "";
function getAnthropicWorkspaceId() {
  return anthropicWorkspaceId;
}
function setAnthropicWorkspaceId(id) {
  const v = String(id || "").trim();
  anthropicWorkspaceId = v;
  if (v) storage.set("anthropic:workspaceId", v, false);
  else storage.delete("anthropic:workspaceId", false);
}
async function loadAnthropicWorkspaceId() {
  try {
    const rec = await storage.get("anthropic:workspaceId", false);
    if (rec && rec.value) {
      anthropicWorkspaceId = String(rec.value).trim();
      return anthropicWorkspaceId;
    }
  } catch {}
  return anthropicWorkspaceId;
}

let useWebSearch = true;
function getUseWebSearch() { return useWebSearch; }
function setUseWebSearch(on) {
  useWebSearch = !!on;
  storage.set("ai:webSearch", useWebSearch ? "1" : "0", false);
}
async function loadUseWebSearch() {
  try {
    const rec = await storage.get("ai:webSearch", false);
    if (rec && rec.value === "0") useWebSearch = false;
  } catch {}
  return useWebSearch;
}

function clipForAi(s, max = AI_INPUT_CHARS) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…[truncated]";
}
function aiWeekKey(clock) {
  if (!clock) return "unknown";
  return [clock.season || "", clock.seasonType || "", clock.week || 1].join(":");
}
async function loadAiAdvice(kind, key, storeKey) {
  const rec = await loadKey(storeKey || ("ai:" + kind), null, true);
  if (!rec || rec.key !== key || rec.value == null) return null;
  if (Date.now() - (rec.at || 0) > AI_CACHE_TTL_MS) return null;
  return rec;
}
async function saveAiAdvice(kind, key, value, storeKey) {
  await saveKey(storeKey || ("ai:" + kind), { key, at: Date.now(), value }, true);
}

async function callClaude(messages, extra = {}) {
  const workspaceId = getAnthropicWorkspaceId();
  const res = await apiFetch("/api/ai", {
    method: "POST",
    body: JSON.stringify({
      model: extra.model || MODEL_FAST,
      max_tokens: extra.max_tokens || 800,
      messages,
      ...extra,
      ...(workspaceId ? { workspaceId } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 || res.status === 404 || res.status === 502) {
      throw new Error(errFromApiBody(data, "Advisor is offline (API " + res.status + ")"));
    }
    throw new Error(errFromApiBody(data, "API " + res.status));
  }
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text) throw new Error(errFromApiBody(data, "Advisor returned an empty reply"));
  return text;
}
function advisorError(e) {
  const m = errText(e);
  if (/401|Sign in required|expired sign-in/i.test(m)) {
    return "The advisor didn't accept your sign-in. Refresh the page, then try Do this for me again.";
  }
  if (/anthropic-workspace-id/i.test(m)) {
    return "This Anthropic key is tied to a Claude workspace. Open https://console.anthropic.com/settings/workspaces — the ID column looks like wrkspc_01…. Paste that in Settings, or create an API key scoped to one workspace so you can skip the ID.";
  }
  if (/authentication_error|invalid x-api-key|ANTHROPIC_API_KEY/i.test(m)) {
    return "The Anthropic API key on the server is missing or invalid. In Google Cloud Secret Manager, open ANTHROPIC_API_KEY and add a new version with your sk-ant- key (don't create a new secret).";
  }
  if (/offline|403|404|502|Failed to fetch|NetworkError/i.test(m)) {
    return "The advisor isn't reachable right now. Roster tools still work.";
  }
  return m || "Couldn't reach the advisor.";
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("no json");
  // find the matching close brace, respecting strings
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const slice = end !== -1 ? clean.slice(start, end + 1) : clean.slice(start);
  try { return JSON.parse(slice); }
  catch (e) {
    if (end !== -1) throw e;
    // repair a truncated response: drop the trailing partial token, then close open structures in stack order
    let s = slice;
    if (inStr) s += '"';
    s = s.replace(/,\s*("[^"]*"\s*:?\s*)?[^,{}\[\]]*$/, "").replace(/,\s*$/, "");
    const st = []; let is = false, es = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (is) { if (es) es = false; else if (c === "\\") es = true; else if (c === '"') is = false; }
      else if (c === '"') is = true;
      else if (c === "{" || c === "[") st.push(c);
      else if (c === "}" || c === "]") st.pop();
    }
    for (let k = st.length - 1; k >= 0; k--) s += st[k] === "{" ? "}" : "]";
    return JSON.parse(s);
  }
}

/* ---------- weekly advice: Sonnet + optional web search ---------- */
async function callClaudeSearch(messages, extra = {}) {
  const opts = { model: MODEL_SMART, max_tokens: 2000, ...extra };
  if (!getUseWebSearch()) return callClaude(messages, opts);
  try {
    return await callClaude(messages, { tools: [{ type: "web_search_20250305", name: "web_search" }], ...opts });
  } catch (e) {
    const m = errText(e);
    if (/web.?search|tool.*not.*available|beta/i.test(m)) return callClaude(messages, opts);
    throw e;
  }
}

export {
  MODEL_FAST, MODEL_SMART, AI_INPUT_CHARS, AI_CACHE_TTL_MS,
  getAnthropicWorkspaceId, setAnthropicWorkspaceId, loadAnthropicWorkspaceId,
  getUseWebSearch, setUseWebSearch, loadUseWebSearch,
  clipForAi, aiWeekKey, loadAiAdvice, saveAiAdvice,
  callClaude, advisorError, extractJSON, callClaudeSearch,
};
