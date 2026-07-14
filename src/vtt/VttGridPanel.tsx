import { useRef } from "react";
import type { VttBackground, VttGrid, VttTerrain } from "./types/scene";

interface Props {
  grid: VttGrid;
  background: VttBackground;
  terrain: VttTerrain | null;
  onGrid: (patch: Partial<VttGrid>) => void;
  onBackground: (patch: Partial<VttBackground>) => void;
  onTerrain: (terrain: VttTerrain | null) => void;
  onClose: () => void;
}

/** Sample a grayscale heightmap image to one normalised height per grid cell. */
async function heightsFromImage(file: File, cols: number, rows: number): Promise<number[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0, cols, rows);
    const px = x.getImageData(0, 0, cols, rows).data;
    const out = new Array<number>(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      // luminance 0..1, rounded to keep the scene JSON compact
      out[i] = Math.round(((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255) * 100) / 100;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Curator grid & map controls: resize the grid (cell size / cols / rows),
// control how the background image fits, and set the 3D terrain heightmap.
export function VttGridPanel({ grid, background, terrain, onGrid, onBackground, onTerrain, onClose }: Props) {
  const fit = background.fit ?? "grid";
  const terrainFileRef = useRef<HTMLInputElement>(null);

  async function onHeightmapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const heights = await heightsFromImage(f, grid.cols, grid.rows).catch(() => null);
    if (heights) onTerrain({ heights, maxCells: terrain?.maxCells ?? 2 });
  }
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

      <div className="panel-title" style={{ marginTop: 14 }}>
        Terrain (3D)
      </div>
      <input ref={terrainFileRef} type="file" accept="image/*" hidden onChange={(e) => void onHeightmapFile(e)} />
      <button className="vtt2-scene-new" style={{ marginTop: 4 }} onClick={() => terrainFileRef.current?.click()}>
        {terrain ? "Replace heightmap" : "Upload heightmap (grayscale)"}
      </button>
      {terrain && (
        <>
          <label className="lobby-field mt">
            <span>Max height · {terrain.maxCells} cell{terrain.maxCells === 1 ? "" : "s"}</span>
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={terrain.maxCells}
              onChange={(e) => onTerrain({ heights: terrain.heights, maxCells: parseFloat(e.target.value) })}
            />
          </label>
          <button className="chip" style={{ marginTop: 6 }} onClick={() => onTerrain(null)}>
            Clear terrain
          </button>
        </>
      )}
      <p className="vtt2-actor-hint" style={{ marginTop: 6 }}>
        White = high, black = flat. Elevation shows in the 3D view; tokens and fog sit on it. Re-upload after resizing the grid.
      </p>
    </div>
  );
}
