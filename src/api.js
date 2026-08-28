import { getFirebase } from "./firebase";

/** Pull a human string out of Error / Anthropic `{error:{message}}` / leftover objects. */
export function errText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v === "[object Object]" ? "" : v;
  if (v instanceof Error) return errText(v.message) || v.message || "";
  if (typeof v === "object") {
    if (typeof v.message === "string") return v.message;
    if (v.error != null) return errText(v.error);
    try {
      const s = JSON.stringify(v);
      return s && s !== "{}" ? s : "";
    } catch {
      return "";
    }
  }
  return String(v);
}

export function errFromApiBody(data, fallback) {
  return errText(data && (data.error || data.message)) || fallback || "Request failed";
}

async function authHeaders(extra = {}) {
  const headers = { ...extra };
  const user = getFirebase()?.auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    // Cloud Run treats Authorization: Bearer as a Google token and returns 401.
    // Send the Firebase ID token on a custom header instead.
    headers["X-Firebase-ID-Token"] = token;
  }
  return headers;
}

/** Same-origin fetch to /api/... with the signed-in user's ID token. */
export async function apiFetch(path, opts = {}) {
  const headers = await authHeaders(opts.headers || {});
  if (opts.body != null && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(path, { ...opts, headers });
}

export async function apiJson(path, opts = {}) {
  const res = await apiFetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errFromApiBody(data, "HTTP " + res.status));
  return data;
}
