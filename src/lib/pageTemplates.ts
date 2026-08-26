// Codex page-builder formats: one scaffold per record type, written to match
// EXACTLY what the game-data parsers read (gameData.ts + codexParse.ts) — a
// page authored from a template is guaranteed to land in the sheet/VTT
// catalogs. parsePreview() runs the real parsers on a draft and reports what
// the page will become, so authors see "parses as …" while they type.
import { parseCodexEntry } from "./codexParse";
import { parseBackgroundPage, parseParadigmPage, parseSpeciesPage } from "./gameData";
import { parseRollFormulaPage } from "../game/rollFormula";
import { parseConditionPage } from "../game/conditions";

export const TEMPLATE_LABELS = ["Creature", "Weapon", "Equipment", "Cipher", "Genus", "Species", "Paradigm", "Background", "Condition", "Roll Formula"] as const;
export type TemplateLabel = (typeof TEMPLATE_LABELS)[number];

export const PAGE_TEMPLATES: Record<TemplateLabel, string> = {
  Weapon: `# New Weapon

| Type | Weapon |
| Category | Blade |
| Grade | 1 |
| Slot | 1-Hand |
| Damage | 2d6 |
| Range | Melee |
| NC Cost | 120 |
| Keywords | keen, balanced |

Effect: What the weapon does in play — bonuses, procs, special rules.

## Overclock
Phase I — what happens when the wielder overclocks it.
`,
  Equipment: `# New Equipment

| Type | Equipment |
| Category | Utility |
| Slot | Back |
| Grade | 1 |
| NC Cost | 80 |
| Keywords | worn |

Effect: What the item does while equipped or used.
`,
  Cipher: `# New Cipher

| Type | Cipher |
| Paradigm | Vanguard |
| Tier | online |
| SS | 4 |
| Activation | Action |
| Range | 30 ft |
| Target | One creature |

Effect: What the cipher does when activated.
`,
  Genus: `# New Genus Ability

| Type | Genus |
| Domain | Neutral |
| SS | 2 |
| Activation | Action |
| Range | Self |
| Target | Self |
| Visibility | player |
| Aliases |  |
| Overrides |  |

Effect: What the ability does.

<!--
Overrides — leave blank for a new ability of your own.
  Put an official id here (for example wte.genus.lark) to REPLACE that rule at
  your table. The official version stays on record, and the card shows both.
  Put "none" to guarantee this is never mistaken for an official ability that
  happens to share its name.
Aliases — former names, comma separated. Characters that already reference an
  old name keep working after you rename this page.
Visibility — "curator" hides this from players everywhere: search, cards, VTT.
-->
`,
  Creature: `# New Creature

| Type | Creature |
| Class | 1 |
| Archive | Standard |
| Rank | D |
| HP | 24 |
| OFF | 6 |
| DEF | 4 |
| SPD | 5 |
| Size | 1 |
| Traits | pack hunter |

## Abilities
- **Rend** — melee strike, 1d8 slashing.
- **Howl** — allies within 30 ft gain +1 OFF for a round.

## Lore
What this creature is and where it's found.
`,
  Species: `# New Species

| Type | Species |
| Name | New Species |
| Family | Humanity |
| Bonuses | STR +2, END +1 |
| Innate | Darkvision |
| Size | medium |
| Dominance |  |
| Recessiveness |  |
| Eminence |  |
| Innate Select | 2 |
| Note |  |

## Variants
### Variant One
- **Gift** — what this lineage grants.
`,
  Paradigm: `# New Paradigm

| Type | Paradigm |
| Name | New Paradigm |
| Group | Codex |
| Weapons | Blades, Sidearms |
| Domains | Force, Veil |
`,
  Background: `# New Background

| Type | Background |
| Name | New Background |
| Mode | standard |
| Bonuses | +2 Wisdom, +2 Perception, +1 Control, +1 Cunning |

Note: One line on who takes this background.
`,
  Condition: `# New Condition

| Type | Condition |
| ID |  |
| Stacking | refresh |
| Aliases |  |
| Overrides |  |
| Visibility | player |

## Effect
What the condition does to a creature that has it.

<!--
Stacking is the rule for a SECOND application of the same condition, and it is
required — the app will not guess it:
  refresh  one instance; the longer of the two durations wins.
  extend   one instance; the durations add together.
  stack    instances count separately.
  highest  one instance; the stronger application wins outright.
ID — leave blank for a new condition of your own; the page derives one from its
  name. Fill it in (for example wte.condition.slowed) only to re-declare a
  condition that already has a permanent id.
Overrides — put an official id here to REPLACE that rule at your table, or
  "none" to guarantee this is never mistaken for the official condition that
  happens to share its name.
Aliases — former names, comma separated, so a token tagged with the old name
  still resolves after a rename.
-->
`,
  "Roll Formula": `# Attribute Check Formula

| Type | Roll Formula |
| Target | Attribute |
| Die | 20 |
| Modifier | floor((score - 10) / 2) |
| Direction |  |
| Below |  |
| Penalty |  |
| Visibility | player |

<!--
Targets: Attribute, Specialty, Roll Axis Attribute, Roll Axis Specialty.
Score formulas may use only the variable "score". Roll Axis formulas may use
only "source" and "derived". Allowed arithmetic: + - * /, parentheses, and the
functions floor, ceil, round, trunc, abs, min, max. This is parsed as data and
never executed as JavaScript.
Division must have a denominator that cannot be zero and must be wrapped in
floor, ceil, round, or trunc unless it is provably whole-number arithmetic.

For an untrained threshold, set both Below and Penalty. For a Roll Axis target,
optionally add a Path row with evasion (or power, density, recovery, capacity,
perception, influence); omit Path to affect every path of that source type.
Set Direction to check or save when those directions need different math; leave
it blank (or use all) to affect both.
-->
`,
};

