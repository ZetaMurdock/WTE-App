// The W.T.E game system as data + pure functions — the single source of truth for
// the native character sheet. The derived-stat math is ported verbatim from the legacy
// public/sheet.html calcAll() (core layer only: no equipment / size / rank / pressure)
// so native results match the old sheet exactly.

import genusData from "./data/genus.json";
import cipherData from "./data/ciphers.json";
import variantsData from "./data/variants.json";
import speciesInnateData from "./data/speciesInnate.json";

export type AttrKey = "phy" | "dex" | "end" | "ap" | "wis" | "cha" | "int";
export type SpecKey =
  | "ins" | "ver" | "bal" | "wt" | "pre" | "ctrl"
  | "pri" | "wm" | "mf" | "per" | "adp" | "cun";
export type DerivedKey = "atk" | "dhp" | "mv" | "ss" | "ev" | "nc" | "rr" | "ad" | "inf" | "pr";

export type Attributes = Record<AttrKey, number>;
export type Specialties = Record<SpecKey, number>;
export type Derived = Record<DerivedKey, number>;

export const ATTRIBUTES: { key: AttrKey; label: string; short: string; desc: string }[] = [
  { key: "phy", label: "Physical", short: "PHY", desc: "Strength, muscle, melee damage." },
  { key: "dex", label: "Dexterity", short: "DEX", desc: "Speed, reflexes, ranged accuracy." },
  { key: "end", label: "Endurance", short: "END", desc: "Health scaling, stamina, toxin resistance." },
  { key: "ap", label: "Action Priority", short: "AP", desc: "Tactical awareness, turn order." },
  { key: "wis", label: "Wisdom", short: "WIS", desc: "Willpower, perception, tracking." },
  { key: "cha", label: "Charisma", short: "CHA", desc: "Leadership, persuasion, social leverage." },
  { key: "int", label: "Intelligence", short: "INT", desc: "Cognition, research, hacking." },
];

export const SPECIALTIES: { key: SpecKey; label: string; desc: string }[] = [
  { key: "ins", label: "Inspiration", desc: "Creativity, flash insights." },
  { key: "ver", label: "Versatility", desc: "Adaptability in unfamiliar situations." },
  { key: "bal", label: "Balance", desc: "Poise, stabilization under pressure." },
  { key: "wt", label: "Weight", desc: "Kinetic force control, leverage." },
  { key: "pre", label: "Precision", desc: "Target acquisition, lockpicking, crits." },
  { key: "ctrl", label: "Control", desc: "Emotional restraint, piloting." },
  { key: "pri", label: "Priority", desc: "Combat initiative optimization." },
  { key: "wm", label: "Weapon Mastery", desc: "Damage output, combat maneuvers." },
  { key: "mf", label: "Mental Fortitude", desc: "Resisting shock, stress, Eldritch decay." },
  { key: "per", label: "Perception", desc: "Notice hidden elements, traps, tracks." },
  { key: "adp", label: "Adaptation", desc: "Surviving hazard shifts, radiation, void." },
  { key: "cun", label: "Cunning", desc: "Stealth, deception, infiltration." },
];

export const DERIVED: { key: DerivedKey; label: string; short: string }[] = [
  { key: "atk", label: "Attack Power", short: "ATK" },
  { key: "dhp", label: "Def. Hit Points", short: "DHP" },
  { key: "mv", label: "Movement", short: "MV" },
  { key: "ss", label: "Synaptic Space", short: "SS" },
  { key: "ev", label: "Evasion", short: "EV" },
  { key: "nc", label: "Neuronal Capacity", short: "NC" },
  { key: "rr", label: "Recovery Rate", short: "RR" },
  { key: "ad", label: "Action Density", short: "AD" },
  { key: "inf", label: "Influence", short: "INF" },
  { key: "pr", label: "Perception Range", short: "PR" },
];

export const SPEC_TOTAL = 225;
export const SPEC_MAX = 75;
export const RED_DIV = 3;
export const ATTR_MIN = 0;
export const ATTR_MAX = 20;
/** A specialty check with fewer than SPEC_PENALTY_MIN points takes a flat SPEC_PENALTY hit. */
export const SPEC_PENALTY_MIN = 25;
export const SPEC_PENALTY = 25;

