import { VTT_TOOLS, type VttTool } from "./types/tool";

interface Props {
  tool: VttTool;
  onTool: (t: VttTool) => void;
  fogOn: boolean;
  onToggleFog: () => void;
  view3d: boolean;
  onToggleView: () => void;
}

// The floating action bar (bottom-centre, Owlbear-style): the map tools live
// here so the top toolbar stays uncluttered. Tool hints ride the tooltips.
export function VttActionBar({ tool, onTool, fogOn, onToggleFog, view3d, onToggleView }: Props) {
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
      <button
        className={"vtt2-action" + (view3d ? " active" : "")}
        onClick={onToggleView}
        title="3D view — orbit the same scene in three dimensions (drag tokens, wheel zooms, right-drag pans)"
      >
        3D
      </button>
    </div>
  );
}
