// What an ability DOES, declared on its own page.
//
// `parseAbilityActions` reads prose and recovers the rolls an ability calls for.
// It cannot recover the edge between them: "make a Save … or take 2d8" yields a
// save and a damage with nothing joining them, so the table remembers which
// followed which. Prose is not going to get better at this — the corpus is
// written for humans, and it should stay that way.
//
// So an ability may also DECLARE its steps, in an `## Actions` section:
//
//     ## Actions
//     - Cost: 6 SS
//     - Save (target): Physical Save — Recovery, DV 18
//     - Fail: Damage: 3d10 Cold, half on success
//     - Fail: Condition: Slowed, 2 rounds
//     - Ruling: brittle objects shatter — Curator adjudicates
//
// Three states are first-class and stay that way: an ability with no block reads
// exactly as it always has, one with a partial block automates what it declares
// and quotes prose for the rest, and a fully declared one runs end to end. There
// is no flag day and no corpus rewrite — the 414 shipped abilities keep working
// untouched while blocks arrive one page at a time.
//
// Follows the `## Grants` precedent in inceptGrants.ts deliberately: bullets of
// `Verb: value`, a closed verb vocabulary, validation that reports rather than
// guesses, and the parser and emitter in one file so the two cannot drift.
import { parseRollRef, resourceOf, rollRefLabel, type InceptResource, type InceptRollRef } from "./inceptGrants";
import type { AbilityAction } from "./abilityActions";

/** The verbs a page may write. Closed on purpose: an unknown verb is an
 *  authoring error the page reports, never a step quietly dropped. */
export type EffectVerb = "cost" | "roll" | "save" | "damage" | "heal" | "condition" | "modify" | "ruling";

/** Who a step lands on. Defaults per verb — a Check is made by the acting
 *  character, a Save by the target — mirroring the inference the prose parser
 *  already uses so declared and parsed abilities agree. */
export type EffectSelector = "self" | "target" | "allies" | "enemies";

/** Which branch of a resolution arms a step. `always` is the default: a step
 *  written with no branch happens. */
export type EffectBranch = "always" | "fail" | "success" | "min" | "tie";

/** How a step's DV is decided. `keyed` defers to the attacker-keyed DV the save
 *  chips already compute, so a page need not restate a number the engine owns. */
export type EffectDv =
  | { kind: "fixed"; value: number; high?: number; bonus?: string }
  | { kind: "die"; die: number }
  | { kind: "keyed" };

/** Durations the corpus actually writes. Closed like the verbs — "a while" is
 *  not a duration anything can expire. */
export type EffectDuration =
  | { kind: "rounds"; count: number }
  | { kind: "minutes"; count: number }
  | { kind: "scene" }
  | { kind: "sustained" }
  | { kind: "permanent" }
  | { kind: "until-save" };

export interface EffectStep {
  verb: EffectVerb;
  branch: EffectBranch;
  who: EffectSelector;
  /** roll/save/modify — the Roll Axis route, validated against the real paths. */
  ref?: InceptRollRef;
  dv?: EffectDv;
  /** damage/heal/cost — dice or a flat amount. */
  expr?: string;
  damageType?: string;
  resource?: InceptResource;
  /** cost — a per-round upkeep rather than a one-off price. */
  perRound?: boolean;
  /** condition — the tag applied. Deliberately OPEN text: the Conditions page
   *  decides what a condition means, and a table writing its own setting must be
   *  able to name one this parser has never heard of. */
  condition?: string;
  duration?: EffectDuration;
  /** modify — which way the roll moves. */
  modify?: "advantage" | "disadvantage";
  /** damage — prose promised a successful save still takes half. */
  half?: boolean;
  /** ruling — what the Curator is being asked to decide. */
  prompt?: string;
}

export interface AbilityEffects {
  steps: EffectStep[];
  /** Lines that looked like steps but were not usable. An ability with an
   *  unreadable step must say so rather than quietly doing less than it claims. */
  errors: string[];
}

const VERBS: Readonly<Record<string, EffectVerb>> = {
  cost: "cost",
  roll: "roll",
  check: "roll",
  save: "save",
  damage: "damage",
  heal: "heal",
  restore: "heal",
  condition: "condition",
  modify: "modify",
  ruling: "ruling",
};

const BRANCHES: Readonly<Record<string, EffectBranch>> = {
  fail: "fail",
  fails: "fail",
  success: "success",
  succeeds: "success",
  min: "min",
  minimum: "min",
  tie: "tie",
};

