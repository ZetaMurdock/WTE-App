// Derive a character's usable actions for the VTT abilities panel: weapon
// attacks (with a computed to-hit), the paradigm's standard genus + cipher sets,
// and racial abilities — each with AoE metadata parsed from its effect text.
import type { RuleLayer } from "../../game/ruleLayers";
import { codexCtx, usableGenusResolved } from "../../game/resolvedGenus";
import type { CharacterRecord } from "../../lib/characters";
import {
  ATTR_KEYS,
  SPEC_KEYS,
  type AttrKey,
  type SpecKey,
  usableRacial,
  usableCiphers,
  computeDerived,
  effectiveAttributes,
  effectiveSpecialties,
  aggregateEquip,
  mergeMods,
  bgBonuses,
  bgSpecBonuses,
  rollMod,
  specRollMod,
  SPEC_MAX,
  moralityMods,
  type Attributes,
  type Specialties,
  type EquipMods,
  sizeOf,
} from "../../game/wte";
import { getWeapon, loadoutMods, isRangedWeapon } from "../../lib/codex";
import { derivedRules, loadRules } from "../../lib/campaignRules";
import { knownGenus, parseSpend } from "../../game/synapticFocus";
import { parseEffectMeta, type EffectMeta } from "./effectMeta";
import type { RollAxisStats } from "../../game/rollAxis";

export type AbilitySource = "action" | "genus" | "cipher" | "racial";

export interface VttAbility {
  id: string;
  /** The ability's PERMANENT Codex id, when the row resolved to a record that
   *  carries one. `id` above is positional and changes the moment a loadout is
   *  reordered, which is fine for a React key and useless for correlating an
   *  outcome back to the ability that caused it. */
  abilityId?: string;
  name: string;
  source: AbilitySource;
  effect: string;
  /** The declaring page's `## Actions` block, verbatim, when it has one.
   *  Carried rather than parsed here: what the steps mean is game/abilityEffects'
   *  answer, and a panel holding its own decoded copy is a second rule the page
   *  can no longer change. Absent for weapon actions and for every ability that
   *  declares nothing — which is the whole shipped corpus, still resolved from
   *  `effect` prose exactly as before. */
  actions?: string | null;
  range?: string | null;
  target?: string | null;
  ss: number;
  /** Synaptic Focus invested (genus only) — what a contest is fought with. */
  focus?: number;
  /** To-hit modifier for weapon actions (rolled as 1d20 + hit). */
  hit?: number;
  damage?: string | null;
  meta: EffectMeta;
}

export interface CharacterActionSet {
  actions: VttAbility[];
  genus: VttAbility[];
  cipher: VttAbility[];
  racial: VttAbility[];
}

export interface CharacterEffectiveRollScores {
  attr: Attributes;
  /** Effective specialties are capped exactly as they are on the sheet. */
  spec: Specialties;
}

function mk(
  source: AbilitySource,
  name: string,
  i: number,
  opts: { abilityId?: string; effect?: string | null; actions?: string | null; range?: string | null; target?: string | null; ss?: number; focus?: number; hit?: number; damage?: string | null }
): VttAbility {
  const effect = opts.effect || "";
  return {
    id: `${source}:${name}:${i}`,
    abilityId: opts.abilityId,
    name,
    source,
    effect,
    actions: opts.actions,
    range: opts.range,
    target: opts.target,
    focus: opts.focus,
    ss: opts.ss ?? 0,
    hit: opts.hit,
    damage: opts.damage,
    meta: parseEffectMeta(effect || `${name} ${opts.range ?? ""}`),
  };
}

function effectiveRollContext(rec: CharacterRecord): CharacterEffectiveRollScores & { equip: EquipMods } {
  const s = rec.sheet;
  const weaponLoadout = s.weaponLoadout ?? [];
  const gearLoadout = s.gearLoadout ?? [];
  const equip = mergeMods(aggregateEquip(s.equipment), loadoutMods(weaponLoadout, gearLoadout));
  const soul = moralityMods(s.morality);
  const effectiveBg = { ...bgBonuses(s.background) };
  for (const [key, value] of Object.entries(soul.attr)) effectiveBg[key as AttrKey] = (effectiveBg[key as AttrKey] || 0) + (value || 0);
  const eff = effectiveAttributes(s.attributes, s.speciesId, effectiveBg, equip.attr);
  eff.ap += sizeOf(s.sizeId, s.speciesId).apMod;
  const effectiveSpec = { ...equip.spec };
  for (const [key, value] of Object.entries(bgSpecBonuses(s.background))) effectiveSpec[key as SpecKey] = (effectiveSpec[key as SpecKey] || 0) + (value || 0);
  for (const [key, value] of Object.entries(soul.spec)) effectiveSpec[key as SpecKey] = (effectiveSpec[key as SpecKey] || 0) + (value || 0);
  const spec = effectiveSpecialties(s.specialties, effectiveSpec);
  for (const key of Object.keys(spec) as SpecKey[]) spec[key] = Math.min(SPEC_MAX, spec[key]);
  return { attr: eff, spec, equip };
}

