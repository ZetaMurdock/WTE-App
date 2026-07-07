import { useCallback, useEffect, useState } from "react";
import { TopBar, type TabId } from "./components/TopBar";
import { Dashboard } from "./components/Dashboard";
import { ToolFrame } from "./components/ToolFrame";
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

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

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

  async function handleCreate(name: string) {
    const c = await createCampaign(name);
    setActiveCampaignId(c.id);
    setActiveTab("dashboard");
    await reload();
  }

  async function handleRename(id: string, name: string) {
    await renameCampaign(id, name);
    await reload();
  }

  async function handleArchive(id: string) {
    await archiveCampaign(id);
    await reload();
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
      />
      <div className="views">
        {activeTab === "dashboard" && (
          <div className="view-scroll">
            <Dashboard
              loading={loading}
              campaign={activeCampaign}
              campaigns={campaigns}
              onCreate={handleCreate}
              onRename={handleRename}
              onArchive={handleArchive}
              onSelect={selectCampaign}
              onOpenTool={setActiveTab}
              onSwitchCampaign={switchCampaign}
            />
          </div>
        )}
        <ToolFrame src="sheet.html" title="Character Sheet" hidden={activeTab !== "sheet"} />
        <ToolFrame src="vtt.html" title="VTT" hidden={activeTab !== "vtt"} />
        <ToolFrame src="wiki.html" title="Codex" hidden={activeTab !== "wiki"} />
      </div>
    </div>
  );
}
