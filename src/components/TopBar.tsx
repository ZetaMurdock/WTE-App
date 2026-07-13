import type { WteUpdate } from "../lib/tauri";
import { useNet } from "../net/NetContext";

export type TabId = "dashboard" | "characters" | "sheet" | "vtt" | "wiki" | "lobby" | "codex" | "vtt2";

// The React "Sheet" and "Codex" are the primary experiences; the legacy iframes
// are demoted to the end as fallbacks while the migration finishes. VTT v2 is
// built beside the legacy VTT until it reaches parity.
export const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "characters", label: "Sheet" },
  { id: "vtt", label: "VTT" },
  { id: "vtt2", label: "VTT v2" },
  { id: "lobby", label: "Lobby" },
  { id: "codex", label: "Codex" },
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
}: TopBarProps) {
  const net = useNet();
  // Per-campaign Curator claim: you're the Curator of campaigns you own. The only
  // "player" case is joining someone else's netplay room as a player — hide the
  // GM-mode button there.
  const isNetPlayer = net.status === "connected" && net.role === "player";
  return (
    <div className="tabbar">
      <span className="brand">W.T.E</span>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={"tab" + (activeTab === t.id ? " active" : "")}
          onClick={() => onTab(t.id)}
        >
          {t.label}
        </button>
      ))}
      <span className="spacer" />
      {update && (
        <span className="upd">
          <span>Update {update.version || ""} available</span>
          <button onClick={onInstallUpdate} disabled={installing}>
            {installing ? "Downloading…" : "Restart & update"}
          </button>
        </span>
      )}
      {!isNetPlayer && (
        <button
          className={"tab" + (curator ? " active" : "")}
          onClick={onToggleCurator}
          title="Curator (GM) mode — reveal GM-only Codex pages & controls"
        >
          {curator ? "Curator ✓" : "Curator"}
        </button>
      )}
      <button className="tab" onClick={onAccount} title="Google account">
        {accountLabel}
      </button>
      <button className="tab" onClick={onToggleTheme} title="Switch Light / Dark theme">
        {theme === "light" ? "Dark" : "Light"}
      </button>
      <span className="ver">{version ? "v" + version : ""}</span>
    </div>
  );
}
