// Ability "understanding" layer. Reads the free-text effect prose of an ability
// (species innate, variant, genus, cipher) and works out which rolls it needs —
// so the UI can render the RIGHT buttons per ability instead of one generic one.
//
// Deterministic on purpose: the app is offline-first, so this is a rules-aware
// parser, not an LLM call. It extracts three things a table actually clicks:
//   • self   — a roll the acting character makes (armed into the dice tray)
//   • damage — a damage dice expression the ability deals
//   • save   — a resolution the TARGET makes, with its DC (shown, not armed)

import { isRestorativeAt } from "./abilityDamage";

export type AbilityActionKind = "self" | "damage" | "save";

export type AbilityRollAxis = "physical" | "mental";
export type AbilityRollDirection = "check" | "save";
export type AbilityRollAxisPath = "power" | "density" | "evasion" | "recovery" | "capacity" | "perception" | "influence";

/** A Universal Resolution path named directly by ability prose, for example
 * `Physical Save — Evasion`. This remains separate from `stat`: a path roll
 * combines one of two legal sources with its derived modifier. */
export interface AbilityRollAxisRef {
  axis: AbilityRollAxis;
  direction: AbilityRollDirection;
  path: AbilityRollAxisPath;
}

export interface AbilityAction {
  kind: AbilityActionKind;
  /** Button / chip label, e.g. "Inspiration check", "3d10 Entropy", "Endurance save · DC 18". */
  label: string;
  /** Dice expression to arm the tray (self + damage only), e.g. "1d20", "3d10". */
  expr?: string;
  /** Named stat the character rolls (self only) — the caller maps it to a modifier. */
  stat?: string;
  /** Full Roll Axis route when the prose names an axis + check/save + path. */
  rollAxis?: AbilityRollAxisRef;
  /** Save/DC for a target-side resolution (save only). */
  dc?: number;
  /** A named modifier the DV adds, e.g. "DV 13 + Neuronal Capacity Modifier". */
  dcBonus?: string;
  /** A DV that is ROLLED rather than fixed — "against a d40 Dice Value". */
  dcDie?: number;
  /** Damage type word, when the text names one (damage only). */
  damageType?: string;
  /** Dice the ACTING character takes or spends, not the target — "the Inquisitor
   *  takes 1d4 psychic backlash", "at the cost of 1d6". The button still arms
   *  (someone rolls it), but a consumer applying an outcome to a target must not
   *  charge them the caster's own price. */
  self?: boolean;
  /** Dice that restore rather than harm — heals, regeneration, temporary HP.
   *  Same reason: the pool moves the other way. */
  restorative?: boolean;
}

// "Radiance" and "Radiant" are the same energy written two ways in the 2026-08
// Genus pages; Eldritch and Elemental damage arrived with the same update.
// Radiance is listed before Radiant so the longer word wins the alternation.
/** Exported for authoring UIs; the parser derives its alternation from this
 *  list so the two can never disagree. */
export const DAMAGE_TYPE_WORDS = [
  "Force", "Radiance", "Radiant", "Antimatter", "Psychic", "Spirit", "Entropy", "Fire", "Cold",
  "Kinetic", "Void", "Null", "Acid", "Poison", "Crushing", "Sonic", "Lightning", "Necrotic",
  "Eldritch", "Elemental",
] as const;
const DAMAGE_TYPES = DAMAGE_TYPE_WORDS.join("|");

// Stat words the resolver in wte.ts understands, as an alternation for scanning.
const STAT_WORDS =
  "Physical|Strength|Dexterity|Endurance|Action Priority|AP|Wisdom|Charisma|Intelligence|" +
  "Inspiration|Balance|Weight|Precision|Control|Weapon Mastery|Mental Fortitude|Perception|Adaptation|Adaption|Cunning|Influence";

/** Must mirror ROLL_AXIS_PATHS in rollAxis.ts; rollFormula.test.ts enforces it. */
export const AXIS_PATH_RULES: Record<AbilityRollAxisPath, { axis: AbilityRollAxis; directions: readonly AbilityRollDirection[] }> = {
  power: { axis: "physical", directions: ["check"] },
  density: { axis: "physical", directions: ["check"] },
  evasion: { axis: "physical", directions: ["save"] },
  recovery: { axis: "physical", directions: ["save"] },
  capacity: { axis: "mental", directions: ["check"] },
  perception: { axis: "mental", directions: ["check", "save"] },
  influence: { axis: "mental", directions: ["check", "save"] },
};

