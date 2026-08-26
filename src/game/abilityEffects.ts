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
export type EffectVerb =
  | "cost" | "roll" | "save" | "damage" | "heal" | "condition" | "modify" | "ruling" | "zone" | "counter" | "summon"
  | "tamper" | "invoke" | "origin";

/**
 * What one ability does to ANOTHER ability's effect.
 *
 * A third of the corpus is meta — Negate, Reflect, Catalyst, Null Zone, Spyder,
 * Quick Hack. These are only expressible because a placed effect already carries
 * the ability that placed it (`VttEffectData.sourceAbilityId`): tamper needs
 * effects to be objects with identity, not anonymous drawings on a map.
 */
export type TamperMode = "negate" | "reflect" | "redirect" | "delay" | "copy" | "end";

/** The shapes the VTT can actually place. Named for the table, mapped to the
 *  engine's own kinds by the caller — a page says "circle", not "VttEffectKind". */
export type EffectShape = "circle" | "cone" | "line" | "ring" | "cross" | "square";

/** WHEN a step happens, which is orthogonal to which BRANCH arms it. A step can
 *  be both ("Each round: Fail: Damage: 3d10") — the zone ticks every round, and
 *  the damage still only lands on a failure. */
export type EffectCadence = "once" | "each-round" | "in-zone" | "at-threshold";

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
  /** When this step fires. `once` is the default. */
  cadence: EffectCadence;
  /** zone — the template the ability places. */
  shape?: EffectShape;
  /** zone — size as the page writes it, in FEET. Cells are the engine's unit,
   *  not the table's; the corpus says "15-ft radius" and so does the block. */
  sizeFt?: number;
  /** zone — what the template is anchored to. `self` is an aura that travels
   *  with its caster; `point` is placed and stays put. */
  attach?: "self" | "target" | "point";
  /** counter — the track's name, as the page writes it. Open text like a
   *  condition: Blight, Fear, Overload Charges are one mechanism with many
   *  names, and a table inventing its own currency must not need a parser change. */
  counter?: string;
  /** counter — how far the track moves, signed. */
  delta?: number;
  /** counter — the value the track stops at, when the page gives one. */
  cap?: number;
  /** at-threshold — the value that fires this step. The counter it watches is
   *  resolved at parse time from the nearest one declared above it, so a
   *  consumer never has to reason about bullet order. */
  threshold?: number;
  /** summon — how many bodies arrive, and what they are called. */
  count?: number;
  summon?: string;
  /** tamper — what this ability does to another ability's active effect. */
  tamper?: TamperMode;
  /** invoke — another ability, called by name. The Last War invokes Weaponize,
   *  Hollow Shell and Trixt Link by name, so ability-as-macro is canon, not a
   *  convenience: the engine resolves the reference rather than a page
   *  restating rules that already live somewhere else. */
  invoke?: string;
  /** origin — where the ability fires FROM when that is not the caster's body:
   *  a Seraph's Medium, a Remnant echo, a Stygian's shadow. Open text, like a
   *  condition's name — origin words belong to a setting, and every one of the
   *  148 Ciphers already mounts on a Component. */
  origin?: string;
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
  zone: "zone",
  area: "zone",
  counter: "counter",
  track: "counter",
  summon: "summon",
  tamper: "tamper",
  invoke: "invoke",
  origin: "origin",
};

const TAMPERS: Readonly<Record<string, TamperMode>> = {
  negate: "negate",
  reflect: "reflect",
  redirect: "redirect",
  delay: "delay",
  copy: "copy",
  end: "end",
  dispel: "end",
};

const SHAPES: Readonly<Record<string, EffectShape>> = {
  circle: "circle",
  radius: "circle",
  sphere: "circle",
  cone: "cone",
  line: "line",
  ring: "ring",
  cross: "cross",
  square: "square",
  cube: "square",
  box: "square",
};