/** Roll modifier: floor((value - 10) / 2). Used for all d20/d40 checks and the on-sheet mod boxes. */
export function rollMod(v: number): number {
  return Math.floor((v - 10) / 2);
}
export function signedMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Rank 0..9 (9 = Apex). Curator-managed; scales HP and unlocks genus/cipher slots. */
export const RANK_MULT = [1.0, 1.2, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75];
export const RANK_MAX = 9;
export function rankMult(rank: number): number {
  return RANK_MULT[Math.max(0, Math.min(RANK_MAX, Math.trunc(rank) || 0))];
}
export function genusSlots(rank: number): number {
  return 5 + Math.max(0, Math.trunc(rank) || 0);
}
export function cipherSlots(rank: number): number {
  return 1 + Math.max(0, Math.trunc(rank) || 0);
}

/** Background bonuses are flat additions you assign to attributes (never multipliers). */
export const BG_STANDARD = [2, 2, 1, 1];
export const BG_FOCUSED = [4, 2];
export type BgMode = "standard" | "focused";
export interface Background {
  name?: string;
  mode: BgMode;
  /** One attribute (or null) per addition in the chosen mode's amount list. */
  assign: (AttrKey | null)[];
  /** Fixed bonuses from a Codex background page (override mode/assign when present). */
  attrBonus?: Partial<Record<AttrKey, number>>;
  specBonus?: Partial<Record<SpecKey, number>>;
}
export function bgAmounts(mode: BgMode): number[] {
  return mode === "focused" ? BG_FOCUSED : BG_STANDARD;
}
/** Attribute additions from a background — the page's fixed set if present, else the assigned mode spread. */
export function bgBonuses(bg?: Background): Partial<Record<AttrKey, number>> {
  if (!bg) return {};
  if (bg.attrBonus && Object.keys(bg.attrBonus).length) return { ...bg.attrBonus };
  const out: Partial<Record<AttrKey, number>> = {};
  const amts = bgAmounts(bg.mode);
  bg.assign.forEach((k, i) => {
    if (k && amts[i] != null) out[k] = (out[k] || 0) + amts[i];
  });
  return out;
}
/** Specialty additions from a Codex background (empty for the manual assign mode). */
export function bgSpecBonuses(bg?: Background): Partial<Record<SpecKey, number>> {
  return bg?.specBonus ? { ...bg.specBonus } : {};
}
/** True when a background carries fixed page-defined bonuses (attrs and/or specs). */
export function bgHasFixed(bg?: Background): boolean {
  return !!(bg && ((bg.attrBonus && Object.keys(bg.attrBonus).length) || (bg.specBonus && Object.keys(bg.specBonus).length)));
}

export const ATTR_KEYS: AttrKey[] = ATTRIBUTES.map((a) => a.key);
export const SPEC_KEYS: SpecKey[] = SPECIALTIES.map((s) => s.key);

