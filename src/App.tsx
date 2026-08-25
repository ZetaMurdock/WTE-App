import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar, type TabId } from "./components/TopBar";
import { Dashboard } from "./components/Dashboard";
import { ToolFrame } from "./components/ToolFrame";
import { CharactersTab } from "./components/characters/CharactersTab";
import { LobbyView } from "./components/LobbyView";
import { PlayerCampaign } from "./components/PlayerCampaign";
import { NetProvider } from "./net/NetContext";
import { CampaignAnnouncer } from "./net/CampaignAnnouncer";
import { CampaignCodexSync } from "./net/CampaignCodexSync";
import { CodexBrowser } from "./components/codex/CodexBrowser";
import { VttScreen } from "./vtt/VttScreen";
import { Boundary } from "./components/ui/Boundary";
import { CursorDot } from "./components/CursorDot";
import { AppToasts } from "./components/ui/AppToasts";
import { SaveStatus } from "./components/ui/SaveStatus";
import { FirstRun } from "./components/FirstRun";
import { countCharacters } from "./lib/characters";
import { loadCodexGameData } from "./lib/gameData";
import { activeRoomCodex, markRoomCodexError } from "./lib/campaignCodex";
import { onOpenCodexPage } from "./lib/openCodexPage";
import { LookUpSelection } from "./components/codex/LookUpSelection";
import {
  getVersion,
  checkUpdate,
  installUpdate,
  signInWithGoogle,
  restoreAuth,
  firebasePublishConfigured,
  type WteUpdate,
  type AuthUser,
} from "./lib/tauri";
import { pendingLibraryUpdates } from "./lib/publishedPages";
import { pushToast } from "./lib/appToast";
import { redoOnce, setUndoScope, undoOnce } from "./lib/undoRedo";
import { installSaveGuards } from "./lib/saveQueue";
import { migrateCampaignToDb } from "./lib/campaignStore";
import type { Campaign } from "./models/campaign";
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  renameCampaign,
  archiveCampaign,
  getActiveCampaignId,
  setActiveCampaignId,
} from "./lib/repo";

type Theme = "dark" | "light";

