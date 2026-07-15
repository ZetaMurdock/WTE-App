import { useRef, useState } from "react";
import { defaultAtmosphere, defaultShader, type VttAtmosphere, type VttBackground, type VttGrid, type VttShader, type VttTerrain } from "./types/scene";
import { listShaderPresets, saveShaderPreset, type ShaderPreset } from "../lib/shaderPresets";

interface Props {
  grid: VttGrid;
  background: VttBackground;
  terrain: VttTerrain | null;
  atmosphere: VttAtmosphere | null;
  audio: { src: string; volume: number } | null;
  shaderError: string;
  onGrid: (patch: Partial<VttGrid>) => void;
  onBackground: (patch: Partial<VttBackground>) => void;
  onTerrain: (terrain: VttTerrain | null) => void;
  onAtmosphere: (atmo: VttAtmosphere) => void;
  onSetMusic: () => void;
  onClearMusic: () => void;
  onMusicVolume: (v: number) => void;
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
export function VttGridPanel({
  grid,
  background,
  terrain,
  atmosphere,
  audio,
  shaderError,
  onGrid,
  onBackground,
  onTerrain,
  onAtmosphere,
  onSetMusic,
  onClearMusic,
  onMusicVolume,
  onClose,
}: Props) {
  const fit = background.fit ?? "grid";
  const terrainFileRef = useRef<HTMLInputElement>(null);
  const atmo = atmosphere ?? defaultAtmosphere();
  const patchAtmo = (p: Partial<VttAtmosphere>) => onAtmosphere({ ...atmo, ...p });
  const shader = atmo.shader ?? defaultShader();
  const patchShader = (p: Partial<VttShader>) => patchAtmo({ shader: { ...shader, ...p } });
  const [presets, setPresets] = useState<ShaderPreset[]>(() => listShaderPresets());
  const [showGlsl, setShowGlsl] = useState(false);
  const [presetName, setPresetName] = useState("");

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

      <div className="panel-title" style={{ marginTop: 14 }}>
        Atmosphere (2D + 3D)
      </div>
      <div className="vtt2-hp-row">
        <label className="lobby-field">
          <span>Backdrop</span>
          <select className="bg-select full" value={atmo.env} onChange={(e) => patchAtmo({ env: e.target.value as VttAtmosphere["env"] })}>
            <option value="void">Void</option>
            <option value="space">Deep space</option>
            <option value="cavern">Cavern</option>
            <option value="wireframe">Wireframe</option>
          </select>
        </label>
        <label className="lobby-field">
          <span>Mood</span>
          <select className="bg-select full" value={atmo.mood} onChange={(e) => patchAtmo({ mood: e.target.value as VttAtmosphere["mood"] })}>
            <option value="neutral">Neutral</option>
            <option value="moonlight">Moonlight</option>
            <option value="hellfire">Hellfire</option>
            <option value="toxic">Toxic</option>
            <option value="dusk">Dusk</option>
          </select>
        </label>
      </div>
      <label className="lobby-field mt">
        <span>Depth fog · {Math.round(atmo.fog * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={atmo.fog} onChange={(e) => patchAtmo({ fog: parseFloat(e.target.value) })} />
      </label>
      <div className="vtt2-hp-row" style={{ marginTop: 6 }}>
        <label className="lobby-field">
          <span>Particles</span>
          <select className="bg-select full" value={atmo.particles} onChange={(e) => patchAtmo({ particles: e.target.value as VttAtmosphere["particles"] })}>
            <option value="none">None</option>
            <option value="embers">Embers</option>
            <option value="spores">Spores</option>
            <option value="rain">Rain</option>
            <option value="snow">Snow</option>
          </select>
        </label>
        <div className="lobby-field">
          <span>Layers</span>
          <div className="chip-row" style={{ marginTop: 2 }}>
            <button className={"chip" + (atmo.mist ? " active" : "")} onClick={() => patchAtmo({ mist: !atmo.mist })} title="Crawling ground mist above the floor">
              Mist
            </button>
            <button className={"chip" + (atmo.shadows ? " active" : "")} onClick={() => patchAtmo({ shadows: !atmo.shadows })} title="Sun + nearby lights cast real shadows (GPU cost)">
              Shadows
            </button>
          </div>
        </div>
      </div>

      {/* ── Custom shader: height-based volumetric fog + presets + raw GLSL ── */}
      <div className="panel-title" style={{ marginTop: 14 }}>
        Shaders — Height Fog (3D)
      </div>
      <div className="chip-row" style={{ marginBottom: 6 }}>
        <button className={"chip" + (shader.heightFog ? " active" : "")} onClick={() => patchShader({ heightFog: !shader.heightFog })} title="Volumetric fog that's thick low and thins as you climb">
          {shader.heightFog ? "Height fog on" : "Height fog off"}
        </button>
      </div>
      {shader.heightFog && (
        <>
          <div className="vtt2-hp-row">
            <label className="lobby-field">
              <span>Density · {shader.density.toFixed(2)}</span>
              <input type="range" min={0} max={3} step={0.05} value={shader.density} onChange={(e) => patchShader({ density: parseFloat(e.target.value) })} />
            </label>
            <label className="lobby-field">
              <span>Falloff · {shader.falloff.toFixed(3)}</span>
              <input type="range" min={0.002} max={0.06} step={0.001} value={shader.falloff} onChange={(e) => patchShader({ falloff: parseFloat(e.target.value) })} />
            </label>
          </div>
          <div className="vtt2-hp-row" style={{ marginTop: 4 }}>
            <label className="lobby-field">
              <span>Colour</span>
              <input className="bg-select full" type="color" value={shader.color} onChange={(e) => patchShader({ color: e.target.value })} />
            </label>
            <label className="lobby-field">
              <span>Floor height · {shader.offset}</span>
              <input className="bg-select full" type="number" step={10} value={shader.offset} onChange={(e) => patchShader({ offset: parseInt(e.target.value, 10) || 0 })} />
            </label>
          </div>

          <label className="lobby-field mt">
            <span>Preset</span>
            <select
              className="bg-select full"
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.name === e.target.value);
                if (p) patchShader({ ...p.shader, heightFog: true });
              }}
            >
              <option value="">Apply a preset…</option>
              {presets.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          <div className="vtt2-asset-add-row" style={{ marginTop: 6 }}>
            <input className="bg-select" style={{ flex: 1 }} placeholder="Save as preset…" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <button
              className="chip"
              disabled={!presetName.trim()}
              onClick={() => {
                saveShaderPreset(presetName.trim(), shader);
                setPresets(listShaderPresets());
                setPresetName("");
              }}
            >
              Save
            </button>
          </div>

          <button className="chip" style={{ marginTop: 8 }} onClick={() => setShowGlsl((v) => !v)}>
            {showGlsl ? "Hide raw GLSL" : "Advanced — edit GLSL"}
          </button>
          {showGlsl && (
            <>
              <p className="vtt2-actor-hint" style={{ marginTop: 6 }}>
                Fragment body. Available: <code>vWorldPos</code>, <code>cameraPosition</code>, <code>uFogColor/uFogDensity/uFogHeightFalloff/uFogOffset</code>, <code>gl_FragColor</code>. Empty = the slider-driven height fog.
              </p>
              <textarea
                className="sheet-notes"
                style={{ minHeight: 130, fontFamily: "Consolas, monospace", fontSize: 11 }}
                placeholder={"float _hf = uFogDensity * exp(-(vWorldPos.y - uFogOffset) * uFogHeightFalloff);\nfloat _ff = clamp(1.0 - exp(-length(vWorldPos - cameraPosition) * _hf), 0.0, 1.0);\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, _ff);"}
                value={shader.glsl ?? ""}
                onChange={(e) => patchShader({ glsl: e.target.value })}
                spellCheck={false}
              />
              {shaderError && <p className="cdx-off-tag" style={{ display: "block", marginTop: 4 }}>Shader error: {shaderError}</p>}
            </>
          )}
        </>
      )}

      {/* ── Ambient music (reliable, persistent controls) ── */}
      <div className="panel-title" style={{ marginTop: 14 }}>
        Ambient music
      </div>
      <div className="chip-row">
        <button className="chip" onClick={onSetMusic}>{audio ? "Replace track…" : "Add track…"}</button>
        {audio && <button className="chip" onClick={onClearMusic}>Remove</button>}
      </div>
      {audio && (
        <label className="lobby-field mt">
          <span>Volume · {Math.round((audio.volume ?? 0.5) * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={audio.volume ?? 0.5} onChange={(e) => onMusicVolume(parseFloat(e.target.value))} />
        </label>
      )}
    </div>
  );
}
