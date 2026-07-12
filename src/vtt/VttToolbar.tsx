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
}

export function VttToolbar({ tool, onTool, sceneName, onRename, tokenCount, campaignReady, fogOn, onToggleFog }: Props) {
  const hint = VTT_TOOLS.find((t) => t.id === tool)?.hint ?? "";
  return (
    <div className="vtt2-toolbar">
      <span className="vtt2-brand">VTT v2</span>
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
