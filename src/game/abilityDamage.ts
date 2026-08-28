// What does this ability actually DO to a target?
//
// The Actions table used to print an ability's SS cost in its Damage column,
// which reads as "Lark deals 5 damage" when 5 SS is what it *costs*. This module
// reads the effect text instead and reports the real damage — or, when there is
// none, what the ability does in place of damage.
//
// The hard part is not finding dice, it is IGNORING dice that are not damage.
// Genus text is full of them: "DC 12 Control check", "a dc of d40 perception",
// "roll d6 — on a 1", "heals HP — 2d8 at SS 5", "HP equal to 10 + Neuronal
// Capacity Modifier", "1d20 + END modifier HP". Every one of those reads as
// damage to a naive dice scan.
//
// For the NON-damage label we lean on the ability's authored Classification
// (Emission / Enhancement / Trans-modification / Divination / Materialization)
// rather than guessing intent from prose. An earlier draft inferred a
// buff/debuff/control taxonomy from wording and got it visibly wrong — Armor
// Increase ("grants +3 DHP") came out as a debuff because it also mentions a −1,
// and Inverse Reverse came out as healing because its text says "a heal becomes
// harm". Classification is authored data; it is never wrong.

/** Damage words the rules use, longest-first so "True Damage" beats "True". */
const DAMAGE_TYPES = [
  "Pathogenic", "Antimatter", "Crushing", "Lightning", "Radiance", "Radiant", "Necrotic",
  "Elemental", "Entropy", "Eldritch", "Psychic", "Spirit", "Kinetic", "Force", "Sonic",
  "Acid", "Poison", "Cold", "Fire", "Void", "Null", "True",
];

export interface DamagePart {
  /** Dice expression as written, e.g. "2d12". */
  expr: string;
  /** Damage type when the text names one. */
  type?: string;
}

export interface DamageSummary {
  /** Every damage instance found, in text order. */
  parts: DamagePart[];
  /** One line for the Damage column: the dice, or what it does instead. */
  label: string;
  /** True when the ability deals no damage at all. */
  none: boolean;
}

/**
 * Prose meaning the dice that FOLLOW it move the pool the other way: they
 * restore rather than harm.
 *
 * Each pattern runs to the end of the sentence rather than to the next clause,
 * because one heal verb governs every tier it goes on to list — Reconstruct's
 * "heals HP — 2d8 at SS 5; 4d8 at SS 10; 6d8 at SS 15" says "heals" once and
 * then three sets of dice. A window measured in clauses or characters reaches
 * the first set and reads the other two as damage.
 */
const RESTORATIVE_BEFORE = [
  /\bheals?\b[^.]*$/i,              // "heals HP — 2d8 at SS 5"
  /\bhealing\b[^.]*$/i,
  /\bregenerat\w*\b[^.]*$/i,        // "regenerate 1d20 HP per turn", "regeneration"
  /\brestores?\b[^.]*$/i,
  /\brecover(?:s|ing)?\b[^.]*$/i,   // "Target recovers 3d8 HP", "recovering 2d6"
  /\brestoring\b[^.]*$/i,           // the gerund the corpus actually writes
  /\btemp(?:orary)?\s+hp\b[^.]*$/i,
];

/** Phrases meaning the dice near them are NOT this ability's damage output. */
const NOT_DAMAGE_BEFORE = [
  /\bdc\s*(?:of|=)?\s*$/i,          // "DC 12", "a dc of d40"
  ...RESTORATIVE_BEFORE,            // a heal is not damage either
  /\bhp equal to\b[^.]*$/i,         // a construct's own HP
  /\broll\s*(?:a\s*)?\(?$/i,        // "roll a d6 — on a 1"; "roll (1d10) for feet"
  // A CEILING is not an output: Voaulton/Cyborg Circuit Transfiguration reads
  // "its own listed yield, never more than 3d10".
  /\b(?:never\s+more\s+than|no\s+more\s+than|at\s+most|up\s+to|maximum\s+of)\s*$/i,
  // A resolution formula the TARGETS roll — Insectoid/Archnida Unnerving
  // Presence, "Resolution: d20 + Size Modifier".
  /\bresolution\s*[:\u2014-]\s*$/i,
];
const NOT_DAMAGE_AFTER = [
  /^\s*(?:hp|dhp)\b/i,              // "1d20 + END modifier HP"
  /^\s*(?:perception|control|wisdom|endurance|dexterity|strength|intelligence)\b/i,
  // A distance or a duration, with the bracket Rudam closes its dice in:
  // "extend the projection by up to 100 ft, roll (1d10) for feet".
  /^\s*\)?\s*(?:for\s+)?(?:rounds?|minutes?|turns?|feet|ft)\b/i,
  // A THRESHOLD the table watches for, not a hit: Stygians Parasitic Shadow,
  // "declare a d20 threshold value (e.g., 15)".
  /^\s*\)?\s*threshold\b/i,
  // Synaptic Space is a different pool. Oriyu/Qerran Interitus restores 1d50 of
  // it; applied as damage that number comes off somebody's hit points.
  /^\s*(?:synaptic\s+space|ss\b)/i,
  // The dice are the size of a bonus, not of a wound.
  /^\s*to\s+(?:a|an|any|the)?\s*(?:check|save|roll)\b/i,
];

/** How far back a dice match reads for the prose that qualifies it. */
const BEFORE_WINDOW = 60;
/** How far FORWARD, for a verb that qualifies dice it follows. Bounded to two
 *  sentences: far enough for "store the result … restore a Health Pool", short
 *  enough that a paragraph's later healing cannot claim an earlier attack. */
