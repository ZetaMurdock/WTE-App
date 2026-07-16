import { useMemo } from "react";
import type { CharacterRecord } from "../lib/characters";
import { ATTRIBUTES, rollAttribute, rollGeneric, type RollResult } from "../game/wte";
import { characterAbilities, type VttAbility } from "./data/characterAbilities";
import { hasAoe, suggestedTemplate } from "./data/effectMeta";

interface Props {
  character: CharacterRecord | null;
  characters: { id: string; name: string }[];
  onPickCharacter: (id: string) => void;
  /** Log a roll to the shared feed. */
  onRoll: (roll: RollResult) => void;
  /** Use an ability: rolls it, then (stage 2) prompts an AoE template to place. */
  onUseAbility: (ability: VttAbility, roll: RollResult) => void;
  onClose: () => void;
}

const SOURCE_LABEL: Record<VttAbility["source"], string> = { genus: "Genus", cipher: "Cipher", racial: "Racial" };

/** A short "cone · 15 ft" style tag describing the parsed AoE, when there is one. */
function aoeTag(a: VttAbility): string | null {
  if (!hasAoe(a.meta)) return null;
  const shape = a.meta.pattern || a.meta.area?.shape || "area";
  const size = a.meta.area?.size;
  const unit = a.meta.area?.unit === "cells" ? "cells" : a.meta.area?.unit;
  return size ? `${shape} · ${size} ${unit}` : shape;
}

// Left-dock Abilities panel: your character's actions, abilities, and base rolls,
// so you can act straight from the VTT. Rolling an ability logs to the shared
// feed; abilities whose text implies an area get an AoE tag and (stage 2) prompt
// a hitbox to place.
export function VttAbilitiesPanel({ character, characters, onPickCharacter, onRoll, onUseAbility, onClose }: Props) {
  const abilities = useMemo(() => (character ? characterAbilities(character) : []), [character]);
  const grouped = useMemo(() => {
    const g: Record<string, VttAbility[]> = { genus: [], cipher: [], racial: [] };
    for (const a of abilities) g[a.source].push(a);
    return g;
  }, [abilities]);

  function useAbility(a: VttAbility) {
    const roll = rollGeneric(a.name);
    onRoll(roll);
    onUseAbility(a, roll);
  }

  return (
    <div className="vtt2-abilities">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>Abilities</span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
      </div>

      {characters.length > 0 && (
        <select
          className="bg-select full"
          style={{ marginBottom: 8 }}
          value={character?.id ?? ""}
          onChange={(e) => onPickCharacter(e.target.value)}
        >
          {!character && <option value="">Select a character…</option>}
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {!character ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>Pick a character to see their abilities.</p>
      ) : (
        <>
          <div className="vtt2-actor-group">Base rolls</div>
          <div className="vtt2-abil-baserolls">
            {ATTRIBUTES.map((attr) => (
              <button
                key={attr.key}
                className="chip"
                title={`${attr.label} check — 1d20 + mod`}
                onClick={() => onRoll(rollAttribute(attr.short, character.sheet.attributes[attr.key] ?? 0))}
              >
                {attr.short}
              </button>
            ))}
          </div>

          {(["genus", "cipher", "racial"] as const).map((src) =>
            grouped[src].length === 0 ? null : (
              <div key={src}>
                <div className="vtt2-actor-group">{SOURCE_LABEL[src]}</div>
                <ul className="vtt2-abil-list">
                  {grouped[src].map((a) => {
                    const tag = aoeTag(a);
                    const tmpl = tag ? suggestedTemplate(a.meta) : null;
                    return (
                      <li key={a.id} className="vtt2-abil-row">
                        <div className="vtt2-abil-main">
                          <div className="vtt2-abil-name">
                            {a.name}
                            {a.ss > 0 && <span className="vtt2-abil-ss">{a.ss} SS</span>}
                          </div>
                          {(a.effect || a.range) && (
                            <div className="vtt2-abil-effect">{a.effect || a.range}</div>
                          )}
                          {tag && (
                            <div className="vtt2-abil-aoe" title={tmpl ? `Suggests a ${tmpl.kind} (~${tmpl.cells} cells) — editable on place` : ""}>
                              {tag}
                            </div>
                          )}
                        </div>
                        <button className="chip" onClick={() => useAbility(a)} title="Roll this ability">Use</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
