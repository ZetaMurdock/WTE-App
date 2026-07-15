import type { WteUpdate } from "../lib/tauri";
import { useNet } from "../net/NetContext";
import { ProfileMenu } from "./ProfileMenu";

// Legacy iframe tabs (sheet/vtt/wiki) are retired from the nav — the React Sheet,
// VTT, and Codex are the app now. The TabId union keeps the ids so old deep links
// / persisted state don't break, but they never render in the bar.
export type TabId = "dashboard" | "characters" | "sheet" | "vtt" | "wiki" | "lobby" | "codex" | "vtt2";

export const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "characters", label: "Sheet" },
  { id: "vtt2", label: "VTT" },
  { id: "lobby", label: "Lobby" },
  { id: "codex", label: "Codex" },
];

interface TopBarProps {
  activeTab: TabId;
  onTab: (id: TabId) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  version: string | null;
  update: WteUpdate | null;
  installing: boolean;
  onInstallUpdate: () => void;
  accountLabel: string;
  onAccount: () => void;
  curator: boolean;
  onToggleCurator: () => void;
  engineer: boolean;
  onToggleEngineer: () => void;
  wallpaper: string | null;
  onWallpaper: (uri: string | null) => void;
  dotCursor: boolean;
  onToggleDotCursor: () => void;
}

export function TopBar({
  activeTab,
  onTab,
  theme,
  onToggleTheme,
  version,
  update,
  installing,
  onInstallUpdate,
  accountLabel,
  onAccount,
  curator,
  onToggleCurator,
  engineer,
  onToggleEngineer,
  wallpaper,
  onWallpaper,
  dotCursor,
  onToggleDotCursor,
}: TopBarProps) {
  const net = useNet();
  // Per-campaign Curator claim: you're the Curator of campaigns you own. The only
  // "player" case is joining someone else's netplay room as a player — hide the
  // GM-mode button there.
  // Once you're in a live campaign session (connected to a room), Curator/Engineer
  // are fixed by your seat at the table — hide the self-toggles for everyone.
  const inSession = net.status === "connected";
  // Legacy iframes are hidden from the nav unless enabled in the profile menu.
  // The Dashboard is the circular orb itself; the rest unfurl from it on hover.
  const tabs = TABS.filter((t) => t.id !== "dashboard");
  const activeLabel = TABS.find((t) => t.id === activeTab)?.label ?? "";
  return (
    <div className="tabbar">
      <div className="nav-orbit">
        <button
          className={"nav-orb" + (activeTab === "dashboard" ? " active" : "")}
          onClick={() => onTab("dashboard")}
          title="Dashboard"
        >
          <span className="nav-orb-core" />
        </button>
        <div className="nav-tabs">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              className={"tab" + (activeTab === t.id ? " active" : "")}
              style={{ transitionDelay: `${i * 28}ms` }}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="nav-current" aria-hidden>
          {activeTab === "dashboard" ? "W.T.E" : activeLabel}
        </span>
      </div>
      <span className="spacer" />
      {update && (
        <span className="upd">
          <span>Update {update.version || ""} available</span>
          <button onClick={onInstallUpdate} disabled={installing}>
            {installing ? "Downloading…" : "Restart & update"}
          </button>
        </span>
      )}
      <ProfileMenu
        theme={theme}
        onToggleTheme={onToggleTheme}
        wallpaper={wallpaper}
        onWallpaper={onWallpaper}
        dotCursor={dotCursor}
        onToggleDotCursor={onToggleDotCursor}
        accountLabel={accountLabel}
        onAccount={onAccount}
        curator={curator}
        onToggleCurator={onToggleCurator}
        engineer={engineer}
        onToggleEngineer={onToggleEngineer}
        rolesHidden={inSession}
      />
      <span className="ver">{version ? "v" + version : ""}</span>
    </div>
  );
}
