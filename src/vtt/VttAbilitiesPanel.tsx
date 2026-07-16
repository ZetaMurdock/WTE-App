import { useMemo, useState } from "react";
import type { CharacterRecord } from "../lib/characters";
import { ATTRIBUTES, SPECIALTIES, rollAttribute, rollSpecialty, rollGeneric, rollToHit, signedMod, type RollResult } from "../game/wte";
import { characterActionSet, type VttAbility } from "./data/characterAbilities";
import { hasAoe, suggestedTemplate } from "./data/effectMeta";

interface Props {
  character: CharacterRecord | null;
  characters: { id: string; name: string }[];
  onPickCharacter: (id: string) => void;
  onRoll: (roll: RollResult) => void;
  onUseAbility: (ability: VttAbility, roll: RollResult) => void;
  onClose: () => void;
}

/** A short "cone · 15 ft" style tag describing the parsed AoE, when there is one. */
function aoeTag(a: VttAbility): string | null {
  if (!hasAoe(a.meta)) return null;
  const shape = a.meta.pattern || a.meta.area?.shape || "area";
  const size = a.meta.area?.size;
  return size ? `${shape} · ${size} ${a.meta.area?.unit}` : shape;
}

// Roll a weapon attack (1d20 + to-hit) or a plain ability check.
function rollFor(a: VttAbility): RollResult {
  return a.source === "action" && a.hit != null ? rollToHit(`${a.name} attack`, a.hit) : rollGeneric(a.name);
}

// Left-dock Abilities panel: base rolls + specialties, weapon actions, the
// paradigm's standard genus + cipher sets, and racial abilities in a dropdown.
// "Use" rolls into the shared feed and, for area abilities, prompts a hitbox.
export function VttAbilitiesPanel({ character, characters, onPickCharacter, onRoll, onUseAbility, onClose }: Props) {
  const set = useMemo(
    () => (character ? characterActionSet(character) : { actions: [], genus: [], cipher: [], racial: [] }),
    [character]
  );
  const [racialIdx, setRacialIdx] = useState(0);

  function use(a: VttAbility) {
    const roll = rollFor(a);
    onRoll(roll);
    onUseAbility(a, roll);
  }

  function Row({ a }: { a: VttAbility }) {
    const tag = aoeTag(a);
    const tmpl = tag ? suggestedTemplate(a.meta) : null;
    return (
      <li className="vtt2-abil-row">
        <div className="vtt2-abil-main">
          <div className="vtt2-abil-name">
            {a.name}
            {a.source === "action" && a.hit != null && <span className="vtt2-abil-hit">{signedMod(a.hit)}</span>}
            {a.ss > 0 && <span className="vtt2-abil-ss">{a.ss} SS</span>}
          </div>
          {(a.effect || a.range || a.damage) && (
            <div className="vtt2-abil-effect">{a.effect || [a.range, a.damage].filter(Boolean).join(" · ")}</div>
          )}
          {tag && (
            <div className="vtt2-abil-aoe" title={tmpl ? `Suggests a ${tmpl.kind} (~${tmpl.cells} cells) — editable on place` : ""}>
              {tag}
            </div>
          )}
        </div>
        <button className="chip" onClick={() => use(a)} title={a.source === "action" ? "Roll to hit" : "Roll this ability"}>
          Use
        </button>
      </li>
    );
  }

  const racialSel = set.racial[racialIdx] ?? null;

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
          <div className="vtt2-actor-group">Base rolls · attributes</div>
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

          <div className="vtt2-actor-group">Specialties · 1d40</div>
          <div className="vtt2-abil-baserolls">
            {SPECIALTIES.map((spec) => (
              <button
                key={spec.key}
                className="chip"
                title={`${spec.label} check — 1d40 + mod${(character.sheet.specialties[spec.key] ?? 0) < 25 ? " (−25 under 25 pts)" : ""}`}
                onClick={() => onRoll(rollSpecialty(spec.label, character.sheet.specialties[spec.key] ?? 0))}
              >
                {spec.key.toUpperCase()}
              </button>
            ))}
          </div>

          {set.actions.length > 0 && (
            <>
              <div className="vtt2-actor-group">Actions · attacks</div>
              <ul className="vtt2-abil-list">{set.actions.map((a) => <Row key={a.id} a={a} />)}</ul>
            </>
          )}

          {set.genus.length > 0 && (
            <>
              <div className="vtt2-actor-group">Genus abilities</div>
              <ul className="vtt2-abil-list">{set.genus.map((a) => <Row key={a.id} a={a} />)}</ul>
            </>
          )}

          {set.cipher.length > 0 && (
            <>
              <div className="vtt2-actor-group">Cipher abilities</div>
              <ul className="vtt2-abil-list">{set.cipher.map((a) => <Row key={a.id} a={a} />)}</ul>
            </>
          )}

          {set.racial.length > 0 && (
            <>
              <div className="vtt2-actor-group">Racial</div>
              <div className="vtt2-abil-racial">
                <select className="bg-select full" value={racialIdx} onChange={(e) => setRacialIdx(parseInt(e.target.value, 10))}>
                  {set.racial.map((a, i) => (
                    <option key={a.id} value={i}>{a.name}</option>
                  ))}
                </select>
                {racialSel && (
                  <>
                    {racialSel.effect && <div className="vtt2-abil-effect" style={{ margin: "6px 2px" }}>{racialSel.effect}</div>}
                    {aoeTag(racialSel) && <div className="vtt2-abil-aoe">{aoeTag(racialSel)}</div>}
                    <button className="chip" style={{ marginTop: 6 }} onClick={() => use(racialSel)}>Use {racialSel.name}</button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
