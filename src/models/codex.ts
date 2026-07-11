// Typed Codex entities parsed from user-authored Codex pages (see docs/CODEX-FORMAT.md).
// A page becomes a data entry only if it has a **Type:** field; everything else stays pure lore.

export type CodexType = "weapon" | "equipment" | "cipher" | "genus" | "creature";

export interface Overclock {
  requires?: string;
  text: string;
}
export interface CodexAbility {
  name: string;
  effect: string;
}

interface CodexBase {
  name: string;
  keywords?: string[];
  effect?: string;
  overclock?: Overclock;
}

export interface Weapon extends CodexBase {
  type: "weapon";
  category?: string; // Kinetic | Energy | Exotic | Hybrid
  grade?: number; // 1–4
  slot?: string; // body slot (R_ARM, L_ARM, …)
  weight?: string; // Minute | Light | Standard | Heavy | …
  mods?: string; // raw "STAT ±N" list — parse with game/wte parseEquipMods
  ncCost?: number; // Neuronal Capacity to use
  ede?: boolean; // has an Overclock/EDE
  domain?: string; // required genus domains to use (e.g. "Eldritch + Null")
  damage?: string; // dice + damage type (from Base Attack Profile)
  range?: string;
  baseAttack?: string; // raw Base Attack Profile line
  sizeMin?: string; // minimum Size Class
}
export interface Equipment extends CodexBase {
  type: "equipment";
  category?: string; // Utility | Module | Cybernetic | Consumable | Armor | …
  slot?: string; // UTILITY | MODULE | HEAD | CHEST | LEGS | R_ARM | …
  grade?: number;
  weight?: string;
  mods?: string; // raw "STAT ±N" list — parse with game/wte parseEquipMods
  ncCost?: number;
  ede?: boolean;
  domain?: string;
}
export interface Cipher extends CodexBase {
  type: "cipher";
  paradigm?: string;
  tier?: string; // Offline | Online | Special
  ss?: number;
  activation?: string;
  range?: string;
  target?: string;
  component?: string;
}
export interface Genus extends CodexBase {
  type: "genus";
  domain?: string; // Kinetic | Eldritch | Elemental | Neutral | Null
  ss?: number;
  activation?: string;
  range?: string;
  target?: string;
  limit?: string;
}
// WTE creatures span 6 Classes, each with its own stat block + HP/DR math (see
// docs/CODEX-FORMAT.md and computeCreature in lib/codex). The author writes raw stats;
// the app derives HP/DR/flags/size. The VTT bestiary reads these same pages offline.
export type CreatureClass = 1 | 2 | 3 | 4 | 5 | 6;
export interface Creature {
  type: "creature";
  name: string;
  cls: CreatureClass; // 1 Standard · 2 Anima · 3 Alter Anima · 4 Fractures · 5 Doxa · 6 Nyvilum
  archive?: string; // the Class's archive name (Standard/Anima/…)
  stats: Record<string, number>; // raw combat stats, uppercase keys (OFF/DEF/SPD/WIL/CON/PHY/END/INT/HP/CHP/…)
  rank?: string; // Class 1: Grunt | Operative | Elite | Boss
  tier?: string; // Class 2: Nascent | Manifested | Apex
  anchor?: string; // Class 2 anchor descriptor
  cl?: number; // Class 3 corruption level
  size?: number; // grid size in cells (defaults per class: Fractures 2, Nyvilum 6, else 1)
  traits?: string; // one-line trait summary (feeds the VTT ability roll parser)
  keywords?: string[];
  abilities?: CodexAbility[];
  lore?: string;
}

export type CodexEntry = Weapon | Equipment | Cipher | Genus | Creature;
