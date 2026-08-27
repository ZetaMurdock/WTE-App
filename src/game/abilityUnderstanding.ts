// One answer to "what does this ability actually do?", shared by every surface
// that draws buttons from an ability.
//
// Two sources can answer. `parseAbilityActions` reads the effect PROSE that all
// 414 shipped abilities already carry. `parseAbilityEffects` reads the
// `## Actions` block a page may DECLARE. Letting both answer for the same
// ability is the bug this module exists to prevent: a declared
// `Fail: Damage: 3d10 Cold` sitting beside prose that says the same thing in
// words puts that damage on the tray twice, and a table rolls it twice.
//
// So a block SUPERSEDES the prose parse for the ability that carries it — not
// merged, not appended. An author who writes a block has said what the ability
// does; the prose beside it is there for a human to read. An ability with no
// block is understood exactly as it always was, which is every ability shipped
// today.
import { parseAbilityActions, type AbilityAction } from "./abilityActions";
import type { AbilityCatalog } from "./abilityCatalog";
import { declaredCosts, type AbilityCost } from "./abilityCost";
import {
  effectStepLabel,
  effectStepsToActions,
  hasDeclaredEffects,
  parseAbilityEffects,
  type EffectStep,
} from "./abilityEffects";
import { expandInvocations, hasInvocations, invocationNote, isInvokeFault, type Invocation } from "./abilityInvoke";

/** A declared step with no rollable face. Costs, conditions, advantage grants
 *  and Curator rulings are half of what an ability does, and a renderer that
 *  only drew the dice would make a declared ability look like it does LESS than
 *  the prose-parsed one it replaced. */
export interface AbilityChip {
  /** Stable across re-renders — steps have no identity of their own. */
  key: string;
  label: string;
  /** The longer sentence, for the chip's tooltip. */
  title: string;
}

export interface AbilityUnderstanding {
  /** Which reader answered. Provenance only: every surface renders `actions`
   *  and `chips` the same way whatever this says, because a second render path
   *  is the thing this module exists to prevent. */
  declared: boolean;
  /** The IR every chip, roll button and DV keying path already consumes, so a
   *  declared ability arms the same tray a prose-parsed one does. */
  actions: AbilityAction[];
  chips: AbilityChip[];
  /** The prices the block declared, typed so a row can spend them rather than
   *  only print them. Empty for an undeclared ability, whose price still lives
   *  on its `SS Cost` header — parsing the block a second time somewhere else to
   *  recover these is exactly the drift this module exists to prevent. */
  costs: AbilityCost[];
  /** The steps exactly as the block declared them, for the consumers that need
   *  the branch a step hangs on rather than a button to draw. Empty for an
   *  undeclared ability, which is the signal every such consumer wants: nothing
   *  was declared, so nothing supersedes the prose. Handed out from here for the
   *  same reason `actions` is — a caller that re-parsed the block to recover
   *  them would be the second reader this module exists to prevent. */
  steps: EffectStep[];
  /** Every `Invoke:` this ability wrote and what became of it — resolved and
   *  spliced into `steps`, resolved to a page that declares nothing (so its
   *  prose is quoted instead), or a fault. Empty unless a catalog was supplied
   *  AND the block invokes something, which is the entire shipped corpus. */
  invocations: Invocation[];
  /** Lines the block could not read. Surfaced rather than swallowed: an ability
   *  that quietly does less than its page claims is worse than one that says it
   *  cannot read a line. */
  errors: string[];
}

const WHO_WORD: Readonly<Record<EffectStep["who"], string>> = {
  self: "you",
  target: "the target",
  allies: "your allies",
  enemies: "your enemies",
};

const BRANCH_WORD: Readonly<Record<EffectStep["branch"], string>> = {
  always: "on use",
  fail: "when the resolution fails",
  success: "when the resolution succeeds",
  min: "on a minimum roll",
  tie: "on a tie",
};

/** The sentence behind a chip. Declared steps are terse by design, and a chip
 *  reading "Slowed · 2 rounds" does not say who is slowed or when. */
function chipTitle(step: EffectStep): string {
  // A threshold's payload explains itself before its verb does: what a reader
  // needs from "1d100" is that nothing happens until the track arrives.
  if (step.cadence === "at-threshold") {
    return `Fires when ${step.counter} reaches ${step.threshold} — not before, and not when this ability resolves`;
  }
  switch (step.verb) {
    case "cost":
      return `Costs ${step.expr} ${(step.resource ?? "ss").toUpperCase()}${step.perRound ? " every round it is sustained" : ""}`;
    case "condition":
      return `Applies ${step.condition} to ${WHO_WORD[step.who]} ${BRANCH_WORD[step.branch]}`;
    case "modify":
      return `${step.modify === "disadvantage" ? "Disadvantage" : "Advantage"} for ${WHO_WORD[step.who]} ${BRANCH_WORD[step.branch]}`;
    case "ruling":
      return step.prompt ?? "";
    default:
      return "";
  }
}

/** Does this step already appear as a button? Rolls, saves, damage and heals
 *  become `AbilityAction`s; everything else has to be drawn from the step. */
function isRollable(step: EffectStep): boolean {
  // An `At N` step is no longer a button — `effectStepsToActions` stopped arming
  // thresholds unconditionally, because a threshold consequence is armed by a
  // track reaching a number and not by the ability that moves the track. Without
  // this line that fix would have made the page's declared threshold vanish from
  // the panel entirely: not a button, and filtered out of the chips as "already
  // shown as one". Trading a wrong button for silence is not a fix.
  if (step.cadence === "at-threshold") return false;
  return step.verb === "roll" || step.verb === "save" || step.verb === "damage" || step.verb === "heal";
}

