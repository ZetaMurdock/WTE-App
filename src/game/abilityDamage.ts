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

/** Phrases meaning the dice near them are NOT this ability's damage output. */
const NOT_DAMAGE_BEFORE = [
  /\bdc\s*(?:of|=)?\s*$/i,          // "DC 12", "a dc of d40"
  /\bheals?\b[^.]*$/i,              // "heals HP — 2d8 at SS 5"
  /\bregenerate[sd]?\b[^.]*$/i,     // "regenerate 1d20 HP per turn"
  /\brestores?\b[^.]*$/i,
  /\bhp equal to\b[^.]*$/i,         // a construct's own HP
  /\btemporary hp\b[^.]*$/i,
  /\broll\s*(?:a\s*)?$/i,           // "roll a d6 — on a 1" (a table roll)
];
const NOT_DAMAGE_AFTER = [
  /^\s*(?:hp|dhp)\b/i,              // "1d20 + END modifier HP"
  /^\s*(?:perception|control|wisdom|endurance|dexterity|strength|intelligence)\b/i,
  /^\s*(?:rounds?|minutes?|turns?|feet|ft)\b/i,
];

/** Is the dice match at `idx` this ability's damage, or something else? */
function isDamageAt(text: string, idx: number, matchLen: number): boolean {
  const before = text.slice(Math.max(0, idx - 60), idx);
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
