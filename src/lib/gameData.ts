// The data-driven Codex pull: species, paradigms, weapons, gear, genus, and
// ciphers are sourced from PULLED Codex pages (pageMeta.pulled, Engineer-set) and
// overlaid onto the baked/hardcoded base data at app boot — so uploading pages
// changes character-creation options and sheet/VTT catalogs without a rebuild.
// Base data always remains the fallback; parse failures skip the page silently.
import {
  registerCodexGameData,
  type Species,
  type SpeciesFamily,
  type SpeciesVariant,
  type Paradigm,
  type AttrKey,
  type GenusAbility,
  type CipherAbility,
} from "../game/wte";
import { parseCodexEntry } from "./codexParse";
import { setCodexCatalog } from "./codex";
import { allPageMeta, getPageMeta } from "./pageMeta";
import { isTauri } from "./tauri";
import type { Weapon, Equipment } from "../models/codex";

const ATTRS: AttrKey[] = ["phy", "dex", "end", "ap", "wis", "cha", "int"];

const strip = (s: string) => (s || "").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").trim();

/** Read `| K | V |`, `**K:** V`, or `K: V` spec fields from a page (same
 *  conventions as codexParse, kept independent so its behaviour never shifts). */
function readFields(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    let k = "";
    let v = "";
    const tbl = line.match(/^\s*\|([^|]+)\|([^|]+)\|/);
    const bold = line.match(/^\s*(?:[-*]\s*)?\*\*([^*]+)\*\*:?\s*(.+)$/);
    const plain = line.match(/^\s*([A-Za-z][A-Za-z ]{1,14}?):[ \t]+(.+)$/);
    if (tbl) [k, v] = [tbl[1], tbl[2]];
    else if (bold) [k, v] = [bold[1], bold[2]];
    else if (plain) [k, v] = [plain[1], plain[2]];
    else continue;
    k = strip(k).replace(/:$/, "").toLowerCase();
    if (k && !/^:?-+:?$/.test(k)) out[k] = strip(v);
  }
  return out;
}
function titleOf(md: string, fallback: string): string {
  const m = md.match(/^#{1,4}\s+(.+)$/m);
  return strip(m ? m[1] : fallback).replace(/_/g, " ");
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function csv(v?: string): string[] {
  return (v || "").split(/[,;·]/).map((s) => s.trim()).filter(Boolean);
}
/** "PHY +2, END +2" or "+2 PHY" pairs → attribute bonus map. */
function parseBonuses(v?: string): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {};
  if (!v || /^(none|—|-)$/i.test(v.trim())) return out;
  const re = /(phy|dex|end|ap|wis|cha|int)\s*([+-]?\d+)|([+-]\d+)\s*(phy|dex|end|ap|wis|cha|int)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) {
    const key = (m[1] || m[4]).toLowerCase() as AttrKey;
    const n = parseInt(m[2] || m[3], 10);
    if (ATTRS.includes(key) && Number.isFinite(n)) out[key] = n;
  }
  return out;
}
/** `### Variant` blocks under a `## Variants` heading; `- **Ability** — effect` bullets. */
function parseVariants(md: string): SpeciesVariant[] {
  const sec = md.split(/^#{2,3}\s+Variants\s*$/im)[1];
  if (!sec) return [];
  const out: SpeciesVariant[] = [];
  let cur: SpeciesVariant | null = null;
  for (const line of sec.split("\n")) {
    if (/^#{1,2}\s/.test(line)) break; // next top-level section
    const h = line.match(/^#{3,4}\s+(.+)$/);
    if (h) {
      cur = { name: strip(h[1]), abilities: [] };
      out.push(cur);
      continue;
    }
    const ab = line.match(/^\s*[-*]\s*\*\*([^*]+)\*\*\s*[—–:-]\s*(.+)$/);
    if (ab && cur) {
      cur.abilities.push({ name: ab[1].trim(), effect: strip(ab[2]) });
      continue;
    }
    if (cur && line.trim() && !line.startsWith("|")) cur.note = ((cur.note || "") + " " + line.trim()).trim();
  }
  return out.filter((v) => v.name);
}

export function parseSpeciesPage(md: string, stem: string): Species | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "species") return null;
  const name = f["name"] || titleOf(md, stem);
  const famRaw = (f["family"] || "Humanity").toLowerCase();
  const family: SpeciesFamily = famRaw.startsWith("omen") ? "Omenity" : famRaw.startsWith("aster") ? "Asternem" : "Humanity";
  return {
    id: f["id"] || slug(name),
    name,
    family,
    bonuses: parseBonuses(f["bonuses"]),
    innate: csv(f["innate"]),
    note: f["note"] || undefined,
    variants: parseVariants(md),
  };
}

export function parseParadigmPage(md: string, stem: string): Paradigm | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "paradigm") return null;
  const name = f["name"] || titleOf(md, stem);
  return {
    id: f["id"] || slug(name),
    name,
    group: f["group"] || "Codex",
    weapons: csv(f["weapons"]),
    domains: csv(f["domains"]),
  };
}

// ── The loader: read every PULLED page and overlay the game data ──
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI__?: { core: { invoke: <R>(c: string, a?: Record<string, unknown>) => Promise<R> } } };
  if (!w.__TAURI__) throw new Error("no tauri");
  return w.__TAURI__.core.invoke<T>(cmd, args);
}

export async function loadCodexGameData(): Promise<void> {
  if (!isTauri()) return;
  const names = await invoke<string[]>("wte_list_pages").catch(() => [] as string[]);
  const meta = allPageMeta();
  const species: Species[] = [];
  const paradigms: Paradigm[] = [];
  const sizes: Record<string, string> = {};
  const weapons: Weapon[] = [];
  const gear: Equipment[] = [];
  const genus: Record<string, GenusAbility[]> = {};
  const ciphers: Record<string, CipherAbility[]> = {};

  for (const name of names) {
    if (!getPageMeta(name, meta).pulled) continue; // Engineer said: don't pull this page
    let md = "";
    try {
      md = await invoke<string>("wte_load_page", { path: name });
    } catch {
      continue;
    }
    const sp = parseSpeciesPage(md, name);
    if (sp) {
      species.push(sp);
      const size = (readFields(md)["size"] || "").toLowerCase();
      if (size) sizes[sp.id] = size;
      continue;
    }
    const pd = parseParadigmPage(md, name);
    if (pd) {
      paradigms.push(pd);
      continue;
    }
    const entry = parseCodexEntry(md, name);
    if (!entry) continue;
    if (entry.type === "weapon") weapons.push(entry);
    else if (entry.type === "equipment") gear.push(entry);
    else if (entry.type === "genus") {
      const domain = entry.domain || "Neutral";
      (genus[domain] ??= []).push({
        name: entry.name, ss: entry.ss ?? null, effect: entry.effect,
        activation: entry.activation, range: entry.range, target: entry.target,
      });
    } else if (entry.type === "cipher") {
      // Key by paradigm id (the page names the paradigm; match name or id).
      const key = slug(entry.paradigm || "");
      if (key) {
        (ciphers[key] ??= []).push({
          name: entry.name, ss: entry.ss ?? null, tier: entry.tier || "offline",
          type: entry.activation, effect: entry.effect,
        });
      }
    }
  }

  registerCodexGameData({ species, paradigms, sizes, genus, ciphers });
  setCodexCatalog(weapons, gear);
  window.dispatchEvent(new Event("wte-gamedata-changed"));
}
