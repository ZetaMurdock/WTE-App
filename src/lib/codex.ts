// Codex data hub. Weapons + gear are BAKED from the user's catalogs (offline, all users),
// parsed via codexParse and committed to src/game/data. Creatures and any custom pages are
// read at runtime from the Codex via the Rust rules commands (desktop-only).
import type { CodexEntry, Weapon, Equipment, Creature } from "../models/codex";
import weaponsData from "../game/data/weapons.json";
import gearData from "../game/data/gear.json";
import { parseCodexEntry } from "./codexParse";
import { parseEquipMods, mergeMods, WEIGHT_CATS, getParadigm, canonicalDomain, type EquipMods } from "../game/wte";
import { isTauri } from "./tauri";
import { isArray, readJson, writeJson } from "./localJson";

const WEAPONS = weaponsData as Weapon[];
const GEAR = gearData as Equipment[];

// ── Custom armory: weapon/equipment records added from Codex pages (localStorage).
// Merged after the baked catalogs so they're equippable in the sheet's Loadout. ──
// Guarded. This matters more than it looks: sheets reference weapons and gear by
// NAME, so once the armory is lost getWeapon() returns undefined and the loadout
// math silently falls back to defaults — the character's slot cost, NC budget and
// stat mods all change while the name still shows in the list.
function customList<T>(key: string): T[] {
  return readJson<T[]>(key, [], { validate: isArray, label: "custom armory" }).value;
}
export function addToArmory(entry: Weapon | Equipment): void {
  const key = entry.type === "weapon" ? "wte-armory-weapons" : "wte-armory-gear";
  const list = customList<Weapon | Equipment>(key).filter((x) => x.name.toLowerCase() !== entry.name.toLowerCase());
  list.push(entry);
  writeJson(key, list, { label: "custom armory" });
}
// ── Codex-pulled catalog: weapon/gear records from PULLED pages, loaded at boot
// by lib/gameData. This is the campaign-authoritative layer, so it must win when
// a player's old local armory contains an item with the same name. Unique local
// items remain available. ──
let codexWeapons: Weapon[] = [];
let codexGear: Equipment[] = [];
export function setCodexCatalog(weapons: Weapon[], gear: Equipment[]): void {
  codexWeapons = weapons;
  codexGear = gear;
}
function overlayByName<T extends { name: string }>(layers: T[][]): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const layer of layers) {
    for (const value of layer) {
      const key = value.name.toLowerCase();
      const found = at.get(key);
      if (found === undefined) {
        at.set(key, out.length);
        out.push(value);
      } else out[found] = value;
    }
  }
  return out;
}
export function listWeapons(): Weapon[] {
  return overlayByName([WEAPONS, customList<Weapon>("wte-armory-weapons"), codexWeapons]);
}
export function listEquipment(): Equipment[] {
  return overlayByName([GEAR, customList<Equipment>("wte-armory-gear"), codexGear]);
}
export function getWeapon(name: string): Weapon | undefined {
  const n = name.toLowerCase();
  return listWeapons().find((w) => w.name.toLowerCase() === n);
}
export function getEquipment(name: string): Equipment | undefined {
  const n = name.toLowerCase();
  return listEquipment().find((g) => g.name.toLowerCase() === n);
}

// A weapon is ranged if its range/profile names "ranged" or a distance over 5 ft (melee otherwise).
// Drives the to-hit stat: ranged uses DEX, melee uses STR.
export function isRangedWeapon(w: { range?: string; baseAttack?: string }): boolean {
  const r = `${w.range || ""} ${w.baseAttack || ""}`;
  if (/\bmelee\b/i.test(r)) return false;
  if (/\branged\b/i.test(r)) return true;
  const m = r.match(/(\d+)\s*ft/i);
  return m ? parseInt(m[1], 10) > 5 : false;
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
  // Both sides are normalised through the domain's CURRENT name, because a
  // rename must not lock content. Kinetic became Photonic, and gear.json,
  // weapons.json and every Overclock requirement still say Kinetic — matching
  // the strings directly meant those requirements named a domain that no longer
  // existed, so they could never be met by anyone.
  const norm = (s: string) => (canonicalDomain(s) ?? s.trim()).toLowerCase();
  const req = domain.split(/[+&,/]/).map((s) => s.trim()).filter(Boolean).map(norm);
  const have = (getParadigm(paradigmId)?.domains || []).map(norm);
  return req.every((r) => have.includes(r));
}

