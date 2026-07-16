// Inventory helpers: map equipped items onto anatomical body slots (so the sheet
// can show what occupies each arm / leg / head / chest and flag conflicts), plus
// small classifiers. Pure + data-driven off the Codex catalog's `slot` values
// (HEAD, CHEST, LEGS, R_ARM, L_ARM, BOTH_ARMS, "R_ARM or L_ARM", UTILITY, MODULE).
import { getWeapon, getEquipment } from "../lib/codex";

export const ANATOMY_SLOTS = ["HEAD", "CHEST", "R_ARM", "L_ARM", "LEGS"] as const;
export const POOL_SLOTS = ["UTILITY", "MODULE"] as const;
export type AnatomySlot = (typeof ANATOMY_SLOTS)[number];

export const SLOT_LABEL: Record<string, string> = {
  HEAD: "Head",
  CHEST: "Chest",
  R_ARM: "Right arm",
  L_ARM: "Left arm",
  LEGS: "Legs",
  UTILITY: "Utility",
  MODULE: "Module",
};

export interface SlotAssign {
  /** Anatomical slots the item always occupies. */
  fixed: AnatomySlot[];
  /** True for "R_ARM or L_ARM" — occupies whichever arm is freer. */
  flexibleArm: boolean;
  /** Capacity pool (UTILITY / MODULE) rather than a body part. */
  pool?: string;
}

/** Interpret a Codex `slot` string into the body slots it takes. */
export function normalizeSlots(raw?: string): SlotAssign {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return { fixed: [], flexibleArm: false };
  if (s === "BOTH_ARMS") return { fixed: ["R_ARM", "L_ARM"], flexibleArm: false };
  if (/L_ARM/.test(s) && /R_ARM/.test(s)) return { fixed: [], flexibleArm: true }; // "R_ARM or L_ARM", "R_ARM (or L_ARM)"
  if (s === "R_ARM") return { fixed: ["R_ARM"], flexibleArm: false };
  if (s === "L_ARM") return { fixed: ["L_ARM"], flexibleArm: false };
  if (s === "HEAD" || s === "CHEST" || s === "LEGS") return { fixed: [s as AnatomySlot], flexibleArm: false };
  if (s === "UTILITY" || s === "MODULE") return { fixed: [], flexibleArm: false, pool: s };
  return { fixed: [], flexibleArm: false };
}

export interface Occupant {
  name: string;
  kind: "weapon" | "gear";
  slotRaw?: string;
}

export interface BodySlotMap {
  anatomy: Record<AnatomySlot, Occupant[]>;
  pools: Record<string, Occupant[]>;
  /** Anatomy slots holding more than one item (over-equipped). */
  conflicts: AnatomySlot[];
  /** Equipped items whose slot is unrecognised (no body part). */
  unassigned: Occupant[];
}

export function bodySlotMap(weaponLoadout: string[], gearLoadout: string[]): BodySlotMap {
  const anatomy: Record<AnatomySlot, Occupant[]> = { HEAD: [], CHEST: [], R_ARM: [], L_ARM: [], LEGS: [] };
  const pools: Record<string, Occupant[]> = { UTILITY: [], MODULE: [] };
  const unassigned: Occupant[] = [];

  const place = (o: Occupant, slot?: string) => {
    const a = normalizeSlots(slot);
    if (a.pool) return void pools[a.pool].push(o);
    if (a.fixed.length) return void a.fixed.forEach((f) => anatomy[f].push(o));
    if (a.flexibleArm) return void (anatomy.R_ARM.length <= anatomy.L_ARM.length ? anatomy.R_ARM : anatomy.L_ARM).push(o);
    unassigned.push(o);
  };

  for (const n of weaponLoadout) {
    const w = getWeapon(n);
    place({ name: n, kind: "weapon", slotRaw: w?.slot }, w?.slot);
  }
  for (const n of gearLoadout) {
    const g = getEquipment(n);
    place({ name: n, kind: "gear", slotRaw: g?.slot }, g?.slot);
  }

  const conflicts = ANATOMY_SLOTS.filter((k) => anatomy[k].length > 1);
  return { anatomy, pools, conflicts, unassigned };
}

/** Is a gear category a consumable (single-use / stackable)? */
export function isConsumable(category?: string): boolean {
  return /consumable/i.test(category || "");
}
