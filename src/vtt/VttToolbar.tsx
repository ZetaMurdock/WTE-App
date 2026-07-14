import { VTT_TOOLS, type VttTool } from "./types/tool";

interface Props {
  tool: VttTool;
  onTool: (t: VttTool) => void;
  sceneName: string;
  onRename: (name: string) => void;
  tokenCount: number;
  campaignReady: boolean;
  fogOn: boolean;
  onToggleFog: () => void;
  scenesOpen: boolean;
  actorsOpen: boolean;
  encounterOpen: boolean;
  assetsOpen: boolean;
  rollsOpen: boolean;
  /** Undefined disables these (no campaign → no persisted scenes / vault). */
  onToggleScenes?: () => void;
  onToggleActors?: () => void;
  onToggleEncounter?: () => void;
  onToggleAssets?: () => void;
  onToggleRolls?: () => void;
  syncOn: boolean;
  syncPeers: number;
}

export function VttToolbar({
  tool,
  onTool,
  sceneName,
  onRename,
  tokenCount,
  campaignReady,
  fogOn,
  onToggleFog,
  scenesOpen,
  actorsOpen,
  encounterOpen,
  assetsOpen,
  rollsOpen,
  onToggleScenes,
  onToggleActors,
  onToggleEncounter,
  onToggleAssets,
  onToggleRolls,
  syncOn,
  syncPeers,
}: Props) {
  const hint = VTT_TOOLS.find((t) => t.id === tool)?.hint ?? "";
  return (
    <div className="vtt2-toolbar">
      <span className="vtt2-brand">VTT v2</span>
      <button
        className={"chip" + (scenesOpen ? " active" : "")}
        onClick={onToggleScenes}
        disabled={!onToggleScenes}
        title="Scene browser — list, create, rename, and switch scenes"
      >
        Scenes
      </button>
      <button
        className={"chip" + (actorsOpen ? " active" : "")}
        onClick={onToggleActors}
        disabled={!onToggleActors}
        title="Actors — spawn linked vault characters as tokens"
      >
        Actors
      </button>
      <button
        className={"chip" + (encounterOpen ? " active" : "")}
        onClick={onToggleEncounter}
        disabled={!onToggleEncounter}
        title="Encounter — initiative, turn order, round counter, HP/status"
      >
        Encounter
      </button>
      <button
        className={"chip" + (assetsOpen ? " active" : "")}
        onClick={onToggleAssets}
        disabled={!onToggleAssets}
        title="Assets — map backgrounds + token art"
      >
        Assets
      </button>
      <button
        className={"chip" + (rollsOpen ? " active" : "")}
        onClick={onToggleRolls}
        disabled={!onToggleRolls}
        title="Roll feed — recent + live dice rolls"
      >
        Rolls
      </button>
      {VTT_TOOLS.map((t) => (
        <button key={t.id} className={"chip" + (tool === t.id ? " active" : "")} onClick={() => onTool(t.id)} title={t.hint}>
          {t.label}
        </button>
      ))}
      <button className={"chip" + (fogOn ? " active" : "")} onClick={onToggleFog} title="Fog of war — vision from tokens + lights, blocked by walls">
        Fog
      </button>
      <span className="vtt2-hint">{hint}</span>
      <span className="rank-spacer" />
      {syncOn && (
        <span className="vtt2-sync" title={`Live sync — ${syncPeers} peer${syncPeers === 1 ? "" : "s"} in the room`}>
          Live · {syncPeers}
        </span>
      )}
      <input
        className="vtt2-scene-name"
        value={sceneName}
        placeholder="Scene name"
        disabled={!campaignReady}
        onChange={(e) => onRename(e.target.value)}
      />
      <span className="vtt2-meta">{tokenCount} tokens</span>
    </div>
  );
}