// ── Runtime Codex scan (user-authored pages: creatures now, custom weapons/gear later) ──
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__.core.invoke(cmd, args) as Promise<T>;
}
let cache: CodexEntry[] | null = null;

/** The unified campaign loader has already parsed these effective pages. Feeding
 * that same set to the bestiary prevents a joined player from re-scanning their
 * unrelated local AppData Codex. */
export function setCodexRuntimeEntries(entries: CodexEntry[]): void {
  cache = entries.slice();
}

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

// ── Creature derivation (HP/DR/flags/size per Class) ──
// Faithful port of the VTT's summonComputeCreature (public/vtt.html) — KEEP IN SYNC.
export interface CreatureDerived {
  hp: number;
  dr: number;
  size: number;
  note: string;
  flags: string[];
  collapsedHP?: number; // Class 5 (Doxa) post-collapse pool
}
export function computeCreature(c: Creature): CreatureDerived {
  const S = c.stats || {};
  const num = (k: string) => S[k] || 0;
  const mod = (k: string) => Math.floor(num(k) / 4); // creature stat → modifier (÷4)
  let hp = 0, dr = 0, note = "";
  const flags: string[] = [];
  let collapsedHP: number | undefined;
  switch (c.cls) {
    case 1: {
      const mult = ({ GRUNT: 5, OPERATIVE: 10, ELITE: 15, BOSS: 25 } as Record<string, number>)[(c.rank || "").toUpperCase()] || 5;
      hp = Math.floor((num("OFF") + num("DEF") + num("SPD") + num("WIL")) / 4) * mult;
      note = (c.rank || "Grunt") + " ×" + mult;
      break;
    }
    case 2: {
      const t = (c.tier || "Nascent").toUpperCase();
      if (t === "APEX") { hp = num("DEF") * 20; dr = mod("DEF") + 2; }
      else if (t === "MANIFESTED") { hp = num("DEF") * 10; dr = mod("DEF"); }
      else { hp = num("DEF") * 5; dr = 0; }
      flags.push("Immune to psychic/emotional manipulation");
      note = (c.tier || "Nascent") + (c.anchor ? " · " + c.anchor : "");
      break;
    }
    case 3:
      hp = mod("CON") * 10 + num("DEF") * 5;
      note = "CL " + (c.cl ?? 1);
      if ((c.cl || 0) >= 3) flags.push("Human modifiers degraded (CL " + c.cl + ")");
      break;
    case 4:
      hp = num("PHY") * 5 + mod("END") * 15;
      flags.push(
        "Primal Instinct: immune to mental deception/hacking; lure with physical distractions/pheromones",
        "Writhing Biomass: advantage on physical adaptation & natural attacks",
      );
      break;
    case 5: {
      const fa = num("HP"), col = num("WIL") * 8 + mod("INT") * 12;
      hp = fa || col; collapsedHP = col;
      note = "Facade " + (fa || "?") + " → Collapsed " + col;
      flags.push("Facade collapses on critical damage / emotional shock / Null exposure");
      break;
    }
    case 6:
      hp = num("CHP");
      note = "CHP pool · regional TL −2.0";
      flags.push(
        "Colossal: conventional combat impossible — deplete CHP via Null-negation barriers / extraction arrays / orbital batteries",
        "Awakening: regional Tech Level −2.0 — Online ciphers forced offline",
      );
      break;
  }
  const size = c.size ?? (c.cls === 4 ? 2 : c.cls === 6 ? 6 : 1);
  return { hp, dr, size, note, flags, collapsedHP };
}
