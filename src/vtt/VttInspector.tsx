import type { VttSelection } from "./engine/PixiVttApp";
import {
  TOKEN_COLORS,
  type VttEffectData,
  type VttEffectKind,
  type VttLight,
  type VttScene,
  type VttToken,
  type VttWall,
} from "./types/scene";

interface Props {
  sel: NonNullable<VttSelection>;
  scene: VttScene;
  onToken: (patch: Partial<VttToken>) => void;
  onWall: (patch: Partial<VttWall>) => void;
  onLight: (patch: Partial<VttLight>) => void;
  onEffect: (patch: Partial<VttEffectData>) => void;
  onEffectKind: (kind: VttEffectKind) => void;
  onDelete: () => void;
  onClose: () => void;
}

const LIGHT_COLORS = ["#a08a4f", "#689a96", "#837aae", "#a1584a", "#a7aebd"];
const EFFECT_COLORS = ["#837aae", "#a1584a", "#a08a4f", "#689a96", "#6f9a68"];

export function VttInspector({ sel, scene, onToken, onWall, onLight, onEffect, onEffectKind, onDelete, onClose }: Props) {
  const token = sel.kind === "token" ? scene.data.tokens.find((t) => t.id === sel.id) : null;
  const wall = sel.kind === "wall" ? scene.data.walls.find((w) => w.id === sel.id) : null;
  const light = sel.kind === "light" ? scene.data.lights.find((l) => l.id === sel.id) : null;
  const effect = sel.kind === "effect" ? scene.data.effects.find((e) => e.id === sel.id) : null;
  if (!token && !wall && !light && !effect) return null;

  function addTokenStatus() {
    if (!token) return;
    const s = prompt("Add status / condition");
    if (s && s.trim() && !(token.statuses ?? []).includes(s.trim())) {
      onToken({ statuses: [...(token.statuses ?? []), s.trim()] });
    }
  }

  return (
    <div className="vtt2-inspector">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {sel.kind === "token" ? "Token" : sel.kind === "wall" ? "Wall" : sel.kind === "light" ? "Light" : "Effect"}
        </span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
      </div>

      {token && (
        <>
          {token.actorKind && (
            <div className="vtt2-linked" title={token.actorKind === "character" ? "Linked to a vault character" : "Linked to a Codex creature"}>
              <span className="vtt2-linked-tag">Linked {token.actorKind === "character" ? "Character" : "Creature"}</span>
              {typeof token.meta?.dr === "number" && token.meta.dr > 0 && <span className="vtt2-linked-meta">DR {token.meta.dr}</span>}
              {token.meta?.flags && token.meta.flags.length > 0 && <span className="vtt2-linked-meta">{token.meta.flags.length} trait{token.meta.flags.length === 1 ? "" : "s"}</span>}
            </div>
          )}
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
          <div className="lobby-field mt">
            <span>Statuses</span>
            <div className="vtt2-enc-statuses" style={{ marginTop: 2 }}>
              {(token.statuses ?? []).map((s) => (
                <button
                  key={s}
                  className="vtt2-enc-status"
                  title="Remove status"
                  onClick={() => onToken({ statuses: (token.statuses ?? []).filter((x) => x !== s) })}
                >
                  {s} ×
                </button>
              ))}
              <button className="vtt2-enc-status-add" onClick={addTokenStatus} title="Add status">
                +st
              </button>
            </div>
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

      {effect && (
        <>
          <label className="lobby-field">
            <span>Shape</span>
            <select className="bg-select full" value={effect.kind} onChange={(e) => onEffectKind(e.target.value as VttEffectKind)}>
              <option value="circle">Circle (AoE)</option>
              <option value="cone">Cone</option>
              <option value="zone">Zone (rect)</option>
            </select>
          </label>
          {effect.kind === "zone" ? (
            <div className="vtt2-hp-row">
              <label className="lobby-field">
                <span>Width</span>
                <input className="bg-select full" type="number" min={1} max={40} value={effect.data.w ?? 4} onChange={(e) => onEffect({ w: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
              </label>
              <label className="lobby-field">
                <span>Height</span>
                <input className="bg-select full" type="number" min={1} max={40} value={effect.data.h ?? 4} onChange={(e) => onEffect({ h: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
              </label>
            </div>
          ) : (
            <div className="vtt2-hp-row">
              <label className="lobby-field">
                <span>Radius</span>
                <input className="bg-select full" type="number" min={1} max={30} value={effect.data.radius ?? 3} onChange={(e) => onEffect({ radius: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
              </label>
              {effect.kind === "cone" && (
                <label className="lobby-field">
                  <span>Angle°</span>
                  <input className="bg-select full" type="number" min={10} max={180} value={effect.data.angle ?? 60} onChange={(e) => onEffect({ angle: Math.max(10, Math.min(180, parseInt(e.target.value, 10) || 60)) })} />
                </label>
              )}
            </div>
          )}
          <label className="lobby-field mt">
            <span>Lifetime (rounds · 0 = ∞)</span>
            <input className="bg-select full" type="number" min={0} max={99} value={effect.data.rounds ?? 0} onChange={(e) => onEffect({ rounds: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
          </label>
          {effect.kind === "zone" && (
            <label className="lobby-field mt">
              <span>Applies status</span>
              <input className="bg-select full" value={effect.data.status ?? ""} placeholder="e.g. difficult" onChange={(e) => onEffect({ status: e.target.value || undefined })} />
            </label>
          )}
          <div className="lobby-field mt">
            <span>Color</span>
            <div className="seq-pick-row" style={{ marginBottom: 0 }}>
              {EFFECT_COLORS.map((c) => (
                <button key={c} className={"seq-swatch" + (effect.data.color === c ? " on" : "")} style={{ background: c }} onClick={() => onEffect({ color: c })} />
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
