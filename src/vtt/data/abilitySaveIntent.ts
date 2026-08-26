// One way to turn "this ability asks the target for a save" into a request.
//
// Two surfaces now draw that button: the gold chip on the abilities card, and
// the ring that opens on the map when an ability is used. They must ask for the
// SAME roll — same DV, same axis, same declared steps riding along — or a
// Curator who presses the map button gets a different number than the one the
// dock printed, and neither is obviously the wrong one.
//
// The DV logic itself lives in `game/saveDv`; this is the assembly, which is
// where the drift was going to happen: which id an outcome is filed under,
// whether declared steps travel, whether the label carries the number.
import type { AbilityAction } from "../../game/abilityActions";
import type { EffectStep } from "../../game/abilityEffects";
import type { NetRollAxisRequest } from "../../net/protocol";
import type { RollAxisStats } from "../../game/rollAxis";
import { abilitySaveDv, saveChipDv, saveDvBreakdown, savePlainLabel } from "../../game/saveDv";

/** A target-side check parsed from an ability. The VTT shell supplies the
 * selected target and turns this intent into a targeted network roll request. */
export interface VttTargetRollIntent {
  abilityId: string;
  abilityName: string;
  sourceCharacterId?: string;
  label: string;
  stat?: string;
  rollAxis?: NetRollAxisRequest;
  dc?: number;
  /** The ability's own prose, so the shell can read what a failed save costs
   *  without resolving the ability a second time. */
  effect?: string;
  /** The page's DECLARED steps, when it has an `## Actions` block. They ride
   *  beside the prose rather than instead of it: the shell hands both to the
   *  ledger, which prefers these, so a declared ability's card says what the
   *  PAGE said instead of what the prose scanner made of it. Empty/absent for
   *  the whole undeclared corpus, which keeps the prose path byte for byte. */
  steps?: readonly EffectStep[];
}

export interface SaveIntentSource {
  /** The permanent id when the ability carries one: an outcome outlives the
   *  loadout position it was fired from. */
  abilityId: string;
  name: string;
  effect?: string;
}

export interface SaveIntentInput {
  ability: SaveIntentSource;
  /** Every action this ability was understood to have — the paired check the
   *  DV keys off is found among them, so a save handed in alone keys nothing. */
  actions: readonly AbilityAction[];
  /** The page's declared steps, when it declared any. */
  steps?: readonly EffectStep[];
  /** Whether an `## Actions` block answered for this ability. A declared DV is
   *  only preferred over a keyed one when the page actually declared. */
  declared: boolean;
  /** The caster's Roll Axis stats, or null when no character is in scope —
   *  then nothing keys and the ability's printed DC stands. */
  axisStats: RollAxisStats | null;
  casterCharacterId?: string;
}

export interface SaveIntentChip {
  /** The DV that actually applies, or undefined when neither the page nor the
   *  keying could produce one. */
  dv?: number;
  /** The number came off the page rather than off the attacker's check. */
  fromPage: boolean;
  /** What the button says. */
  label: string;
  /** Why it says that — the keying breakdown, or which page declared it. */
  title: string;
  intent: VttTargetRollIntent;
}

/**
 * The request one declared save turns into, and the words the button wears.
 *
 * `save` must be one of `actions`: the attacker-keyed DV is 21 plus the paired
 * CHECK this ability rolls, and that check is a sibling action, not something
 * the save carries.
 */
export function saveIntentChip(save: AbilityAction, input: SaveIntentInput): SaveIntentChip {
  // Attacker-keyed DV (21 + this character's paired check mod), which replaces
  // a PRINTED number the prose carries — it rides the request so the target's
  // roll prompt shows the DV that actually applies.
  const keyed = input.axisStats ? abilitySaveDv(save, input.actions, input.axisStats) : null;
  // A page that wrote its own DV in a block meant it; everything else keys. An
  // undeclared ability has no declared DV to prefer, so it reads exactly as it
  // did before declared DVs existed.
  const { dv, fromPage } = saveChipDv(save, keyed, input.declared);
  const label = dv != null ? `${savePlainLabel(save)} · DV ${dv}` : save.label;
  return {
    ...(dv != null ? { dv } : {}),
    fromPage,
    label,
    title: fromPage
      ? ` · DV ${dv} declared on this ability's page`
      : keyed
        ? ` · ${saveDvBreakdown(keyed)}`
        : "",
    intent: {
      abilityId: input.ability.abilityId,
      abilityName: input.ability.name,
      effect: input.ability.effect,
      // Omitted, not sent empty. An ability with no block has to reach the
      // ledger as the identical request it always did — an extra `steps: []`
      // riding along is a second way for the undeclared corpus to behave
      // differently.
      ...(input.steps?.length ? { steps: input.steps } : {}),
      sourceCharacterId: input.casterCharacterId,
      label,
      stat: save.stat,
      ...(save.rollAxis ? { rollAxis: { path: save.rollAxis.path, direction: save.rollAxis.direction } } : {}),
      dc: dv ?? save.dc,
    },
  };
}