const SELECTORS: Readonly<Record<string, EffectSelector>> = {
  self: "self",
  target: "target",
  allies: "allies",
  enemies: "enemies",
};

/** Whose roll a verb is when the line does not say. */
const DEFAULT_SELECTOR: Readonly<Record<EffectVerb, EffectSelector>> = {
  cost: "self",
  roll: "self",
  save: "target",
  damage: "target",
  heal: "target",
  condition: "target",
  modify: "self",
  ruling: "target",
};

/** Dice or a flat amount, matching the Grants validator. Anything else is an
 *  authoring error, not a value to guess at. */
const EXPR_RE = /^\d*d\d+(?:\s*[+-]\s*\d+)?$|^\d+$/i;

const BULLET_RE = /^\s*[-*]\s*(.+?)\s*$/;

function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  const k = key.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, k) ? table[k] : undefined;
}

function parseDuration(text: string): EffectDuration | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t === "scene") return { kind: "scene" };
  if (t === "sustained") return { kind: "sustained" };
  if (t === "permanent") return { kind: "permanent" };
  if (t === "until save" || t === "save ends") return { kind: "until-save" };
  const rounds = /^(\d{1,3})\s+rounds?$/.exec(t);
  if (rounds) return { kind: "rounds", count: parseInt(rounds[1], 10) };
  const minutes = /^(\d{1,3})\s+min(?:ute)?s?$/.exec(t);
  if (minutes) return { kind: "minutes", count: parseInt(minutes[1], 10) };
  return null;
}

function durationText(duration: EffectDuration): string {
  switch (duration.kind) {
    case "rounds": return `${duration.count} round${duration.count === 1 ? "" : "s"}`;
    case "minutes": return `${duration.count} min`;
    case "scene": return "scene";
    case "sustained": return "sustained";
    case "permanent": return "permanent";
    case "until-save": return "until save";
  }
}

/** The four authored DV forms the prose parser already proved, plus `keyed`. */
function parseDv(text: string): EffectDv | null {
  const t = text.trim();
  if (/^keyed$/i.test(t)) return { kind: "keyed" };
  const die = /^d(\d{1,3})$/i.exec(t);
  if (die) return { kind: "die", die: parseInt(die[1], 10) };
  const fixed = /^(\d{1,3})(?:\s*[–—-]\s*(\d{1,3}))?(?:\s*\+\s*(.+))?$/.exec(t);
  if (!fixed) return null;
  const dv: EffectDv = { kind: "fixed", value: parseInt(fixed[1], 10) };
  if (fixed[2]) dv.high = parseInt(fixed[2], 10);
  if (fixed[3]) dv.bonus = fixed[3].trim();
  return dv;
}

function dvText(dv: EffectDv): string {
  if (dv.kind === "keyed") return "DV keyed";
  if (dv.kind === "die") return `DV d${dv.die}`;
  return `DV ${dv.value}${dv.high != null ? `–${dv.high}` : ""}${dv.bonus ? ` + ${dv.bonus}` : ""}`;
}

