// Derive a character's usable abilities for the VTT abilities panel, each with
// its AoE metadata parsed from the effect text (so the panel can preview the
// template and, on use, suggest a hitbox to place).
import type { CharacterRecord } from "../../lib/characters";
import { usableGenus, usableCiphers, usableRacial } from "../../game/wte";
import { parseEffectMeta, type EffectMeta } from "./effectMeta";

export type AbilitySource = "genus" | "cipher" | "racial";

export interface VttAbility {
  id: string;
  name: string;
  source: AbilitySource;
  effect: string;
  range?: string | null;
  target?: string | null;
  ss: number;
  meta: EffectMeta;
}

export function characterAbilities(rec: CharacterRecord): VttAbility[] {
  const s = rec.sheet;
  const raw = [
    ...usableGenus(s.paradigmId, s.genusLoadout ?? []),
    ...usableCiphers(s.paradigmId, s.cipherLoadout ?? []),
    ...usableRacial(s.speciesId, s.variantName, s.variantOption),
  ];
  return raw
    .filter((a) => a.name)
    .map((a, i) => ({
      id: a.source + ":" + a.name + ":" + i,
      name: a.name,
      source: a.source as AbilitySource,
      effect: a.effect || "",
      range: a.range,
      target: a.target,
      ss: a.ss,
      // Fall back to name + range so a shape word in the title still parses.
      meta: parseEffectMeta(a.effect || `${a.name} ${a.range ?? ""}`),
    }));
}
