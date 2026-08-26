import type { RuleLayer } from "../game/ruleLayers";
import { useCodex } from "../game/useCodex";
import { useMemo, useState } from "react";
import type { CharacterRecord } from "../lib/characters";
import {
  ATTRIBUTES,
  SPECIALTIES,
  attributeRollProfile,
  specialtyRollProfile,
  rollProfileExpr,
  diceExprFromText,
  signedMod,
  resolveStatToken,
} from "../game/wte";
import type { AbilityAction } from "../game/abilityActions";
import { abilityUnderstanding } from "../game/abilityUnderstanding";
import type { EffectStep } from "../game/abilityEffects";
import {
  characterActionSet,
  characterEffectiveRollScores,
  characterRollAxisStats,
  type CharacterEffectiveRollScores,
  type VttAbility,
} from "./data/characterAbilities";
import { hasAoe, suggestedTemplate } from "./data/effectMeta";
import { rollAxisChoices, rollAxisPaths, type RollAxis, type RollAxisStats, type RollDirection, type RollAxisPath } from "../game/rollAxis";
import { affinityLabel } from "../game/paradigmAffinity";
import { abilitySaveDv, saveChipDv, saveDvBreakdown, savePlainLabel } from "../game/saveDv";
import type { NetRollAxisRequest } from "../net/protocol";

/** A target-side check parsed from an ability. The VTT shell supplies the
 * selected target and turns this intent into a targeted network roll request. */
export interface VttTargetRollIntent {
  abilityId: string;
  abilityName: string;
  sourceCharacterId?: string;
  label: string;
  stat?: string;
  rollAxis?: NetRollAxisRequest;
  dc?: number;
  /** The ability's own prose, so the shell can read what a failed save costs
   *  without resolving the ability a second time. */
  effect?: string;
  /** The page's DECLARED steps, when it has an `## Actions` block. They ride
   *  beside the prose rather than instead of it: the shell hands both to the
   *  ledger, which prefers these, so a declared ability's card says what the
   *  PAGE said instead of what the prose scanner made of it. Empty/absent for
   *  the whole undeclared corpus, which keeps the prose path byte for byte. */
  steps?: readonly EffectStep[];
}

