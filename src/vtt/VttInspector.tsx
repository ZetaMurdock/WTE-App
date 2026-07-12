import type { VttSelection } from "./engine/PixiVttApp";
import { TOKEN_COLORS, type VttLight, type VttScene, type VttToken, type VttWall } from "./types/scene";

interface Props {
  sel: NonNullable<VttSelection>;
  scene: VttScene;
  onToken: (patch: Partial<VttToken>) => void;
  onWall: (patch: Partial<VttWall>) => void;
  onLight: (patch: Partial<VttLight>) => void;
  onDelete: () => void;
  onClose: () => void;
}

const LIGHT_COLORS = ["#a08a4f", "#689a96", "#837aae", "#a1584a", "#a7aebd"];

export function VttInspector({ sel, scene, onToken, onWall, onLight, onDelete, onClose }: Props) {
  const token = sel.kind === "token" ? scene.data.tokens.find((t) => t.id === sel.id) : null;
  const wall = sel.kind === "wall" ? scene.data.walls.find((w) => w.id === sel.id) : null;
  const light = sel.kind === "light" ? scene.data.lights.find((l) => l.id === sel.id) : null;
  if (!token && !wall && !light) return null;

  return (
    <div className="vtt2-inspector">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {sel.kind === "token" ? "Token" : sel.kind === "wall" ? "Wall" : "Light"}
        </span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
      </div>

      {token && (
        <>
          <label className="lobby-field">
            <span>Name</span>
            <input className="bg-select full" value={token.name} onChange={(e) => onToken({ name: e.target.value })} />
          </label>
          <div className="vtt2-hp-row" style={{ marginTop: 10 }}>
            <label className="lobby-field">
              <span>Size (cells)</span>
              <input
                className="bg-select full"
                type="number"
                min={1}
                max={6}
                value={token.size}
                onChange={(e) => onToken({ size: Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1)) })}
              />
            </label>
            <label className="lobby-field">
              <span>Vision (cells)</span>
              <input
                className="bg-select full"
                type="number"
                min={0}
                max={30}
                value={token.vision ?? 5}
                onChange={(e) => onToken({ vision: Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0)) })}
              />
            </label>
          </div>
          <div className="lobby-field mt">
            <span>Color</span>
            <div className="seq-pick-row" style={{ marginBottom: 0 }}>
              {TOKEN_COLORS.map((c) => (
                <button key={c} className={"seq-swatch" + (token.color === c ? " on" : "")} style={{ background: c }} onClick={() => onToken({ color: c })} />
              ))}
            </div>
          </div>
          <div className="vtt2-hp-row">
            <label className="lobby-field">
              <span>HP</span>
              <input className="bg-select full" type="number" value={token.hp ?? 0} onChange={(e) => onToken({ hp: parseInt(e.target.value, 10) || 0 })} />
            </label>
            <label className="lobby-field">
              <span>Max</span>
              <input className="bg-select full" type="number" value={token.hpMax ?? 0} onChange={(e) => onToken({ hpMax: parseInt(e.target.value, 10) || 0 })} />
            </label>
          </div>
        </>
      )}

      {wall && (
        <button
          className={"chip" + (wall.blocksLight ? " active" : "")}
          onClick={() => onWall({ blocksLight: !wall.blocksLight })}
          title="Whether this wall blocks sight/light"
        >
          {wall.blocksLight ? "Blocks sight" : "See-through"}
        </button>
      )}

      {light && (
        <>
          <label className="lobby-field">
            <span>Radius (cells)</span>
            <input
              className="bg-select full"
              type="number"
              min={1}
              max={30}
              value={light.radius}
              onChange={(e) => onLight({ radius: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)) })}
            />
          </label>
          <label className="lobby-field mt">
            <span>Intensity</span>
            <input
              className="bg-select full"
              type="number"
              step={0.1}
              min={0.1}
              max={1}
              value={light.intensity}
              onChange={(e) => onLight({ intensity: Math.max(0.1, Math.min(1, parseFloat(e.target.value) || 0.5)) })}
            />
          </label>
          <div className="lobby-field mt">
            <span>Color</span>
            <div className="seq-pick-row" style={{ marginBottom: 0 }}>
              {LIGHT_COLORS.map((c) => (
                <button key={c} className={"seq-swatch" + (light.color === c ? " on" : "")} style={{ background: c }} onClick={() => onLight({ color: c })} />
              ))}
            </div>
          </div>
        </>
      )}

      <button className="icon-btn" style={{ marginTop: 12 }} onClick={onDelete}>
        Delete {sel.kind}
      </button>
    </div>
  );
}