export type SpeciesFamily = "Humanity" | "Omenity" | "Asternem";
export interface SpeciesVariantAbility {
  name: string;
  effect: string;
}
export interface SpeciesVariant {
  name: string;
  note?: string;
  abilities: SpeciesVariantAbility[];
  /** A creation-time choice granting one extra ability (e.g. Annunaki head shape). */
  options?: { label: string; ability: SpeciesVariantAbility }[];
}
const VARIANTS = variantsData as Record<string, SpeciesVariant[]>;
export interface Species {
  id: string;
  name: string;
  family: SpeciesFamily;
  bonuses: Partial<Record<AttrKey, number>>;
  innate: string[];
  note?: string;
  /** Named lineage variants that grant extra abilities (from the legacy SPECIES_DATA). */
  variants: SpeciesVariant[];
}
// Base species data; `variants` are pulled from the baked Codex data (src/game/data/variants.json).
export const SPECIES: Species[] = [
  {
    id: "hyomen", name: "Hyomen", family: "Humanity", bonuses: {},
    innate: ["Prodigal Mind", "Indecisive Body", "Indomitable Will", "Peak Evolution"],
    note: "Balanced — specialize by choice.",
    variants: VARIANTS.hyomen ?? [],
  },
  {
    id: "voaulton", name: "Voaulton", family: "Humanity", bonuses: { phy: 2, end: 2 },
    innate: ["Chemical Mastery", "Robotic Integration", "Adaptive Analysis", "Energetic Synergy"],
    note: "Physical & cybernetic integration.",
    variants: VARIANTS.voaulton ?? [],
  },
  {
    id: "mirga", name: "Mirga", family: "Humanity", bonuses: { int: 2, ap: 2 },
    innate: ["Perfect Mimicry", "Mimetic Adaptation", "Illusory Disguise", "Emotional Mimicry"],
    note: "Psychological mimics.",
    variants: VARIANTS.mirga ?? [],
  },
  {
    id: "oriyu", name: "Oriyu", family: "Omenity", bonuses: {},
    innate: ["Energy Manipulation", "Energy Absorption", "Energy Projection", "Energy Shielding"],
    note: "Variable by lineage — assign stats manually.",
    variants: VARIANTS.oriyu ?? [],
  },
  {
    id: "insectoid", name: "Insectoid", family: "Omenity", bonuses: { end: 2, cha: 2 },
    innate: ["Regenerative Limbs", "Eyeless (non-visual senses)", "Reflexive Assurance", "Peak Evolution"],
    note: "Carapaced survivors.",
    variants: VARIANTS.insectoid ?? [],
  },
  {
    id: "subdermin", name: "SubDermin", family: "Omenity", bonuses: { end: 2, dex: 2 },
    innate: ["Forsaken Touch", "Radioactive Anatomy", "Terrestrial Knowledge", "Living Planet Merge"],
    note: "Crystalline, terrestrial anomalies.",
    variants: VARIANTS.subdermin ?? [],
  },
  {
    id: "inderi", name: "Inderi", family: "Asternem", bonuses: { wis: 2, int: 2 },
    innate: ["Eldritch Physiology", "Enhanced Regeneration", "Perfect Reflex Calibration", "True Eye of Solitude"],
    note: "Choose 2 of 4 active — the other 2 become locked Inceptions.",
    variants: VARIANTS.inderi ?? [],
  },
  {
    id: "seraph", name: "Seraph", family: "Asternem", bonuses: { dex: 2, wis: 2 },
    innate: ["Antimatter Wings", "Dance of Displacement", "Spatial Rupture", "Distant Vision"],
    note: "Spatial flyers.",
    variants: VARIANTS.seraph ?? [],
  },
  {
    id: "stygians", name: "Stygians", family: "Asternem", bonuses: { cha: 2, wis: 2 },
    innate: ["Interstitial Intrusion", "Engraving", "Parasitic Shadow", "Locked in Time"],
    note: "Shadow/void aberrants — highest Feral Eminence (+20); connected by the Stygian Hive.",
    variants: VARIANTS.stygians ?? [],
  },
];

export interface Paradigm {
  id: string;
  name: string;
  group: string;
  weapons: string[];
  domains: string[];
}
export const PARADIGMS: Paradigm[] = [
  { id: "science", name: "Science", group: "Scientific", weapons: ["Hybrid", "Medium", "Kinetic"], domains: ["Neutral", "Elemental"] },
  { id: "simulation", name: "Simulation", group: "Scientific", weapons: ["Kinetic", "Hybrid"], domains: ["Kinetic", "Null"] },
  { id: "remnant", name: "Remnant", group: "Esoteric & Survival", weapons: ["Kinetic", "Energy", "Hybrid"], domains: ["Kinetic", "Neutral"] },
  { id: "cognition", name: "Cognition", group: "Esoteric & Survival", weapons: ["Energy", "Exotic", "Hybrid"], domains: ["Eldritch", "Null"] },
  { id: "evolution", name: "Evolution", group: "Esoteric & Survival", weapons: ["Energy", "Exotic", "Hybrid"], domains: ["Elemental", "Eldritch"] },
  { id: "warfare", name: "Warfare", group: "Tactical Combat", weapons: ["Hybrid", "Exotic", "Kinetic"], domains: ["Neutral", "Kinetic"] },
];

// ── Data-driven registry (Codex pull) ────────────────────────────────────────
// The hardcoded arrays above are the BASE data. Pulled Codex pages overlay them
// at runtime via registerCodexGameData (lib/gameData): same-id entries override
// the base, new ids append. The arrays are mutated IN PLACE so every consumer
// (creator, sheet, VTT) keeps reading synchronously; base data is always the
// fallback and a re-register resets to base first (idempotent).
const BASE_SPECIES: Species[] = SPECIES.slice();
const BASE_PARADIGMS: Paradigm[] = PARADIGMS.slice();

export interface CodexGameData {
  species?: Species[];
  paradigms?: Paradigm[];
  /** speciesId → size key, for page-defined species. */
  sizes?: Record<string, string>;
  /** domain → genus abilities from pulled pages (append/override by name). */
  genus?: Record<string, GenusAbility[]>;
  /** paradigmId → ciphers from pulled pages (append/override by name). */
  ciphers?: Record<string, CipherAbility[]>;
  /** Character backgrounds from pulled pages (append/override by name). */
  backgrounds?: CodexBackground[];
}

let pageGenus: Record<string, GenusAbility[]> = {};
let pageCiphers: Record<string, CipherAbility[]> = {};

