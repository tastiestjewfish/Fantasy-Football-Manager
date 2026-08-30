import { useEffect, useState } from "react";
import {
  authErrorMessage,
  defaultWorkspacePrefill,
  isFirebaseConfigured,
  loadRememberedWorkspace,
  normalizeWorkspaceCode,
  saveWorkspace,
  signInWithGoogle,
  signOutUser,
  subscribeAuth,
} from "./firebase";

const CSS = `
:root{
  --bg:#0E1622; --bg2:#080D15; --panel:#16202E; --panel2:#1B2838;
  --line:#26374A; --ink:#EAF1F8; --muted:#8595A6; --muted2:#5E6E80;
  --brand:#57E39A; --now:#FF4B3E;
  --sans:"Helvetica Neue",Arial,system-ui,sans-serif;
}
*{box-sizing:border-box}
.hq{background:var(--bg);color:var(--ink);font-family:var(--sans);min-height:100vh;
  -webkit-font-smoothing:antialiased}
.gate{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(900px 280px at 20% -10%,rgba(87,227,154,.10),transparent),var(--bg)}
.gatecard{background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:440px;width:100%;
  padding:28px 26px 24px;box-shadow:0 24px 64px rgba(0,0,0,.45)}
.gatelogo{font-weight:800;letter-spacing:-.02em;font-size:22px;display:flex;align-items:center;gap:9px;margin-bottom:18px}
.gatelogo .mk{width:24px;height:24px;border-radius:6px;background:var(--brand);display:inline-grid;place-items:center;
  color:#062012;font-weight:900;font-size:13px}
.gatecard h1{margin:0 0 8px;font-size:24px;letter-spacing:-.02em;font-weight:800}
.gatecard .lead{color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 22px}
.gbtn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f1f1f;
  border:0;border-radius:10px;font-weight:700;font-size:14px;padding:12px 15px;cursor:pointer;font-family:inherit}
.gbtn:hover{filter:brightness(.97)}
.gbtn:disabled{opacity:.6;cursor:default}
.btn{background:var(--brand);color:#062012;border:0;border-radius:10px;font-weight:800;font-size:13px;padding:10px 15px;
  letter-spacing:.01em;cursor:pointer;font-family:inherit;width:100%}
.btn:hover{filter:brightness(1.05)}
.btn:disabled{opacity:.5;cursor:default}
.field{margin-bottom:14px}
.field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  font-weight:700;margin-bottom:5px}
.field input{width:100%;background:var(--panel2);color:var(--ink);border:1px solid var(--line);
  border-radius:9px;padding:10px 11px;font-size:14px;font-family:inherit}
.note{font-size:12px;color:var(--muted);line-height:1.55;background:var(--panel2);border:1px solid var(--line);
  border-radius:10px;padding:12px;margin:0 0 16px}
.err{color:var(--now);font-size:13px;margin:0 0 14px;line-height:1.45}
.hint{font-size:12px;color:var(--muted2);margin-top:6px}
.muted{color:var(--muted);font-size:14px}
`;

function Shell({ children }) {
  return (
    <div className="hq">
      <style>{CSS}</style>
      <div className="gate">
        <div className="gatecard">
          <div className="gatelogo"><span className="mk">HQ</span> League HQ</div>
          {children}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.6 7.3l6.3 5.2C38.2 37.2 44 31.5 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

export default function AuthGate({ children }) {
  const [user, setUser] = useState(undefined);
  const [workspace, setWorkspace] = useState("");
  const [checkingWorkspace, setCheckingWorkspace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState(defaultWorkspacePrefill());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const yahooCode = params.get("code");
    const yahooErr = params.get("error");
    if (!yahooCode && !yahooErr) return;
    const clean = () => {
      try { window.history.replaceState({}, "", window.location.pathname); } catch {}
    };
    if (yahooErr) {
      setError("Yahoo: " + (params.get("error_description") || yahooErr));
      clean();
      return;
    }
    fetch("/api/yahoo/callback?code=" + encodeURIComponent(yahooCode) + "&format=json", {
      headers: { Accept: "application/json" },
    }).then(async (res) => {
      const text = await res.text();
      if (!res.ok) throw new Error(text.replace(/<[^>]+>/g, " ").slice(0, 180));
      setError("");
    }).catch((err) => {
      setError("Yahoo connect failed. " + (err?.message || "Try Connect Yahoo again from League → Teams."));
    }).finally(clean);
  }, []);

  useEffect(() => {
    return subscribeAuth((next) => {
      setUser(next);
      setError("");
      if (!next) {
        setWorkspace("");
        setCheckingWorkspace(false);
        return;
      }
      setCheckingWorkspace(true);
      loadRememberedWorkspace(next.uid).then((saved) => {
        setWorkspace(saved);
        if (saved) setCode(saved);
        setCheckingWorkspace(false);
      });
    });
  }, []);

  const onGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onWorkspace = async (e) => {
    e.preventDefault();
    if (!user) return;
    setError("");
    setBusy(true);
    try {
      const saved = await saveWorkspace(user.uid, code);
      setWorkspace(saved);
    } catch (err) {
      setError(err?.message || "Could not save workspace code.");
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    setBusy(true);
    try {
      await signOutUser();
      setWorkspace("");
    } catch (err) {
      setError(err?.message || "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!isFirebaseConfigured()) {
    return (
      <Shell>
        <h1>Firebase isn’t configured</h1>
        <p className="lead">Add your Firebase keys to <b>.env.local</b> and restart the dev server. Then enable Google sign-in in Firebase Authentication.</p>
      </Shell>
    );
  }

  if (user === undefined || (user && checkingWorkspace)) {
    return (
      <Shell>
        <p className="muted">Loading League HQ…</p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <h1>Sign in</h1>
        <p className="lead">Use your Google account to open League HQ. Co-managers each sign in, then enter the same workspace code to share leagues.</p>
        {error ? <p className="err">{error}</p> : null}
        <button type="button" className="gbtn" onClick={onGoogle} disabled={busy}>
          <GoogleIcon />
          {busy ? "Signing in…" : "Continue with Google"}
        </button>
      </Shell>
    );
  }

  if (!workspace) {
    const preview = normalizeWorkspaceCode(code);
    return (
      <Shell>
        <h1>Workspace code</h1>
        <p className="lead">Co-managers type the <b>same code</b> so you share leagues, rosters, and reminders. Pick something only you two know.</p>
        <form onSubmit={onWorkspace}>
          {error ? <p className="err">{error}</p> : null}
          <div className="field">
            <label htmlFor="workspace-code">Workspace code</label>
            <input
              id="workspace-code"
              autoComplete="off"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. hawks-2026"
            />
            {preview.length >= 4 ? <div className="hint">You’ll join: {preview}</div> : <div className="hint">At least 4 letters or numbers.</div>}
          </div>
          <p className="note">This code is remembered on this device and with your Google account, so you won’t have to enter it every time.</p>
          <button type="submit" className="btn" disabled={busy || preview.length < 4}>
            {busy ? "Saving…" : "Enter workspace"}
          </button>
        </form>
      </Shell>
    );
  }

  return children({ user, workspace, signOut: onSignOut });
}
