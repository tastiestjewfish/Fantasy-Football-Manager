import React, { useState, useEffect, useCallback } from "react";
import {
  getNflPlayers, getNflPlayersAt,
  sleeperPlayerDisplayName, sleeperPlayerIsActive, sleeperFantasyPos,
} from "../sleeper";
import { PLAYERS } from "../lib/players.js";
import { PlayerDataBar } from "./shared.jsx";

const FANTASY_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function rosteredPlayerIds(members, pool) {
  const ids = new Set();
  const byName = new Map();
  Object.entries(pool || {}).forEach(([id, p]) => {
    const nm = sleeperPlayerDisplayName(p, id).toLowerCase();
    if (nm) byName.set(nm, id);
    if (p && (p.position === "DEF" || p.position === "DST") && p.team) byName.set(String(p.team).toLowerCase(), id);
  });
  (members || []).forEach((m) => {
    (m.roster || []).forEach((r) => {
      if (r.player_id) ids.add(String(r.player_id));
      const raw = String(r.name || "").trim();
      const key = raw.toLowerCase().replace(/\s+def$/, "");
      if (key && byName.has(key)) ids.add(byName.get(key));
      if (raw && byName.has(raw.toLowerCase())) ids.add(byName.get(raw.toLowerCase()));
      if ((r.pos === "DEF" || r.pos === "DST") && r.team) ids.add(String(r.team));
    });
  });
  return ids;
}

function rosteredNames(members) {
  const names = new Set();
  (members || []).forEach((m) => {
    (m.roster || []).forEach((r) => {
      if (r && r.name) names.add(String(r.name).trim().toLowerCase());
    });
  });
  return names;
}

function rowsFromLivePool(pool, members, qn, posf) {
  const taken = rosteredPlayerIds(members, pool);
  const rows = [];
  Object.entries(pool).forEach(([id, p]) => {
    if (!p || taken.has(id)) return;
    const pos = sleeperFantasyPos(p);
    if (!FANTASY_POS.has(pos) || !sleeperPlayerIsActive(p)) return;
    const name = sleeperPlayerDisplayName(p, id);
    if (qn && !name.toLowerCase().includes(qn)) return;
    if (posf !== "ALL" && pos !== posf) return;
    const rank = Number(p.search_rank);
    rows.push({
      id,
      name,
      pos,
      team: p.team || "",
      rank: Number.isFinite(rank) ? rank : Infinity,
    });
  });
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return rows;
}

/** Static PLAYERS fallback when the live map cannot load. */
function rowsFromStatic(members, qn, posf) {
  const taken = rosteredNames(members);
  return PLAYERS
    .filter((p) => {
      if (taken.has(p.name.toLowerCase())) return false;
      if (!FANTASY_POS.has(p.pos)) return false;
      if (qn && !p.name.toLowerCase().includes(qn)) return false;
      if (posf !== "ALL" && p.pos !== posf) return false;
      return true;
    })
    .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, pos: p.pos, team: p.team || "", rank: p.adp }));
}

function WaiversList({ cfg, members }) {
  const [pool, setPool] = useState(null);
  const [source, setSource] = useState(null); // "live" | "static"
  const [fetchedAt, setFetchedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [posf, setPosf] = useState("ALL");
  const [q, setQ] = useState("");
  const hasRosters = (members || []).some((m) => m.roster && m.roster.length);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const data = await getNflPlayers({ force });
      if (data && Object.keys(data).length >= 100) {
        setPool(data);
        setSource("live");
        setFetchedAt(getNflPlayersAt());
        return;
      }
      throw new Error("sparse");
    } catch {
      setPool({});
      setSource("static");
      setFetchedAt(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!hasRosters) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const data = await getNflPlayers();
        if (cancelled) return;
        if (data && Object.keys(data).length >= 100) {
          setPool(data);
          setSource("live");
          setFetchedAt(getNflPlayersAt());
        } else {
          setPool({});
          setSource("static");
          setFetchedAt(null);
        }
      } catch {
        if (cancelled) return;
        setPool({});
        setSource("static");
        setFetchedAt(null);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hasRosters]);

  if (!hasRosters) {
    return <div className="empty" style={{ paddingTop: 0 }}>Import your league first in the League tab.</div>;
  }
  if (pool == null && busy) {
    return (
      <div className="empty" style={{ paddingTop: 0, display: "flex", alignItems: "center" }}>
        <span className="spin" /> Loading players…
      </div>
    );
  }

  const qn = q.trim().toLowerCase();
  const rows = source === "live"
    ? rowsFromLivePool(pool, members, qn, posf)
    : rowsFromStatic(members, qn, posf);
  const shown = rows.slice(0, 150);

  return (
    <div>
      <div className="empty" style={{ paddingTop: 0 }}>
        Free agents in {cfg.league} — sorted by current Sleeper relevance{source === "static" ? " (offline board)" : ""}.
      </div>
      <PlayerDataBar at={fetchedAt} source={source} busy={busy} onRefresh={() => load(true)} />
      <div className="tools">
        <input placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tools posfilter">
        {["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map((p) => (
          <button key={p} className={posf === p ? "on" : ""} onClick={() => setPosf(p)}>{p}</button>
        ))}
      </div>
      <div className="plist">
        {shown.length === 0 ? (
          <div className="empty">No available players match that filter.</div>
        ) : shown.map((p) => (
          <div className="prow" key={p.id}>
            <span className={"posbadge pb-" + (p.pos === "K" ? "PK" : p.pos)}>{p.pos}</span>
            <span className="pname">{p.name}{p.team ? <><br /><span className="sub">{p.team}</span></> : null}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WaiversList;
