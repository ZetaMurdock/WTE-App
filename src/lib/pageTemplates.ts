// Codex page-builder formats: one scaffold per record type, written to match
// EXACTLY what the game-data parsers read (gameData.ts + codexParse.ts) — a
// page authored from a template is guaranteed to land in the sheet/VTT
// catalogs. parsePreview() runs the real parsers on a draft and reports what
// the page will become, so authors see "parses as …" while they type.
import { parseCodexEntry } from "./codexParse";
import { parseBackgroundPage, parseParadigmPage, parseSpeciesPage } from "./gameData";

export const TEMPLATE_LABELS = ["Creature", "Weapon", "Equipment", "Cipher", "Genus", "Species", "Paradigm", "Background"] as const;
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

Effect: What the ability does.
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
};

/** What a draft page will become when pulled. Runs the REAL parsers. */
export function parsePreview(md: string, stem = "draft"): string {
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