/** Backgrounds sourced from pulled Codex pages (the base game has none baked —
 *  background was a free-text field until the Codex pull). */
export interface CodexBackground {
  name: string;
  mode?: BgMode;
  note?: string;
  /** Fixed bonuses parsed from the page's "PASSIVE BONUSES" list. */
  attrBonus?: Partial<Record<AttrKey, number>>;
  specBonus?: Partial<Record<SpecKey, number>>;
}
export const BACKGROUNDS: CodexBackground[] = [];

export function registerCodexGameData(data: CodexGameData): void {
  SPECIES.length = 0;
  SPECIES.push(...BASE_SPECIES);
  for (const s of data.species ?? []) {
    const i = SPECIES.findIndex((x) => x.id === s.id);
    if (i >= 0) SPECIES[i] = s;
    else SPECIES.push(s);
  }
  PARADIGMS.length = 0;
  PARADIGMS.push(...BASE_PARADIGMS);
  for (const p of data.paradigms ?? []) {
    const i = PARADIGMS.findIndex((x) => x.id === p.id);
    if (i >= 0) PARADIGMS[i] = p;
    else PARADIGMS.push(p);
  }
  for (const [id, size] of Object.entries(data.sizes ?? {})) SPECIES_SIZE[id] = size;
  pageGenus = data.genus ?? {};
  pageCiphers = data.ciphers ?? {};
  BACKGROUNDS.length = 0;
  for (const b of data.backgrounds ?? []) {
    const i = BACKGROUNDS.findIndex((x) => x.name.toLowerCase() === b.name.toLowerCase());
    if (i >= 0) BACKGROUNDS[i] = b;
    else BACKGROUNDS.push(b);
  }
}

export function zeroAttributes(): Attributes {
  return { phy: 0, dex: 0, end: 0, ap: 0, wis: 0, cha: 0, int: 0 };
}
export function zeroSpecialties(): Specialties {
  return { ins: 0, ver: 0, bal: 0, wt: 0, pre: 0, ctrl: 0, pri: 0, wm: 0, mf: 0, per: 0, adp: 0, cun: 0 };
}

export function attrMod(score: number): number {
  return Math.floor(score / 4);
}

export function getSpecies(id?: string): Species | undefined {
  return SPECIES.find((s) => s.id === id);
}
export function getParadigm(id?: string): Paradigm | undefined {
  return PARADIGMS.find((p) => p.id === id);
}

// ── Size, weight & equipment (ported from the legacy sheet) ───────────────
export interface SizeClass {
  key: string;
  label: string;
  budget: number;
  reach: number;
  move: number;
  note: string;
}
export const SIZE_CLASSES: SizeClass[] = [
  { key: "tiny", label: "Tiny", budget: 8, reach: 0, move: 15, note: "¼ weapon dmg · ½ AoE · Minute gear only" },
  { key: "small", label: "Small", budget: 13, reach: 5, move: 25, note: "Disadv vs Huge+ · +1 Stealth (tight) · +1 grapple escape" },
  { key: "moderate", label: "Moderate", budget: 20, reach: 5, move: 30, note: "Baseline — no size modifiers" },
  { key: "large", label: "Large", budget: 27, reach: 10, move: 35, note: "Adv vs Small/Tiny · +1d4 melee · Large armor +2 DHP · −1 Stealth (open)" },
  { key: "huge", label: "Huge", budget: 35, reach: 15, move: 45, note: "Adv vs Moderate− · +2d6 melee · Stomp" },
  { key: "colossal", label: "Colossal", budget: 50, reach: 25, move: 60, note: "Phase-event scale" },
];

export type WeightKey = "minute" | "light" | "standard" | "heavy" | "massive" | "titanic";
export interface WeightCat {
  key: WeightKey;
  label: string;
  cost: number;
  minSize: number;
}
export const WEIGHT_CATS: WeightCat[] = [
  { key: "minute", label: "Minute", cost: 0.25, minSize: 0 },
  { key: "light", label: "Light", cost: 0.5, minSize: 1 },
  { key: "standard", label: "Standard", cost: 1.0, minSize: 2 },
  { key: "heavy", label: "Heavy", cost: 2.0, minSize: 3 },
  { key: "massive", label: "Massive", cost: 4.0, minSize: 4 },
  { key: "titanic", label: "Titanic", cost: 8.0, minSize: 5 },
];

/** Default size per species id, used when a character's size is left on "auto". */
export const SPECIES_SIZE: Record<string, string> = {
  hyomen: "moderate", voaulton: "moderate", mirga: "small", oriyu: "moderate",
  insectoid: "small", subdermin: "small", inderi: "moderate", seraph: "moderate", stygians: "moderate",
};