/** How a chip reads. The `At N` prefix is the whole point of the chip for a
 *  threshold step — `effectStepLabel` writes the payload ("1d100"), and a chip
 *  that showed only that would look exactly like damage the ability deals now. */
function chipLabel(step: EffectStep): string {
  const label = effectStepLabel(step);
  return step.cadence === "at-threshold" ? `At ${step.threshold} · ${label}` : label;
}

/**
 * Read one ability the way the UI needs it.
 *
 * `actions` is the RAW `## Actions` section as the page carries it — parsing
 * happens here so that a caller can never be tempted to parse it a second,
 * slightly different way.
 *
 * `catalog` is what an `Invoke:` resolves against. Optional because resolution
 * needs the campaign's live ability set and a pure reader of one page's text
 * cannot have one; a caller with no catalog gets the invoke step left standing
 * as its own chip, which is what every surface did before invocation existed.
 * A caller WITH one gets the invoked ability's declared steps spliced in — so
 * the tray a composed ability arms is the tray the abilities it names would
 * have armed, rather than a button that says "Invoke Weaponize" and does
 * nothing.
 */
export function abilityUnderstanding(
  effect: string | null | undefined,
  actions?: string | null,
  catalog?: AbilityCatalog | null
): AbilityUnderstanding {
  const effects = parseAbilityEffects(actions);
  if (!hasDeclaredEffects(effects)) {
    // Includes the case of a block that was written but read as nothing: its
    // errors still travel, because the author needs to see them, but the
    // ability keeps behaving exactly as its prose always made it behave.
    return { declared: false, actions: parseAbilityActions(effect), chips: [], costs: [], steps: [], invocations: [], errors: effects.errors };
  }
  // Expansion is skipped outright for a block that invokes nothing, so the
  // declared corpus that composes nothing keeps the exact step array it always
  // had — identity included, which `useMemo` consumers downstream compare on.
  const expanded =
    catalog && hasInvocations(effects.steps)
      ? expandInvocations(effects.steps, catalog)
      : { steps: effects.steps, invocations: [] as Invocation[] };
  return {
    declared: true,
    actions: effectStepsToActions(expanded.steps),
    costs: declaredCosts(expanded.steps),
    chips: expanded.steps
      .map((step, i) => ({ step, i }))
      .filter(({ step }) => !isRollable(step))
      .map(({ step, i }) => ({ key: `${step.verb}${i}`, label: chipLabel(step), title: chipTitle(step) })),
    steps: expanded.steps,
    invocations: expanded.invocations,
    errors: effects.errors,
  };
}

/** A chip per invocation, for the surfaces that draw chips. Separate from
 *  `chips` because an invocation is not a step the ability takes — it is a
 *  reference, and whether it RESOLVED is the thing a reader needs to see. */
export function invocationChips(invocations: readonly Invocation[]): (AbilityChip & { fault: boolean })[] {
  return invocations.map((one, i) => ({
    key: `invoke${i}`,
    label:
      one.outcome === "expanded"
        ? `Invoke ${one.name}`
        : one.outcome === "prose"
          ? `Invoke ${one.name} · prose`
          : one.outcome === "unresolved"
            ? `Invoke "${one.ref}" · unknown`
            : `Invoke ${one.name} · ${one.outcome}`,
    title: invocationNote(one),
    fault: isInvokeFault(one),
  }));
}

/** The `·`-separated declarations a page writes BEFORE its body prose — Type,
 *  Target, Duration, Resolution, Limit. Cut at the first sentence break because
 *  that is where every authored ability in the corpus stops declaring and starts
 *  describing, and the body is where a passive names the rolls it MODIFIES
 *  ("+2 on checks to read terrain") rather than any roll of its own. */
function abilityHeader(effect: string): string {
  const stop = effect.search(/\.\s/);
  return stop === -1 ? effect : effect.slice(0, stop);
}
/** The words a page uses to say its resolution takes no roll. */
const DECLARES_AUTOMATIC = /\b(automatic|automatically|passive|always)\b/i;
/** Anything that would make "no roll" a lie. */
const NAMES_A_ROLL = /\b(check|checks|save|saves|roll|rolls|rolled|contest|contests|contested|clash|dc|dv)\b/i;

/** Does the ability's OWN page say it resolves without a roll?
 *
 *  Asked because a surface that wants to print "Passive — this feature states
 *  no roll" must have READ that, not merely have failed to parse anything. The
 *  two are not the same: `parseAbilityActions` finds nothing in Radiant
 *  Cascade, whose header says outright "Resolution: END Check or Disadvantage
 *  on next roll", and captioning that ability "states no roll" contradicts the
 *  species page — which is this app inventing a rule, in the one direction
 *  nobody notices.
 *
 *  So the answer requires POSITIVE evidence: the header declares Automatic /
 *  Passive / Always AND names no check, save, roll or contest anywhere in the
 *  same header. It never adds or removes an action — `abilityUnderstanding`
 *  remains the only reader of what an ability DOES — and it is deliberately shy:
 *  a header that says both (Voth Avarin's "Passive … creates no additional
 *  roll") answers false, and a surface that gets false simply says nothing
 *  rather than saying something wrong. */
export function declaresNoRoll(effect: string | null | undefined): boolean {
  // A feature with no text has declared nothing, least of all that it is free
  // of rolls.
  if (!effect) return false;
  const header = abilityHeader(effect);
  return DECLARES_AUTOMATIC.test(header) && !NAMES_A_ROLL.test(header);
}
