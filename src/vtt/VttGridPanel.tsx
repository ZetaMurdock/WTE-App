import type { VttBackground, VttGrid } from "./types/scene";

interface Props {
  grid: VttGrid;
  background: VttBackground;
  onGrid: (patch: Partial<VttGrid>) => void;
  onBackground: (patch: Partial<VttBackground>) => void;
  onClose: () => void;
}

// Curator grid & map controls: resize the grid (cell size / cols / rows) and
// control how the background image fits (fill the whole grid, or manual scale).
export function VttGridPanel({ grid, background, onGrid, onBackground, onClose }: Props) {
  const fit = background.fit ?? "grid";
  return (
    <div className="vtt2-gridpanel">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Grid &amp; Map
        </span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      <label className="lobby-field">
        <span>Cell size · {grid.size}px</span>
        <input type="range" min={30} max={140} step={5} value={grid.size} onChange={(e) => onGrid({ size: parseInt(e.target.value, 10) })} />
      </label>
      <div className="vtt2-hp-row">
        <label className="lobby-field">
          <span>Columns</span>
          <input
            className="bg-select full"
            type="number"
            min={5}
            max={200}
            value={grid.cols}
            onChange={(e) => onGrid({ cols: Math.max(5, Math.min(200, parseInt(e.target.value, 10) || 5)) })}
          />
        </label>
        <label className="lobby-field">
          <span>Rows</span>
          <input
            className="bg-select full"
            type="number"
            min={5}
            max={200}
            value={grid.rows}
            onChange={(e) => onGrid({ rows: Math.max(5, Math.min(200, parseInt(e.target.value, 10) || 5)) })}
          />
        </label>
      </div>
      <button className={"chip" + (grid.visible ? " active" : "")} style={{ marginTop: 8 }} onClick={() => onGrid({ visible: !grid.visible })}>
        {grid.visible ? "Grid lines shown" : "Grid lines hidden"}
      </button>

      <div className="panel-title" style={{ marginTop: 14 }}>
        Background
      </div>
      <div className="chip-row" style={{ marginTop: 4 }}>
        <button className={"chip" + (fit === "grid" ? " active" : "")} onClick={() => onBackground({ fit: "grid" })} title="Stretch the map image to cover the whole grid">
          Fit to grid
        </button>
        <button className={"chip" + (fit === "manual" ? " active" : "")} onClick={() => onBackground({ fit: "manual" })} title="Position and scale the image yourself">
          Manual
        </button>
      </div>
      {fit === "manual" && (
        <>
          <label className="lobby-field mt">
            <span>Scale · {(background.scale || 1).toFixed(2)}×</span>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={background.scale || 1}
              onChange={(e) => onBackground({ scale: parseFloat(e.target.value) })}
            />
          </label>
          <div className="vtt2-hp-row">
            <label className="lobby-field">
              <span>Offset X</span>
              <input className="bg-select full" type="number" step={10} value={Math.round(background.x)} onChange={(e) => onBackground({ x: parseInt(e.target.value, 10) || 0 })} />
            </label>
            <label className="lobby-field">
              <span>Offset Y</span>
              <input className="bg-select full" type="number" step={10} value={Math.round(background.y)} onChange={(e) => onBackground({ y: parseInt(e.target.value, 10) || 0 })} />
            </label>
          </div>
        </>
      )}
      {!background.src && <p className="vtt2-actor-hint" style={{ marginTop: 8 }}>No map image set — add one from the Assets panel.</p>}
    </div>
  );
}
