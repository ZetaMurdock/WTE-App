import { VTT_TOOLS, type VttTool } from "./types/tool";

interface Props {
  tool: VttTool;
  onTool: (t: VttTool) => void;
  fogOn: boolean;
  onToggleFog: () => void;
  /** Curator-only: wipe exploration progress (visited areas back to dark). */
  onResetFog?: () => void;
  /** Content-add quick actions (undefined hides each). Add-to-gameplay group. */
  onSpawnActor?: () => void;
  onAddAsset?: () => void;
  onOpenAbilities?: () => void;
}

// The floating action bar (bottom-centre, Owlbear-style): map tools + fog on the
// left, then a "content" group for quickly ADDING things to the encounter (spawn
// an actor, load an asset, open your abilities). Tool hints ride the tooltips.
// (The 3D view is vaulted — the 2D top-down perspective is the standard.)
export function VttActionBar({ tool, onTool, fogOn, onToggleFog, onResetFog, onSpawnActor, onAddAsset, onOpenAbilities }: Props) {
  const hasContent = onSpawnActor || onAddAsset || onOpenAbilities;
  return (
    <div className="vtt2-actionbar">
      {VTT_TOOLS.map((t) => (
        <button
          key={t.id}
          className={"vtt2-action" + (tool === t.id ? " active" : "")}
          onClick={() => onTool(t.id)}
          title={t.hint}
        >
          {t.label}
        </button>
      ))}
      <span className="vtt2-action-sep" />
      <button
        className={"vtt2-action" + (fogOn ? " active" : "")}
        onClick={onToggleFog}
        title="Fog of war — vision from tokens + lights, blocked by walls"
      >
        Fog
      </button>
      {onResetFog && fogOn && (
        <button className="vtt2-action" onClick={onResetFog} title="Reset fog — every visited area goes back to unexplored dark">
          Reset fog
        </button>
      )}
      {hasContent && <span className="vtt2-action-sep" />}
      {onSpawnActor && (
        <button className="vtt2-action add" onClick={onSpawnActor} title="Actors — spawn a linked vault character or Codex creature">
          + Actor
        </button>
      )}
      {onAddAsset && (
        <button className="vtt2-action add" onClick={onAddAsset} title="Assets — add a map background or token art">
          + Asset
        </button>
      )}
      {onOpenAbilities && (
        <button className="vtt2-action add" onClick={onOpenAbilities} title="Abilities — your actions, abilities, and base rolls">
          Abilities
        </button>
      )}
    </div>
  );
}
