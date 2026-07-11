import type { WteUpdate } from "../lib/tauri";

export type TabId = "dashboard" | "characters" | "sheet" | "vtt" | "wiki" | "lobby";

// The React "Sheet" is now the primary character experience; the legacy sheet.html
// iframe is demoted to the end as a fallback while the migration finishes.
export const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "characters", label: "Sheet" },
  { id: "vtt", label: "VTT" },
  { id: "lobby", label: "Lobby" },
  { id: "wiki", label: "Codex" },
  { id: "sheet", label: "Legacy Sheet" },
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
      <button
        className={"tab" + (curator ? " active" : "")}
        onClick={onToggleCurator}
        title="Curator (GM) mode — unlock stat & rank editing"
      >
        {curator ? "Curator ✓" : "Curator"}
      </button>
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
