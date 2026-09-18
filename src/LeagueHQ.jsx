import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { getWorkspaceId } from "./firebase";
import { nflSeasonClock } from "./sleeper";
import { isWinningIntel } from "./gmail";

import { loadKey, saveKey, preloadAiResults } from "./lib/storage.js";
import { urgencyFor, computeDeadlines, fmtRefreshAgo } from "./lib/format.js";
import { defaultSlots, resolveSlots } from "./lib/lineup.js";
import {
  loadAnthropicWorkspaceId, loadUseWebSearch,
} from "./lib/ai.js";
import {
  DEFAULT_CFG, DEFAULT_REM, defaultSources,
  lk, newLeagueId, summaryFromCfg, emptyLeagueBundle,
  loadLeagueBundle, writeLeagueBundle, draftToolsVisible,
  importSleeper, mergeImportedMembers,
} from "./lib/league.js";

import { SpearMark, LeaguePicker, AddLeague } from "./components/shared.jsx";
import Home from "./components/Home.jsx";
import Onboarding from "./components/Onboarding.jsx";
import Inbox from "./components/Inbox.jsx";
import Reminders from "./components/Reminders.jsx";
import Moves from "./components/Moves.jsx";
import League from "./components/League.jsx";
import Lineup from "./components/Lineup.jsx";
import Setup from "./components/Setup.jsx";

/* Heavier / less-frequent screens — split out of the first-load chunk */
const DraftRoom = lazy(() => import("./components/DraftRoom.jsx"));
const RosterBuilder = lazy(() => import("./components/RosterBuilder.jsx"));
const Matchup = lazy(() => import("./components/Matchup.jsx"));
const Trades = lazy(() => import("./components/Trades.jsx"));
const GroupChat = lazy(() => import("./components/GroupChat.jsx"));

function TabFallback() {
  return (
    <div className="card">
      <div className="empty" style={{ padding: 8, display: "flex", alignItems: "center" }}>
        <span className="spin" /> Loading…
      </div>
    </div>
  );
}

/* styles live in src/theme.css, imported from main.jsx */