const CADENCES: Readonly<Record<string, EffectCadence>> = {
  "each round": "each-round",
  "every round": "each-round",
  "in zone": "in-zone",
  "in area": "in-zone",
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
  zone: "target",
  counter: "target",
  summon: "self",
  // Tamper acts on an effect, not a body; the selector says whose effect, and
  // the one worth naming is someone else's.
  tamper: "target",
  invoke: "self",
  origin: "self",
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
  // `Each round:` and `In zone:` say WHEN, not on which branch, so they are
  // stripped first and a branch prefix may still follow them.
  let cadence: EffectCadence = "once";
  let threshold: number | undefined;
  const cadencePrefix = /^([A-Za-z]+\s+[A-Za-z]+)\s*:\s*(.+)$/.exec(rest);
  if (cadencePrefix) {
    const found = own(CADENCES, cadencePrefix[1]);
    if (found) {
      cadence = found;
      rest = cadencePrefix[2];
    }
  }
  // `At 8:` — a track reaching a value is a third way of saying when, alongside
  // a round passing and a body standing somewhere.
  const atPrefix = /^At\s+(\d{1,4})\s*:\s*(.+)$/i.exec(rest);
  if (atPrefix) {
    cadence = "at-threshold";
    threshold = parseInt(atPrefix[1], 10);
    rest = atPrefix[2];
  }
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
  const step: EffectStep = { verb, branch, who, cadence };
  if (threshold !== undefined) step.threshold = threshold;

  if (verb === "counter") {
    const parts = value.split(",");
    const m = /^(.+?)\s*([+-]\d{1,4})$/.exec(parts[0].trim());
    if (!m) {
      errors.push(`Counter needs a name and a signed amount: ${line.trim()}`);
      return null;
    }
    step.counter = m[1].trim();
    step.delta = parseInt(m[2], 10);
    for (const raw of parts.slice(1)) {
      const tail = raw.trim();
      if (!tail) continue;
      const cap = /^cap\s+(\d{1,4})$/i.exec(tail);
      if (!cap) {
        errors.push(`Unreadable counter detail "${tail}": ${line.trim()}`);
        return null;
      }
      step.cap = parseInt(cap[1], 10);
    }
    return step;
  }

  if (verb === "tamper") {
    const parts = value.split(",");
    const mode = own(TAMPERS, parts[0].trim());
    if (!mode) {
      errors.push(`Unknown tamper "${parts[0].trim()}": ${line.trim()}`);
      return null;
    }
    step.tamper = mode;
    const tail = parts.slice(1).join(",").trim();
    if (tail) {
      const duration = parseDuration(tail);
      if (!duration) {
        errors.push(`Unreadable tamper detail "${tail}": ${line.trim()}`);
        return null;
      }
      step.duration = duration;
    }
    return step;
  }

  if (verb === "invoke") {
    const name = value.trim();
    if (!name) {
      errors.push(`Invoke needs an ability to call: ${line.trim()}`);
      return null;
    }
    step.invoke = name;
    return step;
  }

  if (verb === "origin") {
    const name = value.trim();
    if (!name || name.length > 32) {
      errors.push(`Origin needs a place to fire from: ${line.trim()}`);
      return null;
    }
    step.origin = name;
    return step;
  }

  if (verb === "summon") {
    const m = /^(?:(\d{1,4})\s*(?:x\s*)?)?(.+)$/i.exec(value);
    const name = m?.[2]?.trim();
    if (!name) {
      errors.push(`Summon needs something to summon: ${line.trim()}`);
      return null;
    }
    step.summon = name;
    step.count = m?.[1] ? parseInt(m[1], 10) : 1;
    return step;
  }

  if (verb === "zone") {
    const parts = value.split(",");
    const m = /^([A-Za-z]+)\s+(\d{1,4})\s*-?\s*(?:ft|feet)\b/i.exec(parts[0].trim());
    if (!m) {
      errors.push(`Zone needs a shape and a size in feet: ${line.trim()}`);
      return null;
    }
    const shape = own(SHAPES, m[1]);
    if (!shape) {
      errors.push(`Unknown shape "${m[1]}": ${line.trim()}`);
      return null;
    }
    step.shape = shape;
    step.sizeFt = parseInt(m[2], 10);
    for (const raw of parts.slice(1)) {
      const tail = raw.trim();
      if (!tail) continue;
      const attach = /^attach\s+(self|target|point)$/i.exec(tail);
      if (attach) {
        step.attach = attach[1].toLowerCase() as "self" | "target" | "point";
        continue;
      }
      const duration = parseDuration(tail);
      if (!duration) {
        errors.push(`Unreadable zone detail "${tail}": ${line.trim()}`);
        return null;
      }
      step.duration = duration;
    }
    return step;
  }

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
    if (!step) continue;
    // A threshold watches the nearest track declared above it. Resolving the
    // name here keeps the IR self-contained: no consumer has to re-derive
    // meaning from bullet order, which is exactly where such rules rot.
    if (step.cadence === "at-threshold" && !step.counter) {
      const track = [...steps].reverse().find((prior) => prior.verb === "counter" && prior.counter);
      if (!track) {
        errors.push(`"At ${step.threshold}" names no track declared above it: ${line.trim()}`);
        continue;
      }
      step.counter = track.counter;
    }
    steps.push(step);
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
  const cadence =
    step.cadence === "each-round"
      ? "Each round: "
      : step.cadence === "in-zone"
        ? "In zone: "
        : step.cadence === "at-threshold"
          ? `At ${step.threshold}: `
          : "";
  const head = `- ${cadence}${branch}${verbWord}${selector}: `;
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
    case "zone":
      return (
        head +
        `${step.shape} ${step.sizeFt} ft` +
        (step.attach ? `, attach ${step.attach}` : "") +
        (step.duration ? `, ${durationText(step.duration)}` : "")
      );
    case "counter":
      return head + `${step.counter} ${step.delta! > 0 ? "+" : ""}${step.delta}` + (step.cap != null ? `, cap ${step.cap}` : "");
    case "summon":
      return head + `${step.count && step.count > 1 ? `${step.count} ` : ""}${step.summon}`;
    case "tamper":
      return head + step.tamper + (step.duration ? `, ${durationText(step.duration)}` : "");
    case "invoke":
      return head + step.invoke;
    case "origin":
      return head + step.origin;
  }
}