// The acting character paying a price in the same breath as dealing damage —
// Psychic Scream's "the Inquisitor takes 1d4 psychic backlash damage regardless"
// sits in the same effect as the 2d8 it deals the target.
//
// The taking verb must sit adjacent to the dice: "creatures within 10 ft of YOU
// take 2d8" names the acting character too, and a looser window would read the
// target's damage as the caster's cost.
//
// Group 1 is the preposition that demotes the actor from subject to landmark —
// in "creatures within 10 ft of you take 2d6" the takers are the creatures and
// "you" is only the point they are measured from. It is CAPTURED and rejected
// afterwards rather than excluded with a negative lookbehind, because this
// bundle ships into WebKit as well as WebView2 and an engine without
// variable-length lookbehind throws on the pattern itself — every ability row
// in the app would fail to parse, not merely this one clause.
const SELF_COST_RE = new RegExp(
  "(?:(\\b(?:of|from|to|near|around|within|beside|behind|by|with)\\s+)?" +
    "\\b(?:you|the\\s+inquisitor|the\\s+user|the\\s+caster)\\b\\s*(?:also\\s+)?" +
    "(?:takes?|suffers?|loses?|sacrifices?|pays?|spends?)|\\bat\\s+the\\s+cost\\s+of)" +
    "\\s+(?:an?\\s+)?$",
  "i"
);

/** Are the dice immediately after `before` the ACTING character's own price? */
function isSelfCost(before: string): boolean {
  const m = SELF_COST_RE.exec(before);
  // Leftmost-first matching reaches the preposition before it reaches the
  // pronoun, so a landmark reading always populates group 1.
  return !!m && !m[1];
}

/** Chip-sized names for the modifier terms DV expressions actually use. */
function shortStat(term: string): string {
  return term
    .replace(/neuronal capacity/i, "NC")
    .replace(/\bmodifier\b/i, "Mod")
    .replace(/\bcode level\b/i, "Code Lv")
    .replace(/\bode level\b/i, "Ode Lv")
    .trim();
}

// Effect prose is immutable per ability and this parser runs a battery of
// regexes — the VTT re-parses every visible row on every render. One cache
// entry per distinct effect string makes that free. Bounded by wholesale reset:
// a table cycles through hundreds of abilities, not tens of thousands, so
// eviction sophistication would outweigh the cost being avoided. Callers treat
// the returned array as frozen — filter/map it, never push into it.
const PARSE_CACHE_MAX = 512;
const parseCache = new Map<string, AbilityAction[]>();

/** Parse ability effect prose into the concrete actions a table clicks. */
export function parseAbilityActions(effect: string | null | undefined): AbilityAction[] {
  const text = String(effect || "");
  if (!text.trim()) return [];
  const cached = parseCache.get(text);
  if (cached) return cached;
  const parsed = parseAbilityActionsUncached(text);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(text, parsed);
  return parsed;
}

