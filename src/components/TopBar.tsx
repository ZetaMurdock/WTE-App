import type { WteUpdate } from "../lib/tauri";
import { useNet } from "../net/NetContext";
import { ProfileMenu } from "./ProfileMenu";

export type TabId = "dashboard" | "characters" | "sheet" | "vtt" | "wiki" | "lobby" | "codex" | "vtt2";
const LEGACY_TABS: TabId[] = ["sheet", "wiki", "vtt"];

// The React "Sheet" and "Codex" are the primary experiences; the legacy iframes
// are demoted to the end as fallbacks while the migration finishes. VTT v2 is
// built beside the legacy VTT until it reaches parity.
export const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "characters", label: "Sheet" },
  { id: "vtt2", label: "VTT" },
  { id: "lobby", label: "Lobby" },
  { id: "codex", label: "Codex" },
  { id: "vtt", label: "Legacy VTT" },
  { id: "sheet", label: "Legacy Sheet" },
  { id: "wiki", label: "Legacy Codex" },
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
  showLegacy: boolean;
  onToggleLegacy: () => void;
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
  showLegacy,
  onToggleLegacy,
  wallpaper,
  onWallpaper,
  dotCursor,
  onToggleDotCursor,
}: TopBarProps) {
  const net = useNet();
  // Per-campaign Curator claim: you're the Curator of campaigns you own. The only
  // "player" case is joining someone else's netplay room as a player — hide the
  // GM-mode button there.
  const isNetPlayer = net.status === "connected" && net.role === "player";
  // Legacy iframes are hidden from the nav unless enabled in the profile menu.
  // The Dashboard is the circular orb itself; the rest unfurl from it on hover.
  const tabs = TABS.filter((t) => t.id !== "dashboard" && (showLegacy || !LEGACY_TABS.includes(t.id)));
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
        showLegacy={showLegacy}
        onToggleLegacy={onToggleLegacy}
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
        rolesHidden={isNetPlayer}
      />
      <span className="ver">{version ? "v" + version : ""}</span>
    </div>
  );
}