interface Props {
  /** Curator-only: resolve a genus contest against the selected target token.
   *  Present only when a contestable target is selected. */
  onContestTarget?: (ability: VttAbility) => void;
  contestTargetName?: string;
  character: CharacterRecord | null;
  characters: { id: string; name: string }[];
  onPickCharacter: (id: string) => void;
  /** ARM the dice tray with a labeled (optionally pre-filled) roll — nothing
   *  rolls until the player presses Roll (the legacy sheet's locked flow). */
  onArmRoll: (label: string, expr?: string) => void;
  onUseAbility: (ability: VttAbility) => void;
  /** Request that the selected target's owner make this parsed save/check. The
   * callback owns target selection and network delivery. */
  onRequestTargetRoll?: (intent: VttTargetRollIntent) => void;
  /** Players are bound to their table character and cannot switch roll source. */
  lockCharacter?: boolean;
  onClose: () => void;
  /** Numeric rule layers for this campaign, so the SS shown at the table is the
   *  SS the contextual card explains. */
  layers?: RuleLayer[];
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

/** Resolve a parsed self-roll action through the same active profile used by the
 * sheet. Built-ins are d20/d40; a validated Codex formula may replace either. */
function armSelfOptions(
  action: AbilityAction,
  scores: CharacterEffectiveRollScores,
  axisStats: RollAxisStats | null
): { label: string; buttonLabel: string; expr: string }[] {
  if (action.rollAxis && axisStats) {
    const path = rollAxisPaths(action.rollAxis.axis, action.rollAxis.direction).find((candidate) => candidate.id === action.rollAxis!.path);
    if (!path) return [];
    return rollAxisChoices(path, action.rollAxis.direction, axisStats).map((choice) => ({
      label: `${action.label} · ${choice.sourceLabel}`,
      buttonLabel: choice.affinity ? `${choice.sourceLabel} ${affinityLabel(choice.affinity)}` : choice.sourceLabel,
      expr: choice.expr,
    }));
  }
  const ref = action.stat ? resolveStatToken(action.stat) : null;
  if (ref?.kind === "attr") {
    const profile = attributeRollProfile(scores.attr[ref.key as keyof typeof scores.attr] ?? 0);
    return [{ label: action.label, buttonLabel: action.label, expr: rollProfileExpr(profile) }];
  }
  if (ref?.kind === "spec") {
    const profile = specialtyRollProfile(scores.spec[ref.key as keyof typeof scores.spec] ?? 0);
    return [{ label: action.label, buttonLabel: action.label, expr: rollProfileExpr(profile) }];
  }
  return [{ label: action.label, buttonLabel: action.label, expr: action.expr ?? "1d20" }];
}

// Left-dock Abilities panel: base rolls + specialties, weapon actions, the
// slotted genus/cipher loadout, and racial abilities in a dropdown. NOTHING
// auto-rolls: every button ARMS the dice tray with the right label + dice
// (attribute d20s, specialty d40s, an ability's own damage dice) and the
// player presses Roll — the legacy sheet's locked-roll flow. Area abilities
// still prompt their hitbox on use.
export function VttAbilitiesPanel({
  character,
  characters,
  onPickCharacter,
  onArmRoll,
  onUseAbility,
  onRequestTargetRoll,
  onContestTarget,
  contestTargetName,
  lockCharacter = false,
  onClose,
  layers,
}: Props) {
  // The Codex REVISION is part of this key, not just the character.
  //
  // characterActionSet resolves through the registry, so a campaign override
  // arriving while the panel is open changes the answer without changing the
  // character object — and a memo keyed on the character alone kept serving the
  // pre-override mechanics until something unrelated forced a re-render.
  const { tick } = useCodex();
  const set = useMemo(
    () => (character ? characterActionSet(character, layers) : { actions: [], genus: [], cipher: [], racial: [] }),
    [character, tick, layers]
  );
  const [racialIdx, setRacialIdx] = useState(0);
  const [axis, setAxis] = useState<RollAxis | null>(null);
  const [direction, setDirection] = useState<RollDirection | null>(null);
  const [path, setPath] = useState<RollAxisPath["id"] | null>(null);
  const axisPaths = axis && direction ? rollAxisPaths(axis, direction) : [];
  const axisStats = character ? characterRollAxisStats(character) : null;
  const rollScores = character ? characterEffectiveRollScores(character) : null;

  function use(a: VttAbility) {
    onArmRoll(a.name, suggestedExpr(a));
    onUseAbility(a);
  }

  function Row({ a }: { a: VttAbility }) {
    const tag = aoeTag(a);
    const tmpl = tag ? suggestedTemplate(a.meta) : null;
    // The ability "understanding" layer: buttons the ability actually calls for
    // (self checks, damage dice) plus a note of any target save + DC. Read from
    // the page's `## Actions` block where one is declared, from the effect prose
    // where it is not — one renderer either way, so a declared ability arms the
    // same tray and the same keyed DV as a parsed one.
    const read = a.source === "action" ? null : abilityUnderstanding(a.effect, a.actions);
    const actions = read?.actions ?? [];
    const selfRolls = actions.filter((x) => x.kind === "self");
    const dmgRolls = actions.filter((x) => x.kind === "damage");
    const saves = actions.filter((x) => x.kind === "save");
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
          {saves.length > 0 && (
            <div className="vtt2-abil-saves">
              {saves.map((s, i) => {
                // Attacker-keyed DV (21 + this character's paired check mod),
                // which replaces a PRINTED number the prose carries — it rides
                // the request so the target's roll prompt shows the DV that
                // actually applies.
                const keyed = axisStats ? abilitySaveDv(s, actions, axisStats) : null;
                // A page that wrote its own DV in a block meant it; everything
                // else keys. An undeclared ability has no declared DV to prefer,
                // so it reads exactly as it did before declared DVs existed.
                const { dv, fromPage } = saveChipDv(s, keyed, read?.declared === true);
                return (
                  <button
                    key={i}
                    type="button"
                    className="vtt2-abil-savechip"
                    disabled={!onRequestTargetRoll}
                    onClick={() =>
                      onRequestTargetRoll?.({
                        // The permanent id when the ability carries one: an
                        // outcome outlives the loadout position it was fired from.
                        abilityId: a.abilityId ?? a.id,
                        abilityName: a.name,
                        effect: a.effect,
                        // Omitted, not sent empty. An ability with no block has
                        // to reach the ledger as the identical request it always
                        // did — an extra `steps: []` riding along is a second
                        // way for the undeclared corpus to behave differently.
                        ...(read?.steps.length ? { steps: read.steps } : {}),
                        sourceCharacterId: character?.id,
                        label: dv != null ? `${savePlainLabel(s)} · DV ${dv}` : s.label,
                        stat: s.stat,
                        ...(s.rollAxis ? { rollAxis: { path: s.rollAxis.path, direction: s.rollAxis.direction } } : {}),
                        dc: dv ?? s.dc,
                      })
                    }
                    title={
                      (onRequestTargetRoll
                        ? "Resolve this roll against the selected target"
                        : "Select a target token to resolve this roll") +
                      (fromPage
                        ? ` · DV ${dv} declared on this ability's page`
                        : keyed
                          ? ` · ${saveDvBreakdown(keyed)}`
                          : "")
                    }
                  >
                    vs {dv != null ? `${savePlainLabel(s)} · DV ${dv}` : s.label}
                  </button>
                );
              })}
            </div>
          )}
          {/* Declared steps with no dice of their own: the cost, the condition,
              the Curator ruling. A declared ability that showed only its dice
              would read as doing LESS than the prose it supersedes. */}
          {read && read.chips.length > 0 && (
            <div className="vtt2-abil-steps">
              {read.chips.map((chip) => (
                <span className="vtt2-abil-stepchip" key={chip.key} title={chip.title}>{chip.label}</span>
              ))}
            </div>
          )}
          {read && read.errors.length > 0 && (
            <div className="vtt2-abil-steps">
              {read.errors.map((err, i) => (
                <span className="vtt2-abil-stepchip bad" key={"e" + i} title={err}>Unreadable step</span>
              ))}
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
          // Genus / cipher / racial: buttons the parser derived from the effect
          // text — the character's own checks + each damage die — else a plain Use.
          <div className="vtt2-abil-btns">
            {selfRolls.flatMap((s, i) => {
              const armed = rollScores
                ? armSelfOptions(s, rollScores, axisStats)
                : [{ label: s.label, buttonLabel: s.label, expr: s.expr ?? "1d20" }];
              return armed.map((option, optionIndex) => (
                <button
                  key={`s${i}-${optionIndex}`}
                  className="chip"
                  onClick={() => { onArmRoll(`${a.name} — ${option.label}`, option.expr); onUseAbility(a); }}
                  title={`Arm ${option.expr}`}
                >
                  {option.buttonLabel}
                </button>
              ));
            })}
            {dmgRolls.map((d, i) => (
              <button
                key={"d" + i}
                className="chip"
                onClick={() => { onArmRoll(`${a.name} — ${d.label}`, d.expr); onUseAbility(a); }}
                title={`Arm ${d.expr}`}
              >
                {d.label}
              </button>
            ))}
            {selfRolls.length === 0 && dmgRolls.length === 0 && (
              <button className="chip" onClick={() => use(a)} title="Roll this ability">
                Use
              </button>
            )}
            {onContestTarget && a.source === "genus" && (
              <button
                className="chip contest"
                onClick={() => onContestTarget(a)}
                title={`Genus contest: ${a.name} (Focus ${a.focus ?? 0}) against ${contestTargetName ?? "the selected target"} — higher Focus wins outright, ties go to contested Control`}
              >
                ⚔ vs {contestTargetName ?? "target"}
              </button>
            )}
          </div>
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

      {!lockCharacter && characters.length > 0 && (
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
          <div className="vtt2-actor-group">Roll Axis</div>
          <div className="vtt2-abil-baserolls">
            <button className={"chip" + (axis === "physical" ? " active" : "")} onClick={() => { setAxis(axis === "physical" ? null : "physical"); setDirection(null); setPath(null); }}>Physical</button>
            <button className={"chip" + (axis === "mental" ? " active" : "")} onClick={() => { setAxis(axis === "mental" ? null : "mental"); setDirection(null); setPath(null); }}>Mental</button>
          </div>
          {axis && (
            <div className="vtt2-roll-axis">
              <div className="vtt2-abil-baserolls">
                <button className={"chip" + (direction === "check" ? " active" : "")} onClick={() => { setDirection(direction === "check" ? null : "check"); setPath(null); }}>Checks</button>
                <button className={"chip" + (direction === "save" ? " active" : "")} onClick={() => { setDirection(direction === "save" ? null : "save"); setPath(null); }}>Saves</button>
              </div>
              {direction && (
              <div className="vtt2-abil-baserolls">
                {axisPaths.map((item) => <button key={item.id} className={"chip" + (path === item.id ? " active" : "")} onClick={() => setPath(path === item.id ? null : item.id)}>{item.name} {direction === "check" ? "Check" : "Save"}</button>)}
              </div>
              )}
              {axisStats && direction && axisPaths.filter((item) => item.id === path).map((item) => (
                <div key={item.id} className="vtt2-axis-choices">
                  {rollAxisChoices(item, direction, axisStats).map((choice) => (
                    <button
                      key={choice.source}
                      className="ghost-btn"
                      title={`${choice.sourceLabel} ${signedMod(choice.sourceMod)} + ${item.derived.label} ${signedMod(choice.derivedMod)} = ${signedMod(choice.totalMod)}`}
                      onClick={() => onArmRoll(`${choice.label} · ${choice.sourceShort} ${signedMod(choice.sourceMod)} · ${item.derived.short} ${signedMod(choice.derivedMod)}`, choice.expr)}
                    >
                      {choice.sourceLabel}
                      {choice.affinity ? <em className="affinity-badge">{affinityLabel(choice.affinity)}</em> : null}
                      <small>d{choice.die} {signedMod(choice.sourceMod)} + {item.derived.short} {signedMod(choice.derivedMod)} = {signedMod(choice.totalMod)}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="vtt2-actor-group">Base rolls · attributes</div>
          <div className="vtt2-abil-baserolls">
            {ATTRIBUTES.map((attr) => {
              const expr = rollProfileExpr(attributeRollProfile(rollScores?.attr[attr.key] ?? 0));
              return (
                <button
                  key={attr.key}
                  className="chip"
                  title={`${attr.label} check — arms the roller with ${expr}`}
                  onClick={() => onArmRoll(`${attr.short} check`, expr)}
                >
                  {attr.short}
                </button>
              );
            })}
          </div>

          <div className="vtt2-actor-group">Specialty rolls</div>
          <div className="vtt2-abil-baserolls">
            {SPECIALTIES.map((spec) => {
              const expr = rollProfileExpr(specialtyRollProfile(rollScores?.spec[spec.key] ?? 0));
              return (
                <button
                  key={spec.key}
                  className="chip"
                  title={`${spec.label} check — arms the roller with ${expr}`}
                  onClick={() => onArmRoll(`${spec.label} check`, expr)}
                >
                  {spec.key.toUpperCase()}
                </button>
              );
            })}
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
                  <ul className="vtt2-abil-list" style={{ marginTop: 6 }}>
                    <Row a={racialSel} />
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
