// The W.T.E game system as data + pure functions — the single source of truth for
// the native character sheet. The derived-stat math is ported verbatim from the legacy
// public/sheet.html calcAll() (core layer only: no equipment / size / rank / pressure)
// so native results match the old sheet exactly.

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
}
export function bgAmounts(mode: BgMode): number[] {
  return mode === "focused" ? BG_FOCUSED : BG_STANDARD;
}
export function bgBonuses(bg?: Background): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {};
  if (!bg) return out;
  const amts = bgAmounts(bg.mode);
  bg.assign.forEach((k, i) => {
    if (k && amts[i] != null) out[k] = (out[k] || 0) + amts[i];
  });
  return out;
}

export const ATTR_KEYS: AttrKey[] = ATTRIBUTES.map((a) => a.key);
export const SPEC_KEYS: SpecKey[] = SPECIALTIES.map((s) => s.key);

export type SpeciesFamily = "Humanity" | "Omenity" | "Asternem";
export interface SpeciesVariant {
  name: string;
  abilities: string[];
}
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
export const SPECIES: Species[] = [
  {
    id: "hyomen", name: "Hyomen", family: "Humanity", bonuses: {},
    innate: ["Prodigal Mind", "Indecisive Body", "Indomitable Will", "Peak Evolution"],
    note: "Balanced — specialize by choice.",
    variants: [
      { name: "Bio-Engineered Hyomen", abilities: ["Enhanced Strength (+½ Ode Lvl to STR rolls)", "Enhanced Anatomy (Adv. on Adaptation)"] },
      { name: "Spatians", abilities: ["Space Modulation", "Evolved Body (convert non-crit dmg type)"] },
      { name: "Neo-Humans", abilities: ["Awakened Visualization (magnetic fields)", "Genetic Control (latent mutations 1hr)"] },
    ],
  },
  {
    id: "voaulton", name: "Voaulton", family: "Humanity", bonuses: { phy: 2, end: 2 },
    innate: ["Chemical Mastery", "Robotic Integration", "Adaptive Analysis", "Energetic Synergy"],
    note: "Physical & cybernetic integration.",
    variants: [
      { name: "Droid", abilities: ["Modulation (restructure form)", "EMP (40ft pulse, 1 free/enc.)"] },
      { name: "Cyborg", abilities: ["Hacking (backfire attacker)", "Circuit Transfiguration (Halt/Detonate/Redirect)"] },
      { name: "N-T1 (Novus-Tauron)", abilities: ["Forced Control (Nerve Grapple / Neural Override)", "Elongation (limbs to 40ft)"] },
    ],
  },
  {
    id: "mirga", name: "Mirga", family: "Humanity", bonuses: { int: 2, ap: 2 },
    innate: ["Perfect Mimicry", "Mimetic Adaptation", "Illusory Disguise", "Emotional Mimicry"],
    note: "Psychological mimics.",
    variants: [
      { name: "Chimera", abilities: ["Multicellular Sentience (detach segments)", "Modularity (transform segments, 8/hr)"] },
    ],
  },
  {
    id: "oriyu", name: "Oriyu", family: "Omenity", bonuses: {},
    innate: ["Energy Manipulation", "Energy Absorption", "Energy Projection", "Energy Shielding"],
    note: "Variable by lineage — assign stats manually.",
    variants: [],
  },
  {
    id: "insectoid", name: "Insectoid", family: "Omenity", bonuses: { end: 2, cha: 2 },
    innate: ["Regenerative Limbs", "Eyeless (non-visual senses)", "Reflexive Assurance", "Peak Evolution"],
    note: "Carapaced survivors.",
    variants: [
      { name: "Archnida", abilities: ["Bursting Fracture", "Unnerving Presence"] },
      { name: "Cerioisk", abilities: ["Augo Consumption (Cocoon Phase)", "Corruptive Reproduction"] },
    ],
  },
  {
    id: "subdermin", name: "SubDermin", family: "Omenity", bonuses: { end: 2, dex: 2 },
    innate: ["Forsaken Touch", "Radioactive Anatomy", "Terrestrial Knowledge", "Living Planet Merge"],
    note: "Crystalline, terrestrial anomalies.",
    variants: [
      { name: "Fractine", abilities: ["Diamond Form", "Crystal Manipulation"] },
      { name: "Construct", abilities: ["Physical Fracture (Anchored on overwhelm)", "Pressuring Advance"] },
    ],
  },
  {
    id: "inderi", name: "Inderi", family: "Asternem", bonuses: { wis: 2, int: 2 },
    innate: ["Eldritch Physiology", "Enhanced Regeneration", "Perfect Reflex Calibration", "True Eye of Solitude"],
    note: "Choose 2 of 4 active — the other 2 become locked Inceptions.",
    variants: [
      { name: "AI'N", abilities: ["Dilation", "Replication (1:1 replica, 1/2hr)"] },
    ],
  },
  {
    id: "seraph", name: "Seraph", family: "Asternem", bonuses: { dex: 2, wis: 2 },
    innate: ["Antimatter Wings", "Dance of Displacement", "Spatial Rupture", "Distant Vision"],
    note: "Spatial flyers.",
    variants: [],
  },
  {
    id: "stygians", name: "Stygians", family: "Asternem", bonuses: { cha: 2, wis: 2 },
    innate: ["Shadow Meld", "Umbral Step", "Hive Conjugation", "Dimensional Flicker"],
    note: "Shadow forms.",
    variants: [
      { name: "Xeno", abilities: ["Mutagenic Absorption", "Freakish Nature"] },
      { name: "Greys", abilities: ["Telepathy / Telekinesis", "Psionic Mold"] },
      { name: "Annunaki", abilities: ["Melam Manifestation", "Ni Conjuration", "+ Head Shape ability (Telepathy / Precognition / Atomic Manip.)"] },
    ],
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

/** Base attributes with the selected species' innate bonuses and any background additions folded in. */
export function effectiveAttributes(
  base: Attributes,
  speciesId?: string,
  bg?: Partial<Record<AttrKey, number>>
): Attributes {
  const sp = getSpecies(speciesId);
  const out = { ...base };
  for (const k of ATTR_KEYS) {
    out[k] = (out[k] || 0) + (sp?.bonuses[k] || 0) + (bg?.[k] || 0);
  }
  return out;
}

/** The 10 derived stats + max HP, ported from calcAll(). Reductions are applied last
 *  with NO floor, so an over-specialized build can legitimately go 0 or negative. */
export interface DerivedOpts {
  speciesId?: string;
  rank?: number;
  bgBonuses?: Partial<Record<AttrKey, number>>;
}
export function computeDerived(
  attrsIn: Attributes,
  specsIn: Specialties,
  opts: DerivedOpts = {}
): Derived & { hpMax: number } {
  const a = effectiveAttributes(attrsIn, opts.speciesId, opts.bgBonuses);
  const s = { ...specsIn };
  for (const k of SPEC_KEYS) s[k] = Math.min(SPEC_MAX, s[k] || 0);

  const red = (pts: number) => Math.floor(pts / RED_DIV);
  const dv = (contribs: number, reductions: number) => {
    const S = 5 + contribs;
    const max = S + Math.floor(S / 10) * 2;
    return max - reductions;
  };

  const d: Derived = {
    atk: dv(a.phy + s.wt + s.ctrl, red(s.pre) + red(s.bal)),
    dhp: dv(s.wt + a.end, red(s.adp) + red(s.cun)),
    mv: dv(a.dex + a.ap + s.pri, red(s.wt) + red(s.pre)),
    ss: dv(s.mf + a.int + s.adp, red(s.ver) + red(s.pri)),
    ev: dv(a.dex + s.bal + s.cun, red(s.wt) + red(s.mf)),
    nc: dv(s.adp + s.mf + a.wis + s.ver, red(s.ctrl) + red(s.wm)),
    rr: dv(a.end + s.bal + s.adp, red(s.wt) + red(s.ctrl) + red(s.cun)),
    ad: dv(a.ap + s.pre + s.cun + s.pri, red(s.wt) + red(s.mf)),
    inf: dv(a.cha + s.cun + s.ins + s.ver, red(s.adp) + red(s.per)),
    pr: dv(a.wis + s.per + s.cun, red(s.mf) + red(s.bal)),
  };
  const hpMax = Math.max(0, Math.floor((d.dhp / 2) * rankMult(opts.rank ?? 0)) + attrMod(a.end));
  return { ...d, hpMax };
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
