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
  damage?: string; // dice + damage type
  range?: string;
  weight?: string; // Light | Medium | Heavy
  sizeMin?: string; // minimum Size Class
}
export interface Equipment extends CodexBase {
  type: "equipment";
  slot?: string; // Armor | Cybernetic | Utility | Wing | Other
  grade?: number;
  weight?: string;
  mods?: string; // raw "STAT ±N" list — parse with game/wte parseEquipMods
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
export interface Creature {
  type: "creature";
  name: string;
  archive?: string;
  size?: string;
  rank?: number;
  hp?: number;
  attack?: number;
  evasion?: number;
  movement?: string;
  keywords?: string[];
  abilities?: CodexAbility[];
  lore?: string;
}

export type CodexEntry = Weapon | Equipment | Cipher | Genus | Creature;
