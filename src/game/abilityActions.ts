// Ability "understanding" layer. Reads the free-text effect prose of an ability
// (species innate, variant, genus, cipher) and works out which rolls it needs —
// so the UI can render the RIGHT buttons per ability instead of one generic one.
//
// Deterministic on purpose: the app is offline-first, so this is a rules-aware
// parser, not an LLM call. It extracts three things a table actually clicks:
//   • self   — a roll the acting character makes (armed into the dice tray)
//   • damage — a damage dice expression the ability deals
//   • save   — a resolution the TARGET makes, with its DC (shown, not armed)

export type AbilityActionKind = "self" | "damage" | "save";

export interface AbilityAction {
  kind: AbilityActionKind;
  /** Button / chip label, e.g. "Inspiration check", "3d10 Entropy", "Endurance save · DC 18". */
  label: string;
  /** Dice expression to arm the tray (self + damage only), e.g. "1d20", "3d10". */
  expr?: string;
  /** Named stat the character rolls (self only) — the caller maps it to a modifier. */
  stat?: string;
  /** Save/DC for a target-side resolution (save only). */
  dc?: number;
  /** Damage type word, when the text names one (damage only). */
  damageType?: string;
}

const DAMAGE_TYPES = "Force|Radiant|Antimatter|Psychic|Spirit|Entropy|Fire|Cold|Kinetic|Void|Null|Acid|Poison|Crushing|Cold|Sonic|Lightning|Necrotic";

// Stat words the resolver in wte.ts understands, as an alternation for scanning.
const STAT_WORDS =
  "Physical|Strength|Dexterity|Endurance|Action Priority|Wisdom|Charisma|Intelligence|" +
  "Inspiration|Balance|Weight|Precision|Control|Weapon Mastery|Mental Fortitude|Perception|Adaptation|Adaption|Cunning|Influence";

/** Parse ability effect prose into the concrete actions a table clicks. */
export function parseAbilityActions(effect: string | null | undefined): AbilityAction[] {
  const text = String(effect || "");
  if (!text.trim()) return [];
  const out: AbilityAction[] = [];
  const seen = new Set<string>();
  const push = (a: AbilityAction) => {
    const k = `${a.kind}|${a.label}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a);
  };

  // ── Damage dice: "3d10 Entropy", "deals 2d8", "1d8 Psychic or 1d10 Spirit" ──
  const dmgRe = new RegExp(`(\\d*d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s*(${DAMAGE_TYPES})?`, "gi");
  let dm: RegExpExecArray | null;
  while ((dm = dmgRe.exec(text))) {
    const expr = dm[1].replace(/\s+/g, "");
    const type = dm[2] ? dm[2][0].toUpperCase() + dm[2].slice(1).toLowerCase() : undefined;
    push({ kind: "damage", label: type ? `${expr} ${type}` : expr, expr, damageType: type });
  }

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

  // ── Target saves / checks with a DC: "Endurance Save (DC 18)", "Wisdom Save DC 16" ──
  const saveRe = new RegExp(`(${STAT_WORDS})\\s+(?:Saving Throw|Save|Check)(?:[^.]*?DC\\s*(\\d+))?`, "gi");
  let sv: RegExpExecArray | null;
  while ((sv = saveRe.exec(text))) {
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
