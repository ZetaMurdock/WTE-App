// Derive a character's usable actions for the VTT abilities panel: weapon
// attacks (with a computed to-hit), the paradigm's standard genus + cipher sets,
// and racial abilities — each with AoE metadata parsed from its effect text.
import type { CharacterRecord } from "../../lib/characters";
import {
  usableRacial,
  usableGenus,
  usableCiphers,
  computeDerived,
  effectiveAttributes,
  aggregateEquip,
  mergeMods,
  bgBonuses,
  bgSpecBonuses,
  rollMod,
} from "../../game/wte";
import { getWeapon, loadoutMods, isRangedWeapon } from "../../lib/codex";
import { parseEffectMeta, type EffectMeta } from "./effectMeta";

export type AbilitySource = "action" | "genus" | "cipher" | "racial";

export interface VttAbility {
  id: string;
  name: string;
  source: AbilitySource;
  effect: string;
  range?: string | null;
  target?: string | null;
  ss: number;
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

function mk(
  source: AbilitySource,
  name: string,
  i: number,
  opts: { effect?: string | null; range?: string | null; target?: string | null; ss?: number; hit?: number; damage?: string | null }
): VttAbility {
  const effect = opts.effect || "";
  return {
    id: `${source}:${name}:${i}`,
    name,
    source,
    effect,
    range: opts.range,
    target: opts.target,
    ss: opts.ss ?? 0,
    hit: opts.hit,
    damage: opts.damage,
    meta: parseEffectMeta(effect || `${name} ${opts.range ?? ""}`),
  };
}

// Weapon to-hit mirrors the character sheet's ActionsTable: atk + PHY (melee) or
// DEX (ranged) modifier, with the same effective-attribute + equipment stack.
function deriveHits(rec: CharacterRecord): { atk: number; phyMod: number; dexMod: number } {
  const s = rec.sheet;
  const weaponLoadout = s.weaponLoadout ?? [];
  const gearLoadout = s.gearLoadout ?? [];
  const equip = mergeMods(aggregateEquip(s.equipment), loadoutMods(weaponLoadout, gearLoadout));
  const eff = effectiveAttributes(s.attributes, s.speciesId, bgBonuses(s.background), equip.attr);
  const derived = computeDerived(s.attributes, s.specialties, {
    speciesId: s.speciesId,
    rank: s.rank ?? 0,
    bgBonuses: bgBonuses(s.background),
    bgSpec: bgSpecBonuses(s.background),
    equip,
    sizeId: s.sizeId,
    morality: s.morality,
    overrides: s.derivedOverrides,
  });
  return { atk: derived.atk, phyMod: rollMod(eff.phy), dexMod: rollMod(eff.dex) };
}

export function characterActionSet(rec: CharacterRecord): CharacterActionSet {
  const s = rec.sheet;
  const { atk, phyMod, dexMod } = deriveHits(rec);

  const actions = (s.weaponLoadout ?? [])
    .map((n) => getWeapon(n))
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w, i) => mk("action", w.name, i, { effect: w.effect, range: w.range, hit: atk + (isRangedWeapon(w) ? dexMod : phyMod), damage: w.damage }));

  // Only what the character has SLOTTED — their loadout — not the full paradigm set.
  const genus = usableGenus(s.paradigmId, s.genusLoadout ?? []).map((a, i) => mk("genus", a.name, i, { effect: a.effect, range: a.range, target: a.target, ss: a.ss ?? 0 }));

  const cipher = usableCiphers(s.paradigmId, s.cipherLoadout ?? []).map((a, i) => mk("cipher", a.name, i, { effect: a.effect, ss: a.ss ?? 0 }));

  const racial = usableRacial(s.speciesId, s.variantName, s.variantOption).map((a, i) => mk("racial", a.name, i, { effect: a.effect }));

  return { actions, genus, cipher, racial };
}