/** What a draft page will become when pulled. Runs the REAL parsers. */
export function parsePreview(md: string, stem = "draft"): string {
  const condition = parseConditionPage(md, stem);
  if (condition) {
    if (!condition.ok) return `Invalid Condition — ${condition.errors.join(" ")}`;
    const aliases = condition.condition.aliases.length ? ` · also ${condition.condition.aliases.join(", ")}` : "";
    return `Condition — ${condition.condition.name} · stacking: ${condition.condition.stacking}${aliases}`;
  }
  const formula = parseRollFormulaPage(md, stem);
  if (formula) {
    if (!formula.ok) return `Invalid Roll Formula — ${formula.errors.join(" ")}`;
    const path = formula.formula.path ? ` · ${formula.formula.path}` : "";
    const direction = formula.formula.direction ? ` · ${formula.formula.direction}` : "";
    return `Roll Formula — ${formula.formula.target}${path}${direction} · d${formula.formula.die} + (${formula.formula.expression})`;
  }
  const sp = parseSpeciesPage(md, stem);
  if (sp) {
    const b = Object.entries(sp.bonuses).map(([k, v]) => `${k.toUpperCase()} ${v! >= 0 ? "+" : ""}${v}`).join(", ");
    return `Species — ${sp.name} (${sp.family}${b ? " · " + b : ""}${sp.variants.length ? ` · ${sp.variants.length} variant${sp.variants.length === 1 ? "" : "s"}` : ""})`;
  }
  const pd = parseParadigmPage(md, stem);
  if (pd) return `Paradigm — ${pd.name} (${pd.group}${pd.weapons.length ? " · weapons: " + pd.weapons.join(", ") : ""})`;
  const bg = parseBackgroundPage(md, stem);
  if (bg) {
    const n = Object.keys(bg.attrBonus ?? {}).length + Object.keys(bg.specBonus ?? {}).length;
    return `Background — ${bg.name}${bg.mode ? " (" + bg.mode + ")" : ""}${n ? ` · ${n} bonus${n === 1 ? "" : "es"}` : ""}`;
  }
  const entry = parseCodexEntry(md, stem);
  if (!entry) return "Lore page — no Type field, so it won't feed the sheet/VTT catalogs.";
  switch (entry.type) {
    case "weapon":
      return `Weapon — ${entry.name}${entry.damage ? " · " + entry.damage : ""}${entry.range ? " · " + entry.range : ""}${entry.category ? " · " + entry.category : ""}`;
    case "equipment":
      return `Equipment — ${entry.name}${entry.category ? " · " + entry.category : ""}${entry.slot ? " · slot " + entry.slot : ""}`;
    case "cipher":
      return `Cipher — ${entry.name}${entry.paradigm ? " · " + entry.paradigm : " · NO PARADIGM (set one or it won't attach)"}${entry.ss != null ? " · SS " + entry.ss : ""}`;
    case "genus":
      return `Genus — ${entry.name} · ${entry.domain || "Neutral"}${entry.ss != null ? " · SS " + entry.ss : ""}`;
    case "creature":
      return `Creature — ${entry.name} · Class ${entry.cls} (${entry.archive})${entry.abilities?.length ? ` · ${entry.abilities.length} abilit${entry.abilities.length === 1 ? "y" : "ies"}` : ""}`;
  }
  return "Unrecognized record.";
}
