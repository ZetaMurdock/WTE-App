// Roll a complete random Inquisitor — species, paradigm, a lineage variant,
// rolled attributes, a spread of specialties, and a background. Used by the
// vault's "Randomize" quick-create.
import {
  SPECIES,
  PARADIGMS,
  BACKGROUNDS,
  SECTORS,
  ATTR_KEYS,
  SPEC_KEYS,
  ATTR_MAX,
  SPEC_TOTAL,
  SPEC_MAX,
  bgAmounts,
  rollDie,
  zeroAttributes,
  zeroSpecialties,
  type Background,
  type AttrKey,
} from "../game/wte";
import type { CharacterSheet } from "../models/character";

const NAME_A = ["Zephyr", "Kael", "Vesper", "Orin", "Nyx", "Cassian", "Lyra", "Draven", "Sable", "Thorne", "Ash", "Vex", "Rune", "Silas", "Mira", "Corvid"];
const NAME_B = ["Voss", "Kane", "Rychar", "Halloway", "Vane", "Crowe", "Marrow", "Quill", "Stray", "Locke", "Ferro", "Wilde", "Grave", "Ozdemir", "Rell"];
const rand = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** @param specTotal the table's specialty budget (defaults to the published 200). */
export function randomCharacter(specTotal: number = SPEC_TOTAL): { name: string; sheet: CharacterSheet } {
  const species = rand(SPECIES);
  const paradigm = rand(PARADIGMS);
  const variant = species.variants.length ? rand(species.variants) : undefined;

  // Stats roll a simple d20 each — same as the creator's roll-and-assign.
  const attributes = zeroAttributes();
  for (const k of ATTR_KEYS) attributes[k] = Math.min(ATTR_MAX, rollDie(20));

  // scatter the specialty pool, respecting the per-specialty cap
  const specialties = zeroSpecialties();
  let pool = specTotal;
  let guard = specTotal * 4;
  while (pool > 0 && guard-- > 0) {
    const k = rand(SPEC_KEYS);
    if (specialties[k] < SPEC_MAX) {
      specialties[k]++;
      pool--;
    } else if (SPEC_KEYS.every((s) => specialties[s] >= SPEC_MAX)) {
      break;
    }
  }

  // background: prefer a pulled Codex one; else a random manual spread
  let background: Background;
  if (BACKGROUNDS.length && Math.random() < 0.75) {
    const b = rand(BACKGROUNDS);
    background = { name: b.name, mode: b.mode ?? "standard", assign: [], attrBonus: b.attrBonus, specBonus: b.specBonus };
  } else {
    const mode = Math.random() < 0.5 ? "standard" : "focused";
    const assign = bgAmounts(mode).map(() => rand(ATTR_KEYS) as AttrKey | null);
    background = { name: undefined, mode, assign };
  }

  return {
    name: `${rand(NAME_A)} ${rand(NAME_B)}`,
    sheet: {
      attributes,
      specialties,
      speciesId: species.id,
      variantName: variant?.name,
      paradigmId: paradigm.id,
      rank: 0,
      background,
      sector: rand(SECTORS).id,
      morality: rand([10, 30, 50, 70, 90]),
      notes: "",
    },
  };
}