/** Split "3d10 Cold" into dice and the type word the page named. */
function splitExpr(text: string): { expr: string; rest: string } | null {
  const m = /^(\d*d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(.*)$/i.exec(text.trim());
  if (!m) return null;
  const expr = m[1].replace(/\s+/g, "");
  return EXPR_RE.test(expr) ? { expr, rest: m[2].trim() } : null;
}

function parseStep(body: string, errors: string[], line: string): EffectStep | null {
  // `Fail: Damage: 3d10` — a branch prefix binds the step to a resolution
  // outcome. Without one the step simply happens.
  let branch: EffectBranch = "always";
  let rest = body;
  const prefix = /^([A-Za-z]+)\s*:\s*(.+)$/.exec(rest);
  if (prefix) {
    const found = own(BRANCHES, prefix[1]);
    if (found) {
      branch = found;
      rest = prefix[2];
    }
  }

  const head = /^([A-Za-z]+)\s*(?:\(\s*([A-Za-z]+)\s*\))?\s*:\s*(.*)$/.exec(rest);
  if (!head) {
    errors.push(`Not a step: ${line.trim()}`);
    return null;
  }
  const verb = own(VERBS, head[1]);
  if (!verb) {
    errors.push(`Unknown action "${head[1]}": ${line.trim()}`);
    return null;
  }
  let who = DEFAULT_SELECTOR[verb];
  if (head[2]) {
    const selector = own(SELECTORS, head[2]);
    if (!selector) {
      errors.push(`Unknown selector "${head[2]}": ${line.trim()}`);
      return null;
    }
    who = selector;
  }
  const value = head[3].trim();
  const step: EffectStep = { verb, branch, who };

  if (verb === "ruling") {
    if (!value) {
      errors.push(`Ruling needs something for the Curator to decide: ${line.trim()}`);
      return null;
    }
    step.prompt = value;
    return step;
  }

  if (verb === "roll" || verb === "save") {
    const [routeText, ...tail] = value.split(",");
    const ref = parseRollRef(routeText);
    if (!ref) {
      errors.push(`Not a Roll Axis route: ${routeText.trim() || line.trim()}`);
      return null;
    }
    // A Check is not a Save: "Physical Save — Power" names a route the system
    // does not have, and parseRollRef refuses it rather than inventing one.
    if ((verb === "roll") !== (ref.direction === "check")) {
      errors.push(`${verb === "roll" ? "Roll" : "Save"} does not match ${rollRefLabel(ref)}: ${line.trim()}`);
      return null;
    }
    step.ref = ref;
    const dvText2 = tail.join(",").replace(/\bDV\s*/i, "").trim();
    if (dvText2) {
      const dv = parseDv(dvText2);
      if (!dv) {
        errors.push(`Unreadable DV "${dvText2}": ${line.trim()}`);
        return null;
      }
      step.dv = dv;
    }
    return step;
  }

  if (verb === "modify") {
    const m = /^(advantage|disadvantage)\s+on\s+(.+)$/i.exec(value);
    if (!m) {
      errors.push(`Modify needs "Advantage on <route>": ${line.trim()}`);
      return null;
    }
    const [routeText, ...tail] = m[2].split(",");
    const ref = parseRollRef(routeText);
    if (!ref) {
      errors.push(`Not a Roll Axis route: ${routeText.trim()}`);
      return null;
    }
    step.modify = m[1].toLowerCase() as "advantage" | "disadvantage";
    step.ref = ref;
    const durationText2 = tail.join(",").trim();
    if (durationText2) {
      const duration = parseDuration(durationText2);
      if (!duration) {
        errors.push(`Unreadable duration "${durationText2}": ${line.trim()}`);
        return null;
      }
      step.duration = duration;
    }
    return step;
  }

  if (verb === "condition") {
    const [name, ...tail] = value.split(",");
    const condition = name.trim();
    if (!condition || condition.length > 32) {
      errors.push(`Condition needs a name: ${line.trim()}`);
      return null;
    }
    step.condition = condition;
    const durationText2 = tail.join(",").trim();
    if (durationText2) {
      const duration = parseDuration(durationText2);
      if (!duration) {
        errors.push(`Unreadable duration "${durationText2}": ${line.trim()}`);
        return null;
      }
      step.duration = duration;
    }
    return step;
  }

  // cost / damage / heal all carry an amount.
  const parts = value.split(",");
  const split = splitExpr(parts[0]);
  if (!split) {
    errors.push(`Needs dice or a number: ${line.trim()}`);
    return null;
  }
  step.expr = split.expr;
  if (verb === "cost") {
    const resource = resourceOf(split.rest || "ss");
    if (!resource) {
      errors.push(`Unknown resource "${split.rest}": ${line.trim()}`);
      return null;
    }
    step.resource = resource;
    if (/per\s+round/i.test(parts.slice(1).join(","))) step.perRound = true;
    return step;
  }
  if (verb === "damage") {
    if (split.rest) step.damageType = split.rest;
    if (/half\s+on\s+success/i.test(parts.slice(1).join(","))) step.half = true;
    return step;
  }
  // heal
  if (split.rest) {
    const resource = resourceOf(split.rest);
    if (!resource) {
      errors.push(`Unknown resource "${split.rest}": ${line.trim()}`);
      return null;
    }
    step.resource = resource;
  }
  return step;
}

/**
 * Read an `## Actions` section.
 *
 * Blank lines and prose between bullets are ignored, so an author may annotate
 * the block for a human reader without breaking it.
 */
export function parseAbilityEffects(section: string | null | undefined): AbilityEffects {
  const steps: EffectStep[] = [];
  const errors: string[] = [];
  for (const line of String(section || "").replace(/\r\n/g, "\n").split("\n")) {
    const bullet = BULLET_RE.exec(line);
    if (!bullet) continue;
    const step = parseStep(bullet[1], errors, line);
    if (step) steps.push(step);
  }
  return { steps, errors };
}

/** Write a step back as the bullet a page carries. Round-trip with the parser
 *  is a test, not an aspiration: the Mechanics editor rebuilds pages from the
 *  model, and a step it could not re-emit would be a step it silently deleted. */
export function effectLine(step: EffectStep): string {
  const branch = step.branch === "always" ? "" : `${step.branch[0].toUpperCase()}${step.branch.slice(1)}: `;
  const verbWord = step.verb[0].toUpperCase() + step.verb.slice(1);
  const selector = step.who === DEFAULT_SELECTOR[step.verb] ? "" : ` (${step.who})`;
  const head = `- ${branch}${verbWord}${selector}: `;
  switch (step.verb) {
    case "ruling":
      return head + (step.prompt ?? "");
    case "roll":
    case "save":
      return head + rollRefLabel(step.ref!) + (step.dv ? `, ${dvText(step.dv)}` : "");
    case "modify": {
      const word = step.modify === "disadvantage" ? "Disadvantage" : "Advantage";
      return head + `${word} on ${rollRefLabel(step.ref!)}` + (step.duration ? `, ${durationText(step.duration)}` : "");
    }
    case "condition":
      return head + step.condition + (step.duration ? `, ${durationText(step.duration)}` : "");
    case "cost":
      return head + `${step.expr} ${(step.resource ?? "ss").toUpperCase()}` + (step.perRound ? ", per round" : "");
    case "damage":
      return head + `${step.expr}${step.damageType ? ` ${step.damageType}` : ""}` + (step.half ? ", half on success" : "");
    case "heal":
      return head + `${step.expr}${step.resource && step.resource !== "health" ? ` ${step.resource.toUpperCase()}` : ""}`;
  }
}

/** How a step reads on a chip. */
export function effectStepLabel(step: EffectStep): string {
  const branch = step.branch === "always" ? "" : `${step.branch === "fail" ? "On fail" : `On ${step.branch}`} · `;
  switch (step.verb) {
    case "ruling": return `${branch}Curator rules`;
    case "roll":
    case "save": return `${branch}${rollRefLabel(step.ref!)}${step.dv ? ` · ${dvText(step.dv)}` : ""}`;
    case "modify": return `${branch}${step.modify === "disadvantage" ? "Disadvantage" : "Advantage"} · ${rollRefLabel(step.ref!)}`;
    case "condition": return `${branch}${step.condition}${step.duration ? ` · ${durationText(step.duration)}` : ""}`;
    case "cost": return `${step.expr} ${(step.resource ?? "ss").toUpperCase()}${step.perRound ? "/round" : ""}`;
    case "damage": return `${branch}${step.expr}${step.damageType ? ` ${step.damageType}` : ""}`;
    case "heal": return `${branch}Heal ${step.expr}`;
  }
}

/**
 * Declared steps as the actions the UI already renders.
 *
 * `AbilityAction` is the de-facto IR every chip and roll button consumes, so a
 * declared ability arms the same tray the prose-parsed one does — one renderer,
 * one DV keying path, no second code path to keep in step. Steps with no rollable
 * or damaging face (costs, conditions, rulings) contribute nothing here; they are
 * shown from the steps themselves.
 */
export function effectStepsToActions(steps: readonly EffectStep[]): AbilityAction[] {
  const out: AbilityAction[] = [];
  for (const step of steps) {
    if (step.verb === "roll" || step.verb === "save") {
      const action: AbilityAction = {
        kind: step.verb === "roll" ? "self" : "save",
        label: effectStepLabel(step),
        rollAxis: { axis: step.ref!.axis, direction: step.ref!.direction, path: step.ref!.path },
      };
      if (step.dv?.kind === "fixed") {
        action.dc = step.dv.value;
        if (step.dv.bonus) action.dcBonus = step.dv.bonus;
      }
      if (step.dv?.kind === "die") action.dcDie = step.dv.die;
      out.push(action);
      continue;
    }
    if (step.verb === "damage") {
      out.push({
        kind: "damage",
        label: effectStepLabel(step),
        expr: step.expr,
        damageType: step.damageType,
        ...(step.who === "self" ? { self: true } : {}),
      });
      continue;
    }
    if (step.verb === "heal") {
      out.push({ kind: "damage", label: effectStepLabel(step), expr: step.expr, restorative: true });
    }
  }
  return out;
}

/** Does this page declare anything at all? Used to decide whether the block
 *  supersedes the prose parse for an ability. */
export function hasDeclaredEffects(effects: AbilityEffects): boolean {
  return effects.steps.length > 0;
}
