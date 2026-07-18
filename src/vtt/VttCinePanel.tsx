import { useState } from "react";
import type { VttToken } from "./types/scene";
import { CINE_PRESETS, cinePresetBody, validateCineBody } from "../lib/cinePresets";

export interface CineConfig {
  on: boolean;
  tokenId?: string;
  /** The resolved GLSL body actually broadcast (preset or custom). */
  glsl?: string;
  shake?: number;
}

interface Props {
  tokens: VttToken[];
  cine: CineConfig;
  onChange: (next: CineConfig) => void;
  onClose: () => void;
}

// Director's booth (Curator only): lock every player's camera onto one token,
// shake the frame, and drive a full-screen effect — presets or your own GLSL,
// the same way the zone brushes work. Everything applies live to the room.
export function VttCinePanel({ tokens, cine, onChange, onClose }: Props) {
  const [presetId, setPresetId] = useState<string>("");
  const [customBody, setCustomBody] = useState("");
  const [glslError, setGlslError] = useState("");

  function patch(p: Partial<CineConfig>) {
    onChange({ ...cine, ...p });
  }
  function pickPreset(id: string) {
    const next = presetId === id ? "" : id;
    setPresetId(next);
    setGlslError("");
    patch({ glsl: next ? cinePresetBody(next) : undefined });
  }
  function applyCustom() {
    const body = customBody.trim();
    if (!body) {
      setGlslError("");
      setPresetId("");
      patch({ glsl: undefined });
      return;
    }
    const err = validateCineBody(body);
    setGlslError(err ?? "");
    if (!err) {
      setPresetId("");
      patch({ glsl: body });
    }
  }

  return (
    <div className="vtt2-cine">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>Cinematic</span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
      </div>

      <button
        className={"chip" + (cine.on ? " active" : "")}
        onClick={() => patch({ on: !cine.on })}
        title="While rolling, players lose their chrome and you own their screens"
      >
        {cine.on ? "● Rolling — players see your cut" : "Start cinematic"}
      </button>

      <label className="lobby-field mt">
        <span>Camera locked on</span>
        <select
          className="bg-select full"
          value={cine.tokenId ?? ""}
          onChange={(e) => patch({ tokenId: e.target.value || undefined })}
          title="Every player's camera follows this token as it moves; blank = leave their cameras alone"
        >
          <option value="">Free — don't move cameras</option>
          {tokens.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      <label className="lobby-field mt" title="Frame shake strength — explosions, tremors, impacts">
        <span>Shake · {Math.round((cine.shake ?? 0) * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={cine.shake ?? 0}
          onChange={(e) => patch({ shake: parseFloat(e.target.value) })}
        />
      </label>

      <div className="lobby-field mt">
        <span>Screen effect</span>
        <div className="chip-row" style={{ flexWrap: "wrap" }}>
          {CINE_PRESETS.map((p) => (
            <button key={p.id} className={"chip" + (presetId === p.id ? " active" : "")} title={p.note} onClick={() => pickPreset(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <label className="lobby-field mt">
        <span>Custom GLSL (same contract as map shaders — modify `color` via `uv`, `uTime`)</span>
        <textarea
          className="bg-select full"
          style={{ minHeight: 90, fontFamily: "Consolas, monospace", fontSize: 11 }}
          placeholder={"// e.g.\ncolor.rgb *= 0.6 + 0.4 * sin(uTime * 2.0);"}
          value={customBody}
          onChange={(e) => setCustomBody(e.target.value)}
        />
      </label>
      <div className="vtt2-hp-row">
        <button className="chip" onClick={applyCustom}>Apply custom effect</button>
        {(presetId || cine.glsl) && (
          <button className="chip" onClick={() => { setPresetId(""); setCustomBody(""); setGlslError(""); patch({ glsl: undefined }); }}>
            Clear effect
          </button>
        )}
      </div>
      {glslError && <div className="validation-list" style={{ marginTop: 6 }}>{glslError}</div>}
      <p className="vtt2-actor-hint" style={{ marginTop: 8 }}>
        Camera lock and hidden chrome apply to players only — your view stays free. Use Player View to feel it yourself.
      </p>
    </div>
  );
}
