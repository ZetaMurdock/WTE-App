// Does an ability's `## Actions` block still say what its prose says?
//
// A page carrying both is carrying two rules. The moment one is edited without
// the other — "2d8" in the sentence, "3d8" in the block — the table plays
// whichever half the code happened to read, and nothing catches it at runtime
// because both halves are individually valid. So the authoring surface asks the
// two parsers the same questions and reports where they answer differently.
//
// The hard part is SILENCE. `parseAbilityActions` deliberately recovers less
// than a block declares: it cannot see the edge joining a save to the damage
// that follows it, and it has no notion of a Cost, a Condition or a Ruling at
// all. "The prose does not mention this" is therefore the normal state of a
// partial block, not a fault — and a panel that cried about it would teach
// Curators to ignore the panel, which is the only way this can really fail.
//
// Hence two severities. A warning is reserved for the two halves naming the
// same thing with different values; everything else is information a human may
// glance at and dismiss. Comparison only — nothing here rewrites a page, because
// which half is right is a Curator's judgement, not a parser's.
import { parseAbilityActions, type AbilityAction } from "./abilityActions";
import { hasDeclaredEffects, parseAbilityEffects, type EffectStep } from "./abilityEffects";
import { counterGaps } from "./counterTracks";
import { rollRefLabel, type InceptRollRef } from "./inceptGrants";

/** `warning` — prose and block state the same thing two ways, so one of them is
 *  wrong. `info` — one side is simply quieter than the other, which a partly
 *  declared ability is entitled to be. */
export type LintSeverity = "warning" | "info";

/** What the finding is about, so a surface can group or filter without reading
 *  the sentence. `unreadable` is a step the block itself could not parse.
 *  `track` is a custom currency whose runtime cannot keep everything the page
 *  might mean by it — see `counterGaps`. */
export type LintCategory = "unreadable" | "dice" | "dv" | "route" | "track";

export interface LintFinding {
  severity: LintSeverity;
  category: LintCategory;
  /** One plain sentence, addressed to the Curator looking at the page. */
  message: string;
}

/** `d10` and `1d10` are the same dice written two ways; the prose parser keeps
 *  whichever the sentence used. Comparing them raw would report a disagreement
 *  between a page and itself. */
const normExpr = (expr: string): string => expr.trim().toLowerCase().replace(/\s+/g, "").replace(/^d/, "1d");

const listExprs = (exprs: readonly string[]): string => exprs.join(", ");

const unique = (exprs: readonly string[]): string[] => [...new Set(exprs)];

/**
 * Dice the prose rolls, split the way the block splits them.
 *
 * The acting character's own price ("the Inquisitor takes 1d4 backlash") is
 * deliberately NOT excluded: the block writes it as `Damage (self)`, so it sits
 * in the same bucket on both sides and a mismatch there is still caught.
 */
function proseDice(actions: readonly AbilityAction[], side: "damage" | "healing"): string[] {
  return actions
    .filter((action) => action.kind === "damage" && !!action.expr && !!action.restorative === (side === "healing"))
    .map((action) => normExpr(action.expr!));
}

/** Dice the block declares. Costs are absent on purpose — the prose parser has
 *  no notion of a price, so there is nothing to compare a Cost against. */
function stepDice(steps: readonly EffectStep[], verb: "damage" | "heal"): string[] {
  return steps.filter((step) => step.verb === verb && !!step.expr).map((step) => normExpr(step.expr!));
}

/** The two pools compared, and the words each is described in. */
const DICE_BUCKETS = {
  damage: { verb: "deals", noun: "damage" },
  healing: { verb: "restores", noun: "healing" },
} as const;

function diceFindings(
  bucket: keyof typeof DICE_BUCKETS,
  proseList: readonly string[],
  declaredList: readonly string[],
  findings: LintFinding[]
): void {
  const { verb, noun } = DICE_BUCKETS[bucket];
  const prose = unique(proseList);
  const declared = unique(declaredList);
  if (!prose.length && !declared.length) return;
  if (!declared.length) {
    findings.push({
      severity: "info",
      category: "dice",
      message: `The prose rolls ${listExprs(prose)} ${noun} the block does not declare — those dice stay prose for the Curator to read out.`,
    });
    return;
  }
  if (!prose.length) {
    findings.push({
      severity: "info",
      category: "dice",
      message: `The block ${verb} ${listExprs(declared)} ${noun}; the prose names no dice.`,
    });
    return;
  }
  const onlyDeclared = declared.filter((expr) => !prose.includes(expr));
  const onlyProse = prose.filter((expr) => !declared.includes(expr));
  // Each side carrying dice the other lacks is the drift this exists to catch:
  // one hit, written twice, with two different numbers.
  if (onlyDeclared.length && onlyProse.length) {
    findings.push({
      severity: "warning",
      category: "dice",
      message: `The block ${verb} ${listExprs(onlyDeclared)} ${noun} where the prose says ${listExprs(onlyProse)} — the page states the rule twice, differently.`,
    });
    return;
  }
  if (onlyDeclared.length) {
    findings.push({
      severity: "info",
      category: "dice",
      message: `The block declares ${listExprs(onlyDeclared)} ${noun} the prose does not mention.`,
    });
  }
  if (onlyProse.length) {
    findings.push({
      severity: "info",
      category: "dice",
      message: `The prose names ${listExprs(onlyProse)} ${noun} the block does not declare.`,
    });
  }
}

