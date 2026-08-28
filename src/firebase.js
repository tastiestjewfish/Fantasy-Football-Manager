import { initializeApp, getApps } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

let app;
let auth;
let db;
let workspaceId = "";

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
  );
}

function init() {
  if (!isFirebaseConfigured()) return null;
  if (!app) {
    app = getApps()[0] || initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    getRedirectResult(auth).catch(() => {});
  }
  return { app, auth, db };
}

export function getFirebase() {
  return init();
}

export function normalizeWorkspaceCode(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
}

export function getWorkspaceId() {
  return workspaceId;
}

export function setWorkspaceId(raw) {
  workspaceId = normalizeWorkspaceCode(raw);
  return workspaceId;
}

export function clearWorkspaceId() {
  workspaceId = "";
}

function lsKey(uid) {
  return "leaguehq:workspace:" + uid;
}

export function defaultWorkspacePrefill() {
  return normalizeWorkspaceCode(import.meta.env.VITE_FIREBASE_WORKSPACE_ID || "");
}

async function joinWorkspace(uid, code) {
  const ctx = init();
  if (!ctx || !uid || !code) return;
  await setDoc(doc(ctx.db, "workspaces", code, "members", uid), {
    uid,
    joinedAt: serverTimestamp(),
  }, { merge: true });
}

export async function loadRememberedWorkspace(uid) {
  if (!uid) return "";
  try {
    const local = localStorage.getItem(lsKey(uid));
    const fromLocal = setWorkspaceId(local || "");
    if (fromLocal) {
      try { await joinWorkspace(uid, fromLocal); } catch {}
      return fromLocal;
    }
  } catch {}
  const ctx = init();
  if (!ctx) return "";
  try {
    const snap = await getDoc(doc(ctx.db, "profiles", uid));
    const fromCloud = setWorkspaceId(snap.exists() ? snap.data().workspaceCode : "");
    if (fromCloud) {
      try { localStorage.setItem(lsKey(uid), fromCloud); } catch {}
      try { await joinWorkspace(uid, fromCloud); } catch {}
      return fromCloud;
    }
  } catch {}
  clearWorkspaceId();
  return "";
}

export async function saveWorkspace(uid, raw) {
  const code = normalizeWorkspaceCode(raw);
  if (code.length < 4) throw new Error("Use at least 4 letters or numbers.");
  setWorkspaceId(code);
  try { localStorage.setItem(lsKey(uid), code); } catch {}
  const ctx = init();
  if (ctx) {
    await setDoc(doc(ctx.db, "profiles", uid), {
      workspaceCode: code,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await joinWorkspace(uid, code);
  }
  return code;
}

export function subscribeAuth(callback) {
  const ctx = init();
  if (!ctx) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(ctx.auth, callback);
}

export async function signInWithGoogle() {
  const ctx = init();
  if (!ctx) throw new Error("Firebase is not configured.");
  try {
    await signInWithPopup(ctx.auth, googleProvider);
  } catch (err) {
    if (err?.code === "auth/popup-blocked" || err?.code === "auth/cancelled-popup-request") {
      await signInWithRedirect(ctx.auth, googleProvider);
      return;
    }
    throw err;
  }
}

export async function signOutUser() {
  clearWorkspaceId();
  const ctx = init();
  if (ctx) await signOut(ctx.auth);
}

export function authErrorMessage(err) {
  const code = err?.code || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/operation-not-allowed") return "Enable Google sign-in in Firebase Authentication → Sign-in method.";
  if (code === "auth/unauthorized-domain") return "Add this site to Firebase Authentication → Settings → Authorized domains.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection and try again.";
  return err?.message || "Sign-in failed. Try again.";
}
