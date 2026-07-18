import { useRef, useState } from "react";
import { ZONE_KINDS, defaultAtmosphere, defaultShader, newId, type VttAtmosphere, type VttBackground, type VttFogMode, type VttFogState, type VttGrid, type VttLight, type VttLinkEdge, type VttSceneLink, type VttShader, type VttTerrain, type VttZoneKind } from "./types/scene";
import { LIGHT_DIRECTIONS } from "./engine/systems/lightState";
import { listShaderPresets, saveShaderPreset, deleteShaderPreset, isBuiltinPreset, type ShaderPreset } from "../lib/shaderPresets";
import { listZonePresets, saveZonePreset } from "../lib/zonePresets";
import { ZONE_DEFAULT_BODIES } from "./engine/layers/ZoneLayer";

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
  fog: VttFogState;
  onFog: (patch: { mode?: VttFogMode; decaySeconds?: number; lanterns?: boolean }) => void;
  /** Every light in the scene — bulk configuration. */
  lightCount: number;
  onAllLights: (patch: Partial<VttLight>) => void;
  /** Other scenes in the campaign (portal targets) + this scene's border links. */
  otherScenes: { id: string; name: string }[];
  links: VttSceneLink[];
  onLinks: (links: VttSceneLink[]) => void;
  /** Painted effect zones: cell counts per kind + the armed brush. */
  zones: Partial<Record<VttZoneKind, string[]>>;
  zoneBrush: { kind: VttZoneKind; erase: boolean } | null;
  onZoneBrush: (brush: { kind: VttZoneKind; erase: boolean } | null) => void;
  onZoneClear: (kind: VttZoneKind) => void;
  /** Custom GLSL body per zone slot ("" = built-in effect). */
  zoneGlsl: Partial<Record<VttZoneKind, string>>;
  onZoneGlsl: (kind: VttZoneKind, body: string) => void;
  /** Freehand-drawing table rules (Curator). */
  allowPlayerDraw: boolean;
  onAllowPlayerDraw: (allow: boolean) => void;
  onClearDrawings: () => void;
  onSetMusic: () => void;
  onClearMusic: () => void;
  onMusicVolume: (v: number) => void;
  onClose: () => void;
}

type StudioTab = "grid" | "terrain" | "atmosphere" | "fog" | "lights" | "shaders" | "zones" | "portals" | "music";
const STUDIO_TABS: { id: StudioTab; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "terrain", label: "Terrain" },
  { id: "atmosphere", label: "Atmos" },
  { id: "fog", label: "Fog" },
  { id: "lights", label: "Lights" },
  { id: "shaders", label: "Shaders" },
  { id: "zones", label: "Zones" },
  { id: "portals", label: "Portals" },
  { id: "music", label: "Music" },
];

// Per-slot GLSL editor (remounted per slot via key so drafts don't bleed).
function ZoneGlslEditor({ kind, current, error, onApply }: { kind: VttZoneKind; current: string; error: string; onApply: (body: string) => void }) {
  const [draft, setDraft] = useState(current || ZONE_DEFAULT_BODIES[kind]);
  const [presetName, setPresetName] = useState("");
  const presets = listZonePresets();
  return (
    <div className="zone-editor">
      <div className="scene-studio-sub">Effect code · {kind}</div>
      <select
        className="bg-select full"
        value=""
        onChange={(e) => {
          const p = presets.find((x) => x.name === e.target.value);
          if (p) setDraft(p.body);
        }}
      >
        <option value="">Load a preset…</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <div className={"shader-editor" + (error ? " error" : "")} style={{ marginTop: 6 }}>
        <textarea
          className="shader-code"
          spellCheck={false}
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"// set col (vec3) + alpha (float)\n// inputs: mask (0..1), pc (world cells), uTime (s)"}
        />
      </div>
      {error && <div className="equip-warn">{error}</div>}
      <div className="chip-row" style={{ marginTop: 6 }}>
        <button className="chip" onClick={() => onApply(draft)}>Apply</button>
        <button className="chip" onClick={() => { setDraft(ZONE_DEFAULT_BODIES[kind]); onApply(""); }} title="Back to the built-in effect">
          Reset to built-in
        </button>
      </div>
      <div className="chip-row" style={{ marginTop: 6 }}>
        <input className="bg-select" style={{ flex: 1 }} placeholder="Preset name…" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
        <button
          className="chip"
          disabled={!presetName.trim()}
          onClick={() => {
            saveZonePreset(presetName.trim(), draft);
            setPresetName("");
          }}
        >
          Save preset
        </button>
      </div>
      <p className="size-note" style={{ marginTop: 6 }}>
        Contract: set <code>col</code> (vec3) and <code>alpha</code> (float) using <code>mask</code> (feathered 0..1),{" "}
        <code>pc</code> (world cell coords), <code>uTime</code> (seconds). A bad chunk reports here and the slot falls back
        to its built-in — on every player's machine too.
      </p>
    </div>
  );
}