export interface EquipmentItem {
  id: string;
  name: string;
  weight: WeightKey;
  equipped: boolean;
  /** Free-text stat mods, e.g. "DEX +2, DHP +3, Weight -1". */
  mods: string;
  notes?: string;
}

// Free-text mod name → target ("a:phy" attr, "s:wt" specialty, "d:atk" derived). Longer names win.
const STAT_ALIASES: Record<string, string> = {
  phy: "a:phy", strength: "a:phy", str: "a:phy", dex: "a:dex", dexterity: "a:dex", end: "a:end", endurance: "a:end",
  ap: "a:ap", "action priority": "a:ap", wis: "a:wis", wisdom: "a:wis", cha: "a:cha", con: "a:cha", charisma: "a:cha",
  int: "a:int", intelligence: "a:int",
  inspiration: "s:ins", insp: "s:ins", ins: "s:ins", versatility: "s:ver", ver: "s:ver", balance: "s:bal", bal: "s:bal",
  weight: "s:wt", wt: "s:wt", precision: "s:pre", prec: "s:pre", pre: "s:pre", control: "s:ctrl", ctrl: "s:ctrl",
  priority: "s:pri", pri: "s:pri", "wpn mastery": "s:wm", "weapon mastery": "s:wm", mastery: "s:wm", wm: "s:wm",
  "mental fort": "s:mf", "mental fortitude": "s:mf", fort: "s:mf", mf: "s:mf", perception: "s:per", per: "s:per",
  adaption: "s:adp", adaptation: "s:adp", adp: "s:adp", cunning: "s:cun", cun: "s:cun",
  attack: "d:atk", "attack power": "d:atk", atk: "d:atk", dhp: "d:dhp", "defensive hit points": "d:dhp", "def hit points": "d:dhp",
  movement: "d:mv", move: "d:mv", mv: "d:mv", "synaptic space": "d:ss", synaptic: "d:ss", ss: "d:ss", evasion: "d:ev", eva: "d:ev", ev: "d:ev",
  "neuronal capacity": "d:nc", neuronal: "d:nc", nc: "d:nc", "recovery rate": "d:rr", recovery: "d:rr", rr: "d:rr",
  "action density": "d:ad", density: "d:ad", ad: "d:ad", influence: "d:inf", inf: "d:inf", "perception range": "d:pr", range: "d:pr", pr: "d:pr",
};

export interface EquipMods {
  attr: Partial<Record<AttrKey, number>>;
  spec: Partial<Record<SpecKey, number>>;
  derived: Partial<Record<DerivedKey, number>>;
}
export function parseEquipMods(text: string): EquipMods {
  const out: EquipMods = { attr: {}, spec: {}, derived: {} };
  String(text || "").replace(/−/g, "-").split(/[,;\n]+/).forEach((tok) => {
    const m = tok.trim().match(/^(.+?)\s*([+-]\s*\d+)\s*$/);
    if (!m) return;
    const name = m[1].trim().toLowerCase().replace(/\s+/g, " ");
    const ref = STAT_ALIASES[name];
    if (!ref) return;
    const v = parseInt(m[2].replace(/\s+/g, ""), 10) || 0;
    const key = ref.slice(2);
    if (ref[0] === "a") out.attr[key as AttrKey] = (out.attr[key as AttrKey] || 0) + v;
    else if (ref[0] === "s") out.spec[key as SpecKey] = (out.spec[key as SpecKey] || 0) + v;
    else out.derived[key as DerivedKey] = (out.derived[key as DerivedKey] || 0) + v;
  });
  return out;
}
export function aggregateEquip(items?: EquipmentItem[]): EquipMods {
  const out: EquipMods = { attr: {}, spec: {}, derived: {} };
  (items || []).forEach((it) => {
    if (!it.equipped) return;
    const m = parseEquipMods(it.mods);
    for (const k in m.attr) out.attr[k as AttrKey] = (out.attr[k as AttrKey] || 0) + (m.attr[k as AttrKey] || 0);
    for (const k in m.spec) out.spec[k as SpecKey] = (out.spec[k as SpecKey] || 0) + (m.spec[k as SpecKey] || 0);
    for (const k in m.derived) out.derived[k as DerivedKey] = (out.derived[k as DerivedKey] || 0) + (m.derived[k as DerivedKey] || 0);
  });
  return out;
}
/** Sum several EquipMods bonus maps into one (equipment + weapon + gear mods). */
export function mergeMods(...parts: EquipMods[]): EquipMods {
  const out: EquipMods = { attr: {}, spec: {}, derived: {} };
  for (const m of parts) {
    for (const k in m.attr) out.attr[k as AttrKey] = (out.attr[k as AttrKey] || 0) + (m.attr[k as AttrKey] || 0);
    for (const k in m.spec) out.spec[k as SpecKey] = (out.spec[k as SpecKey] || 0) + (m.spec[k as SpecKey] || 0);
    for (const k in m.derived) out.derived[k as DerivedKey] = (out.derived[k as DerivedKey] || 0) + (m.derived[k as DerivedKey] || 0);
  }
  return out;
}
export function sizeIndexOf(sizeId: string | undefined, speciesId?: string): number {
  const key = !sizeId || sizeId === "auto" ? SPECIES_SIZE[speciesId || ""] || "moderate" : sizeId;
  const i = SIZE_CLASSES.findIndex((s) => s.key === key);
  return i < 0 ? 2 : i;
}
export function sizeOf(sizeId: string | undefined, speciesId?: string): SizeClass {
  return SIZE_CLASSES[sizeIndexOf(sizeId, speciesId)];
}

