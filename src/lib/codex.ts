// Codex data hub. Weapons + gear are BAKED from the user's catalogs (offline, all users),
// parsed via codexParse and committed to src/game/data. Creatures and any custom pages are
// read at runtime from the Codex via the Rust rules commands (desktop-only).
import type { CodexEntry, Weapon, Equipment, Creature } from "../models/codex";
import weaponsData from "../game/data/weapons.json";
import gearData from "../game/data/gear.json";
import { parseCodexEntry } from "./codexParse";
import { parseEquipMods, mergeMods, WEIGHT_CATS, getParadigm, type EquipMods } from "../game/wte";
import { isTauri } from "./tauri";

const WEAPONS = weaponsData as Weapon[];
const GEAR = gearData as Equipment[];

export function listWeapons(): Weapon[] {
  return WEAPONS;
}
export function listEquipment(): Equipment[] {
  return GEAR;
}
export function getWeapon(name: string): Weapon | undefined {
  const n = name.toLowerCase();
  return WEAPONS.find((w) => w.name.toLowerCase() === n);
}
export function getEquipment(name: string): Equipment | undefined {
  const n = name.toLowerCase();
  return GEAR.find((g) => g.name.toLowerCase() === n);
}

// ── Loadout math (weapon slots, NC equip budget, mod aggregation, domain gate) ──
export const WEAPON_SLOTS = 4;
export function weaponSlotCost(weight?: string): number {
  const w = WEIGHT_CATS.find((x) => x.key === (weight || "").toLowerCase());
  return w ? w.cost : 1;
}
export function weaponSlotsUsed(weaponNames: string[]): number {
  return weaponNames.reduce((s, n) => s + weaponSlotCost(getWeapon(n)?.weight), 0);
}
export function loadoutNC(weaponNames: string[], gearNames: string[]): number {
  const w = weaponNames.reduce((s, n) => s + (getWeapon(n)?.ncCost || 0), 0);
  const g = gearNames.reduce((s, n) => s + (getEquipment(n)?.ncCost || 0), 0);
  return w + g;
}
/** Aggregate the MODS of equipped weapons + gear into one EquipMods bonus map. */
export function loadoutMods(weaponNames: string[], gearNames: string[]): EquipMods {
  const parts: EquipMods[] = [];
  for (const n of weaponNames) {
    const w = getWeapon(n);
    if (w?.mods) parts.push(parseEquipMods(w.mods));
  }
  for (const n of gearNames) {
    const g = getEquipment(n);
    if (g?.mods) parts.push(parseEquipMods(g.mods));
  }
  return mergeMods(...parts);
}
/** Does the character (via its paradigm's domains) meet a weapon's DOMAIN requirement? */
export function weaponDomainsMet(domain: string | undefined, paradigmId?: string): boolean {
  if (!domain) return true;
  const req = domain.split(/[+&,/]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const have = (getParadigm(paradigmId)?.domains || []).map((d) => d.toLowerCase());
  return req.every((r) => have.includes(r));
}

// ── Runtime Codex scan (user-authored pages: creatures now, custom weapons/gear later) ──
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__.core.invoke(cmd, args) as Promise<T>;
}
let cache: CodexEntry[] | null = null;

export async function scanCodex(force = false): Promise<CodexEntry[]> {
  if (!isTauri()) return [];
  if (cache && !force) return cache;
  const names = await invoke<string[]>("wte_list_pages").catch(() => [] as string[]);
  const entries: CodexEntry[] = [];
  for (const name of names) {
    try {
      const md = await invoke<string>("wte_load_page", { path: name });
      const entry = parseCodexEntry(md, name);
      if (entry) entries.push(entry);
    } catch {
      /* unreadable page — skip */
    }
  }
  cache = entries;
  return entries;
}
export function clearCodexCache(): void {
  cache = null;
}
export async function listCreatures(): Promise<Creature[]> {
  return (await scanCodex()).filter((e): e is Creature => e.type === "creature");
}
