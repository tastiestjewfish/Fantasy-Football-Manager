import { getFirebase } from "./firebase";

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
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
