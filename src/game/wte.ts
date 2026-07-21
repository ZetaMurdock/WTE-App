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
  | "ins" | "bal" | "wt" | "pre" | "ctrl"
  | "wm" | "mf" | "per" | "adp" | "cun";
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
  { key: "bal", label: "Balance", desc: "Poise, stabilization under pressure." },
  { key: "wt", label: "Weight", desc: "Kinetic force control, leverage." },
  { key: "pre", label: "Precision", desc: "Target acquisition, lockpicking, crits." },
  { key: "ctrl", label: "Control", desc: "Emotional restraint, piloting." },
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

export const SPEC_TOTAL = 200;
export const SPEC_MAX = 75;
export const RED_DIV = 3;
export const ATTR_MIN = 0;
export const ATTR_MAX = 20;
/** An untrained specialty (< SPEC_PENALTY_MIN points) takes a flat SPEC_PENALTY
 *  hit. This balances the d40 spread specialty checks roll on — ATTRIBUTES roll
 *  a d20 and never take it. */
export const SPEC_PENALTY_MIN = 25;
export const SPEC_PENALTY = 25;

/** Roll modifier: floor((value - 10) / 2). Used for d20/d40 checks and the on-sheet mod boxes. */
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
  /** Genetic Dominance / Recessiveness — how strongly traits assert in hybrids. */
  dom?: number;
  rec?: number;
  /** Institutional Eminence Nature signature, e.g. "Civilized +30". */
  eminence?: string;
  /** Every species now chooses 2 of 4 innates active; the rest seed the Incept Pool. */
  innateSelect?: number;
  /** Named lineage variants that grant extra abilities (from the baked variants data). */
  variants: SpeciesVariant[];
}
// Base species data; `variants` + innate effects come from the baked Codex data
// (src/game/data/variants.json, speciesInnate.json). Every species selects 2 of 4
// innate abilities active; the unselected pair seeds the Incept Pool.
export const SPECIES: Species[] = [
  {
    id: "hyomen", name: "Hyomen", family: "Humanity", bonuses: {},
    innate: ["Prodigal Mind", "Omen", "Indomitable Will", "Peak Evolution"],
    dom: 45, rec: 10, eminence: "Civilized +30", innateSelect: 2,
    note: "The baseline humanoid — high Dominance; a Variant must be chosen.",
    variants: VARIANTS.hyomen ?? [],
  },
  {
    id: "voaulton", name: "Voaulton", family: "Humanity", bonuses: { phy: 2, end: 2 },
    innate: ["Chemical Mastery", "Robotic Integration", "Adaptive Analysis", "Energetic Synergy"],
    dom: 45, rec: 5, eminence: "Civilized +20 / Feral +5", innateSelect: 2,
    note: "Technologically integrated; machine-symbiosis lineage — a Variant must be chosen.",
    variants: VARIANTS.voaulton ?? [],
  },
  {
    id: "mirga", name: "Mirga", family: "Humanity", bonuses: { int: 2, ap: 2 },
    innate: ["Perfect Mimicry", "Mimetic Adaptation", "Illusory Disguise", "Emotional Mimicry"],
    dom: 20, rec: 15, eminence: "Civilized +10", innateSelect: 2,
    note: "Defined entirely by mimicry — unpredictable hybrids; a Variant must be chosen.",
    variants: VARIANTS.mirga ?? [],
  },
  {
    id: "oriyu", name: "Oriyu", family: "Omenity", bonuses: {},
    innate: ["Vesul Enkludtiu", "Vesul Exovertntiu", "Unravel Spacia", "Dyn Formn"],
    dom: 40, rec: 10, eminence: "Civilized +20 / Feral +5", innateSelect: 2,
    note: "Energy-attuned; a closed metric loop (compress → deflect → expand → release). A Variant must be chosen.",
    variants: VARIANTS.oriyu ?? [],
  },
  {
    id: "insectoid", name: "Insectoid", family: "Omenity", bonuses: { end: 2, cha: 2 },
    innate: ["Regenerative Limbs", "Eyeless", "Reflexive Assurance", "Peak Evolution"],
    dom: 24, rec: 40, eminence: "Civilized +15", innateSelect: 2,
    note: "Multi-form chitinous survivors — highest Recessiveness; a Variant must be chosen.",
    variants: VARIANTS.insectoid ?? [],
  },
  {
    id: "subdermin", name: "SubDermin", family: "Omenity", bonuses: { end: 2, dex: 2 },
    innate: ["Forsaken Touch", "Radioactive Anatomy", "Terrestrial Knowledge", "Living Planet Merge"],
    dom: 30, rec: 20, eminence: "Feral +10 / Civilized +10", innateSelect: 2,
    note: "Underground-dwelling; between Humanity and Omenity. A Variant must be chosen.",
    variants: VARIANTS.subdermin ?? [],
  },
  {
    id: "inderi", name: "Inderi", family: "Asternem", bonuses: { wis: 2, int: 2 },
    innate: ["Eldritch Physiology", "Enhanced Regeneration", "Perfect Reflex Calibration", "True Eye of Solitude"],
    dom: 40, rec: 5, eminence: "Civilized +35", innateSelect: 2,
    note: "Primordial pioneers of Incept Selection — unselected pair enters the Incept Pool at FULL Dominance. A Variant must be chosen.",
    variants: VARIANTS.inderi ?? [],
  },
  {
    id: "seraph", name: "Seraph", family: "Asternem", bonuses: { dex: 2, wis: 2 },
    innate: ["Antimatter Wings", "Dance of Displacement", "Spatial Rupture", "Distant Vision"],
    dom: 45, rec: 5, eminence: "Civilized +40", innateSelect: 2,
    note: "Divine-origin spatial masters — the highest Civilized Eminence in the game. A Variant must be chosen.",
    variants: VARIANTS.seraph ?? [],
  },
  {
    id: "stygians", name: "Stygians", family: "Asternem", bonuses: { cha: 2, wis: 2 },
    innate: ["Interstitial Intrusion", "Engraving", "Parasitic Shadow", "Locked in Time"],
    dom: 20, rec: 35, eminence: "Feral +20", innateSelect: 2,
    note: "Shadow/void aberrants — lowest Dominance, highest Feral Eminence (+20); connected by the Stygian Hive. A Variant must be chosen.",
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
  { id: "remnant", name: "Remnant", group: "Esoteric & Survival", weapons: ["Kinetic", "Energy", "Hybrid"], domains: ["Null", "Neutral"] },
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

// ── The 16 Sectors (ECP Territorial Atlas) + the Polarized Soul morality scale ──
export const SECTORS: { id: string; name: string; epithet: string }[] = [
  { id: "azimuth", name: "Azimuth", epithet: "The Center" },
  { id: "boren", name: "Boren", epithet: "The North" },
  { id: "nne", name: "NNE", epithet: "The Botanical Foundry" },
  { id: "ne", name: "NE", epithet: "The Moss-Iron Plains" },
  { id: "ene", name: "ENE", epithet: "The Ore-Grove Monoliths" },
  { id: "orentn", name: "Orentn", epithet: "The East" },
  { id: "ese", name: "ESE", epithet: "The Ash-Grime Foundries" },
  { id: "se", name: "SE", epithet: "The Rust-Trench Border" },
  { id: "sse", name: "SSE", epithet: "The Shrapnel Canyons" },
  { id: "austn", name: "Austn", epithet: "The South" },
  { id: "ssw", name: "SSW", epithet: "The Trench-Frontier" },
  { id: "sw", name: "SW", epithet: "The Dust-Choked Trenches" },
  { id: "wsw", name: "WSW", epithet: "The Frontier Rail" },
  { id: "oksdn", name: "Oksdn", epithet: "The West" },
  { id: "wnw", name: "WNW", epithet: "The Solar Homesteads" },
  { id: "nw", name: "NW", epithet: "The Green-Glass Dome" },
  { id: "nnw", name: "NNW", epithet: "The Canopy Laboratories" },
];
export function getSector(id?: string): { id: string; name: string; epithet: string } | undefined {
  return SECTORS.find((s) => s.id === id);
}

/** Polarized Soul state for a 0..100 morality position (see the built-in page). */
export function moralityState(m: number): { label: string } {
  if (m <= 15) return { label: "Pure Process" };
  if (m <= 35) return { label: "Leaning Process" };
  if (m <= 64) return { label: "Existential Drift" };
  if (m <= 84) return { label: "Leaning Resonance" };
  return { label: "Apex Resonance" };
}

/** The Soul's WIRED mechanics (built-in page): Process (≤30) gains +3 INT and
 *  +3 Control but Influence collapses to 0; Resonance (≥70) effects that map to
 *  static sheet math don't exist — its note reminds the table of the rest. */
export function moralityMods(m?: number): {
  attr: Partial<Record<AttrKey, number>>;
  spec: Partial<Record<SpecKey, number>>;
  influenceZero: boolean;
  note: string | null;
} {
  const v = m ?? 50;
  if (v <= 30) return { attr: { int: 3 }, spec: { ctrl: 3 }, influenceZero: true, note: "Process — +3 INT · +3 Control · Influence 0 · immune to Unsettled/Fear" };
  if (v >= 70) return { attr: {}, spec: {}, influenceZero: false, note: "Resonance — Inspiration ×2 for Complexity · double Psychic/Eldritch damage" };
  return { attr: {}, spec: {}, influenceZero: false, note: null };
}

// ── Pressure Engine (ported verbatim from the legacy sheet's PE section) ──
export const PE_MAX = 600;
export const PE_DEFAULT = 50;
export function pressureState(v: number): { label: string; key: "calm" | "tense" | "critical" | "catastrophic" } {
  if (v >= 110) return { label: "CATASTROPHIC", key: "catastrophic" };
  if (v >= 80) return { label: "CRITICAL", key: "critical" };
  if (v >= 45) return { label: "TENSE", key: "tense" };
  return { label: "CALM", key: "calm" };
}
/** Tax Burden: every specialty EXCEPT Inspiration contributes ⌊pts/10⌋. */
export function pressureTax(specs: Specialties): number {
  let tax = 0;
  for (const k of SPEC_KEYS) if (k !== "ins") tax += Math.floor((specs[k] || 0) / 10);
  return tax;
}
/** Final Complexity = Inspiration − Tax, shaped by the Polarized Soul:
 *  Process (≤30) cannot use Inspiration or Complexity at all (Hollow Signature);
 *  Resonance (≥70) doubles raw Inspiration for the Complexity calculation. */
export function pressureComplexity(specs: Specialties, morality?: number): number {
  const m = morality ?? 50;
  if (m <= 30) return 0;
  const insp = Math.min(SPEC_MAX, specs.ins || 0) * (m >= 70 ? 2 : 1);
  return insp - pressureTax(specs);
}
export interface PeBand {
  name: string;
  change: number;
  range: string;
}
/** Outcome band for AAV − PE (suggested pressure change; negative resolves). */
export function peBand(diff: number): PeBand {
  if (diff >= 6) return { name: "CRITICAL SUCCESS", change: -8, range: "−6 to −10" };
  if (diff >= 4) return { name: "SUCCESS", change: -4, range: "−4" };
  if (diff >= 2) return { name: "SIMPLE SUCCESS", change: -2, range: "−2" };
  if (diff >= -1) return { name: "PARTIAL / STALEMATE", change: 0, range: "0" };
  if (diff >= -3) return { name: "FUMBLE", change: 2, range: "+1 to +2" };
  if (diff >= -5) return { name: "FAILURE", change: 4, range: "+3 to +5" };
  return { name: "CRITICAL FAILURE", change: 8, range: "+5 to +10" };
}

/** Eminence — the System Alignment Index (−20 liability … +20 asset, start 0).
 *  Curator-adjusted; shapes HOW advancement manifests, never EXP speed. */
export function eminenceState(e: number): string {
  if (e >= 15) return "System Asset";
  if (e >= 6) return "Favored Instrument";
  if (e > -6) return "Unresolved Variable";
  if (e > -15) return "Flagged";
  return "System Liability";
}

export function zeroAttributes(): Attributes {
  return { phy: 0, dex: 0, end: 0, ap: 0, wis: 0, cha: 0, int: 0 };
}
export function zeroSpecialties(): Specialties {
  return { ins: 0, bal: 0, wt: 0, pre: 0, ctrl: 0, wm: 0, mf: 0, per: 0, adp: 0, cun: 0 };
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
// ── Size Classes ────────────────────────────────────────────────────────────
// An INVERSE KINETIC SCALING model: small things are fast and evasive but
// fragile; large things are slow, durable and devastating. Moderate is the
// baseline every equipment slot and rule is balanced around.
export interface SizeClass {
  key: string;
  label: string;
  /** Equipment slot budget. */
  budget: number;
  /** Innate reach in feet (0 = adjacent only). */
  reach: number;
  /** Base movement in feet. */
  move: number;
  /** Starting HP anchor for the class. */
  startHp: number;
  /** Added into the DHP pool (Base DHP = Weight + Endurance + this). */
  dhpMod: number;
  /** Applied to Action Priority checks. */
  apMod: number;
  /** Applied to Evasion. */
  evMod: number;
  height: string;
  weight: string;
  /** Battlefield footprint, feet per side (0 = a single cell). */
  footprint: number;
  note: string;
  /** The class's full rules profile, shown on the sheet. */
  rules: string[];
}
export const SIZE_CLASSES: SizeClass[] = [
  {
    key: "tiny", label: "Tiny", budget: 8, reach: 0, move: 15,
    startHp: 10, dhpMod: -5, apMod: 9, evMod: 4,
    height: "Under 1 ft", weight: "Under 5 lbs", footprint: 0,
    note: "¼ weapon dmg · ½ AoE · Minute gear only",
    rules: [
      "Cannot be targeted by weapons not built for their scale (Director's call).",
      "Take half damage from all AoE/splash — they slip through the pressure wave.",
      "Deal ¼ damage on standard physical attacks.",
      "Automatically fail physical grapple checks started by Small or larger.",
      "Can enter cells held by larger creatures without threatening space or drawing reactions.",
      "8 slots. Minute-scale weapons only (1d4 damage maximum).",
    ],
  },
  {
    key: "small", label: "Small", budget: 13, reach: 5, move: 25,
    startHp: 15, dhpMod: -2, apMod: 3, evMod: 2,
    height: "1–4 ft", weight: "5–60 lbs", footprint: 5,
    note: "Disadv vs Huge+ · +1 Stealth (tight) · Squeeze",
    rules: [
      "Disadvantage on physical attacks against Huge or Colossal targets — unless using reach weaponry or a specialised Cipher.",
      "Advantage against Huge/Colossal when attacking from behind or below (flanking).",
      "Squeeze Protocol: move through spaces held by Moderate or larger without penalty.",
      "+1 Stealth in non-open terrain; free access to vents, crawlspaces and pipes.",
      "13 slots. Standard gear needs custom sizing (+20% vendor premium; Paradigm-issued gear recalibrates itself).",
    ],
  },
  {
    key: "moderate", label: "Moderate", budget: 20, reach: 5, move: 30,
    startHp: 25, dhpMod: 0, apMod: 0, evMod: 0,
    height: "4–7 ft", weight: "60–350 lbs", footprint: 5,
    note: "Baseline — no size modifiers",
    rules: ["The baseline: no innate size bonuses or penalties.", "20 slots. All standard gear fits natively."],
  },
  {
    key: "large", label: "Large", budget: 27, reach: 10, move: 35,
    startHp: 35, dhpMod: 5, apMod: -2, evMod: -2,
    height: "7–12 ft", weight: "350–1,500 lbs", footprint: 10,
    note: "Adv vs Small/Tiny · +1d4 melee · +1d4 taken from AoE",
    rules: [
      "Advantage on physical attacks against Small or Tiny targets.",
      "+1d4 damage on every successful melee attack (kinetic mass).",
      "Easy target: AoE and splash attacks deal +1d4 against them.",
      "Occupies a 10×10 ft footprint with 10 ft innate reach.",
      "Must squeeze through Moderate doorways/vents at half speed; −1 Stealth in the open.",
      "27 slots. Custom gear +40%. Large weapons gain +1 damage die; Large armor grants +2 DHP.",
    ],
  },
  {
    key: "huge", label: "Huge", budget: 35, reach: 15, move: 45,
    startHp: 55, dhpMod: 10, apMod: -5, evMod: -5,
    height: "12–25 ft", weight: "1,500–15,000 lbs", footprint: 15,
    note: "Adv vs Moderate− · +2d6 melee · Stomp · unparryable",
    rules: [
      "Advantage on physical attacks against any target Moderate or smaller.",
      "+2d6 damage on every successful melee attack.",
      "Parry Barrier: Moderate and smaller cannot Parry its attacks — they must Avoid (reflex) or Endure.",
      "Kinetic Mass Immunity: immune to knockback, trip and grapple from Moderate or smaller.",
      "Stomp (standard action): everyone in an adjacent/occupied cell makes a Dexterity save (DC 10 + Strength mod) or takes 2d8 crushing damage and is knocked prone.",
      "Occupies a 15×15 ft footprint with 15 ft innate reach.",
      "35 slots. Standard gear is non-functional — Huge-scale fabrication required.",
    ],
  },
  {
    key: "colossal", label: "Colossal", budget: 50, reach: 25, move: 60,
    startHp: 90, dhpMod: 20, apMod: -10, evMod: -8,
    height: "25+ ft", weight: "15,000+ lbs", footprint: 25,
    note: "Adv vs all · +3d10 melee · +2d6 taken from AoE · phase-event scale",
    rules: [
      "Advantage on physical attacks against every smaller size class.",
      "+3d10 damage on every successful melee attack.",
      "Parry Barrier: smaller creatures cannot Parry without specialised heavy shielding (e.g. the Vanguard's Diverger).",
      "Kinetic Mass Immunity: immune to all displacement, knockback and grapple from smaller classes.",
      "AoE Vulnerability: inescapable surface area — takes +2d6 from all AoE, explosive and splash attacks.",
      "Occupies a 25×25 ft footprint (or larger) with 25 ft innate reach, scaling to orbital ranges by tier.",
      "50 slots. Most standard gear is non-functional.",
      "Combat is usually resolved as a multi-phase narrative event rather than grid turns.",
    ],
  },
];

/** Size-difference combat modifiers (attacker index − defender index). */
export interface SizeDiffMods {
  /** Flat modifier to the attack roll. */
  attack: number;
  /** Damage rider, as written on the table. */
  damage: string;
  /** Roll posture forced by the mismatch. */
  posture: "standard" | "advantage" | "disadvantage";
  /** Defensive reaction the target loses, if any. */
  limit?: string;
}
export function sizeDiffMods(attackerIdx: number, defenderIdx: number): SizeDiffMods {
  const d = attackerIdx - defenderIdx;
  if (d >= 3) return { attack: 3, damage: "+1d8", posture: "advantage", limit: "Target cannot Parry" };
  if (d === 2) return { attack: 2, damage: "+1d6", posture: "standard" };
  if (d === 1) return { attack: 1, damage: "+1d4", posture: "standard" };
  if (d === 0) return { attack: 0, damage: "—", posture: "standard" };
  if (d === -1) return { attack: 0, damage: "−1d4 (min 1 die)", posture: "standard" };
  if (d === -2) return { attack: 0, damage: "−2 flat", posture: "disadvantage" };
  return { attack: -2, damage: "−4 flat", posture: "disadvantage", limit: "Target cannot Endure" };
}

/** Grapple modifiers by size difference (attacker index − defender index). */
export interface SizeGrapple {
  mod: number;
  posture: "standard" | "advantage" | "disadvantage";
  /** True when the grapple simply succeeds barring a displacement Cipher. */
  automatic: boolean;
  note: string;
}
export function sizeGrapple(attackerIdx: number, defenderIdx: number): SizeGrapple {
  const d = attackerIdx - defenderIdx;
  if (d >= 3) return { mod: 0, posture: "advantage", automatic: true, note: "Automatic success unless the defender has a displacement Cipher or escape ability" };
  if (d === 2) return { mod: 0, posture: "advantage", automatic: false, note: "Advantage on the grapple check" };
  if (d === 1) return { mod: 2, posture: "standard", automatic: false, note: "+2 to the grapple check" };
  if (d === 0) return { mod: 0, posture: "standard", automatic: false, note: "Standard contested roll" };
  return { mod: 0, posture: "disadvantage", automatic: false, note: `Disadvantage (${-d} class${-d === 1 ? "" : "es"} smaller)` };
}

export type WeightKey = "minute" | "light" | "standard" | "heavy" | "massive" | "titanic";
export interface WeightCat {
  key: WeightKey;
  label: string;
  cost: number;
  /** Smallest SIZE_CLASSES index that can wield it. */
  minSize: number;
  /** Physical weight band. */
  weight: string;
  /** Representative gear at this weight. */
  examples: string;
}
export const WEIGHT_CATS: WeightCat[] = [
  { key: "minute", label: "Minute", cost: 0.25, minSize: 0, weight: "Under 1 lb", examples: "Throwing darts, nano-scanners, micro-tools" },
  { key: "light", label: "Light", cost: 0.5, minSize: 1, weight: "1–5 lbs", examples: "Short blades, light pistols, wrist terminals" },
  { key: "standard", label: "Standard", cost: 1.0, minSize: 2, weight: "5–25 lbs", examples: "Paradigm rifles, standard armor, longswords" },
  { key: "heavy", label: "Heavy", cost: 2.0, minSize: 3, weight: "25–80 lbs", examples: "Heavy support cannons, full plate armor" },
  { key: "massive", label: "Massive", cost: 4.0, minSize: 4, weight: "80–300 lbs", examples: "Vehicle-mounted blasters, industrial tools" },
  { key: "titanic", label: "Titanic", cost: 8.0, minSize: 5, weight: "300+ lbs", examples: "Starship batteries, geological drills" },
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
  /** How many you carry (stacks); defaults to 1 when unset. */
  qty?: number;
  /** Single-use item — the inventory shows a "Use" that decrements qty. */
  consumable?: boolean;
}

// Free-text mod name → target ("a:phy" attr, "s:wt" specialty, "d:atk" derived). Longer names win.
const STAT_ALIASES: Record<string, string> = {
  phy: "a:phy", strength: "a:phy", str: "a:phy", dex: "a:dex", dexterity: "a:dex", end: "a:end", endurance: "a:end",
  ap: "a:ap", "action priority": "a:ap", wis: "a:wis", wisdom: "a:wis", cha: "a:cha", con: "a:cha", charisma: "a:cha",
  int: "a:int", intelligence: "a:int",
  inspiration: "s:ins", insp: "s:ins", ins: "s:ins", balance: "s:bal", bal: "s:bal",
  weight: "s:wt", wt: "s:wt", precision: "s:pre", prec: "s:pre", pre: "s:pre", control: "s:ctrl", ctrl: "s:ctrl",
  "wpn mastery": "s:wm", "weapon mastery": "s:wm", mastery: "s:wm", wm: "s:wm",
  "mental fort": "s:mf", "mental fortitude": "s:mf", fort: "s:mf", mf: "s:mf", perception: "s:per", per: "s:per",
  adaption: "s:adp", adaptation: "s:adp", adp: "s:adp", cunning: "s:cun", cun: "s:cun",
  attack: "d:atk", "attack power": "d:atk", atk: "d:atk", dhp: "d:dhp", "defensive hit points": "d:dhp", "def hit points": "d:dhp",
  movement: "d:mv", move: "d:mv", mv: "d:mv", "synaptic space": "d:ss", synaptic: "d:ss", ss: "d:ss", evasion: "d:ev", eva: "d:ev", ev: "d:ev",
  "neuronal capacity": "d:nc", neuronal: "d:nc", nc: "d:nc", "recovery rate": "d:rr", recovery: "d:rr", rr: "d:rr",
  "action density": "d:ad", density: "d:ad", ad: "d:ad", influence: "d:inf", inf: "d:inf", "perception range": "d:pr", range: "d:pr", pr: "d:pr",
};

/** Resolve a free-text stat name ("Endurance", "Inspiration", "Wisdom") to its
 *  bucket + key, so ability text can be turned into the right roll. Null when
 *  the word isn't a known attribute/specialty/derived stat. */
export function resolveStatToken(name: string): { kind: "attr" | "spec" | "derived"; key: string } | null {
  const ref = STAT_ALIASES[name.trim().toLowerCase().replace(/\s+/g, " ")];
  if (!ref) return null;
  return { kind: ref[0] === "a" ? "attr" : ref[0] === "s" ? "spec" : "derived", key: ref.slice(2) };
}

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
/** Ciphers replaced or respelled in the rules: saved loadouts holding the old
 *  name resolve (and display) as the replacement, so nobody's character
 *  silently loses one. */
const CIPHER_RENAMES: Record<string, string> = {
  ANIMATION: "SPYDER",
  "SPYDER SPYDER": "SPYDER",
  STABLIZE: "STABILIZE",
  BIPARTION: "BIPARTITION",
  ARTHIMETIC: "ARITHMETIC",
  DIFUSE: "DIFFUSE",
  AUTHORATATIVE: "AUTHORITATIVE",
};
export function usableCiphers(paradigmId: string | undefined, loadout: string[]): UsableAbility[] {
  const all = ciphersForParadigm(paradigmId);
  return loadout.map((raw) => {
    const name = CIPHER_RENAMES[raw] ?? raw;
    const a = all.find((x) => x.name === name);
    return { source: "cipher" as const, name, ss: a?.ss ?? 0, effect: a?.effect, activation: a?.type };
  });
}
export function usableRacial(
  speciesId?: string,
  variantName?: string,
  variantOption?: string,
  /** The 2-of-4 chosen active innates (by name). Empty/undefined = all active
   *  (legacy characters predate the choose-2-of-4 rule). */
  innateChoice?: string[],
): UsableAbility[] {
  let innates = speciesInnate(speciesId);
  if (innateChoice && innateChoice.length) innates = innates.filter((a) => innateChoice.includes(a.name));
  const out: UsableAbility[] = innates.map((a) => ({ source: "racial" as const, name: a.name, ss: 0, effect: a.effect }));
  const variant = getSpecies(speciesId)?.variants.find((v) => v.name === variantName);
  if (variant) {
    variant.abilities.forEach((a) => out.push({ source: "racial", name: a.name, ss: 0, effect: a.effect }));
    const opt = variant.options?.find((o) => o.label === variantOption);
    if (opt) out.push({ source: "racial", name: opt.ability.name, ss: 0, effect: opt.ability.effect });
  }
  return out;
}

/** The 2 unselected innate abilities — the Incept-pool seeds. */
export function inceptSeeds(speciesId?: string, innateChoice?: string[]): SpeciesVariantAbility[] {
  if (!innateChoice || !innateChoice.length) return [];
  return speciesInnate(speciesId).filter((a) => !innateChoice.includes(a.name));
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

/** Derived rework: the CORE stats (Defensive Hit Points, Synaptic Space, Neuronal
 *  Capacity, Movement) stay as POOLS — raw × rank multiplier, because they are
 *  quantities you spend or lose, not check modifiers. Every OTHER derived stat is a
 *  MODIFIER derived from its raw pool:
 *    raw ≤ 40           → ⌊(raw − 20) / 4⌋            (−4 … +5)
 *    raw > 40           → ⌊5 + blocks·11⁄3 · rankMult⌋ where blocks = ⌊(raw − 40)/15⌋
 *  i.e. each 15 raw above 40 banks 11 points, divided by 3, scaled by rank. */
export const CORE_DERIVED: ReadonlySet<DerivedKey> = new Set<DerivedKey>(["ss", "nc", "mv", "dhp"]);
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
  /** The character's size class — supplies the DHP / AP / Evasion modifiers and
   *  the movement floor. Pass this (with speciesId) rather than sizeMove. */
  sizeId?: string;
  /** Polarized Soul position — wires the Process/Resonance mechanics in. */
  morality?: number;
  /** Curator-sanctioned manual overrides — replace the computed value outright. */
  overrides?: Partial<Derived> & { hpMax?: number; ncMod?: number };
}
/** Attribute value at which compensation begins (below this you are "lacking"). */
export const ATTR_PIVOT = 10;
/** Compensation accrues at HALF the reduction rate (RED_DIV 3 → 6). */
export const COMP_DIV = RED_DIV * 2;

/** The compensation web: a LOW attribute pays back into the stat it opposes —
 *  but only for a character actually trained in that stat. High attributes keep
 *  their full drag, so a wall of 20s is still the most taxed build on the table. */
export const ATTR_COMPENSATION: { attr: AttrKey; stat: DerivedKey; specs: SpecKey[] }[] = [
  { attr: "phy", stat: "ev", specs: ["bal", "cun"] },
  { attr: "dex", stat: "dhp", specs: ["wt"] },
  { attr: "end", stat: "mv", specs: ["ctrl"] },
  { attr: "ap", stat: "rr", specs: ["bal", "adp"] },
  { attr: "wis", stat: "ad", specs: ["pre", "cun", "ctrl"] },
  { attr: "cha", stat: "pr", specs: ["per", "cun", "bal"] },
  { attr: "int", stat: "atk", specs: ["wt", "wm"] },
];

/** What a lacking attribute pays back, scaled by rank so it stays legible at 9.
 *  Zero unless the character is TRAINED (≥ SPEC_PENALTY_MIN) in a contributing
 *  specialty — dumping alone never pays, you must spend into the other side. */
export function attrCompensation(attrVal: number, trained: boolean, rank = 0): number {
  if (!trained || attrVal >= ATTR_PIVOT) return 0;
  return Math.floor(((ATTR_PIVOT - attrVal) / COMP_DIV) * rankMult(rank));
}

export function computeDerived(
  attrsIn: Attributes,
  specsIn: Specialties,
  opts: DerivedOpts = {}
): Derived & { hpMax: number; ncMod: number; raw: Derived } {
  const mm = moralityMods(opts.morality);
  const bgb: Partial<Record<AttrKey, number>> = { ...(opts.bgBonuses ?? {}) };
  for (const k of ATTR_KEYS) if (mm.attr[k]) bgb[k] = (bgb[k] || 0) + mm.attr[k]!;
  // Size class: AP rides the attribute (it modifies every AP check), while the
  // DHP and Evasion modifiers land on their derived stats below.
  const size = opts.sizeId !== undefined || opts.speciesId !== undefined ? sizeOf(opts.sizeId, opts.speciesId) : null;
  if (size?.apMod) bgb.ap = (bgb.ap || 0) + size.apMod;
  const a = effectiveAttributes(attrsIn, opts.speciesId, bgb, opts.equip?.attr);
  const s = { ...specsIn };
  for (const k of SPEC_KEYS) s[k] = Math.min(SPEC_MAX, (s[k] || 0) + (opts.equip?.spec?.[k] || 0) + (opts.bgSpec?.[k] || 0) + (mm.spec[k] || 0));
  const rank = opts.rank ?? 0;

  const red = (pts: number) => Math.floor(pts / RED_DIV);
  const dv = (contribs: number, reductions: number) => {
    const S = 5 + contribs;
    const max = S + Math.floor(S / 10) * 2;
    return max - reductions;
  };

  // THE 10 DERIVED STATISTICS — inputs / reduced-by per the published table
  // (every reduction is −1 per 3 points, RED_DIV). Each ATTRIBUTE also drags its
  // natural opposite so no attribute is pure upside — the dichotomy web:
  //   STR→EV (force vs finesse) · DEX→DHP (finesse vs mass) · END→MV (mass vs speed)
  //   AP→RR (twitch vs rest) · WIS→AD (deliberation vs frenzy) · CHA→PR (projection
  //   vs observation) · INT→ATK (brains vs brawn). SS/NC/INF keep no attr reducer.
  const raw: Derived = {
    atk: dv(a.phy + s.wt + s.wm, red(s.pre) + red(s.bal) + red(a.int)),
    dhp: dv(s.wt + a.end, red(s.bal) + red(s.pre) + red(a.dex)),
    mv: dv(a.dex + a.ap + s.ctrl, red(s.wt) + red(s.pre) + red(a.end)),
    ss: dv(s.mf + a.int + s.ctrl, red(s.pre) + red(s.wm)),
    ev: dv(a.dex + s.bal + s.cun, red(s.wt) + red(s.mf) + red(a.phy)),
    nc: dv(s.adp + s.mf + a.wis + s.per, red(s.ctrl) + red(s.wm)),
    rr: dv(a.end + s.bal + s.adp, red(s.wt) + red(s.ctrl) + red(s.cun) + red(a.ap)),
    ad: dv(a.ap + s.pre + s.cun + s.ctrl, red(s.wt) + red(s.mf) + red(a.wis)),
    inf: dv(a.cha + s.cun + s.per + s.pre, red(s.adp) + red(s.wt)),
    pr: dv(a.wis + s.per + s.cun + s.bal, red(s.mf) + red(a.cha)),
  };
  // Equipment MODS on derived stats feed the RAW pool (everything flows through raw).
  const ed = opts.equip?.derived;
  if (ed) for (const stat of DERIVED) raw[stat.key] += ed[stat.key] || 0;
  // Size DHP modifier joins the pool (Base DHP = Weight + Endurance + size), and
  // never drops a body below the Tiny floor of 5.
  if (size?.dhpMod) raw.dhp = Math.max(5, raw.dhp + size.dhpMod);

  const d: Derived = { ...raw };
  for (const stat of DERIVED) {
    d[stat.key] = CORE_DERIVED.has(stat.key)
      ? Math.round(raw[stat.key] * rankMult(rank))
      : derivedMod(raw[stat.key], rank);
  }
  // Compensation lands on the CHECK, not the raw pool — a ±2 raw swing is
  // invisible at every rank (the block conversion moves in 15s), so paying a
  // shaped build back at the modifier is the only place it can be felt.
  for (const c of ATTR_COMPENSATION) {
    const trained = c.specs.some((k) => (s[k] || 0) >= SPEC_PENALTY_MIN);
    d[c.stat] += attrCompensation(a[c.attr], trained, rank);
  }
  // Size Evasion modifier applies to the CHECK (post-conversion), per the AAV rule.
  if (size?.evMod) d.ev += size.evMod;
  const moveFloor = opts.sizeMove ?? size?.move;
  if (moveFloor != null) d.mv = Math.max(d.mv, moveFloor);
  // Process morality: Influence Collapse — the stat is permanently 0.
  if (mm.influenceZero) {
    d.inf = 0;
    raw.inf = 0;
  }
  // Manual overrides land LAST — the Curator's word beats every formula.
  if (opts.overrides) {
    for (const stat of DERIVED) {
      const ov = opts.overrides[stat.key];
      if (ov != null && Number.isFinite(ov)) d[stat.key] = ov;
    }
  }
  // HP is ANCHORED on the size class's starting HP (Moderate 25 … Colossal 90):
  // a Colossal body starts at 90 base health before stats add anything.
  const hpBase = (size ?? sizeOf("moderate")).startHp;
  const hpMax = Math.max(0, hpBase + Math.floor((raw.dhp / 2) * rankMult(rank)) + attrMod(a.end));
  // Neuronal Capacity is a CORE total (it budgets equipment), but it also gets a
  // check modifier like every other derived stat — so `nc` stays the budget and
  // `ncMod` is what you add to an NC roll.
  const ncMod = opts.overrides?.ncMod ?? derivedMod(raw.nc, rank);
  return { ...d, hpMax: opts.overrides?.hpMax ?? hpMax, ncMod, raw };
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
/** Roll posture: advantage/disadvantage roll the die twice, keep high/low. */
export type RollMode = "normal" | "adv" | "dis";
export interface RollResult {
  formula: string;
  result: number;
  detail: { die: number; roll: number; modifier: number; label: string; mode?: RollMode; rolls?: number[] };
}
export function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}
/** One posture-aware die: normal = one roll; adv/dis = two, keep high/low. */
export function rollDieMode(sides: number, mode: RollMode): { roll: number; rolls: number[] } {
  const a = rollDie(sides);
  if (mode === "normal") return { roll: a, rolls: [a] };
  const b = rollDie(sides);
  return { roll: mode === "adv" ? Math.max(a, b) : Math.min(a, b), rolls: [a, b] };
}
/** " · Advantage (17/4)" — the message always names the posture rolled with. */
function modeTag(mode: RollMode, rolls: number[]): string {
  return mode === "normal" ? "" : ` · ${mode === "adv" ? "Advantage" : "Disadvantage"} (${rolls.join("/")})`;
}
function fmtMod(n: number): string {
  return n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`;
}
/** Net specialty roll modifier: rollMod(pts) minus the under-25 penalty. Shown in the mod box. */
export function specRollMod(pts: number): number {
  return rollMod(pts) - (pts < SPEC_PENALTY_MIN ? SPEC_PENALTY : 0);
}
/** Attribute check: 1d20 + rollMod(score). */
export function rollAttribute(label: string, score: number, mode: RollMode = "normal"): RollResult {
  const { roll, rolls } = rollDieMode(20, mode);
  const mod = rollMod(score);
  return { formula: `1d20 ${fmtMod(mod)}${modeTag(mode, rolls)}`, result: roll + mod, detail: { die: 20, roll, modifier: mod, label, mode, rolls } };
}
/** Specialty check: 1d40 + rollMod(pts), with a flat −25 when the specialty has
 *  under 25 points. Specialties (and the Pressure Engine) roll d40; only
 *  ATTRIBUTE checks roll a d20. */
export function rollSpecialty(label: string, pts: number, mode: RollMode = "normal"): RollResult {
  const { roll, rolls } = rollDieMode(40, mode);
  const mod = rollMod(pts);
  const penalty = pts < SPEC_PENALTY_MIN ? SPEC_PENALTY : 0;
  const formula = (penalty ? `1d40 ${fmtMod(mod)} - ${SPEC_PENALTY}` : `1d40 ${fmtMod(mod)}`) + modeTag(mode, rolls);
  return { formula, result: roll + mod - penalty, detail: { die: 40, roll, modifier: mod - penalty, label, mode, rolls } };
}
/** Plain 1d20 assist roll (used when resolving an ability). */
export function rollGeneric(label: string, mode: RollMode = "normal"): RollResult {
  const { roll, rolls } = rollDieMode(20, mode);
  return { formula: `1d20${modeTag(mode, rolls)}`, result: roll, detail: { die: 20, roll, modifier: 0, label, mode, rolls } };
}
// A d20 attack roll with an explicit to-hit modifier (weapon HIT = ATK + PHY/DEX mod).
export function rollToHit(label: string, mod: number, mode: RollMode = "normal"): RollResult {
  const { roll, rolls } = rollDieMode(20, mode);
  return { formula: `1d20 ${fmtMod(mod)}${modeTag(mode, rolls)}`, result: roll + mod, detail: { die: 20, roll, modifier: mod, label, mode, rolls } };
}

/** Parse a dice expression — "2d6+3", "d20", "3d8-1" (whitespace tolerant). */
export function parseDiceExpr(raw: string): { count: number; sides: number; mod: number } | null {
  const m = raw
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .match(/^(\d+)?d(\d+)([+-]\d+)?$/);
  if (!m) return null;
  const count = Math.min(99, parseInt(m[1] || "1", 10));
  const sides = Math.min(1000, parseInt(m[2], 10));
  const mod = parseInt(m[3] || "0", 10);
  if (count < 1 || sides < 2) return null;
  return { count, sides, mod };
}

/** Roll a freeform dice expression (the legacy sheet's dice-panel behavior) —
 *  null when the expression doesn't parse. Advantage/disadvantage roll the
 *  whole expression twice and keep the higher/lower total. */
export function rollDiceExpr(label: string, raw: string, mode: RollMode = "normal"): RollResult | null {
  const p = parseDiceExpr(raw);
  if (!p) return null;
  const once = () => {
    let sum = 0;
    for (let i = 0; i < p.count; i++) sum += rollDie(p.sides);
    return sum;
  };
  const a = once();
  let sum = a;
  const totals = [a];
  if (mode !== "normal") {
    const b = once();
    totals.push(b);
    sum = mode === "adv" ? Math.max(a, b) : Math.min(a, b);
  }
  const formula = `${p.count}d${p.sides}${p.mod > 0 ? "+" + p.mod : p.mod < 0 ? String(p.mod) : ""}${modeTag(mode, totals)}`;
  return { formula, result: sum + p.mod, detail: { die: p.sides, roll: sum, modifier: p.mod, label, mode, rolls: totals } };
}

/** First dice expression found in free text ("deals 3d6 fire…" → "3d6"), for
 *  pre-filling the roller when an ability is used. */
export function diceExprFromText(text?: string | null): string | null {
  const m = (text || "").match(/(\d*)d(\d+)([+-]\d+)?/i);
  return m ? `${m[1] || "1"}d${m[2]}${m[3] || ""}` : null;
}
