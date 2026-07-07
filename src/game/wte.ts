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

export const ATTR_KEYS: AttrKey[] = ATTRIBUTES.map((a) => a.key);
export const SPEC_KEYS: SpecKey[] = SPECIALTIES.map((s) => s.key);

export type SpeciesFamily = "Humanity" | "Omenity" | "Asternem";
export interface Species {
  id: string;
  name: string;
  family: SpeciesFamily;
  bonuses: Partial<Record<AttrKey, number>>;
  innate: string[];
  note?: string;
}
export const SPECIES: Species[] = [
  { id: "hyomen", name: "Hyomen", family: "Humanity", bonuses: {}, innate: ["Prodigal Mind", "Indecisive Body", "Indomitable Will", "Peak Evolution"], note: "Highly versatile, balanced." },
  { id: "voaulton", name: "Voaulton", family: "Humanity", bonuses: { phy: 2, end: 2 }, innate: ["Chemical Mastery", "Robotic Integration", "Adaptive Analysis", "Energetic Synergy"], note: "Physical & cybernetic integration." },
  { id: "mirga", name: "Mirga", family: "Humanity", bonuses: { int: 2, ap: 2 }, innate: ["Perfect Mimicry", "Mimetic Adaptation", "Illusory Disguise", "Emotional Mimicry"], note: "Psychological mimics." },
  { id: "oriyu", name: "Oriyu", family: "Omenity", bonuses: {}, innate: ["Energy Manipulation", "Energy Absorption", "Energy Projection", "Energy Shielding"], note: "Energy manipulators — assign stats manually." },
  { id: "insectoid", name: "Insectoid", family: "Omenity", bonuses: { end: 2, cha: 2 }, innate: ["Regenerative Limbs", "Eyeless", "Reflexive Assurance", "Peak Evolution"], note: "Carapaced survivors." },
  { id: "subdermin", name: "SubDermin", family: "Omenity", bonuses: { end: 2, dex: 2 }, innate: ["Forsaken Touch", "Radioactive Anatomy", "Terrestrial Knowledge", "Living Planet Merge"], note: "Crystalline, terrestrial anomalies." },
  { id: "inderi", name: "Inderi", family: "Asternem", bonuses: { wis: 2, int: 2 }, innate: ["Eldritch Physiology", "Enhanced Regeneration", "Perfect Reflex Calibration", "True Eye of Solitude"], note: "Elders of deep cognition." },
  { id: "seraph", name: "Seraph", family: "Asternem", bonuses: { dex: 2, wis: 2 }, innate: ["Antimatter Wings", "Dance of Displacement", "Spatial Rupture", "Distant Vision"], note: "Spatial flyers." },
  { id: "stygians", name: "Stygians", family: "Asternem", bonuses: { cha: 2, wis: 2 }, innate: ["Shadow Meld", "Umbral Step", "Hive Conjugation", "Dimensional Flicker"], note: "Shadow forms." },
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

/** Base attributes with the selected species' innate bonuses folded in. */
export function effectiveAttributes(base: Attributes, speciesId?: string): Attributes {
  const sp = getSpecies(speciesId);
  const out = { ...base };
  if (sp) for (const k of ATTR_KEYS) out[k] = (out[k] || 0) + (sp.bonuses[k] || 0);
  return out;
}

/** The 10 derived stats + max HP, ported from calcAll(). Reductions are applied last
 *  with NO floor, so an over-specialized build can legitimately go 0 or negative. */
export function computeDerived(
  attrsIn: Attributes,
  specsIn: Specialties,
  speciesId?: string
): Derived & { hpMax: number } {
  const a = effectiveAttributes(attrsIn, speciesId);
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
  const hpMax = Math.max(0, Math.floor(d.dhp / 2) + attrMod(a.end)); // rank multiplier deferred (=1)
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
/** Attribute check: 1d20 + Attribute Score (Attributes.md). */
export function rollAttribute(label: string, score: number): RollResult {
  const roll = rollDie(20);
  return { formula: `1d20 + ${score}`, result: roll + score, detail: { die: 20, roll, modifier: score, label } };
}
/** Specialty check: 1d40 + Specialty Points (the rules' "+ attribute modifier" nuance is deferred). */
export function rollSpecialty(label: string, pts: number): RollResult {
  const roll = rollDie(40);
  return { formula: `1d40 + ${pts}`, result: roll + pts, detail: { die: 40, roll, modifier: pts, label } };
}
