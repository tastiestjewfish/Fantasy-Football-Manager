import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase, getWorkspaceId } from "./firebase";

/**
 * Drop-in replacement for the sandbox `window.storage` API:
 *   get(key, shared)    -> { key, value, timestamp } | null
 *   set(key, value, shared)
 *   delete(key, shared)
 *   list(prefix, shared) -> { keys: [{ key, value, timestamp }, ...] }
 *
 * shared === true  -> workspaces/{id}/shared/{key}
 * shared === false -> workspaces/{id}/users/{uid}/kv/{key}
 *
 * Reads/writes no-op until Google sign-in and a workspace code are set.
 */

function encodeKey(key) {
  return encodeURIComponent(String(key));
}

function kvCollection(db, workspace, shared, uid) {
  if (shared) return collection(db, "workspaces", workspace, "shared");
  return collection(db, "workspaces", workspace, "users", uid, "kv");
}

function kvDoc(db, workspace, key, shared, uid) {
  return doc(kvCollection(db, workspace, shared, uid), encodeKey(key));
}

function record(key, data) {
  return {
    key,
    value: data.value ?? "",
    timestamp: data.updatedAt?.toMillis?.() ?? 0,
  };
}

function withStore(shared) {
  const ctx = getFirebase();
  const workspace = getWorkspaceId();
  const user = ctx?.auth.currentUser;
  if (!ctx || !workspace || !user) return null;
  return { db: ctx.db, uid: user.uid, workspace, shared: shared !== false };
}

export async function get(key, shared = true) {
  const store = withStore(shared);
  if (!store) return null;
  const snap = await getDoc(kvDoc(store.db, store.workspace, key, store.shared, store.uid));
  if (!snap.exists()) return null;
  return record(key, snap.data());
}

export async function set(key, value, shared = true) {
  const store = withStore(shared);
  if (!store) return;
  await setDoc(kvDoc(store.db, store.workspace, key, store.shared, store.uid), {
    key: String(key),
    value: String(value),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteKey(key, shared = true) {
  const store = withStore(shared);
  if (!store) return;
  await deleteDoc(kvDoc(store.db, store.workspace, key, store.shared, store.uid));
}

export async function list(prefix = "", shared = true) {
  const store = withStore(shared);
  if (!store) return { keys: [] };
  const snap = await getDocs(kvCollection(store.db, store.workspace, store.shared, store.uid));
  const out = [];
  snap.forEach((d) => {
    const data = d.data();
    const key = data.key || decodeURIComponent(d.id);
    if (!prefix || String(key).startsWith(prefix)) out.push(record(key, data));
  });
  return { keys: out };
}

const storage = {
  get,
  set,
  delete: deleteKey,
  list,
};

export default storage;