/** How a step reads on a chip.
 *
 * A non-default selector rides the label for the same reason `effectLine`
 * writes it into the bullet: it is the whole difference between two steps.
 * Unravel Spacia declares `Damage: 3d10 Force` and `Damage (self): 3d10 Force`,
 * and without the suffix the tray offers two buttons nothing tells apart; a
 * `Modify (target)` chip reads as though the USER took the disadvantage.
 * Ruling is exempt — its prompt is prose that names its own subject. */
export function effectStepLabel(step: EffectStep): string {
  const branch = step.branch === "always" ? "" : `${step.branch === "fail" ? "On fail" : `On ${step.branch}`} · `;
  const who = step.who === DEFAULT_SELECTOR[step.verb] ? "" : ` (${step.who})`;
  switch (step.verb) {
    case "ruling": return `${branch}Curator rules`;
    case "roll":
    case "save": return `${branch}${rollRefLabel(step.ref!)}${step.dv ? ` · ${dvText(step.dv)}` : ""}${who}`;
    case "modify": return `${branch}${step.modify === "disadvantage" ? "Disadvantage" : "Advantage"} · ${rollRefLabel(step.ref!)}${who}`;
    case "condition": return `${branch}${step.condition}${step.duration ? ` · ${durationText(step.duration)}` : ""}${who}`;
    case "cost": return `${step.expr} ${(step.resource ?? "ss").toUpperCase()}${step.perRound ? "/round" : ""}${who}`;
    case "damage": return `${branch}${step.expr}${step.damageType ? ` ${step.damageType}` : ""}${who}`;
    case "heal": return `${branch}Heal ${step.expr}${who}`;
    case "zone":
      return `${step.attach === "self" ? "Aura" : "Zone"} · ${step.shape} ${step.sizeFt} ft${step.duration ? ` · ${durationText(step.duration)}` : ""}`;
    case "counter":
      return `${branch}${step.counter} ${step.delta! > 0 ? "+" : ""}${step.delta}${step.cap != null ? ` / ${step.cap}` : ""}${who}`;
    case "summon":
      return `${branch}Summon ${step.count && step.count > 1 ? `${step.count} ` : ""}${step.summon}`;
    case "tamper": {
      const word = step.tamper === "end" ? "End" : step.tamper![0].toUpperCase() + step.tamper!.slice(1);
      return `${branch}${word} effect${step.duration ? ` · ${durationText(step.duration)}` : ""}`;
    }
    case "invoke":
      return `${branch}Invoke ${step.invoke}`;
    case "origin":
      return `From ${step.origin}`;
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
 *
 * `At N` steps are NOT actions. A threshold's payload is armed by a track
 * reaching a number, and `crossedThresholds` is the only thing entitled to say
 * that it did; putting `At 8: Damage: 1d100` in the tray offered a button the
 * Curator could press on the first point of Blight — the 1d100 landing seven
 * points early, under a label that gave no hint it was conditional. The same
 * rule already holds in `consequencesFromSteps` and `pageSummons`, both of which
 * skip `at-threshold` at the top level; this was the one reader that did not,
 * and the tray is the one place where the mistake is a single click away.
 */
export function effectStepsToActions(steps: readonly EffectStep[]): AbilityAction[] {
  const out: AbilityAction[] = [];
  for (const step of steps) {
    if (step.cadence === "at-threshold") continue;
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