function parseAbilityActionsUncached(text: string): AbilityAction[] {
  const out: AbilityAction[] = [];
  const seen = new Map<string, number>();
  const push = (a: AbilityAction) => {
    const stat = a.stat?.trim().toLowerCase();
    // A stat word that IS a Roll Axis path name, arriving after that path was
    // already parsed in full, is a back-reference ("If the Perception Save
    // fails…"), not a second roll.
    if (!a.rollAxis && stat && out.some((prior) => prior.rollAxis && prior.rollAxis.path === stat)) return;
    const k = a.kind === "damage"
      ? `${a.kind}|${a.expr ?? a.label}|${a.damageType ?? ""}`
      : a.rollAxis
        ? `${a.kind}|axis|${a.rollAxis.axis}|${a.rollAxis.direction}|${a.rollAxis.path}`
        : `${a.kind}|${stat ?? a.label.toLowerCase()}`;
    const priorIndex = seen.get(k);
    if (priorIndex != null) {
      const prior = out[priorIndex];
      // A broad natural-language match may find "target makes Endurance Save"
      // before the explicit save parser reaches "(DC 12)". Enrich that one
      // action instead of rendering a second, weaker request button.
      if (a.kind === "save" && prior.dc == null && a.dc != null) out[priorIndex] = a;
      return;
    }
    seen.set(k, out.length);
    out.push(a);
  };

  // ── Damage dice: "3d10 Entropy", "deals 2d8", "1d8 Psychic or 1d10 Spirit" ──
  const dmgRe = new RegExp(`(\\d*d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s*(${DAMAGE_TYPES})?`, "gi");
  let dm: RegExpExecArray | null;
  while ((dm = dmgRe.exec(text))) {
    // "each against a d40 Dice Value" is a DV, not damage — without this guard
    // every rolled DV also spawned a phantom d40 damage button.
    const dmTail = text.slice(dm.index + dm[0].length, dm.index + dm[0].length + 16);
    if (/^\s*Dice\s+Value/i.test(dmTail)) continue;
    const expr = dm[1].replace(/\s+/g, "");
    const type = dm[2] ? dm[2][0].toUpperCase() + dm[2].slice(1).toLowerCase() : undefined;
    // WHO the dice land on. Clause-bounded for the same reason the axis scanner
    // is: an earlier sentence's "you take" must not claim this sentence's damage.
    const dmgClause = Math.max(
      text.lastIndexOf(".", dm.index - 1),
      text.lastIndexOf(";", dm.index - 1),
      text.lastIndexOf("·", dm.index - 1)
    );
    const dmgBefore = text.slice(Math.max(dmgClause + 1, dm.index - 100), dm.index);
    const self = isSelfCost(dmgBefore);
    // WHICH WAY the pool moves is asked of the damage summarizer instead, which
    // already owns that judgement for the Actions table. Deliberately NOT
    // clause-bounded: a heal verb carries across the semicolons separating its
    // SS tiers, where "you take" does not carry across a sentence.
    const restorative = isRestorativeAt(text, dm.index);
    push({
      kind: "damage",
      label: type ? `${expr} ${type}` : expr,
      expr,
      damageType: type,
      ...(self ? { self: true } : {}),
      ...(restorative ? { restorative: true } : {}),
    });
  }

  // ── Universal Resolution paths ──
  // These must be recognized before the broad "Stat Save" scanner below. A
  // phrase such as "Physical Save — Evasion" is not a bare Physical roll: it is
  // DEX or Balance PLUS the Evasion derived modifier, and the active Codex may
  // replace that path/direction formula.
  const axisRanges: { start: number; end: number }[] = [];
  const axisRe = /\b(Physical|Mental)\s+(Saves?|Checks?)\s*(?:[\u2014\u2013:\-]\s*)?(Power|Density|Evasion|Recovery|Capacity|Perception|Influence)\b/gi;
  let ar: RegExpExecArray | null;
  while ((ar = axisRe.exec(text))) {
    const axis = ar[1].toLowerCase() as AbilityRollAxis;
    const plural = /s$/i.test(ar[2]);
    const direction = ar[2].toLowerCase().replace(/s$/, "") as AbilityRollDirection;
    const path = ar[3].toLowerCase() as AbilityRollAxisPath;
    axisRanges.push({ start: ar.index, end: ar.index + ar[0].length });
    const route = AXIS_PATH_RULES[path];
    if (route.axis !== axis || !route.directions.includes(direction)) continue;

    // Explicit subject wording wins. Without one, Checks are made by the
    // acting character and Saves by the target, which is how Resolution pairs
    // such as "Mental Check — Capacity vs Physical Save — Evasion" are written.
    const clauseStart = Math.max(
      text.lastIndexOf(".", ar.index - 1),
      text.lastIndexOf(";", ar.index - 1),
      text.lastIndexOf("·", ar.index - 1)
    );
    const before = text.slice(Math.max(clauseStart + 1, ar.index - 100), ar.index);
    const targetSubject = /\b(?:the\s+target|target|they|the\s+creature|creatures|opponent|unwilling\s+creatures?)\b[^.;·]{0,75}\b(?:rolls?|makes?|with|using|repeat(?:s)?)\s+(?:an?\s+)?$/i.test(before);
    const selfSubject = /\b(?:you|your\s+character|the\s+inquisitor)\b[^.;·]{0,75}\b(?:rolls?|makes?)\s+(?:an?\s+)?$/i.test(before);
    // A plural mention with no rolling subject is penalty/reference prose
    // ("disadvantage on Physical Saves — Evasion") — recorded in axisRanges so
    // the broad scanners skip it, but it is not itself a roll anyone makes.
    if (plural && !targetSubject && !selfSubject) continue;
    const kind: AbilityActionKind = targetSubject ? "save" : selfSubject ? "self" : direction === "check" ? "self" : "save";
    // The updated pages write DVs three ways: fixed ("DV 13"), fixed plus a
    // named modifier ("DV 13 + Neuronal Capacity Modifier"), and rolled
    // ("each against a d40 Dice Value"). The window spans "and a Mental Save
    // — Influence, each against a" so a shared rolled DV reaches BOTH saves,
    // but never crosses a sentence boundary.
    const dcTail = text.slice(ar.index + ar[0].length, ar.index + ar[0].length + 96);
    const dcMatch = /^[^.;·]{0,64}\bD(?:C|V)\s*(?:of|=)?\s*(\d+)(?:\s*[–—-]\s*(\d+))?(?:\s*\+\s*([A-Za-z][A-Za-z ]*?(?:Modifier|Level)))?/i.exec(dcTail);
    const dieMatch = dcMatch ? null : /^[^.;·]{0,64}\bd(\d+)\s+Dice\s+Value/i.exec(dcTail);
    const dc = dcMatch ? parseInt(dcMatch[1], 10) : undefined;
    // "DV 12–18 based on complexity": dc keeps the low bound, the label keeps
    // the authored range rather than silently understating it.
    const dcHigh = dcMatch?.[2] ? parseInt(dcMatch[2], 10) : undefined;
    const dcBonus = dcMatch?.[3]?.trim();
    const dcDie = dieMatch ? parseInt(dieMatch[1], 10) : undefined;
    const dvText =
      dc != null
        ? `DV ${dc}${dcHigh != null ? `–${dcHigh}` : ""}${dcBonus ? ` + ${shortStat(dcBonus)}` : ""}`
        : dcDie != null
          ? `DV d${dcDie}`
          : "";
    const word = direction === "check" ? "Check" : "Save";
    const label = `${ar[1]} ${word} — ${ar[3]}${dvText ? ` · ${dvText}` : ""}`;
    push({ kind, label, rollAxis: { axis, direction, path }, dc, dcBonus, dcDie });
  }
  const overlapsAxisPhrase = (index: number, length: number) =>
    axisRanges.some((range) => index < range.end && index + length > range.start);

  // ── Explicit self rolls FIRST (so an opposed pair's lead stat wins) ──
  // "opposed Inspiration + Influence Check" → the character rolls Inspiration.
  const opposed = new RegExp(`opposed\\s+(${STAT_WORDS})(?:\\s*\\+\\s*(${STAT_WORDS}))?\\s+(?:Skill\\s+)?Check`, "i").exec(text);
  if (opposed) {
    push({ kind: "self", label: `${opposed[1]} check`, expr: "1d20", stat: opposed[1] });
  }
  // "roll a d20 + Ode Level", "d20 + Code Level" → a flat level-scaled d20.
  if (/\bd20\s*\+\s*(?:ode|code|rank)\b/i.test(text)) {
    push({ kind: "self", label: "d20 + level", expr: "1d20" });
  }

  // Natural "roll Stat" phrasing used by species/variant abilities. Explicit
  // actor words decide which side rolls; a forced roll is target-side.
  const selfRollRe = new RegExp(
    `(?:\\b(?:you|your character|the inquisitor)\\b[^.;]{0,50}?\\b(?:roll|rolls|make|makes)\\s+(?:an?\\s+)?|\\bsucceed\\s+on\\s+(?:an?\\s+)?|(?:^|[.;]\\s*)\\broll\\s+)(${STAT_WORDS})(?:\\s+(?:roll|check))?`,
    "gi"
  );
  let sr: RegExpExecArray | null;
  while ((sr = selfRollRe.exec(text))) {
    if (overlapsAxisPhrase(sr.index, sr[0].length)) continue;
    push({ kind: "self", label: `${sr[1]} check`, expr: "1d20", stat: sr[1] });
  }
  const targetRollRe = new RegExp(
    `\\b(?:the\\s+target|target|they|the\\s+creature|opponent)\\b[^.;]{0,45}?\\b(?:roll|rolls|make|makes)\\s+(?:an?\\s+)?(${STAT_WORDS})(?:\\s+(?:roll|check|save))?`,
    "gi"
  );
  let tr: RegExpExecArray | null;
  while ((tr = targetRollRe.exec(text))) {
    if (overlapsAxisPhrase(tr.index, tr[0].length)) continue;
    push({ kind: "save", label: `${tr[1]} save`, stat: tr[1] });
  }
  const forcedRollRe = new RegExp(`\\bforced\\s+(${STAT_WORDS})\\s+Roll`, "gi");
  let fr: RegExpExecArray | null;
  while ((fr = forcedRollRe.exec(text))) {
    push({ kind: "save", label: `${fr[1]} save`, stat: fr[1] });
  }

  // ── Target saves / checks with a DC: "Endurance Save (DC 18)", "Wisdom Save DC 16" ──
  const saveRe = new RegExp(`(${STAT_WORDS})\\s+(?:Saving Throw|Save|Check)(?:[^.]*?DC\\s*(\\d+))?`, "gi");
  let sv: RegExpExecArray | null;
  while ((sv = saveRe.exec(text))) {
    if (overlapsAxisPhrase(sv.index, sv[0].length)) continue;
    const stat = sv[1];
    const dc = sv[2] ? parseInt(sv[2], 10) : undefined;
    const pre = text.slice(Math.max(0, sv.index - 40), sv.index).toLowerCase();
    if (/\bopposed\b/.test(pre)) continue; // part of an opposed pair, already handled
    if (/\b(you|your|roll a?|make an?|the inquisitor)\b/.test(pre)) {
      push({ kind: "self", label: `${stat} check`, expr: "1d20", stat });
    } else {
      push({ kind: "save", label: dc != null ? `${stat} save · DC ${dc}` : `${stat} save`, stat, dc });
    }
  }

  return out;
}