const ZONE_INFO: Record<VttZoneKind, { label: string; desc: string }> = {
  water: { label: "Water", desc: "Wavy green-teal, caustic shimmer" },
  smoke: { label: "Smoke", desc: "Pale drifting wisps" },
  ember: { label: "Embers", desc: "Molten veins, warm pulse" },
  auxa: { label: "Custom A", desc: "Yours to design — violet haze by default" },
  auxb: { label: "Custom B", desc: "Yours to design — cyan weave by default" },
  auxc: { label: "Custom C", desc: "Yours to design — amber motes by default" },
};

const EDGES: { id: VttLinkEdge; label: string }[] = [
  { id: "north", label: "North edge (top)" },
  { id: "south", label: "South edge (bottom)" },
  { id: "east", label: "East edge (right)" },
  { id: "west", label: "West edge (left)" },
];

const FOG_MODES: { id: VttFogMode; label: string; desc: string }[] = [
  { id: "pitch", label: "Pitch black", desc: "No memory — the moment you leave an area it goes fully black again." },
  { id: "remembered", label: "Remembered", desc: "Explored areas stay dimly visible (the classic). Default." },
  { id: "realistic", label: "Hyper-realistic", desc: "Memory DECAYS — areas you leave slowly sink back to pitch black. Creepy." },
];

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
      out[i] = Math.round(((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255) * 100) / 100;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Scene Studio: a full-height side panel that gathers every per-scene control —
// grid, background, terrain, atmosphere, the custom shader editor, and music —
// into tabbed sections instead of one cramped scrolling dropdown.
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
  fog,
  onFog,
  lightCount,
  onAllLights,
  otherScenes,
  links,
  onLinks,
  zones,
  zoneBrush,
  onZoneBrush,
  onZoneClear,
  zoneGlsl,
  onZoneGlsl,
  allowPlayerDraw,
  onAllowPlayerDraw,
  onClearDrawings,
  onSetMusic,
  onClearMusic,
  onMusicVolume,
  onClose,
}: Props) {
  const [tab, setTab] = useState<StudioTab>("grid");
  const fit = background.fit ?? "grid";
  const terrainFileRef = useRef<HTMLInputElement>(null);
  const atmo = atmosphere ?? defaultAtmosphere();
  const patchAtmo = (p: Partial<VttAtmosphere>) => onAtmosphere({ ...atmo, ...p });
  const shader = atmo.shader ?? defaultShader();
  const patchShader = (p: Partial<VttShader>) => patchAtmo({ shader: { ...shader, ...p } });
  const [presets, setPresets] = useState<ShaderPreset[]>(() => listShaderPresets());
  const [presetName, setPresetName] = useState("");

  async function onHeightmapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const heights = await heightsFromImage(f, grid.cols, grid.rows).catch(() => null);
    if (heights) onTerrain({ heights, maxCells: terrain?.maxCells ?? 2 });
  }

  return (
    <div className="scene-studio">
      <div className="scene-studio-head">
        <span className="scene-studio-title">Scene Studio</span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="scene-studio-tabs">
        {STUDIO_TABS.map((t) => (
          <button key={t.id} className={"scene-studio-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="scene-studio-body">
        {tab === "grid" && (
          <>
            <label className="lobby-field">
              <span>Cell size · {grid.size}px</span>
              <input type="range" min={30} max={140} step={5} value={grid.size} onChange={(e) => onGrid({ size: parseInt(e.target.value, 10) })} />
            </label>
            <div className="vtt2-hp-row">
              <label className="lobby-field">
                <span>Columns</span>
                <input className="bg-select full" type="number" min={5} max={200} value={grid.cols} onChange={(e) => onGrid({ cols: Math.max(5, Math.min(200, parseInt(e.target.value, 10) || 5)) })} />
              </label>
              <label className="lobby-field">
                <span>Rows</span>
                <input className="bg-select full" type="number" min={5} max={200} value={grid.rows} onChange={(e) => onGrid({ rows: Math.max(5, Math.min(200, parseInt(e.target.value, 10) || 5)) })} />
              </label>
            </div>
            <div className="scene-studio-sub">Drawing</div>
            <div className="chip-row">
              <button
                className={"chip" + (allowPlayerDraw ? " active" : "")}
                onClick={() => onAllowPlayerDraw(!allowPlayerDraw)}
                title="May players use the Draw tool on this scene?"
              >
                Players can draw
              </button>
              <button className="chip" onClick={onClearDrawings} title="Erase every annotation on this scene (synced)">
                Clear drawings
              </button>
            </div>
            <button className={"chip" + (grid.visible ? " active" : "")} style={{ marginTop: 8 }} onClick={() => onGrid({ visible: !grid.visible })}>
              {grid.visible ? "Grid lines shown" : "Grid lines hidden"}
            </button>

            <div className="scene-studio-sub">Background</div>
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
                  <input type="range" min={0.2} max={3} step={0.05} value={background.scale || 1} onChange={(e) => onBackground({ scale: parseFloat(e.target.value) })} />
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
          </>
        )}

        {tab === "terrain" && (
          <>
            <input ref={terrainFileRef} type="file" accept="image/*" hidden onChange={(e) => void onHeightmapFile(e)} />
            <button className="vtt2-scene-new" onClick={() => terrainFileRef.current?.click()}>
              {terrain ? "Replace heightmap" : "Upload heightmap (grayscale)"}
            </button>
            {terrain && (
              <>
                <label className="lobby-field mt">
                  <span>Max height · {terrain.maxCells} cell{terrain.maxCells === 1 ? "" : "s"}</span>
                  <input type="range" min={0.5} max={6} step={0.5} value={terrain.maxCells} onChange={(e) => onTerrain({ heights: terrain.heights, maxCells: parseFloat(e.target.value) })} />
                </label>
                <button className="chip" style={{ marginTop: 6 }} onClick={() => onTerrain(null)}>
                  Clear terrain
                </button>
              </>
            )}
            <p className="vtt2-actor-hint" style={{ marginTop: 6 }}>
              White = high, black = flat. Elevation shows in the 3D view; tokens and fog sit on it. Re-upload after resizing the grid.
            </p>
          </>
        )}

        {tab === "atmosphere" && (
          <>
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
          </>
        )}

        {tab === "fog" && (
          <>
            <div className="scene-studio-sub">Darkness level</div>
            <div className="fog-mode-list">
              {FOG_MODES.map((m) => (
                <button
                  key={m.id}
                  className={"fog-mode-card" + ((fog.mode ?? "remembered") === m.id ? " active" : "")}
                  onClick={() => onFog({ mode: m.id })}
                >
                  <span className="fog-mode-name">{m.label}</span>
                  <span className="fog-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
            {(fog.mode ?? "remembered") === "realistic" && (
              <label className="lobby-field mt">
                <span>Fade-out time · seconds until a left area is fully black</span>
                <input
                  className="bg-select full"
                  type="number"
                  min={5}
                  max={3600}
                  value={fog.decaySeconds ?? 90}
                  onChange={(e) => onFog({ decaySeconds: Math.max(5, Math.min(3600, parseInt(e.target.value, 10) || 90)) })}
                />
              </label>
            )}
            {(fog.mode ?? "remembered") === "realistic" && (
              <button
                className={"chip mt" + (fog.lanterns !== false ? " active" : "")}
                onClick={() => onFog({ lanterns: fog.lanterns === false })}
                title="ON: lights start dark and players must click them alight, then they burn down. OFF: every light simply burns — no lantern mechanic."
              >
                {fog.lanterns !== false ? "Players light lanterns" : "Lights always burning"}
              </button>
            )}
            <p className="size-note" style={{ marginTop: 10 }}>
              Fog on/off lives on the action bar; "Reset fog" there wipes exploration progress. The level applies to this scene and syncs to everyone.
            </p>
          </>
        )}

        {tab === "lights" && (
          <>
            <div className="scene-studio-sub">All lights · {lightCount} in this scene</div>
            {lightCount === 0 ? (
              <p className="size-note">No lights yet — place them with the Light tool, then configure them all together here.</p>
            ) : (
              <>
                <p className="size-note" style={{ marginBottom: 8 }}>
                  Each control below applies to EVERY light at once. Individual lights stay editable by clicking them.
                </p>
                <div className="vtt2-hp-row">
                  <label className="lobby-field">
                    <span>Radius (cells)</span>
                    <input className="bg-select full" type="number" min={1} max={30} defaultValue={6}
                      onKeyDown={(e) => { if (e.key === "Enter") onAllLights({ radius: Math.max(1, Math.min(30, parseInt((e.target as HTMLInputElement).value, 10) || 6)) }); }}
                      onBlur={(e) => onAllLights({ radius: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 6)) })}
                    />
                  </label>
                  <label className="lobby-field">
                    <span>Intensity</span>
                    <input className="bg-select full" type="number" step={0.1} min={0.1} max={1} defaultValue={0.5}
                      onBlur={(e) => onAllLights({ intensity: Math.max(0.1, Math.min(1, parseFloat(e.target.value) || 0.5)) })}
                    />
                  </label>
                </div>
                <div className="lobby-field mt">
                  <span>Colour — applies to all</span>
                  <div className="seq-pick-row" style={{ marginBottom: 0, alignItems: "center" }}>
                    {["#a08a4f", "#689a96", "#837aae", "#a1584a", "#a7aebd"].map((c) => (
                      <button key={c} className="seq-swatch" style={{ background: c }} onClick={() => onAllLights({ color: c })} />
                    ))}
                    <input type="color" className="light-color-pick" defaultValue="#a08a4f" onChange={(e) => onAllLights({ color: e.target.value })} title="Any colour you like" />
                  </div>
                </div>
                <div className="lobby-field mt">
                  <span>Point them all</span>
                  <div className="chip-row" style={{ flexWrap: "wrap" }}>
                    {LIGHT_DIRECTIONS.map((d) => (
                      <button key={d.label} className="chip" onClick={() => onAllLights({ dir: d.rad, cone: 90 })} title={`Aim every light ${d.label}`}>
                        {d.label}
                      </button>
                    ))}
                    <button className="chip" onClick={() => onAllLights({ cone: 360 })} title="Back to omnidirectional">Omni</button>
                  </div>
                </div>
                <label className="lobby-field mt">
                  <span>Cone spread° (applies to all)</span>
                  <input className="bg-select full" type="number" min={10} max={359} defaultValue={90}
                    onBlur={(e) => onAllLights({ cone: Math.max(10, Math.min(359, parseInt(e.target.value, 10) || 90)) })}
                  />
                </label>
                <div className="vtt2-hp-row mt">
                  <button className="chip" onClick={() => onAllLights({ alwaysOn: true })} title="Exempt every light from the lit/burn mechanic">All always on</button>
                  <button className="chip" onClick={() => onAllLights({ alwaysOn: false })} title="Every light obeys the lantern mechanic again">All burn down</button>
                </div>
                <div className="vtt2-hp-row mt">
                  <button className="chip" onClick={() => onAllLights({ lit: true, litAt: Date.now() })} title="Light every lantern now">Light them all</button>
                  <button className="chip" onClick={() => onAllLights({ lit: false })} title="Snuff every lantern">Snuff them all</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === "shaders" && (
          <>
            <div className="chip-row" style={{ marginBottom: 8 }}>
              <button className={"chip" + (shader.heightFog ? " active" : "")} onClick={() => patchShader({ heightFog: !shader.heightFog })} title="Volumetric fog that's thick low and thins as you climb">
                {shader.heightFog ? "Height fog ON" : "Height fog OFF"}
              </button>
            </div>
            {!shader.heightFog ? (
              <p className="vtt2-actor-hint">Height-based volumetric fog for the 3D view — thick in valleys, thinning as you climb. Turn it on to tune it or write a custom shader.</p>
            ) : (
              <>
                <div className="scene-studio-sub">Presets</div>
                <div className="shader-preset-grid">
                  {presets.map((p) => (
                    <div key={p.name} className="shader-preset-card" onClick={() => patchShader({ ...p.shader, heightFog: true })} title="Apply this preset">
                      <span className="shader-preset-swatch" style={{ background: p.shader.color }} />
                      <span className="shader-preset-name">{p.name}</span>
                      {p.shader.glsl?.trim() && <span className="shader-preset-tag">GLSL</span>}
                      {!isBuiltinPreset(p.name) && (
                        <button
                          className="shader-preset-del"
                          title="Delete preset"
                          onClick={(e) => { e.stopPropagation(); deleteShaderPreset(p.name); setPresets(listShaderPresets()); }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="scene-studio-sub">Parameters</div>
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

                <div className="scene-studio-sub">
                  Fragment shader (GLSL)
                  {shader.glsl?.trim() ? <span className="shader-badge custom">custom</span> : <span className="shader-badge">built-in</span>}
                </div>
                <div className={"shader-editor" + (shaderError ? " error" : "")}>
                  <textarea
                    className="shader-code"
                    spellCheck={false}
                    placeholder={"// Runs over the 2D map. Modify `color` (vec4) using `uv`, `uTime`,\n// `uResolution`; re-sample `uTexture` for distortion. Example:\nvec2 w = uv;\nw.x += sin(uv.y * 90.0 + uTime * 1.6) * 0.0018;\ncolor = texture(uTexture, w);"}
                    value={shader.glsl ?? ""}
                    onChange={(e) => patchShader({ glsl: e.target.value })}
                  />
                  {shaderError ? (
                    <div className="shader-status err">⚠ {shaderError}</div>
                  ) : (
                    <div className="shader-status ok">
                      {shader.glsl?.trim() ? "compiled ✓" : "using slider params"} · in scope: vWorldPos · cameraPosition · uFog* · gl_FragColor
                    </div>
                  )}
                </div>
                {shader.glsl?.trim() && (
                  <button className="chip" style={{ marginTop: 6 }} onClick={() => patchShader({ glsl: "" })}>
                    Reset to slider fog
                  </button>
                )}

                <div className="scene-studio-sub">Save preset</div>
                <div className="vtt2-asset-add-row">
                  <input className="bg-select" style={{ flex: 1 }} placeholder="Preset name…" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                  <button
                    className="chip"
                    disabled={!presetName.trim()}
                    onClick={() => { saveShaderPreset(presetName.trim(), shader); setPresets(listShaderPresets()); setPresetName(""); }}
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {tab === "zones" && (
          <>
            <div className="scene-studio-sub">Effect brushes</div>
            <p className="size-note">
              Pick a brush, then click or drag over map tiles with the Paint tool (it arms automatically). Each kind renders as a
              living shader region — feathered edges, animated, synced to everyone.
            </p>
            <div className="fog-mode-list" style={{ marginTop: 8 }}>
              {ZONE_KINDS.map((k) => {
                const armed = zoneBrush?.kind === k;
                const count = zones[k]?.length ?? 0;
                return (
                  <button
                    key={k}
                    className={"fog-mode-card" + (armed ? " active" : "")}
                    onClick={() => onZoneBrush(armed ? null : { kind: k, erase: zoneBrush?.erase ?? false })}
                  >
                    <span className="fog-mode-name">
                      {ZONE_INFO[k].label}
                      {count > 0 ? ` · ${count} tiles` : ""}
                    </span>
                    <span className="fog-mode-desc">{ZONE_INFO[k].desc}</span>
                  </button>
                );
              })}
            </div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              <button
                className={"chip" + (zoneBrush?.erase ? " active" : "")}
                onClick={() => zoneBrush && onZoneBrush({ ...zoneBrush, erase: !zoneBrush.erase })}
                disabled={!zoneBrush}
                title="Erase mode — the brush removes tiles instead of adding them"
              >
                Erase
              </button>
              {ZONE_KINDS.filter((k) => (zones[k]?.length ?? 0) > 0).map((k) => (
                <button key={k} className="chip" onClick={() => onZoneClear(k)} title={`Remove every ${ZONE_INFO[k].label} tile`}>
                  Clear {ZONE_INFO[k].label.toLowerCase()}
                </button>
              ))}
            </div>
            {zoneBrush && (
              <>
                <p className="size-note" style={{ marginTop: 10 }}>
                  Brush armed: {ZONE_INFO[zoneBrush.kind].label}
                  {zoneBrush.erase ? " (erasing)" : ""} — paint on the map now.
                </p>
                <ZoneGlslEditor
                  key={zoneBrush.kind}
                  kind={zoneBrush.kind}
                  current={zoneGlsl[zoneBrush.kind] ?? ""}
                  error={shaderError.startsWith("Zone " + zoneBrush.kind) ? shaderError : ""}
                  onApply={(body) => onZoneGlsl(zoneBrush.kind, body)}
                />
              </>
            )}
          </>
        )}

        {tab === "portals" && (
          <>
            <div className="scene-studio-sub">Border portals</div>
            {otherScenes.length === 0 ? (
              <p className="size-note">Create another scene first — portals link this map's borders to it.</p>
            ) : (
              <>
                {links.length === 0 && <p className="size-note">No portals yet. A portal turns a map border into a doorway to another scene.</p>}
                {links.map((l) => (
                  <div key={l.id} className="portal-row">
                    <select
                      className="bg-select"
                      value={l.edge}
                      onChange={(e) => onLinks(links.map((x) => (x.id === l.id ? { ...x, edge: e.target.value as VttLinkEdge } : x)))}
                    >
                      {EDGES.map((ed) => (
                        <option key={ed.id} value={ed.id}>{ed.label}</option>
                      ))}
                    </select>
                    <select
                      className="bg-select"
                      value={l.targetSceneId}
                      onChange={(e) => onLinks(links.map((x) => (x.id === l.id ? { ...x, targetSceneId: e.target.value } : x)))}
                    >
                      {otherScenes.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button className="icon-btn" onClick={() => onLinks(links.filter((x) => x.id !== l.id))} title="Remove this portal">
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="primary-btn full mt"
                  onClick={() => onLinks([...links, { id: newId("ln"), edge: "east", targetSceneId: otherScenes[0].id }])}
                >
                  Add portal
                </button>
                <p className="size-note" style={{ marginTop: 10 }}>
                  Walking a token into a linked border carries it through — it arrives just inside the opposite edge of the target
                  map, same relative position. With players connected you'll be asked whether the whole party travels.
                </p>
              </>
            )}
          </>
        )}

        {tab === "music" && (
          <>
            <div className="chip-row">
              <button className="chip" onClick={onSetMusic}>{audio ? "Replace track…" : "Add track…"}</button>
              {audio && <button className="chip" onClick={onClearMusic}>Remove</button>}
            </div>
            {audio ? (
              <label className="lobby-field mt">
                <span>Volume · {Math.round((audio.volume ?? 0.5) * 100)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={audio.volume ?? 0.5} onChange={(e) => onMusicVolume(parseFloat(e.target.value))} />
              </label>
            ) : (
              <p className="vtt2-actor-hint" style={{ marginTop: 8 }}>Ambient music loops while this scene is active and stops when you switch. Stored with the scene.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
