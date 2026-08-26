import type { RuleLayer } from "../game/ruleLayers";
import { useCodex } from "../game/useCodex";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { officialAbilityCatalog, type AbilityCatalog } from "../game/abilityCatalog";
import { abilityUnderstanding, invocationChips } from "../game/abilityUnderstanding";
import {
  characterActionSet,
  characterEffectiveRollScores,
  characterRollAxisStats,
  type CharacterEffectiveRollScores,
  type VttAbility,
} from "./data/characterAbilities";
import { hasAoe, suggestedTemplate } from "./data/effectMeta";
import { saveIntentChip, type SaveIntentInput, type VttTargetRollIntent } from "./data/abilitySaveIntent";
import { rollAxisChoices, rollAxisPaths, type RollAxis, type RollAxisStats, type RollDirection, type RollAxisPath } from "../game/rollAxis";
import { affinityLabel, type AffinityDice } from "../game/paradigmAffinity";
import { snrChip } from "../game/snr";
import { parseUsageLimit, type UsageLimit } from "../game/abilityLimits";
import {
  clearUses,
  listUses,
  recordUse,
  subscribeUses,
  usageLabel,
  usageStatus,
  usageTitle,
  type UsageStatus,
  type UsageWindow,
} from "./data/usageLedger";

/** Re-exported from where the request is now ASSEMBLED. The dock's gold save
 *  chip and the map ring both ask for the same roll, so the one builder they
 *  share owns the shape of what it builds; a copy of the type here would be a
 *  second place for a field to be added to only one of them. */
export type { VttTargetRollIntent } from "./data/abilitySaveIntent";

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
  /** Where uses are counted, and which windows are currently open. Absent means
   *  the panel shows each ability's authored limit and counts nothing — the
   *  read-only behaviour every caller had before limits were tracked. */
  usage?: { scope: string; window: UsageWindow };
}

// Stable reference for a panel with no usage scope. useSyncExternalStore
// compares snapshots by identity and would re-render forever against a getter
// that allocated a fresh array each call.
const EMPTY_USES = Object.freeze([]) as unknown as ReturnType<typeof listUses>;

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

/** One firing control the card can draw for a parsed self-roll. */
interface ArmOption {
  /** What the tray and the roll feed call this roll. */
  label: string;
  /** The word on the chip. This is the thing the player is CHOOSING — a
   *  SOURCE — so it stays a bare statistic name; see `affinity`. */
  source: string;
  /** Favored dice this source earns, drawn as a secondary badge beside the
   *  source rather than spliced into its name. Folding them in turned a chip
   *  reading "Strength" into "Strength +2d5 +2d10", which is what widened the
   *  old button column until the ability's own name had no room left. */
  affinity?: AffinityDice;
  expr: string;
}

/** Resolve a parsed self-roll action through the same active profile used by the
 * sheet. Built-ins are d20/d40; a validated Codex formula may replace either. */
function armSelfOptions(
  action: AbilityAction,
  scores: CharacterEffectiveRollScores,
  axisStats: RollAxisStats | null
): ArmOption[] {
  if (action.rollAxis && axisStats) {
    const path = rollAxisPaths(action.rollAxis.axis, action.rollAxis.direction).find((candidate) => candidate.id === action.rollAxis!.path);
    if (!path) return [];
    return rollAxisChoices(path, action.rollAxis.direction, axisStats).map((choice) => ({
      label: `${action.label} · ${choice.sourceLabel}`,
      source: choice.sourceLabel,
      affinity: choice.affinity,
      expr: choice.expr,
    }));
  }
  const ref = action.stat ? resolveStatToken(action.stat) : null;
  if (ref?.kind === "attr") {
    const profile = attributeRollProfile(scores.attr[ref.key as keyof typeof scores.attr] ?? 0);
    return [{ label: action.label, source: action.label, expr: rollProfileExpr(profile) }];
  }
  if (ref?.kind === "spec") {
    const profile = specialtyRollProfile(scores.spec[ref.key as keyof typeof scores.spec] ?? 0);
    return [{ label: action.label, source: action.label, expr: rollProfileExpr(profile) }];
  }
  return [{ label: action.label, source: action.label, expr: action.expr ?? "1d20" }];
}

/** An ability's authored limit and what this character has spent against it. */
interface RowUsage {
  limit: UsageLimit;
  status: UsageStatus;
}