const AFTER_WINDOW = 160;
const RESTORATIVE_AFTER =
  /\b(?:store[sd]?|stored|stores?)\b[^.]{0,80}\.[^.]{0,80}\b(?:restore|restores|restoring|heal|heals|healing|recover|recovers)\b/i;

/**
 * Do the dice at `idx` restore rather than harm?
 *
 * Exported because the ability ACTION parser needs the same verdict: the Damage
 * column and the VTT resolution card read the same prose, and a heal that one
 * of them applies as damage to a token is the worst kind of disagreement. One
 * list, one answer.
 */
export function isRestorativeAt(text: string, idx: number): boolean {
  const before = text.slice(Math.max(0, idx - BEFORE_WINDOW), idx);
  if (RESTORATIVE_BEFORE.some((re) => re.test(before))) return true;
  // The verb can also come AFTER the dice, in the next breath: the Trevant
  // ability Vhisper reads "roll 1d40 and store the result as Returned
  // Vitality. The Trevant can restore a Health Pool ... add the stored value".
  // Reading backwards only, that 1d40 was damage — and on the VTT it would have
  // been subtracted from a token. The window stops at the sentence that names
  // the pool, so a later unrelated "restores" cannot reach back and heal
  // somebody's damage roll.
  const after = text.slice(idx, idx + AFTER_WINDOW);
  return RESTORATIVE_AFTER.test(after);
}

/**
 * Is the dice match at `idx` this ability's damage, or something else?
 *
 * Exported for the same reason `isRestorativeAt` is. The Damage column and the
 * ACTION parser read one prose, and they used to answer differently: this
 * function rejected nine dice across the corpus that `parseAbilityActions`
 * armed as damage buttons — a threshold value ("declare a d20 threshold"), a
 * distance ("roll (1d10) for feet", on an ability whose own text says it "does
 * not deal damage directly"), a roll bonus ("+1d10 to a Check"), a restored
 * pool, a stated cap. Harmless while a chip was only a button; since a damage
 * chip applies HP through the resolution card, a phantom one takes hit points
 * off a real body. One list, one answer.
 */
const OTHER_POOL_AFTER = /^\s*(?:synaptic\s+space|ss\b|focus\b)/i;

/**
 * Do the dice name a pool that is NOT hit points?
 *
 * Asked separately because a restorative reading deliberately bypasses the
 * damage filter, and Oriyu/Qerran Interitus reads "restoring 1d50 Synaptic
 * Space" — a heal of the wrong pool, which a consumer would add to a body.
 */
export function namesOtherPoolAt(text: string, idx: number, matchLen: number): boolean {
  return OTHER_POOL_AFTER.test(text.slice(idx + matchLen, idx + matchLen + 24));
}

export function isDamageAt(text: string, idx: number, matchLen: number): boolean {
  const before = text.slice(Math.max(0, idx - BEFORE_WINDOW), idx);
  const after = text.slice(idx + matchLen, idx + matchLen + 24);
  if (NOT_DAMAGE_BEFORE.some((re) => re.test(before))) return false;
  if (NOT_DAMAGE_AFTER.some((re) => re.test(after))) return false;
  return true;
}

const TYPE_RE = new RegExp(`^\\s*(?:points? of\\s+)?(${DAMAGE_TYPES.join("|")})\\b`, "i");
const TRAILING_TYPE_RE = new RegExp(`^\\s*(${DAMAGE_TYPES.join("|")})?\\s*damage\\b`, "i");

/** The Classification's leading word — what the ability fundamentally is. */
function primaryClass(classification?: string | null): string | null {
  const first = String(classification ?? "").split("/")[0].trim();
  if (!first) return null;
  // "Trans-modification" is a mouthful in a narrow column.
  if (/^trans-?modification$/i.test(first)) return "Transmod";
  return first;
}

/**
 * Read an ability's effect text and report its damage, or what it does instead.
 * Pass the authored `classification` so a non-damaging ability is labelled by
 * what the rules call it rather than by a guess.
 */
export function summarizeDamage(effect?: string | null, classification?: string | null): DamageSummary {
  const text = String(effect ?? "");
  const parts: DamagePart[] = [];

  const diceRe = /(\d*d\d+(?:\s*[+-]\s*\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = diceRe.exec(text))) {
    if (!isDamageAt(text, m.index, m[0].length)) continue;
    const rest = text.slice(m.index + m[0].length);
    const typed = TYPE_RE.exec(rest) || TRAILING_TYPE_RE.exec(rest);
    const type = typed && typed[1] ? typed[1] : undefined;
    // A bare die with no damage word nearby is probably not damage.
    if (!type && !/\bdamage\b/i.test(rest.slice(0, 40))) continue;
    const expr = m[0].replace(/\s+/g, "");
    if (!parts.some((p) => p.expr === expr && p.type === type)) parts.push({ expr, type });
  }

  if (parts.length) {
    return {
      parts,
      label: parts.map((p) => (p.type ? `${p.expr} ${p.type}` : p.expr)).join(" + "),
      none: false,
    };
  }
  return { parts, label: primaryClass(classification) ?? "Effect", none: true };
}

/** Total average damage, for sorting or a quick power read. 0 when none. */
export function averageDamage(s: DamageSummary): number {
  let total = 0;
  for (const p of s.parts) {
    const m = p.expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if (!m) continue;
    const count = parseInt(m[1] || "1", 10);
    const sides = parseInt(m[2], 10);
    const mod = parseInt(m[3] || "0", 10);
    total += count * ((sides + 1) / 2) + mod;
  }
  return Math.round(total * 10) / 10;
}
