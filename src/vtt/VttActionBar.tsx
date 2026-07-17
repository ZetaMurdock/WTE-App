import { VTT_TOOLS, type VttTool } from "./types/tool";

const PLAYER_TOOLS: VttTool[] = ["select", "pan", "measure"];

interface Props {
  tool: VttTool;
  onTool: (t: VttTool) => void;
  /** Curator gets the scene-builder tools; players get select/pan/measure. */
  builder: boolean;
  fogOn: boolean;
  /** Undefined hides the Fog toggle (players don't control the fog). */
  onToggleFog?: () => void;
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
export function VttActionBar({ tool, onTool, builder, fogOn, onToggleFog, onResetFog, onSpawnActor, onAddAsset, onOpenAbilities }: Props) {
  const hasContent = onSpawnActor || onAddAsset || onOpenAbilities;
  const tools = builder ? VTT_TOOLS : VTT_TOOLS.filter((t) => PLAYER_TOOLS.includes(t.id));
  return (
    <div className="vtt2-actionbar">
      {tools.map((t) => (
        <button
          key={t.id}
          className={"vtt2-action" + (tool === t.id ? " active" : "")}
          onClick={() => onTool(t.id)}
          title={t.hint}
        >
          {t.label}
        </button>
      ))}
      {onToggleFog && <span className="vtt2-action-sep" />}
      {onToggleFog && (
        <button
          className={"vtt2-action" + (fogOn ? " active" : "")}
          onClick={onToggleFog}
          title="Fog of war — vision from tokens + lights, blocked by walls"
        >
          Fog
        </button>
      )}
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
