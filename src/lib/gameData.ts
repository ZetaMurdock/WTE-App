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
  type CodexBackground,
  type BgMode,
  type SpecKey,
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
/** "STR +2, END +2" or "+2 STR" pairs → attribute bonus map.
 *  PHY is still accepted — it was this attribute's name until v0.8.37, and older
 *  Codex pages and homebrew packs are full of it. */
function parseBonuses(v?: string): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {};
  if (!v || /^(none|—|-)$/i.test(v.trim())) return out;
  const re = /(str|phy|dex|end|ap|wis|cha|int)\s*([+-]?\d+)|([+-]\d+)\s*(str|phy|dex|end|ap|wis|cha|int)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) {
    const tok = (m[1] || m[4]).toLowerCase();
    const key = (tok === "str" ? "phy" : tok) as AttrKey;
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

// Stat NAME → key (attributes and specialties), with the common synonyms seen in
// authored background pages ("Strength", "Adaption", "Willpower", …).
const ATTR_NAMES: Record<string, AttrKey> = {
  physical: "phy", physique: "phy", strength: "phy", str: "phy", phy: "phy",
  dexterity: "dex", agility: "dex", dex: "dex",
  endurance: "end", stamina: "end", end: "end",
  "action priority": "ap", "action points": "ap", ap: "ap",
  wisdom: "wis", willpower: "wis", wis: "wis",
  charisma: "cha", cha: "cha",
  intelligence: "int", int: "int",
};
const SPEC_NAMES: Record<string, SpecKey> = {
  inspiration: "ins", balance: "bal", weight: "wt", precision: "pre",
  control: "ctrl", "weapon mastery": "wm", "mental fortitude": "mf",
  perception: "per", adaptation: "adp", adaption: "adp", cunning: "cun",
};

/** Parse a "PASSIVE BONUSES" list ("+2 Wisdom, +2 Mental Fortitude, +1 Control")
 *  into fixed attribute + specialty maps. Freeform entries ("+2 to any three …")
 *  and unknown names are skipped (the player assigns those manually). */
function parseBonusList(text: string): { attr: Partial<Record<AttrKey, number>>; spec: Partial<Record<SpecKey, number>> } {
  const attr: Partial<Record<AttrKey, number>> = {};
  const spec: Partial<Record<SpecKey, number>> = {};
  for (const part of strip(text).split(/[,;]/)) {
    const m = part.match(/^\s*\+?(-?\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const name = m[2].toLowerCase().replace(/\s+/g, " ").trim();
    if (ATTR_NAMES[name]) attr[ATTR_NAMES[name]] = (attr[ATTR_NAMES[name]] || 0) + n;
    else if (SPEC_NAMES[name]) spec[SPEC_NAMES[name]] = (spec[SPEC_NAMES[name]] || 0) + n;
  }
  return { attr, spec };
}
/** Infer the point-spread mode from the parsed amounts (2/2/1/1 vs 4/2). */
function inferMode(attr: Partial<Record<AttrKey, number>>, spec: Partial<Record<SpecKey, number>>): BgMode | undefined {
  const amts = [...Object.values(attr), ...Object.values(spec)].sort((a, b) => b - a).join(",");
  if (amts === "2,2,1,1") return "standard";
  if (amts === "4,2") return "focused";
  return undefined;
}

export function parseBackgroundPage(md: string, stem: string): CodexBackground | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "background") return null;
  const name = f["name"] || titleOf(md, stem);
  const modeRaw = (f["mode"] || "").toLowerCase();
  let mode: BgMode | undefined = modeRaw.startsWith("focus") ? "focused" : modeRaw.startsWith("standard") ? "standard" : undefined;
  const bg: CodexBackground = { name, mode, note: f["note"] || undefined };
  const bonusText = f["bonuses"] || f["passive bonuses"];
  if (bonusText) {
    const { attr, spec } = parseBonusList(bonusText);
    if (Object.keys(attr).length) bg.attrBonus = attr;
    if (Object.keys(spec).length) bg.specBonus = spec;
    if (!mode) mode = inferMode(attr, spec);
    bg.mode = mode;
  }
  return bg;
}

/** Parse a "background directory" page — one page listing many backgrounds as
 *  cards (a bold name span + a "PASSIVE BONUSES" list each). Returns every
 *  background found, so an authored directory page populates the creator. */
export function parseBackgroundsDirectory(md: string): CodexBackground[] {
  if (!/passive bonuses/i.test(md)) return [];
  const names = [...md.matchAll(/<span[^>]*font-size:\s*16px[^>]*>([^<]+)<\/span>/gi)].map((m) => strip(m[1]));
  const bonuses = [...md.matchAll(/PASSIVE BONUSES<\/strong>\s*([^<]+)/gi)].map((m) => m[1]);
  const out: CodexBackground[] = [];
  const n = Math.min(names.length, bonuses.length);
  for (let i = 0; i < n; i++) {
    const name = names[i];
    if (!name) continue;
    const { attr, spec } = parseBonusList(bonuses[i]);
    const bg: CodexBackground = { name, mode: inferMode(attr, spec) };
    if (Object.keys(attr).length) bg.attrBonus = attr;
    if (Object.keys(spec).length) bg.specBonus = spec;
    out.push(bg);
  }
  return out;
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
  const backgrounds: CodexBackground[] = [];

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
    const bg = parseBackgroundPage(md, name);
    if (bg) {
      backgrounds.push(bg);
      continue;
    }
    // A directory page (many backgrounds as cards) — pull them all.
    const dir = parseBackgroundsDirectory(md);
    if (dir.length) {
      backgrounds.push(...dir);
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

  registerCodexGameData({ species, paradigms, sizes, genus, ciphers, backgrounds });
  setCodexCatalog(weapons, gear);
  window.dispatchEvent(new Event("wte-gamedata-changed"));
}
