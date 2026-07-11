import { useCallback, useEffect, useState } from "react";
import { TopBar, type TabId } from "./components/TopBar";
import { Dashboard } from "./components/Dashboard";
import { ToolFrame } from "./components/ToolFrame";
import { CharactersTab } from "./components/characters/CharactersTab";
import { LobbyView } from "./components/LobbyView";
import { countCharacters } from "./lib/characters";
import {
  getVersion,
  checkUpdate,
  installUpdate,
  signInWithGoogle,
  restoreAuth,
  type WteUpdate,
  type AuthUser,
} from "./lib/tauri";
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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
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

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [charCount, setCharCount] = useState(0);
  const [charTick, setCharTick] = useState(0);
  const bumpChars = useCallback(() => setCharTick((t) => t + 1), []);

  const reload = useCallback(async () => {
    const list = await listCampaigns();
    setCampaigns(list);
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

  useEffect(() => {
    getVersion().then(setVersion);
    checkUpdate().then(setUpdate);
    restoreAuth((u) => setAccountLabel(accountLabelFor(u)));
  }, []);

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

  return (
    <div className="app">
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
              onSelect={selectCampaign}
              onOpenTool={setActiveTab}
              onOpenCharacters={() => setActiveTab("characters")}
              onSwitchCampaign={switchCampaign}
            />
          </div>
        )}
        {activeTab === "characters" && (
          <div className="view-scroll">
            <CharactersTab campaign={activeCampaign} curator={curator} onCharactersChanged={bumpChars} />
          </div>
        )}
        {activeTab === "lobby" && (
          <div className="view-scroll">
            <LobbyView />
          </div>
        )}
        <ToolFrame src="sheet.html" title="Character Sheet" hidden={activeTab !== "sheet"} />
        <ToolFrame src="vtt.html" title="VTT" hidden={activeTab !== "vtt"} />
        <ToolFrame src="wiki.html" title="Codex" hidden={activeTab !== "wiki"} />
      </div>
    </div>
  );
}
