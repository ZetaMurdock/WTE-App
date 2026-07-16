import { useState } from "react";
import type { VttAbility } from "./data/characterAbilities";
import { suggestedTemplate } from "./data/effectMeta";

export type AoeMode = "self" | "selected" | "center" | "click";
export type AoeKind = "circle" | "cone" | "zone" | "line" | "ring" | "cross";

export interface AoePlacement {
  mode: AoeMode;
  kind: AoeKind;
  cells: number;
  rounds: number;
}

interface Props {
  ability: VttAbility;
  casterName: string | null;
  hasSelectedToken: boolean;
  onPlace: (p: AoePlacement) => void;
  onCancel: () => void;
}

// Prompt shown after an ability with an area is used: the template is auto-
// suggested from the ability text, but every field is editable before you place,
// and the placed hitbox stays selected so you can drag/resize it on the fly.
export function VttAoePrompt({ ability, casterName, hasSelectedToken, onPlace, onCancel }: Props) {
  const suggested = suggestedTemplate(ability.meta);
  const [mode, setMode] = useState<AoeMode>(ability.meta.attach === "self" ? "self" : hasSelectedToken ? "selected" : "center");
  const [kind, setKind] = useState<AoeKind>(suggested.kind);
  const [cells, setCells] = useState<number>(suggested.cells);
  const [rounds, setRounds] = useState<number>(ability.meta.duration ?? 0);

  return (
    <div className="vtt2-aoe-backdrop" onMouseDown={onCancel}>
      <div className="vtt2-aoe" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-aoe-title">Place area · {ability.name}</div>
        {ability.effect && <div className="vtt2-aoe-effect">{ability.effect}</div>}

        <div className="vtt2-aoe-label">Target</div>
        <div className="vtt2-aoe-modes">
          <button className={"chip" + (mode === "self" ? " active" : "")} onClick={() => setMode("self")}>
            On {casterName || "me"}
          </button>
          <button
            className={"chip" + (mode === "selected" ? " active" : "")}
            onClick={() => setMode("selected")}
            disabled={!hasSelectedToken}
            title={hasSelectedToken ? "Centre on the selected token" : "Select a token first"}
          >
            On selected
          </button>
          <button className={"chip" + (mode === "center" ? " active" : "")} onClick={() => setMode("center")}>
            At view centre
          </button>
          <button className={"chip" + (mode === "click" ? " active" : "")} onClick={() => setMode("click")} title="Then click anywhere on the map to drop it">
            Click to place
          </button>
        </div>

        <div className="vtt2-aoe-grid">
          <label>
            Shape
            <select value={kind} onChange={(e) => setKind(e.target.value as AoeKind)}>
              <option value="circle">Circle / burst</option>
              <option value="cone">Cone</option>
              <option value="line">Line / beam</option>
              <option value="ring">Ring</option>
              <option value="cross">Cross</option>
              <option value="zone">Zone (rect)</option>
            </select>
          </label>
          <label>
            Size (cells)
            <input type="number" min={1} max={40} value={cells} onChange={(e) => setCells(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </label>
          <label>
            Linger (rounds)
            <input type="number" min={0} max={20} value={rounds} onChange={(e) => setRounds(Math.max(0, parseInt(e.target.value, 10) || 0))} />
          </label>
        </div>

        <div className="vtt2-aoe-actions">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="ghost-btn strong" onClick={() => onPlace({ mode, kind, cells, rounds })}>Place</button>
        </div>
        <div className="vtt2-aoe-hint">Placed hitboxes stay selected — drag to aim, resize in the inspector.</div>
      </div>
    </div>
  );
}