// ── Genus & Ciphers (baked from the Codex wiki mirror) ────────────────────
export interface GenusAbility {
  name: string;
  ss: number | null;
  effect?: string | null;
  activation?: string | null;
  range?: string | null;
  target?: string | null;
}
export interface CipherAbility {
  name: string;
  ss: number | null;
  tier: string;
  type?: string | null;
  effect?: string | null;
}
const GENUS_DATA = genusData as Record<string, GenusAbility[]>;
const CIPHER_DATA = cipherData as Record<string, CipherAbility[]>;

/** Merge baked abilities with pulled-page ones (page entries override by name). */
function mergeAbilities<T extends { name: string }>(base: T[], page: T[]): T[] {
  if (!page.length) return base;
  const out = base.filter((b) => !page.some((p) => p.name.toLowerCase() === b.name.toLowerCase()));
  return [...out, ...page];
}

/** Genus abilities available to a paradigm, grouped by its accessible energy domains.
 *  Baked data + pulled Codex genus pages (keyed by domain). */
export function genusForParadigm(paradigmId?: string): { domain: string; abilities: GenusAbility[] }[] {
  const p = getParadigm(paradigmId);
  if (!p) return [];
  return p.domains
    .map((d) => ({ domain: d, abilities: mergeAbilities(GENUS_DATA[d] || [], pageGenus[d] || []) }))
    .filter((g) => g.abilities.length > 0);
}
/** Ciphers for a paradigm, in page order (each carries its tier: offline/online/special).
 *  Baked data + pulled Codex cipher pages (keyed by paradigm id). */
export function ciphersForParadigm(paradigmId?: string): CipherAbility[] {
  return mergeAbilities(CIPHER_DATA[paradigmId || ""] || [], pageCiphers[paradigmId || ""] || []);
}
export const CIPHER_TIERS = ["offline", "online", "special"] as const;

// ── Racial abilities + unified "usable" ability model (for the Actions rail) ──
const SPECIES_INNATE = speciesInnateData as Record<string, SpeciesVariantAbility[]>;
/** A species' innate abilities with effects; falls back to bare names when the wiki page had none. */
export function speciesInnate(speciesId?: string): SpeciesVariantAbility[] {
  const wiki = SPECIES_INNATE[speciesId || ""] || [];
  if (wiki.length) return wiki;
  return (getSpecies(speciesId)?.innate || []).map((name) => ({ name, effect: "" }));
}

export type AbilitySource = "genus" | "cipher" | "racial";
export interface UsableAbility {
  source: AbilitySource;
  name: string;
  ss: number;
  effect?: string | null;
  range?: string | null;
  target?: string | null;
  activation?: string | null;
}

export function usableGenus(paradigmId: string | undefined, loadout: string[]): UsableAbility[] {
  const all = genusForParadigm(paradigmId).flatMap((g) => g.abilities);
  return loadout.map((name) => {
    const a = all.find((x) => x.name === name);
    return { source: "genus" as const, name, ss: a?.ss ?? 0, effect: a?.effect, range: a?.range, target: a?.target, activation: a?.activation };
  });
}
export function usableCiphers(paradigmId: string | undefined, loadout: string[]): UsableAbility[] {
  const all = ciphersForParadigm(paradigmId);
  return loadout.map((name) => {
    const a = all.find((x) => x.name === name);
    return { source: "cipher" as const, name, ss: a?.ss ?? 0, effect: a?.effect, activation: a?.type };
  });
}
export function usableRacial(speciesId?: string, variantName?: string, variantOption?: string): UsableAbility[] {
  const out: UsableAbility[] = speciesInnate(speciesId).map((a) => ({ source: "racial" as const, name: a.name, ss: 0, effect: a.effect }));
  const variant = getSpecies(speciesId)?.variants.find((v) => v.name === variantName);
  if (variant) {
    variant.abilities.forEach((a) => out.push({ source: "racial", name: a.name, ss: 0, effect: a.effect }));
    const opt = variant.options?.find((o) => o.label === variantOption);
    if (opt) out.push({ source: "racial", name: opt.ability.name, ss: 0, effect: opt.ability.effect });
  }
  return out;
}