interface AbilityRowProps {
  a: VttAbility;
  catalog: AbilityCatalog;
  characterId?: string;
  axisStats: RollAxisStats | null;
  rollScores: CharacterEffectiveRollScores | null;
  usageOf: RowUsage | null;
  /** Whether this card is the one showing its declared detail. */
  open: boolean;
  onToggle: () => void;
  onArmRoll: (label: string, expr?: string) => void;
  onFire: (a: VttAbility, control: string) => void;
  onUse: (a: VttAbility) => void;
  onRequestTargetRoll?: (intent: VttTargetRollIntent) => void;
  onContestTarget?: (ability: VttAbility) => void;
  contestTargetName?: string;
  /** Absent when nothing is being counted, so the row draws no reset it could
   *  not honour. */
  onResetUses?: (a: VttAbility) => void;
}

/**
 * One ability, as a card.
 *
 * Declared at module scope, NOT inside the panel. A component defined inside a
 * render body is a new type on every render, so React unmounted and remounted
 * the whole list whenever any panel state moved — which threw keyboard focus
 * off the control the Curator had just pressed. A disclosure that loses focus
 * when it opens is not usable from the keyboard at all.
 */
function AbilityRow({
  a,
  catalog,
  characterId,
  axisStats,
  rollScores,
  usageOf,
  open,
  onToggle,
  onArmRoll,
  onFire,
  onUse,
  onRequestTargetRoll,
  onContestTarget,
  contestTargetName,
  onResetUses,
}: AbilityRowProps) {
  const tag = aoeTag(a);
  const tmpl = tag ? suggestedTemplate(a.meta) : null;
  // The ability "understanding" layer: buttons the ability actually calls for
  // (self checks, damage dice) plus a note of any target save + DC. Read from
  // the page's `## Actions` block where one is declared, from the effect prose
  // where it is not — one renderer either way, so a declared ability arms the
  // same tray and the same keyed DV as a parsed one.
  const read = a.source === "action" ? null : abilityUnderstanding(a.effect, a.actions, catalog);
  // Where the ability sits in resolution order, from its DOMAIN page — never
  // from the activation prose that also says it. Shown here because this is
  // the moment the Curator is deciding what goes first; the app enforces no
  // turn priority, so this is the Curator's call and the chip is the whole of
  // the app's contribution to it. See src/game/snr.ts.
  const snr = snrChip(a.abilityId ?? a.id) ?? snrChip(a.name);
  const actions = read?.actions ?? [];
  const selfRolls = actions.filter((x) => x.kind === "self");
  const dmgRolls = actions.filter((x) => x.kind === "damage");
  const saves = actions.filter((x) => x.kind === "save");
  // Who is asking, said once for every save on the page. The map ring builds
  // the identical context from the identical `abilityUnderstanding` read, so a
  // save asked from the map carries the DV the dock printed.
  const saveContext: SaveIntentInput = {
    ability: { abilityId: a.abilityId ?? a.id, name: a.name, effect: a.effect },
    actions,
    steps: read?.steps,
    declared: read?.declared === true,
    axisStats,
    casterCharacterId: characterId,
  };
  const quoted = read?.invocations.filter((one) => one.outcome === "prose" && one.prose) ?? [];
  const summary = a.effect || [a.range, a.damage].filter(Boolean).join(" · ");
  // What the card holds back until it is opened. A dense dock panel lists
  // twenty of these; every one of them drawing its costs, conditions, rulings
  // and quoted invocations at once is the wall of chips this card replaces.
  const hasDetail =
    !!summary || (read?.chips.length ?? 0) > 0 || (read?.invocations.length ?? 0) > 0 || !!usageOf;

  return (
    <li className={"vtt2-abil-card" + (open ? " open" : "")}>
      {/* The header owns the FULL width of the card. Nothing sits beside the
          name — the roll controls used to, and a long affinity label in that
          column shrank "Reverse Reaction" to "Rev Rea". */}
      <div className="vtt2-abil-head">
        {hasDetail ? (
          <button
            type="button"
            className="vtt2-abil-toggle"
            aria-expanded={open}
            onClick={onToggle}
            title={open ? `Hide what ${a.name} declares` : `Show what ${a.name} declares`}
          >
            <span className="vtt2-abil-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
            <span className="vtt2-abil-name">{a.name}</span>
          </button>
        ) : (
          <span className="vtt2-abil-name">{a.name}</span>
        )}
        <span className="vtt2-abil-badges">
          {a.source === "action" && a.hit != null && <span className="vtt2-abil-hit">{signedMod(a.hit)}</span>}
          {a.ss > 0 && <span className="vtt2-abil-ss">{a.ss} SS</span>}
          {snr && (
            <span
              className={"vtt2-abil-snr" + (snr.posture === "anti" ? " anti" : "")}
              title={`${snr.domain} — ${snr.note}`}
            >
              {snr.label}
            </span>
          )}
        </span>
      </div>

      {/* Identifying meta, the area tag leading it. Clamped to two lines while
          the card is closed, with the whole text in the tooltip — truncation
          the card CHOSE, rather than whatever a width fight left of it. The tag
          leads rather than taking a band of its own because this list is
          scrolled mid-fight and a row spent on one 9px tag is a row fewer of
          the abilities being scrolled past. */}
      {(summary || tag) && (
        <div className="vtt2-abil-effect" title={summary || undefined}>
          {tag && (
            <span className="vtt2-abil-aoe" title={tmpl ? `Suggests a ${tmpl.kind} (~${tmpl.cells} cells) — editable on place` : ""}>
              {tag}
            </span>
          )}
          {summary}
        </div>
      )}

      {/* Firing controls: a WRAPPING row beneath the header, so a control too
          wide for the dock costs a line of its own and never the name. */}
      <div className="vtt2-abil-actions">
        {a.source === "action" ? (
          // weapons get BOTH rolls: to-hit (1d20 + attack context) and damage
          <>
            {a.hit != null && (
              <button
                type="button"
                className="chip vtt2-abil-arm"
                onClick={() => onArmRoll(`${a.name} — hit`, `1d20${modSuffix(a.hit ?? 0)}`)}
                title={`Arm the to-hit roll · 1d20${modSuffix(a.hit ?? 0)}`}
              >
                <span className="vtt2-abil-armsrc">Hit</span>
              </button>
            )}
            <button type="button" className="chip vtt2-abil-arm" onClick={() => onUse(a)} title="Arm the damage roll">
              <span className="vtt2-abil-armsrc">Damage</span>
            </button>
          </>
        ) : (
          // Genus / cipher / racial: buttons the parser derived from the effect
          // text — the character's own checks + each damage die — else a plain Use.
          <>
            {selfRolls.flatMap((s, i) => {
              const options = rollScores
                ? armSelfOptions(s, rollScores, axisStats)
                : [{ label: s.label, source: s.label, expr: s.expr ?? "1d20" } as ArmOption];
              return options.map((option, optionIndex) => (
                <button
                  key={`s${i}-${optionIndex}`}
                  type="button"
                  className="chip vtt2-abil-arm"
                  onClick={() => { onArmRoll(`${a.name} — ${option.label}`, option.expr); onFire(a, `s${i}-${optionIndex}`); }}
                  title={`Arm ${option.label} · ${option.expr}`}
                >
                  <span className="vtt2-abil-armsrc">{option.source}</span>
                  {option.affinity && (
                    <em className={"affinity-badge" + (option.affinity.convergence ? " convergence" : "")}>
                      {affinityLabel(option.affinity)}
                    </em>
                  )}
                </button>
              ));
            })}
            {dmgRolls.map((d, i) => (
              <button
                key={"d" + i}
                type="button"
                className="chip vtt2-abil-arm"
                onClick={() => { onArmRoll(`${a.name} — ${d.label}`, d.expr); onFire(a, "d" + i); }}
                title={`Arm ${d.label} · ${d.expr}`}
              >
                <span className="vtt2-abil-armsrc">{d.label}</span>
              </button>
            ))}
            {selfRolls.length === 0 && dmgRolls.length === 0 && (
              <button type="button" className="chip vtt2-abil-arm" onClick={() => onUse(a)} title="Roll this ability">
                <span className="vtt2-abil-armsrc">Use</span>
              </button>
            )}
            {onContestTarget && a.source === "genus" && (
              <button
                type="button"
                className="chip vtt2-abil-arm contest"
                onClick={() => onContestTarget(a)}
                title={`Genus contest: ${a.name} (Focus ${a.focus ?? 0}) against ${contestTargetName ?? "the selected target"} — higher Focus wins outright, ties go to contested Control`}
              >
                <span className="vtt2-abil-armsrc">⚔ vs {contestTargetName ?? "target"}</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Rolls someone ELSE makes. Squared and gold against the accent pills
          above them, because pressing one asks the target's owner for a roll
          rather than arming this player's tray. */}
      {saves.length > 0 && (
        <div className="vtt2-abil-saves">
          {saves.map((s, i) => {
            // Assembled in data/abilitySaveIntent, which the map ring calls
            // too: the same save asked from two surfaces has to carry the same
            // DV, or the Curator gets two numbers and no way to tell which one
            // the page meant.
            const chip = saveIntentChip(s, saveContext);
            return (
              <button
                key={i}
                type="button"
                className="vtt2-abil-savechip"
                disabled={!onRequestTargetRoll}
                onClick={() => onRequestTargetRoll?.(chip.intent)}
                title={
                  (onRequestTargetRoll
                    ? "Resolve this roll against the selected target"
                    : "Select a target token to resolve this roll") + chip.title
                }
              >
                vs {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {/* A page the reader could not finish. Never folded into the disclosure:
          a broken step is the one thing on this card the table needs to see
          without being asked to go looking for it. */}
      {read && read.errors.length > 0 && (
        <div className="vtt2-abil-steps">
          {read.errors.map((err, i) => (
            <span className="vtt2-abil-stepchip bad" key={"e" + i} title={err}>Unreadable step</span>
          ))}
        </div>
      )}

      {usageOf && (
        <div className="vtt2-abil-limit" title={usageTitle(usageOf.limit, usageOf.status)}>
          {usageOf.status.tracked ? (
            <>
              <span className={"vtt2-abil-limitchip" + (usageOf.status.exhausted ? " spent" : "")}>
                {usageLabel(usageOf.status)}
              </span>
              {open && (
                <>
                  {/* The window's edge, in the words that say whose call it is.
                      The app runs rounds and encounters; it does not run rests,
                      and a chip that read "per short rest" without saying so
                      would imply it knew when one ended. */}
                  <span className="vtt2-abil-limitwhen">
                    {usageOf.status.boundary === "table" ? "since reset · " : ""}
                    {usageOf.limit.text}
                  </span>
                  {usageOf.status.used > 0 && onResetUses && (
                    <button
                      type="button"
                      className="vtt2-abil-limitreset"
                      title="Clear this tally — the Curator's word that the window turned over"
                      onClick={() => onResetUses(a)}
                    >
                      ↺
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <span className="vtt2-abil-limitchip open">{usageOf.limit.text}</span>
          )}
        </div>
      )}

      {open && (read?.chips.length || read?.invocations.length || quoted.length) ? (
        <div className="vtt2-abil-detail">
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
          {/* Every ability this one calls by name, and what became of the call.
              A resolved invocation's steps are already in the chips and buttons
              above; this row exists so the table can see WHERE they came from —
              and so a reference that did not resolve says so on the card rather
              than contributing nothing and looking complete. */}
          {read && read.invocations.length > 0 && (
            <div className="vtt2-abil-steps">
              {invocationChips(read.invocations).map((chip) => (
                <span
                  className={chip.fault ? "vtt2-abil-stepchip bad" : "vtt2-abil-stepchip"}
                  key={chip.key}
                  title={chip.title}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}
          {/* An invoked ability that declares nothing executable. Its own words
              are quoted, because the three-states rule says an undeclared page
              is not a broken one: the Curator runs it by hand, and the only way
              they can is if the card puts the text in front of them. */}
          {quoted.map((one, i) => (
            <div className="vtt2-abil-effect" key={"iq" + i} title={`Quoted from ${one.name} — this ability declares no steps`}>
              {one.name}: {one.prose}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
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
  usage,
}: Props) {
  // The Codex REVISION is part of this key, not just the character.
  //
  // characterActionSet resolves through the registry, so a campaign override
  // arriving while the panel is open changes the answer without changing the
  // character object — and a memo keyed on the character alone kept serving the
  // pre-override mechanics until something unrelated forced a re-render.
  const { tick } = useCodex();
  // What an `Invoke:` resolves against, rebuilt on the same signal for the same
  // reason: a campaign that forked WEAPONIZE onto its own page must be the
  // Weaponize that S4 — THE LAST WAR runs, and a catalog captured at mount
  // would go on running the official rule.
  const catalog = useMemo(() => officialAbilityCatalog(), [tick]);
  const set = useMemo(
    () => (character ? characterActionSet(character, layers) : { actions: [], genus: [], cipher: [], racial: [] }),
    [character, tick, layers]
  );
  const [racialIdx, setRacialIdx] = useState(0);
  const [axis, setAxis] = useState<RollAxis | null>(null);
  const [direction, setDirection] = useState<RollDirection | null>(null);
  const [path, setPath] = useState<RollAxisPath["id"] | null>(null);
  // Which card is showing its declared detail. One at a time: the dock is
  // 264px wide, and every card drawing its costs, conditions and invocations
  // at once is the wall the Curator has to scroll past to reach the ability
  // they actually want.
  const [openId, setOpenId] = useState<string | null>(null);
  const axisPaths = axis && direction ? rollAxisPaths(axis, direction) : [];
  const axisStats = character ? characterRollAxisStats(character) : null;
  const rollScores = character ? characterEffectiveRollScores(character) : null;

  // The tally, read through the store rather than held in this panel: the
  // panel unmounts every time the Curator switches tools, and a count that
  // vanished with it would be worse than no count at all.
  const usageScope = usage?.scope ?? "";
  const uses = useSyncExternalStore(
    useCallback((listener) => (usageScope ? subscribeUses(usageScope, listener) : () => {}), [usageScope]),
    useCallback(() => (usageScope ? listUses(usageScope) : EMPTY_USES), [usageScope])
  );

  /** What this character has spent against an ability's authored limit. */
  function limitOf(a: VttAbility): RowUsage | null {
    const limit = parseUsageLimit(a.limit);
    if (!limit || !usage || !character) return null;
    const status = usageStatus(limit, uses, {
      abilityId: a.abilityId ?? a.id,
      characterId: character.id,
      window: usage.window,
    });
    return { limit, status };
  }

  // Which of a row's firing controls have already been armed in the activation
  // in progress, per ability, and the window key that activation was counted
  // under.
  //
  // Nine of the 98 shipped genus abilities render more than one firing control:
  // Internal Break arms a Mental Check AND its 2d6, which is ONE use of one
  // ability. Counting each press put "2 of 1 used" and an amber row on the
  // first entirely legal use. Arming a control that has already fired is the
  // player going again, so THAT starts a fresh activation — deduping by ability
  // instead would have made a limit uncountable past its first use.
  const armed = useRef(new Map<string, { key: string; controls: Set<string> }>());

  /**
   * Note a use. Fires alongside every button that spends the ability, and
   * NEVER gates one: an exhausted limit is a thing the row says, not a thing it
   * enforces. A Curator overrules a printed limit as a matter of course, and a
   * disabled button would put this app in front of that decision.
   *
   * `control` identifies WHICH of the row's buttons was pressed; see `armed`.
   */
  function fire(a: VttAbility, control: string) {
    if (usage && character && a.limit) {
      const limit = parseUsageLimit(a.limit);
      const abilityId = a.abilityId ?? a.id;
      const ctx = { abilityId, characterId: character.id, window: usage.window };
      // The window key rides in the activation record so a use armed in one
      // round and another armed in the next are never folded into one — the
      // tally they land in is not the same tally.
      const key = usageStatus(limit, uses, ctx).key ?? "";
      const open = armed.current.get(abilityId);
      const sameActivation = !!open && open.key === key && !open.controls.has(control);
      if (sameActivation) open.controls.add(control);
      else {
        armed.current.set(abilityId, { key, controls: new Set([control]) });
        recordUse(usage.scope, limit, ctx);
      }
    }
    onUseAbility(a);
  }

  function use(a: VttAbility) {
    onArmRoll(a.name, suggestedExpr(a));
    fire(a, "use");
  }

  const resetUses =
    usage && character
      ? (a: VttAbility) => clearUses(usage.scope, { abilityId: a.abilityId ?? a.id, characterId: character.id })
      : undefined;

  const row = (a: VttAbility) => (
    <AbilityRow
      key={a.id}
      a={a}
      catalog={catalog}
      characterId={character?.id}
      axisStats={axisStats}
      rollScores={rollScores}
      usageOf={limitOf(a)}
      open={openId === a.id}
      onToggle={() => setOpenId(openId === a.id ? null : a.id)}
      onArmRoll={onArmRoll}
      onFire={fire}
      onUse={use}
      onRequestTargetRoll={onRequestTargetRoll}
      onContestTarget={onContestTarget}
      contestTargetName={contestTargetName}
      onResetUses={resetUses}
    />
  );

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
              <ul className="vtt2-abil-list">{set.actions.map(row)}</ul>
            </>
          )}

          {set.genus.length > 0 && (
            <>
              <div className="vtt2-actor-group">Genus abilities</div>
              <ul className="vtt2-abil-list">{set.genus.map(row)}</ul>
            </>
          )}

          {set.cipher.length > 0 && (
            <>
              <div className="vtt2-actor-group">Cipher abilities</div>
              <ul className="vtt2-abil-list">{set.cipher.map(row)}</ul>
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
                    {row(racialSel)}
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
