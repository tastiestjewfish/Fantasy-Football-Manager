import storage from "../storage";
import { fmtGeneratedAt } from "./format.js";

async function loadKey(key, fallback, shared = true) {
  try { const r = await storage.get(key, shared); return r ? JSON.parse(r.value) : fallback; }
  catch { return fallback; }
}
async function saveKey(key, value, shared = true) {
  try { await storage.set(key, JSON.stringify(value), shared); } catch {}
}

/* ---------- Persistent AI results (per-user; never TTL-expire) ---------- */
const AI_RESULT_KEYS = [
  "ai:home", "ai:lineup", "ai:startsit", "ai:waivers", "ai:trades",
  "ai:respond", "ai:build", "ai:matchup", "ai:draft",
];
const aiResultBoot = Object.create(null);

async function loadAiResult(key) {
  const rec = await loadKey(key, null, false);
  if (!rec || typeof rec !== "object" || rec.data === undefined || rec.data === null) return null;
  return { data: rec.data, at: rec.at || 0 };
}

async function saveAiResult(key, data) {
  const at = Date.now();
  await saveKey(key, { data, at }, false);
  return at;
}

async function preloadAiResults() {
  await Promise.all(AI_RESULT_KEYS.map(async (key) => {
    try { aiResultBoot[key] = await loadAiResult(key); }
    catch { aiResultBoot[key] = null; }
  }));
}

export {
  loadKey, saveKey,
  AI_RESULT_KEYS, aiResultBoot,
  loadAiResult, saveAiResult, preloadAiResults,
  fmtGeneratedAt,
};
