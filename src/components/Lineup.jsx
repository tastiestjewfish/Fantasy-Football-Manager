import React, { useState, useEffect, useRef } from "react";
import { getMyStarters, getNflPlayers } from "../sleeper";
import { apiFetch, errFromApiBody } from "../api";
import { activeRoster, optimizeLineup, defaultSlots, FALLBACK_NOTE } from "../lib/lineup.js";
import { fmtGeneratedAt, copyText } from "../lib/format.js";
import { saveAiResult } from "../lib/storage.js";
import { AiResultBar, DoMe, useAiResult } from "./shared.jsx";


/* ---------- Lineup optimizer ---------- */
function Lineup({ cfg, board, members, slots, setSlots, saved, setSaved }) {
  const roster = activeRoster(members, board);
  const ai = useAiResult("ai:lineup");
  const platform = cfg.platform || "Sleeper";
  const isSleeper = platform === "Sleeper";
  const isYahoo = platform === "Yahoo";

  const [assign, setAssign] = useState(() => {
    if (ai.data && Array.isArray(ai.data.assign) && ai.data.assign.length === slots.length) return ai.data.assign;
    if (saved && Array.isArray(saved.assign) && saved.assign.length === slots.length) return saved.assign;
    return slots.map(() => null);
  });
  const [meta, setMeta] = useState(() => (ai.data && ai.data.meta) || (saved && saved.meta) || null);
  const [err, setErr] = useState("");
  const [submitted, setSubmitted] = useState(!!(saved && saved.submitted));
  const [editSlots, setEditSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [subMsg, setSubMsg] = useState("");
  const [subErr, setSubErr] = useState("");
  const [current, setCurrent] = useState(() => (ai.data && Array.isArray(ai.data.current) ? ai.data.current : null));
  const [currentAt, setCurrentAt] = useState(() => (ai.data && ai.data.currentAt) || null);
  const [currentOk, setCurrentOk] = useState(() => (ai.data ? !!ai.data.currentOk : false));
  const [currentBusy, setCurrentBusy] = useState(false);
  const hydratedRef = useRef(false);
  const readRanRef = useRef(false);
  const genRanRef = useRef(false);

  const meMember = (members || []).find((m) => m.mine);
  const canYahoo = isYahoo && meMember && meMember.teamKey && roster.some((p) => p.playerKey);

  useEffect(() => {
    if (!ai.hydrated || hydratedRef.current) return;
    hydratedRef.current = true;
    if (ai.data && Array.isArray(ai.data.assign)) {
      setAssign(ai.data.assign);
      if (ai.data.meta) setMeta(ai.data.meta);
    }
    if (ai.data && Array.isArray(ai.data.current)) {
      setCurrent(ai.data.current);
      setCurrentAt(ai.data.currentAt || null);
      setCurrentOk(!!ai.data.currentOk);
    }
  }, [ai.hydrated, ai.data]);

  const persistBundle = async (patch) => {
    const next = {
      assign: patch.assign !== undefined ? patch.assign : assign,
      meta: patch.meta !== undefined ? patch.meta : meta,
      current: patch.current !== undefined ? patch.current : current,
      currentAt: patch.currentAt !== undefined ? patch.currentAt : currentAt,
      currentOk: patch.currentOk !== undefined ? patch.currentOk : currentOk,
    };
    await ai.succeed(next);
    return next;
  };

  const resolveStarterRow = (pid, playersPool) => {
    const id = String(pid);
    const fromRoster = roster.find((p) => p.player_id != null && String(p.player_id) === id);
    if (fromRoster) return { name: fromRoster.name, pos: fromRoster.pos || "", playerId: id };
    const p = playersPool && playersPool[id];
    if (p) {
      const name = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || id;
      return { name, pos: p.position || "", playerId: id };
    }
    return { name: id, pos: "", playerId: id };
  };

  const readLiveStarters = async () => {
    setCurrentBusy(true);
    try {
      if (isSleeper && cfg.leagueId && meMember && meMember.rosterId != null) {
        const ids = await getMyStarters(cfg.leagueId, meMember.rosterId);
        if (!ids) {
          setCurrentOk(false);
          if (currentAt) {
            /* keep last good read */
          } else {
            setCurrent(slots.map(() => null));
          }
          setCurrentBusy(false);
          return null;
        }
        const pool = await getNflPlayers();
        const resolved = ids.map((pid) => resolveStarterRow(pid, pool));
        const bySlot = slots.map((_, i) => resolved[i] || null);
        const at = Date.now();
        setCurrent(bySlot);
        setCurrentAt(at);
        setCurrentOk(true);
        setCurrentBusy(false);
        return { current: bySlot, currentAt: at, currentOk: true };
      }
      if (isYahoo) {
        const at = Date.now();
        const unavailable = slots.map(() => ({ name: "unavailable — set in Yahoo", pos: "", playerId: "", unavailable: true }));
        setCurrent(unavailable);
        setCurrentAt(at);
        setCurrentOk(false);
        setCurrentBusy(false);
        return { current: unavailable, currentAt: at, currentOk: false };
      }
      setCurrent(slots.map(() => null));
      setCurrentOk(false);
      setCurrentBusy(false);
      return null;
    } catch {
      setCurrentOk(false);
      setCurrentBusy(false);
      return null;
    }
  };

  const applySuggestion = (names, nextMeta) => {
    setAssign(names);
    setMeta(nextMeta);
  };

  const generate = async (opts = {}) => {
    if (!roster.length) {
      setErr("Set your roster first — import your league and mark your team in the League tab, or draft in Draft Room.");
      return;
    }
    const hadPrior = !!(ai.data && ai.data.assign);
    ai.begin();
    setErr(""); setSubmitted(false);
    let live = null;
    if (!opts.skipRead) live = await readLiveStarters();
    const currentRows = (live && live.current) || current;

    try {
      const result = await optimizeLineup({
        roster,
        slots,
        currentStarters: currentRows,
        scoring: cfg.scoring,
        useAi: !opts.forceLocal,
      });
      applySuggestion(result.assign, result.meta);
      await persistBundle({
        assign: result.assign,
        meta: {
          ...result.meta,
          changeCount: result.changeCount,
          source: result.source,
          note: result.note,
        },
        ...(live || {}),
      });
      if (result.note && !opts.silent) setErr(result.note);
      else setErr("");
    } catch (e) {
      if (hadPrior && !opts.forceLocal) {
        ai.failKeep();
        setErr((e && e.message) || "Couldn't build a lineup.");
      } else {
        try {
          const result = await optimizeLineup({
            roster,
            slots,
            currentStarters: currentRows,
            scoring: cfg.scoring,
            useAi: false,
          });
          applySuggestion(result.assign, result.meta);
          await persistBundle({
            assign: result.assign,
            meta: { ...result.meta, changeCount: result.changeCount, source: "local", note: FALLBACK_NOTE },
            ...(live || {}),
          });
          if (!opts.silent) setErr(FALLBACK_NOTE);
        } catch (e2) {
          ai.end();
          if (!opts.silent) setErr((e2 && e2.message) || FALLBACK_NOTE);
        }
      }
    }
  };

  useEffect(() => {
    if (!ai.hydrated || readRanRef.current) return;
    readRanRef.current = true;
    (async () => {
      const live = await readLiveStarters();
      if (live && (ai.data && ai.data.assign)) {
        await saveAiResult("ai:lineup", {
          ...ai.data,
          ...live,
          assign: ai.data.assign,
          meta: ai.data.meta,
        });
      }
      if (!(ai.data && ai.data.assign) && roster.length && !genRanRef.current) {
        genRanRef.current = true;
        await generate({ skipRead: true, forceLocal: true, silent: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.hydrated, cfg.leagueId, meMember && meMember.rosterId, platform]);

  const removeSlot = (i) => { setSlots(slots.filter((_, j) => j !== i)); setAssign(assign.filter((_, j) => j !== i)); setCurrent((c) => (c ? c.filter((_, j) => j !== i) : c)); };
  const addSlot = (pos) => {
    if (!pos) return;
    setSlots([...slots, pos]);
    setAssign([...assign, null]);
    setCurrent((c) => (c ? [...c, null] : c));
  };
  const resetSlots = () => {
    const d = defaultSlots(cfg.format);
    setSlots(d);
    setAssign(d.map(() => null));
    setCurrent(null);
  };

  const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const changeCount = slots.reduce((n, s, i) => {
    const sug = assign[i];
    if (!sug) return n;
    const cur = current && current[i] ? current[i].name : null;
    if (!cur || current[i].unavailable) return n; // can't compare
    return nameEq(cur, sug) ? n : n + 1;
  }, 0);
  const hasSuggestions = assign.some(Boolean);
  const comparable = current && currentOk && current.some((c) => c && c.name && !c.unavailable);
  const summaryLine = !hasSuggestions
    ? "Tap Do this for me to get suggestions."
    : !comparable
      ? (changeCount === 0 && hasSuggestions ? "Suggestions ready — we couldn't compare to your live lineup." : "Suggestions ready.")
      : changeCount === 0
        ? "You're set — no changes needed."
        : changeCount + " change" + (changeCount === 1 ? "" : "s") + " to make.";

  const lineupText = "Lineup — " + cfg.league + "\n" + slots.map((s, i) => {
    const sug = assign[i] || "—";
    const cur = current && current[i] && current[i].name ? current[i].name : "—";
    return `${s}: now ${cur} → ${sug}`;
  }).join("\n");

  const finalize = () => { setSaved({ assign, meta, submitted: true, at: Date.now() }); setSubmitted(true); };

  const submitYahoo = async () => {
    if (!canYahoo) return;
    const nameToKey = {}; roster.forEach((p) => { if (p.playerKey) nameToKey[p.name] = p.playerKey; });
    const starters = slots.map((s, i) => (assign[i] && nameToKey[assign[i]]) ? { playerKey: nameToKey[assign[i]], slot: s } : null).filter(Boolean);
    const benchP = roster.filter((p) => !assign.includes(p.name) && p.playerKey).map((p) => ({ playerKey: p.playerKey, slot: "BN" }));
    setSubmitting(true); setSubErr(""); setSubMsg("");
    try {
      const r = await apiFetch("/api/yahoo/roster", {
        method: "POST",
        body: JSON.stringify({ teamKey: meMember.teamKey, players: [...starters, ...benchP] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(errFromApiBody(j, "HTTP " + r.status));
      setSubMsg("Submitted to Yahoo" + (j.week ? " for week " + j.week : "") + ".");
      setSaved({ assign, meta, submitted: true, at: Date.now() }); setSubmitted(true);
    } catch (e) { setSubErr("Couldn't submit to Yahoo: " + e.message + ". Check that your Yahoo app has write access and you're connected."); }
    setSubmitting(false);
  };

  const refreshAll = () => generate({ skipRead: false });

  const readStamp = currentAt
    ? (isSleeper
      ? (currentOk ? "Read from Sleeper: " : "Couldn't read Sleeper — last read: ") + fmtGeneratedAt(currentAt)
      : isYahoo
        ? "Yahoo live starters unavailable — set in Yahoo"
        : "Lineup read: " + fmtGeneratedAt(currentAt))
    : (currentBusy ? "Reading your lineup…" : null);

  return (
    <div>
      <div className="card">
        <div className="cardhead">
          <h3>Lineup</h3>
          <DoMe onClick={refreshAll} busy={ai.busy || currentBusy} working="Checking…" label="Do this for me" />
        </div>
        <div className="v" style={{ marginBottom: 8 }}>{summaryLine}</div>
        <AiResultBar at={ai.at} busy={ai.busy} refreshFail={ai.refreshFail} onRefresh={hasSuggestions ? refreshAll : null} show={!!(ai.at || hasSuggestions)} />
        {readStamp && <div className="eyebrow" style={{ margin: "4px 0 10px" }}>{readStamp}</div>}
        {err && <div className="note" style={{ borderColor: err === FALLBACK_NOTE ? "var(--soon)" : "var(--now)" }}>{err}</div>}
        {meta && meta.note && err !== meta.note && (
          <div className="note" style={{ borderColor: "var(--soon)" }}>{meta.note}</div>
        )}
        {!currentOk && isSleeper && hasSuggestions && (
          <div className="empty" style={{ paddingTop: 0 }}>Couldn't read your lineup — showing suggestions anyway.</div>
        )}

        <div className="slotedit">
          <button className="btn ghost sm" onClick={() => setEditSlots((v) => !v)}>{editSlots ? "Done editing slots" : "Edit slots"}</button>
          {editSlots && (
            <div style={{ marginTop: 10 }}>
              {slots.map((s, i) => <span className="slotchip" key={i}>{s}<button onClick={() => removeSlot(i)} aria-label="remove">✕</button></span>)}
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select onChange={(e) => { addSlot(e.target.value); e.target.value = ""; }} defaultValue="">
                  <option value="" disabled>+ add slot…</option>
                  {["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF"].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="btn ghost sm" onClick={resetSlots}>Reset to {cfg.format.includes("Super") ? "Superflex" : "standard"} default</button>
              </div>
            </div>
          )}
        </div>

        <div className={"lcomptable" + (ai.busy && hasSuggestions ? " airesdim" : "")}>
          <div className="lcomphead">
            <span>Position</span>
            <span>Your lineup now</span>
            <span>Suggested</span>
          </div>
          {slots.map((s, i) => {
            const sug = assign[i];
            const cur = current && current[i] ? current[i] : null;
            const curName = cur && cur.name ? cur.name : "—";
            const same = sug && cur && !cur.unavailable && nameEq(cur.name, sug);
            const different = sug && cur && !cur.unavailable && !nameEq(cur.name, sug);
            const info = meta && meta.byPlayer && sug ? meta.byPlayer[sug] : null;
            return (
              <div className={"lcomprow" + (different ? " lcompchange" : "")} key={i}>
                <span className="lslot">{s}</span>
                <span className="lcompcur">{curName}</span>
                <span className="lcompsug">
                  {!sug ? "—"
                    : same ? <span className="lcompkeep">✓ Keep</span>
                      : different ? <span className="lcompstart">▸ Start {sug} instead</span>
                        : <span className="lcompstart">▸ Start {sug}</span>}
                  {info && info.why && different && <div className="lwhy">{info.why}</div>}
                </span>
              </div>
            );
          })}
        </div>

        {roster.length > 0 && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {canYahoo && <button className="btn" onClick={submitYahoo} disabled={submitting}>{submitting && <span className="spin" />}{submitting ? "Submitting…" : "Submit to Yahoo"}</button>}
            <button className={"btn " + (canYahoo ? "ghost" : "")} onClick={finalize}>{submitted ? "Locked in ✓" : "Lock in lineup"}</button>
            <button className="btn ghost" onClick={() => copyText(lineupText)}>Copy lineup</button>
            {submitted && !subMsg && <span className="empty" style={{ padding: 0 }}>Saved &amp; shared with your co-manager.</span>}
          </div>
        )}
        {subMsg && <div className="note" style={{ borderColor: "var(--go)" }}>{subMsg}</div>}
        {subErr && <div className="note" style={{ borderColor: "var(--now)" }}>{subErr}</div>}
        {isSleeper && (
          <div className="note">
            Make these changes in the Sleeper app — we'll confirm them next time you open this.
          </div>
        )}
        {isYahoo && (
          <div className="note">
            Yahoo can push the suggested lineup with <b>Submit to Yahoo</b>. Live starters aren't readable here yet — set or confirm in Yahoo if needed.
          </div>
        )}
      </div>

      {meta && (meta.risks && meta.risks.length || meta.notes) && (
        <div className={"card" + (ai.busy && hasSuggestions ? " airesdim" : "")}>
          <h3>Roster check</h3>
          {(meta.risks || []).map((r, i) => (
            <div className="alert" key={i}><div className="bar bar-now" /><div className="body"><div className="t">{r}</div></div></div>
          ))}
          {meta.notes && <div className="idea-r" style={{ marginTop: (meta.risks || []).length ? 10 : 0 }}>{meta.notes}</div>}
        </div>
      )}
    </div>
  );
}


export default Lineup;
