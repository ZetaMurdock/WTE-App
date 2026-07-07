// Codex data hub: scans the app's Codex pages (via the existing Rust rules commands),
// parses the ones authored in the CODEX-FORMAT, and exposes typed queries for the sheet
// (Phase 5 weapons/equipment) and VTT (Phase 6 creatures). Desktop-only.
import type { CodexEntry, Weapon, Equipment, Cipher, Genus, Creature } from "../models/codex";
import { parseCodexEntry } from "./codexParse";
import { isTauri } from "./tauri";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__.core.invoke(cmd, args) as Promise<T>;
}

let cache: CodexEntry[] | null = null;

/** Load + parse every Codex page once (memoized); only format pages become entries. */
export async function scanCodex(force = false): Promise<CodexEntry[]> {
  if (!isTauri()) return [];
  if (cache && !force) return cache;
  const names = await invoke<string[]>("wte_list_pages").catch(() => [] as string[]);
  const entries: CodexEntry[] = [];
  for (const name of names) {
    try {
      const md = await invoke<string>("wte_load_page", { path: name });
      const entry = parseCodexEntry(md);
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

export async function listWeapons(): Promise<Weapon[]> {
  return (await scanCodex()).filter((e): e is Weapon => e.type === "weapon");
}
export async function listEquipment(): Promise<Equipment[]> {
  return (await scanCodex()).filter((e): e is Equipment => e.type === "equipment");
}
export async function listCiphers(): Promise<Cipher[]> {
  return (await scanCodex()).filter((e): e is Cipher => e.type === "cipher");
}
export async function listGenus(): Promise<Genus[]> {
  return (await scanCodex()).filter((e): e is Genus => e.type === "genus");
}
export async function listCreatures(): Promise<Creature[]> {
  return (await scanCodex()).filter((e): e is Creature => e.type === "creature");
}
export async function getEntry(name: string): Promise<CodexEntry | undefined> {
  const want = name.toLowerCase();
  return (await scanCodex()).find((e) => e.name.toLowerCase() === want);
}
