// Codex data hub. Weapons + gear are BAKED from the user's catalogs (offline, all users),
// parsed via codexParse and committed to src/game/data. Creatures and any custom pages are
// read at runtime from the Codex via the Rust rules commands (desktop-only).
import type { CodexEntry, Weapon, Equipment, Creature } from "../models/codex";
import weaponsData from "../game/data/weapons.json";
import gearData from "../game/data/gear.json";
import { parseCodexEntry } from "./codexParse";
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