/** The one effective score stack for VTT checks: species, background, equipped
 * items and Soul/morality, with the same specialty cap as CharacterSheet. */
export function characterEffectiveRollScores(rec: CharacterRecord): CharacterEffectiveRollScores {
  const { attr, spec } = effectiveRollContext(rec);
  return { attr, spec };
}

// Weapon to-hit mirrors the character sheet's ActionsTable: atk + STR (melee) or
// DEX (ranged) modifier, with the same effective-attribute + equipment stack.
/** Fully effective modifiers used by the seven universal Roll Axis paths. */
export function characterRollAxisStats(rec: CharacterRecord): RollAxisStats {
  const s = rec.sheet;
  const { attr: eff, spec, equip } = effectiveRollContext(rec);
  const derived = computeDerived(s.attributes, s.specialties, {
    speciesId: s.speciesId,
    rank: s.rank ?? 0,
    bgBonuses: bgBonuses(s.background),
    bgSpec: bgSpecBonuses(s.background),
    equip,
    sizeId: s.sizeId,
    morality: s.morality,
    overrides: s.derivedOverrides,
    ...derivedRules(rec.campaignId),
  });
  const rules = loadRules(rec.campaignId ?? "");
  return {
    // Paradigm Affinity flows through the VTT exactly as on the sheet, gated by
    // the same table rule.
    ...(rules.paradigmAffinity
      ? {
          affinity: {
            paradigmId: s.paradigmId,
            rank: s.rank ?? 0,
            extraAttr: ATTR_KEYS.includes(s.favoredAttr as AttrKey) ? (s.favoredAttr as AttrKey) : undefined,
            extraSpec: SPEC_KEYS.includes(s.favoredSpec as SpecKey) ? (s.favoredSpec as SpecKey) : undefined,
          },
        }
      : {}),
    attr: {
      phy: rollMod(eff.phy), ap: rollMod(eff.ap), dex: rollMod(eff.dex), end: rollMod(eff.end),
      wis: rollMod(eff.wis), int: rollMod(eff.int), cha: rollMod(eff.cha),
    },
    spec: {
      wm: specRollMod(spec.wm), pre: specRollMod(spec.pre), bal: specRollMod(spec.bal),
      adp: specRollMod(spec.adp), mf: specRollMod(spec.mf), per: specRollMod(spec.per), cun: specRollMod(spec.cun),
    },
    derived: { atk: derived.atk, ad: derived.ad, ev: derived.ev, rr: derived.rr, nc: derived.ncMod, pr: derived.pr, inf: derived.inf },
  };
}

function deriveHits(rec: CharacterRecord): { atk: number; phyMod: number; dexMod: number } {
  const stats = characterRollAxisStats(rec);
  return { atk: stats.derived.atk, phyMod: stats.attr.phy, dexMod: stats.attr.dex };
}

/**
 * `layers` is passed in rather than fetched: this is a pure derivation the VTT
 * calls per render, and a numeric layer the card explains must be a layer play
 * actually charges. Without it the Codex said an ability cost 5 while the table
 * spent 2.
 */
export function characterActionSet(rec: CharacterRecord, layers?: RuleLayer[]): CharacterActionSet {
  const s = rec.sheet;
  const { atk, phyMod, dexMod } = deriveHits(rec);

  const actions = (s.weaponLoadout ?? [])
    .map((n) => getWeapon(n))
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w, i) => mk("action", w.name, i, { effect: w.effect, range: w.range, hit: atk + (isRangedWeapon(w) ? dexMod : phyMod), damage: w.damage }));

  // Only what the character actually KNOWS — the genus they invested Synaptic
  // Focus in — not the full paradigm set. Falls back to the legacy flat loadout
  // for any sheet that predates the Focus rework and hasn't been migrated yet.
  const spend = parseSpend(s.focusSpend);
  const known = knownGenus(spend);
  const genusNames = known.length ? known : s.genusLoadout ?? [];
  // Resolved through the Codex, so a character holding stable ids gets real
  // mechanics instead of a row of blanks, and a campaign override reaches the
  // VTT exactly as it reaches the sheet.
  const genus = usableGenusResolved(genusNames, codexCtx(rec.campaignId, rec.id), spend.genus, layers).map((a, i) =>
    mk("genus", a.name, i, { abilityId: a.id, effect: a.effect, actions: a.actions, range: a.range, target: a.target, ss: a.ss ?? 0, focus: a.focus })
  );

  const cipher = usableCiphers(s.paradigmId, s.cipherLoadout ?? []).map((a, i) => mk("cipher", a.name, i, { abilityId: a.id, effect: a.effect, actions: a.actions, ss: a.ss ?? 0 }));

  const racial = usableRacial(s.speciesId, s.variantName, s.variantOption, s.innateChoice).map((a, i) => mk("racial", a.name, i, { abilityId: a.id, effect: a.effect, actions: a.actions }));

  return { actions, genus, cipher, racial };
}