const routeKey = (ref: InceptRollRef): string => `${ref.axis}|${ref.direction}|${ref.path}`;

function dvFindings(label: string, step: EffectStep, action: AbilityAction, findings: LintFinding[]): void {
  const proseDv = action.dc;
  const proseDie = action.dcDie;
  if (!step.dv) {
    // A block that names no DV takes the attacker-keyed one. Worth saying when
    // the prose fixed a number, since the roll will not use it.
    if (proseDv != null || proseDie != null) {
      findings.push({
        severity: "info",
        category: "dv",
        message: `The prose sets ${label} at ${proseDv != null ? `DV ${proseDv}` : `a d${proseDie} Dice Value`}; the block states no DV, so the keyed DV is used.`,
      });
    }
    return;
  }
  if (step.dv.kind === "keyed") {
    if (proseDv != null || proseDie != null) {
      findings.push({
        severity: "info",
        category: "dv",
        message: `The prose sets ${label} at ${proseDv != null ? `DV ${proseDv}` : `a d${proseDie} Dice Value`}; the block defers to the keyed DV instead.`,
      });
    }
    return;
  }
  if (step.dv.kind === "fixed") {
    if (proseDv != null && proseDv !== step.dv.value) {
      findings.push({
        severity: "warning",
        category: "dv",
        message: `${label}: the block says DV ${step.dv.value}, the prose says DV ${proseDv}.`,
      });
    } else if (proseDie != null) {
      findings.push({
        severity: "warning",
        category: "dv",
        message: `${label}: the block fixes DV ${step.dv.value}, the prose rolls a d${proseDie} Dice Value.`,
      });
    }
    return;
  }
  if (proseDie != null && proseDie !== step.dv.die) {
    findings.push({
      severity: "warning",
      category: "dv",
      message: `${label}: the block rolls a d${step.dv.die} Dice Value, the prose a d${proseDie}.`,
    });
  } else if (proseDv != null) {
    findings.push({
      severity: "warning",
      category: "dv",
      message: `${label}: the block rolls a d${step.dv.die} Dice Value, the prose fixes DV ${proseDv}.`,
    });
  }
}

function routeFindings(prose: readonly AbilityAction[], steps: readonly EffectStep[], findings: LintFinding[]): void {
  const proseRoutes = new Map<string, AbilityAction>();
  for (const action of prose) {
    if (action.rollAxis) proseRoutes.set(routeKey(action.rollAxis), action);
  }
  const declaredRoutes = new Set<string>();
  for (const step of steps) {
    // `modify` also carries a route, but granting advantage on a save is not the
    // ability asking for that save — only rolls the page makes are compared.
    if (step.verb !== "roll" && step.verb !== "save") continue;
    const ref = step.ref!;
    declaredRoutes.add(routeKey(ref));
    const label = rollRefLabel(ref);
    const match = proseRoutes.get(routeKey(ref));
    if (!match) {
      findings.push({
        severity: "info",
        category: "route",
        message: `The block rolls ${label}; the prose does not name that route.`,
      });
      continue;
    }
    dvFindings(label, step, match, findings);
  }
  for (const [key, action] of proseRoutes) {
    if (declaredRoutes.has(key)) continue;
    findings.push({
      severity: "info",
      category: "route",
      message: `The prose calls for ${rollRefLabel(action.rollAxis!)}; the block does not declare it, so that roll stays one the prose parser found.`,
    });
  }
}

/**
 * Compare an ability's effect prose with its `## Actions` block.
 *
 * Returns nothing at all for a page with no block: a prose-only ability is not
 * a half-finished declared one, and the three states stay first-class.
 */
export function lintDeclaredAgainstProse(
  effectProse: string | null | undefined,
  actionsSection: string | null | undefined
): LintFinding[] {
  const declared = parseAbilityEffects(actionsSection);
  if (!hasDeclaredEffects(declared) && declared.errors.length === 0) return [];

  const findings: LintFinding[] = [];
  // A line the block could not read is the loudest thing on the page: the
  // ability claims a step it will never take.
  for (const error of declared.errors) {
    findings.push({
      severity: "warning",
      category: "unreadable",
      message: `${error} — until this line reads, the ability claims a step it never takes.`,
    });
  }
  const prose = parseAbilityActions(effectProse);
  diceFindings("damage", proseDice(prose, "damage"), stepDice(declared.steps, "damage"), findings);
  diceFindings("healing", proseDice(prose, "healing"), stepDice(declared.steps, "heal"), findings);
  routeFindings(prose, declared.steps, findings);
  // A track's gaps are `info`, not `warning`: nothing here disagrees with the
  // page. It is the engine saying which part of what the page means it is NOT
  // going to enforce — the decay, the reset, the repeat — so the Curator rules
  // on those at the table instead of discovering mid-fight that nobody did.
  for (const gap of counterGaps(declared.steps)) {
    findings.push({ severity: "info", category: "track", message: gap });
  }
  return findings;
}

/** Do any findings need the author's attention rather than merely informing
 *  them? Lets a surface show one warning row without re-scanning the list. */
export function hasLintWarnings(findings: readonly LintFinding[]): boolean {
  return findings.some((finding) => finding.severity === "warning");
}