function initialTheme(): Theme {
  try {
    return localStorage.getItem("wte-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function accountLabelFor(u: AuthUser | null): string {
  if (!u) return "Sign in";
  return (u.displayName || u.email || "Account").split(" ")[0];
}

function CodexMechanicsGate({ error, onOpenCodex }: { error?: string; onOpenCodex: () => void }) {
  return (
    <div className="dashboard">
      <div className="panel">
        <div className="panel-title">Campaign Codex</div>
        <p className={error ? "campaign-codex-error" : "list-empty"}>
          {error || "Loading campaign settings before character and VTT mechanics become available…"}
        </p>
        <button className="primary-btn" onClick={onOpenCodex}>Open Codex</button>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  // Legacy iframe tabs a user has actually opened this session (lazy mount).
  const [visitedLegacy, setVisitedLegacy] = useState<Set<TabId>>(new Set());
  useEffect(() => {
    if (activeTab === "sheet" || activeTab === "vtt" || activeTab === "wiki") {
      setVisitedLegacy((v) => (v.has(activeTab) ? v : new Set(v).add(activeTab)));
    }
  }, [activeTab]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<WteUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [accountLabel, setAccountLabel] = useState("Sign in");
  const [curator, setCurator] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wte-curator") === "1";
    } catch {
      return false;
    }
  });
  const [engineer, setEngineer] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wte-engineer") === "1";
    } catch {
      return false;
    }
  });
  const [wallpaper, setWallpaper] = useState<string | null>(() => {
    try {
      return localStorage.getItem("wte-wallpaper");
    } catch {
      return null;
    }
  });
  const [dotCursor, setDotCursor] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wte-dot-cursor") !== "0"; // on by default
    } catch {
      return true;
    }
  });
  function toggleDotCursor() {
    setDotCursor((v) => {
      const next = !v;
      try {
        localStorage.setItem("wte-dot-cursor", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  function changeWallpaper(uri: string | null) {
    setWallpaper(uri);
    try {
      if (uri) localStorage.setItem("wte-wallpaper", uri);
      else localStorage.removeItem("wte-wallpaper");
    } catch {
      /* ignore */
    }
  }

  function toggleCurator() {
    setCurator((c) => {
      const next = !c;
      try {
        localStorage.setItem("wte-curator", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  function toggleEngineer() {
    setEngineer((e) => {
      const next = !e;
      try {
        localStorage.setItem("wte-engineer", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [archivedCampaigns, setArchivedCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [charCount, setCharCount] = useState(0);
  const [charTick, setCharTick] = useState(0);
  const bumpChars = useCallback(() => setCharTick((t) => t + 1), []);

  const reload = useCallback(async () => {
    // Load BOTH, so archiving is a reversible move rather than a one-way door.
    const all = await listCampaigns(true);
    setCampaigns(all.filter((c) => !c.archived));
    setArchivedCampaigns(all.filter((c) => c.archived));
    const activeId = getActiveCampaignId();
    setActiveCampaign(activeId ? (await getCampaign(activeId)) ?? null : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // apply theme to <body> and persist; same-origin tool iframes pick it up via the storage event
  useEffect(() => {
    document.body.classList.toggle("wte-light", theme === "light");
    try {
      localStorage.setItem("wte-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Nothing flushed the debounced saves on app close before this.
  useEffect(() => {
    installSaveGuards();
  }, []);

  useEffect(() => {
    getVersion().then(setVersion);
    checkUpdate().then(setUpdate);
    restoreAuth((u) => setAccountLabel(accountLabelFor(u)));
  }, []);

  // Data-driven Codex pull: overlay species/paradigms/catalogs from pulled pages
  // at boot, and re-load whenever the Codex changes pages or pull flags. The
  // tick re-renders the tree so open tools re-read the (mutated-in-place) data.
  const [, setDataTick] = useState(0);
  const [codexLoad, setCodexLoad] = useState<{ status: "loading" | "ready" | "error"; sourceKey: string; message?: string }>({
    status: "loading",
    sourceKey: "",
  });
  const codexUiLoadToken = useRef(0);
  // Campaign-scoped Codex rules resolve against the campaign that owns them, so
  // switching campaigns has to re-run the pull. Without this dependency the
  // registry kept the previous table's overrides and the new campaign silently
  // played by the old one's house rules. loadCodexGameData orders its own passes,
  // so a slow load begun before the switch cannot land after this one.
  const codexCampaignKey = activeCampaign?.id ?? "";
  useEffect(() => {
    const reload = () => {
      const uiToken = ++codexUiLoadToken.current;
      const sourceKey = activeRoomCodex()?.campaignId ?? codexCampaignKey;
      setCodexLoad({ status: "loading", sourceKey });
      void loadCodexGameData()
      .then(() => {
        if (uiToken !== codexUiLoadToken.current) return;
        setCodexLoad({ status: "ready", sourceKey });
        setDataTick((t) => t + 1);
      })
      .catch((error) => {
        if (uiToken !== codexUiLoadToken.current) return;
        const room = activeRoomCodex();
        const message = `The campaign Codex could not be applied: ${error instanceof Error ? error.message : String(error)}`;
        setCodexLoad({ status: "error", sourceKey, message });
        if (room) markRoomCodexError(room.campaignId, message);
        pushToast(message, "error", 0);
      });
    };
    reload();
    // Content, pull flags AND visibility all announce themselves this way; a
    // second event name would only be another thing to forget to dispatch.
    window.addEventListener("wte-pages-changed", reload);
    return () => {
      codexUiLoadToken.current += 1;
      window.removeEventListener("wte-pages-changed", reload);
    };
  }, [codexCampaignKey]);
  // "Open the full Codex page", from the sheet, the VTT or a contextual card.
  // App owns the tab, so it is the only place that can switch to it.
  useEffect(() => onOpenCodexPage(() => setActiveTab("codex")), []);

  // Library updates are OFFERED at launch, never applied. This used to call
  // autoRefreshPulledPages(), which wrote every changed page straight over the
  // local file before the user saw the app — destroying their own edits to a
  // pulled page, silently re-enabling pages they had deliberately un-pulled, and
  // rendering whatever the shared library happened to contain. Now we only count
  // them; Codex › Library already reviews and applies deliberately.
  useEffect(() => {
    if (!firebasePublishConfigured()) return;
    pendingLibraryUpdates()
      .then((pending) => {
        if (pending.length === 0) return;
        pushToast(
          `${pending.length} shared Codex ${pending.length === 1 ? "page has" : "pages have"} an update waiting — open Codex › Library to review.`,
          "info",
          12000
        );
      })
      .catch(() => {});
  }, []);

  // Copy this campaign's data out of localStorage into the database, once per key.
  // Until this ran, copying wte.db to another machine arrived stripped of the
  // campaign rules, desk notes, calendar and folder trees. It is a COPY, never a
  // move: the localStorage original stays put so a bad migration is recoverable.
  useEffect(() => {
    if (!activeCampaign) return;
    void migrateCampaignToDb(activeCampaign.id).catch(() => {});
  }, [activeCampaign]);

  // keep the Dashboard character count in sync with the active campaign
  useEffect(() => {
    let alive = true;
    if (activeCampaign) {
      countCharacters(activeCampaign.id).then((n) => {
        if (alive) setCharCount(n);
      });
    } else {
      setCharCount(0);
    }
    return () => {
      alive = false;
    };
  }, [activeCampaign, charTick]);

  async function handleInstallUpdate() {
    if (!update) return;
    setInstalling(true);
    try {
      await installUpdate(update);
    } catch {
      setInstalling(false);
      alert("Update failed.");
    }
  }

  async function handleAccount() {
    try {
      const u = await signInWithGoogle();
      setAccountLabel(accountLabelFor(u));
    } catch (e) {
      alert("Sign-in failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function reportError(action: string, e: unknown) {
    alert(`Could not ${action}: ` + (e instanceof Error ? e.message : String(e)));
  }

  async function handleCreate(name: string) {
    try {
      const c = await createCampaign(name);
      setActiveCampaignId(c.id);
      setActiveTab("dashboard");
      await reload();
    } catch (e) {
      reportError("create campaign", e);
    }
  }

  async function handleRename(id: string, name: string) {
    try {
      await renameCampaign(id, name);
      await reload();
    } catch (e) {
      reportError("rename campaign", e);
    }
  }

  async function handleUnarchive(id: string) {
    try {
      await archiveCampaign(id, false);
      await reload();
    } catch (e) {
      reportError("restore campaign", e);
    }
  }

  async function handleArchive(id: string) {
    try {
      await archiveCampaign(id);
      await reload();
    } catch (e) {
      reportError("archive campaign", e);
    }
  }

  async function selectCampaign(id: string) {
    setActiveCampaignId(id);
    setActiveTab("dashboard");
    await reload();
  }

  async function switchCampaign() {
    setActiveCampaignId(null);
    await reload();
  }

  // Undo history is scoped to the WORKSPACE. Campaign Settings and the Codex
  // are one workspace — customizing a rule walks dashboard → codex editor →
  // back, and the trail must survive that walk. Every other tab is its own
  // window; switching to it drops the previous trail.
  useEffect(() => {
    const workspace = activeTab === "dashboard" || activeTab === "codex" ? "workspace:campaign" : `workspace:${activeTab}`;
    setUndoScope(workspace);
  }, [activeTab]);

  // Ctrl+Z undoes, Ctrl+X redoes — one action per press. Typing surfaces keep
  // their native behavior: hijacking Ctrl+X inside a text field would turn
  // "cut" into "redo", so editable elements are exempt.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "x") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      if (key === "z") void undoOnce();
      else void redoOnce();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currentCodexSourceKey = activeRoomCodex()?.campaignId ?? codexCampaignKey;
  const mechanicsBlocked = codexLoad.status !== "ready" || codexLoad.sourceKey !== currentCodexSourceKey;
  const mechanicsGate = (
    <CodexMechanicsGate
      error={codexLoad.status === "error" ? codexLoad.message : undefined}
      onOpenCodex={() => setActiveTab("codex")}
    />
  );

  return (
    <NetProvider>
    <CampaignAnnouncer campaign={activeCampaign} curator={curator} />
    <CampaignCodexSync campaign={activeCampaign} curator={curator} />
    <div className="app">
      {wallpaper && <div className="app-wallpaper" style={{ backgroundImage: `url(${wallpaper})` }} />}
      <CursorDot enabled={dotCursor} />
      {/* Select a term anywhere — sheet, scene, note, reader — and ask what it
          means here. Global on purpose: the Codex only keeps its promise if it
          answers everywhere, not just inside the Codex tab. */}
      <LookUpSelection campaignId={activeCampaign?.id} />
      <AppToasts />
      <SaveStatus />
      <FirstRun />
      <TopBar
        activeTab={activeTab}
        onTab={setActiveTab}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        version={version}
        update={update}
        installing={installing}
        onInstallUpdate={handleInstallUpdate}
        accountLabel={accountLabel}
        onAccount={handleAccount}
        curator={curator}
        onToggleCurator={toggleCurator}
        engineer={engineer}
        onToggleEngineer={toggleEngineer}
        wallpaper={wallpaper}
        onWallpaper={changeWallpaper}
        dotCursor={dotCursor}
        onToggleDotCursor={toggleDotCursor}
      />
      <div className="views">
        {activeTab === "dashboard" && (
          <div className="view-scroll">
            <Dashboard
              loading={loading}
              campaign={activeCampaign}
              campaigns={campaigns}
              characterCount={charCount}
              onCreate={handleCreate}
              onRename={handleRename}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              archivedCampaigns={archivedCampaigns}
              onSelect={selectCampaign}
              onOpenTool={setActiveTab}
              onOpenCharacters={() => setActiveTab("characters")}
              onSwitchCampaign={switchCampaign}
              curator={curator}
            />
          </div>
        )}
        {activeTab === "characters" && (
          <div className="view-scroll">
            {mechanicsBlocked
              ? mechanicsGate
              : <CharactersTab campaign={activeCampaign} curator={curator} onCharactersChanged={bumpChars} />}
          </div>
        )}
        {activeTab === "table" && (
          <div className="view-scroll">
            {mechanicsBlocked
              ? mechanicsGate
              : (
                <Boundary label="Table">
                  <PlayerCampaign />
                </Boundary>
              )}
          </div>
        )}

        {activeTab === "lobby" && (
          <div className="view-scroll">
            <LobbyView />
          </div>
        )}
        {/* Codex stays mounted so its tabs/history survive switching away */}
        <div className={"view-scroll" + (activeTab !== "codex" ? " hidden" : "")}>
          <CodexBrowser curator={curator} engineer={engineer} campaignId={activeCampaign?.id ?? null} />
        </div>
        {/* VTT v2 stays mounted so the Pixi context survives tab switches */}
        <div className={"view-scroll" + (activeTab !== "vtt2" ? " hidden" : "")}>
          <div className={"vtt-host" + (mechanicsBlocked ? " vtt-gated" : "")}>
            <Boundary label="VTT v2">
              <VttScreen campaign={activeCampaign} active={activeTab === "vtt2" && !mechanicsBlocked} />
            </Boundary>
          </div>
          {activeTab === "vtt2" && mechanicsBlocked && mechanicsGate}
        </div>
        {/* Legacy iframes mount LAZILY on first open (three fewer live documents
            at boot), then stay mounted so their in-frame state survives switches. */}
        {visitedLegacy.has("sheet") && <ToolFrame src="sheet.html" title="Character Sheet" hidden={activeTab !== "sheet"} />}
        {visitedLegacy.has("vtt") && <ToolFrame src="vtt.html" title="VTT" hidden={activeTab !== "vtt"} />}
        {visitedLegacy.has("wiki") && <ToolFrame src="wiki.html" title="Codex" hidden={activeTab !== "wiki"} />}
      </div>
    </div>
    </NetProvider>
  );
}
