import { useMemo, useState } from "react";
import type { CharacterRecord } from "../lib/characters";
import { ATTRIBUTES, SPECIALTIES, rollMod, specRollMod, diceExprFromText, signedMod } from "../game/wte";
import { characterActionSet, type VttAbility } from "./data/characterAbilities";
import { hasAoe, suggestedTemplate } from "./data/effectMeta";

interface Props {
  character: CharacterRecord | null;
  characters: { id: string; name: string }[];
  onPickCharacter: (id: string) => void;
  /** ARM the dice tray with a labeled (optionally pre-filled) roll — nothing
   *  rolls until the player presses Roll (the legacy sheet's locked flow). */
  onArmRoll: (label: string, expr?: string) => void;
  onUseAbility: (ability: VttAbility) => void;
  onClose: () => void;
}

/** A short "cone · 15 ft" style tag describing the parsed AoE, when there is one. */
function aoeTag(a: VttAbility): string | null {
  if (!hasAoe(a.meta)) return null;
  const shape = a.meta.pattern || a.meta.area?.shape || "area";
  const size = a.meta.area?.size;
  return size ? `${shape} · ${size} ${a.meta.area?.unit}` : shape;
}

/** "+3" / "-2" / "" — modifier suffix for a pre-filled dice expression. */
function modSuffix(mod: number): string {
  return mod > 0 ? `+${mod}` : mod < 0 ? String(mod) : "";
}

/** The dice an ability suggests: a weapon's damage dice, or the first dice
 *  expression in the effect text. Null = the player picks in the tray. */
function suggestedExpr(a: VttAbility): string | undefined {
  if (a.source === "action" && a.damage) return diceExprFromText(a.damage) ?? undefined;
  return a.meta.values[0]?.expr ?? diceExprFromText(a.effect) ?? undefined;
}

// Left-dock Abilities panel: base rolls + specialties, weapon actions, the
// slotted genus/cipher loadout, and racial abilities in a dropdown. NOTHING
// auto-rolls: every button ARMS the dice tray with the right label + dice
// (attribute d20s, specialty d40s, an ability's own damage dice) and the
// player presses Roll — the legacy sheet's locked-roll flow. Area abilities
// still prompt their hitbox on use.
export function VttAbilitiesPanel({ character, characters, onPickCharacter, onArmRoll, onUseAbility, onClose }: Props) {
  const set = useMemo(
    () => (character ? characterActionSet(character) : { actions: [], genus: [], cipher: [], racial: [] }),
    [character]
  );
  const [racialIdx, setRacialIdx] = useState(0);

  function use(a: VttAbility) {
    onArmRoll(a.name, suggestedExpr(a));
    onUseAbility(a);
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
        {a.source === "action" ? (
          // weapons get BOTH rolls: to-hit (1d20 + attack context) and damage
          <div className="vtt2-abil-btns">
            {a.hit != null && (
              <button
                className="chip"
                onClick={() => onArmRoll(`${a.name} — hit`, `1d20${modSuffix(a.hit ?? 0)}`)}
                title="Arm the to-hit roll (1d20 + attack)"
              >
                Hit
              </button>
            )}
            <button className="chip" onClick={() => use(a)} title="Arm the damage roll">
              Dmg
            </button>
          </div>
        ) : (
          <button className="chip" onClick={() => use(a)} title="Roll this ability">
            Use
          </button>
        )}
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
                title={`${attr.label} check — arms the roller with 1d20${modSuffix(rollMod(character.sheet.attributes[attr.key] ?? 0))}`}
                onClick={() => onArmRoll(`${attr.short} check`, `1d20${modSuffix(rollMod(character.sheet.attributes[attr.key] ?? 0))}`)}
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
                title={`${spec.label} check — arms the roller with 1d40${modSuffix(specRollMod(character.sheet.specialties[spec.key] ?? 0))}`}
                onClick={() => onArmRoll(`${spec.label} check`, `1d40${modSuffix(specRollMod(character.sheet.specialties[spec.key] ?? 0))}`)}
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
