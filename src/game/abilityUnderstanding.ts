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
import { declaredCosts, type AbilityCost } from "./abilityCost";
import {
  effectStepLabel,
  effectStepsToActions,
  hasDeclaredEffects,
  parseAbilityEffects,
  type EffectStep,
} from "./abilityEffects";

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
  return step.verb === "roll" || step.verb === "save" || step.verb === "damage" || step.verb === "heal";
}

/**
 * Read one ability the way the UI needs it.
 *
 * `actions` is the RAW `## Actions` section as the page carries it — parsing
 * happens here so that a caller can never be tempted to parse it a second,
 * slightly different way.
 */
export function abilityUnderstanding(
  effect: string | null | undefined,
  actions?: string | null
): AbilityUnderstanding {
  const effects = parseAbilityEffects(actions);
  if (!hasDeclaredEffects(effects)) {
    // Includes the case of a block that was written but read as nothing: its
    // errors still travel, because the author needs to see them, but the
    // ability keeps behaving exactly as its prose always made it behave.
    return { declared: false, actions: parseAbilityActions(effect), chips: [], costs: [], steps: [], errors: effects.errors };
  }
  return {
    declared: true,
    actions: effectStepsToActions(effects.steps),
    costs: declaredCosts(effects.steps),
    chips: effects.steps
      .map((step, i) => ({ step, i }))
      .filter(({ step }) => !isRollable(step))
      .map(({ step, i }) => ({ key: `${step.verb}${i}`, label: effectStepLabel(step), title: chipTitle(step) })),
    steps: effects.steps,
    errors: effects.errors,
  };
}