export default function LeagueHQ({ user, onSignOut }) {
  const [tab, setTab] = useState("home");
  const [panes, setPanes] = useState({ week: "lineup", moves: "trades", league: "teams", draft: "board" });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [board, setBoard] = useState({});            // {playerId: 'mine'|'gone'}
  const [rem, setRem] = useState(DEFAULT_REM);
  const [alerts, setAlerts] = useState([]);          // from last inbox scan
  const [, force] = useState(0);
  const [sources, setSources] = useState(defaultSources("Sleeper"));
  const [onboarded, setOnboarded] = useState(false);
  const [members, setMembers] = useState([]);
  const [offers, setOffers] = useState([]);
  const [slots, setSlots] = useState(defaultSlots("Standard (1 QB)"));
  const [savedLineup, setSavedLineup] = useState(null);
  const [savedRoster, setSavedRoster] = useState(null);
  const [clock, setClock] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [leagues, setLeagues] = useState([]);
  const [activeId, setActiveId] = useState("default");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingLeague, setAddingLeague] = useState(false);
  const activeIdRef = useRef("default");
  const switchingRef = useRef(false);

  const applyBundle = (bundle, leagueId) => {
    setCfg(bundle.cfg);
    setMembers(bundle.members);
    setBoard(bundle.board);
    setRem(bundle.rem);
    const rawAlerts = Array.isArray(bundle.alerts) ? bundle.alerts : [];
    const cleanedAlerts = rawAlerts.filter(isWinningIntel);
    setAlerts(cleanedAlerts);
    if (leagueId && cleanedAlerts.length !== rawAlerts.length) saveKey(lk(leagueId, "alerts"), cleanedAlerts);
    setSources(bundle.sources);
    setOffers(bundle.offers);
    setSlots(bundle.slots);
    setSavedLineup(bundle.savedLineup);
    setSavedRoster(bundle.savedRoster);
    setLastRefresh(bundle.lastRefresh);
  };

  const refreshSleeper = async (nextCfg, nextMembers, leagueId) => {
    if ((nextCfg.platform || "Sleeper") !== "Sleeper" || !nextCfg.leagueId) return;
    setRefreshing(true);
    try {
      const result = await importSleeper(nextCfg.leagueId);
      if (result && Array.isArray(result.members) && activeIdRef.current === leagueId) {
        const merged = mergeImportedMembers(nextMembers, result.members);
        setMembers(merged);
        saveKey(lk(leagueId, "members"), merged);
        if (Array.isArray(result.slots) && result.slots.length) {
          setSlots(result.slots);
          saveKey(lk(leagueId, "slots"), result.slots);
        }
        const ts = Date.now();
        setLastRefresh(ts);
        saveKey(lk(leagueId, "lastRefresh"), ts);
      }
    } catch { /* keep last-known members */ }
    if (activeIdRef.current === leagueId) setRefreshing(false);
  };

  /* load shared state — only after Google sign-in + workspace code are set */
  useEffect(() => {
    if (!getWorkspaceId()) return;
    let cancelled = false;
    (async () => {
      let index = await loadKey("leagues:index", null);
      if (!Array.isArray(index) || !index.length) {
        const legacyCfg = { ...DEFAULT_CFG, ...(await loadKey("league:config", DEFAULT_CFG)) };
        index = [summaryFromCfg(legacyCfg, "default")];
        await saveKey("leagues:index", index);
      }
      let nextId = await loadKey("me:activeLeagueId", index[0].id, false);
      if (!index.some((l) => l.id === nextId)) nextId = index[0].id;
      const bundle = await loadLeagueBundle(nextId);
      if (cancelled) return;
      activeIdRef.current = nextId;
      setLeagues(index);
      setActiveId(nextId);
      applyBundle(bundle, nextId);
      setOnboarded(await loadKey("me:onboarded", false, false));
      await loadAnthropicWorkspaceId();
      await loadUseWebSearch();
      await preloadAiResults();
      if (!cancelled) setReady(true);
      await refreshSleeper(bundle.cfg, bundle.members, nextId);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, []);

  /* 1s tick for live countdowns */
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    nflSeasonClock().then(setClock).catch(() => {});
  }, []);

  const persistKind = (kind, setter) => (next) => {
    setter(next);
    if (switchingRef.current) return;
    saveKey(lk(activeIdRef.current, kind), next);
  };
  const persistCfg = (next) => {
    setCfg(next);
    if (switchingRef.current) return;
    const id = activeIdRef.current;
    saveKey(lk(id, "config"), next);
    setLeagues((prev) => {
      const nextIndex = prev.map((l) => (l.id === id ? { ...l, ...summaryFromCfg(next, id) } : l));
      saveKey("leagues:index", nextIndex);
      return nextIndex;
    });
  };
  const persistBoard = persistKind("board", setBoard);
  const persistRem = persistKind("rem", setRem);
  const persistAlerts = persistKind("alerts", setAlerts);
  const persistSources = persistKind("sources", setSources);
  const persistMembers = persistKind("members", setMembers);
  const persistOffers = persistKind("offers", setOffers);
  const persistSlots = persistKind("slots", setSlots);
  const persistSavedLineup = persistKind("lineup", setSavedLineup);
  const persistSavedRoster = persistKind("roster", setSavedRoster);
  const completeOnboarding = (srcNext) => { if (srcNext) persistSources(srcNext); setOnboarded(true); saveKey("me:onboarded", true, false); };
  const restartOnboarding = () => { setOnboarded(false); saveKey("me:onboarded", false, false); };

  const switchLeague = async (id) => {
    if (!id || id === activeIdRef.current) { setPickerOpen(false); return; }
    switchingRef.current = true;
    setPickerOpen(false);
    setRefreshing(true);
    const bundle = await loadLeagueBundle(id);
    applyBundle(bundle, id);
    activeIdRef.current = id;
    setActiveId(id);
    saveKey("me:activeLeagueId", id, false);
    switchingRef.current = false;
    setRefreshing(false);
    if (tab === "draft" && !draftToolsVisible(bundle.cfg, bundle.members, clock)) setTab("home");
    await refreshSleeper(bundle.cfg, bundle.members, id);
  };

  const addLeague = async ({ cfg: nextCfg, members: nextMembers, slots: nextSlots }) => {
    const id = newLeagueId();
    const bundle = { ...emptyLeagueBundle(nextCfg), cfg: { ...DEFAULT_CFG, ...nextCfg }, members: nextMembers || [] };
    bundle.slots = resolveSlots(nextSlots, (nextCfg && nextCfg.format) || bundle.cfg.format);
    await writeLeagueBundle(id, bundle);
    const entry = summaryFromCfg(bundle.cfg, id);
    const nextIndex = [...leagues, entry];
    setLeagues(nextIndex);
    saveKey("leagues:index", nextIndex);
    setAddingLeague(false);
    await switchLeague(id);
    setTab("league");
    setPanes((s) => ({ ...s, league: "teams" }));
  };

  const removeLeague = async (id) => {
    if (leagues.length < 2) return;
    const nextIndex = leagues.filter((l) => l.id !== id);
    setLeagues(nextIndex);
    saveKey("leagues:index", nextIndex);
    if (id === activeIdRef.current) await switchLeague(nextIndex[0].id);
  };

  /* deadlines */
  const deadlines = computeDeadlines(rem);
  const nextDeadline = deadlines[0];
  const heroState = nextDeadline ? urgencyFor(nextDeadline.when) : "go";

  const showDraft = draftToolsVisible(cfg, members, clock);
  const TABS = [
    { id: "home", label: "Home" },
    { id: "week", label: "This week", panes: [["lineup", "Lineup"], ["matchup", "Matchup"], ["start", "Start / Sit"]] },
    { id: "moves", label: "Moves", panes: [["trades", "Trades"], ["waiver", "Waivers"], ["byes", "Byes"]] },
    { id: "league", label: "League", panes: [["teams", "Teams"], ["inbox", "Intel"], ["chat", "Chat"]] },
    showDraft ? { id: "draft", label: "Draft", panes: [["board", "Board"], ["build", "Builder"]] } : null,
    { id: "settings", label: "Settings" },
  ].filter(Boolean);
  const TOOL_TAB_IDS = { week: 1, moves: 1, league: 1, draft: 1 };
  const tabShown = (tab === "draft" && !showDraft) || tab === "coach" ? "home" : tab;
  const pane = panes[tabShown];
  const setPane = (id) => setPanes((s) => ({ ...s, [tabShown]: id }));
  const go = (nextTab, nextPane) => {
    setTab(nextTab);
    if (TOOL_TAB_IDS[nextTab]) setToolsOpen(true);
    if (nextPane) setPanes((s) => ({ ...s, [nextTab]: nextPane }));
  };
  const activeTab = TABS.find((t) => t.id === tabShown);
  const primaryTabs = TABS.filter((t) => t.id === "home" || t.id === "settings");
  const toolTabs = TABS.filter((t) => TOOL_TAB_IDS[t.id]);
  const navTabs = toolsOpen
    ? [...primaryTabs.filter((t) => t.id === "home"), ...toolTabs, ...primaryTabs.filter((t) => t.id === "settings")]
    : primaryTabs;

  const toggleTools = () => {
    setToolsOpen((open) => {
      if (open && TOOL_TAB_IDS[tabShown]) setTab("home");
      return !open;
    });
  };

  if (!ready) {
    return (<div className="hq"><div className="wrap" style={{ paddingTop: 60, color: "var(--muted)" }}>Loading League HQ…</div></div>);
  }

  return (
    <div className="hq">
      <header className="top">
        <div className="topin">
          <div className="logo">
            <span className="mk"><SpearMark /></span>
            <span className="logotxt">
              <span className="logoname">League HQ</span>
              <span className="logosub">Seminoles fantasy</span>
            </span>
          </div>
          <LeaguePicker
            leagues={leagues}
            activeId={activeId}
            cfg={cfg}
            open={pickerOpen}
            setOpen={setPickerOpen}
            onSelect={switchLeague}
            onAdd={() => { setPickerOpen(false); setAddingLeague(true); }}
          />
          {(refreshing || lastRefresh) && (
            <span className="refreshline">{refreshing ? "Refreshing…" : fmtRefreshAgo(lastRefresh)}</span>
          )}
          <span className="spacer" />
          {onSignOut && (
            <button type="button" className="btn ghost sm" onClick={onSignOut} title={user?.email || "Sign out"}>
              Sign out
            </button>
          )}
        </div>
        <div className="topin" style={{ paddingTop: 0 }}>
          <nav className="nav">
            {navTabs.map((t) => (
              <button key={t.id} className={tabShown === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.id === "home" && nextDeadline && (
                  <span className="dot" style={{ background: `var(--${heroState})` }} />
                )}
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className={"navtools" + (toolsOpen ? " on" : "")}
              onClick={toggleTools}
              aria-expanded={toolsOpen}
            >
              Tools {toolsOpen ? "▾" : "▸"}
            </button>
          </nav>
        </div>
      </header>

      <main className="wrap">
        {(tabShown === "home" || tabShown === "week") && clock && (
          <div className="weekbanner">{clock.label}</div>
        )}
        {activeTab && activeTab.panes && (
          <div className="subnav" role="tablist">
            {activeTab.panes.map(([id, label]) => (
              <button key={id} className={pane === id ? "on" : ""} onClick={() => setPane(id)}>{label}</button>
            ))}
          </div>
        )}
        {tabShown === "home" && (
          <Home
            cfg={cfg}
            board={board}
            members={members}
            slots={slots}
            nextDeadline={nextDeadline}
            clock={clock}
            lastRefresh={lastRefresh}
            go={go}
            onStartSetup={restartOnboarding}
            onOpenTools={() => setToolsOpen(true)}
          />
        )}
        {tabShown === "week" && pane === "lineup" && (
          <Lineup cfg={cfg} board={board} members={members} slots={slots} setSlots={persistSlots} saved={savedLineup} setSaved={persistSavedLineup} />
        )}
        {tabShown === "week" && pane === "matchup" && (
          <Suspense fallback={<TabFallback />}>
            <Matchup cfg={cfg} slots={slots} board={board} members={members} setSavedLineup={persistSavedLineup} />
          </Suspense>
        )}
        {tabShown === "week" && pane === "start" && (
          <Moves cfg={cfg} board={board} members={members} pane="start" />
        )}
        {tabShown === "moves" && pane === "trades" && (
          <Suspense fallback={<TabFallback />}>
            <Trades cfg={cfg} board={board} members={members} offers={offers} setOffers={persistOffers} goLeague={() => go("league", "teams")} />
          </Suspense>
        )}
        {tabShown === "moves" && (pane === "waiver" || pane === "byes") && (
          <Moves cfg={cfg} board={board} members={members} pane={pane} />
        )}
        {tabShown === "league" && pane === "teams" && (
          <League cfg={cfg} setCfg={persistCfg} members={members} setMembers={persistMembers} setSlots={persistSlots} />
        )}
        {tabShown === "league" && pane === "inbox" && (
          <Inbox alerts={alerts} setAlerts={persistAlerts} sources={sources} cfg={cfg} members={members} />
        )}
        {tabShown === "league" && pane === "chat" && (
          <Suspense fallback={<TabFallback />}>
            <GroupChat alerts={alerts} setAlerts={persistAlerts} offers={offers} setOffers={persistOffers} />
          </Suspense>
        )}
        {tabShown === "draft" && pane === "board" && (
          <Suspense fallback={<TabFallback />}>
            <DraftRoom cfg={cfg} board={board} setBoard={persistBoard} />
          </Suspense>
        )}
        {tabShown === "draft" && pane === "build" && (
          <Suspense fallback={<TabFallback />}>
            <RosterBuilder cfg={cfg} slots={slots} board={board} setBoard={persistBoard} members={members} saved={savedRoster} setSaved={persistSavedRoster} />
          </Suspense>
        )}
        {tabShown === "settings" && (
          <>
            <Reminders rem={rem} setRem={persistRem} cfg={cfg} />
            <div style={{ height: 14 }} />
            <Setup
              cfg={cfg}
              setCfg={persistCfg}
              resetBoard={() => persistBoard({})}
              restart={restartOnboarding}
              leagues={leagues}
              activeId={activeId}
              onAddLeague={() => setAddingLeague(true)}
              onRemoveLeague={removeLeague}
              showDraft={showDraft}
            />
          </>
        )}
      </main>

      {!onboarded && (
        <Onboarding
          cfg={cfg}
          setCfg={persistCfg}
          members={members}
          setMembers={persistMembers}
          setSlots={persistSlots}
          onDone={completeOnboarding}
          goHome={() => setTab("home")}
        />
      )}
      {addingLeague && (
        <AddLeague
          onCancel={() => setAddingLeague(false)}
          onSave={addLeague}
        />
      )}
    </div>
  );
}