/** Specialties with equipment bonuses folded in (used for rolls + mod boxes). */
export function effectiveSpecialties(base: Specialties, equipSpec?: Partial<Record<SpecKey, number>>): Specialties {
  const out = { ...base };
  if (equipSpec) for (const k of SPEC_KEYS) out[k] = (out[k] || 0) + (equipSpec[k] || 0);
  return out;
}

/** Base attributes with the selected species' innate bonuses and any background additions folded in. */
export function effectiveAttributes(
  base: Attributes,
  speciesId?: string,
  bg?: Partial<Record<AttrKey, number>>,
  equipAttr?: Partial<Record<AttrKey, number>>
): Attributes {
  const sp = getSpecies(speciesId);
  const out = { ...base };
  for (const k of ATTR_KEYS) {
    out[k] = (out[k] || 0) + (sp?.bonuses[k] || 0) + (bg?.[k] || 0) + (equipAttr?.[k] || 0);
  }
  return out;
}

/** Derived rework: the three CORE stats (Synaptic Space, Neuronal Capacity, Movement)
 *  stay as totals — raw pool × rank multiplier. Every OTHER derived stat is now a
 *  MODIFIER derived from its raw pool:
 *    raw ≤ 40           → ⌊(raw − 20) / 4⌋            (−4 … +5)
 *    raw > 40           → ⌊5 + blocks·11⁄3 · rankMult⌋ where blocks = ⌊(raw − 40)/15⌋
 *  i.e. each 15 raw above 40 banks 11 points, divided by 3, scaled by rank. */
export const CORE_DERIVED: ReadonlySet<DerivedKey> = new Set<DerivedKey>(["ss", "nc", "mv"]);
export function derivedMod(raw: number, rank = 0): number {
  if (raw <= 40) return Math.floor((raw - 20) / 4);
  const blocks = Math.floor((raw - 40) / 15);
  return Math.floor(5 + ((blocks * 11) / 3) * rankMult(rank));
}

/** Raw pools ported from calcAll(). Reductions are applied last with NO floor, so an
 *  over-specialized build can legitimately go 0 or negative. */
export interface DerivedOpts {
  speciesId?: string;
  rank?: number;
  bgBonuses?: Partial<Record<AttrKey, number>>;
  /** Background specialty additions (from a Codex background). */
  bgSpec?: Partial<Record<SpecKey, number>>;
  equip?: EquipMods;
  /** Movement is floored at the size class's base move. */
  sizeMove?: number;
}
export function computeDerived(
  attrsIn: Attributes,
  specsIn: Specialties,
  opts: DerivedOpts = {}
): Derived & { hpMax: number; raw: Derived } {
  const a = effectiveAttributes(attrsIn, opts.speciesId, opts.bgBonuses, opts.equip?.attr);
  const s = { ...specsIn };
  for (const k of SPEC_KEYS) s[k] = Math.min(SPEC_MAX, (s[k] || 0) + (opts.equip?.spec?.[k] || 0) + (opts.bgSpec?.[k] || 0));
  const rank = opts.rank ?? 0;

  const red = (pts: number) => Math.floor(pts / RED_DIV);
  const dv = (contribs: number, reductions: number) => {
    const S = 5 + contribs;
    const max = S + Math.floor(S / 10) * 2;
    return max - reductions;
  };

  const raw: Derived = {
    atk: dv(a.phy + s.wt + s.ctrl, red(s.pre) + red(s.bal)),
    dhp: dv(s.wt + a.end, red(s.adp) + red(s.cun)),
    mv: dv(a.dex + a.ap + s.pri, red(s.wt) + red(s.pre)),
    ss: dv(s.mf + a.int + s.adp, red(s.ver) + red(s.pri)),
    ev: dv(a.dex + s.bal + s.cun, red(s.wt) + red(s.mf)),
    nc: dv(s.adp + s.mf + a.wis + s.ver, red(s.ctrl) + red(s.wm)),
    rr: dv(a.end + s.bal + s.adp, red(s.wt) + red(s.ctrl) + red(s.cun)),
    ad: dv(a.ap + s.pre + s.cun + s.pri, red(s.wt) + red(s.mf)),
    inf: dv(a.cha + s.cun + s.ins + s.ver, red(s.adp) + red(s.per)),
    pr: dv(a.wis + s.per + s.cun + s.bal, red(s.mf)),
  };
  // Equipment MODS on derived stats feed the RAW pool (everything flows through raw).
  const ed = opts.equip?.derived;
  if (ed) for (const stat of DERIVED) raw[stat.key] += ed[stat.key] || 0;

  const d: Derived = { ...raw };
  for (const stat of DERIVED) {
    d[stat.key] = CORE_DERIVED.has(stat.key)
      ? Math.round(raw[stat.key] * rankMult(rank))
      : derivedMod(raw[stat.key], rank);
  }
  if (opts.sizeMove != null) d.mv = Math.max(d.mv, opts.sizeMove);
  const hpMax = Math.max(0, Math.floor((raw.dhp / 2) * rankMult(rank)) + attrMod(a.end));
  return { ...d, hpMax, raw };
}

export function specialtyTotal(specs: Specialties): number {
  return SPEC_KEYS.reduce((sum, k) => sum + (specs[k] || 0), 0);
}
export function specialtyRemaining(specs: Specialties): number {
  return SPEC_TOTAL - specialtyTotal(specs);
}

export interface SheetValidation {
  ok: boolean;
  errors: string[];
}
export function validateSheet(attrs: Attributes, specs: Specialties): SheetValidation {
  const errors: string[] = [];
  for (const a of ATTRIBUTES) {
    const v = attrs[a.key];
    if (v < ATTR_MIN || v > ATTR_MAX) errors.push(`${a.short} must be between ${ATTR_MIN} and ${ATTR_MAX}.`);
  }
  const total = specialtyTotal(specs);
  if (total > SPEC_TOTAL) errors.push(`Specialties use ${total}/${SPEC_TOTAL} points (over by ${total - SPEC_TOTAL}).`);
  for (const sp of SPECIALTIES) {
    const v = specs[sp.key] || 0;
    if (v > SPEC_MAX) errors.push(`${sp.label} exceeds the ${SPEC_MAX}-point cap.`);
    if (v < 0) errors.push(`${sp.label} cannot be negative.`);
  }
  return { ok: errors.length === 0, errors };
}

// ── Rolls ────────────────────────────────────────────────────────────────
export interface RollResult {
  formula: string;
  result: number;
  detail: { die: number; roll: number; modifier: number; label: string };
}
function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}
function fmtMod(n: number): string {
  return n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`;
}
/** Net specialty roll modifier: rollMod(pts) minus the under-25 penalty. Shown in the mod box. */
export function specRollMod(pts: number): number {
  return rollMod(pts) - (pts < SPEC_PENALTY_MIN ? SPEC_PENALTY : 0);
}
/** Attribute check: 1d20 + rollMod(score). */
export function rollAttribute(label: string, score: number): RollResult {
  const roll = rollDie(20);
  const mod = rollMod(score);
  return { formula: `1d20 ${fmtMod(mod)}`, result: roll + mod, detail: { die: 20, roll, modifier: mod, label } };
}
/** Specialty check: 1d40 + rollMod(pts), with a flat -25 penalty when the specialty has < 25 points. */
export function rollSpecialty(label: string, pts: number): RollResult {
  const roll = rollDie(40);
  const mod = rollMod(pts);
  const penalty = pts < SPEC_PENALTY_MIN ? SPEC_PENALTY : 0;
  const formula = penalty ? `1d40 ${fmtMod(mod)} - ${SPEC_PENALTY}` : `1d40 ${fmtMod(mod)}`;
  return { formula, result: roll + mod - penalty, detail: { die: 40, roll, modifier: mod - penalty, label } };
}
/** Plain 1d20 assist roll (used when resolving an ability). */
export function rollGeneric(label: string): RollResult {
  const roll = rollDie(20);
  return { formula: "1d20", result: roll, detail: { die: 20, roll, modifier: 0, label } };
}
// A d20 attack roll with an explicit to-hit modifier (weapon HIT = ATK + PHY/DEX mod).
export function rollToHit(label: string, mod: number): RollResult {
  const roll = rollDie(20);
  return { formula: `1d20 ${fmtMod(mod)}`, result: roll + mod, detail: { die: 20, roll, modifier: mod, label } };
}
