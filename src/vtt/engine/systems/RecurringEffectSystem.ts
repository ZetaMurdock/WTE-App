// RecurringEffectSystem: effects that keep happening.
//
// `Each round: Save: Physical Save — Recovery, DV 18` is a resolution that
// repeats. The one-shot version of that sentence has had a home since P0 — the
// Resolution Card, where a validated roll becomes an applied consequence and a
// human confirms every write. The recurring version must land in exactly the
// same place, and this system exists to make sure it cannot land anywhere else.
//
// So NOTHING here writes. It has no vitals writer, no engine reference and no
// way to reach a token: it reads the scene, works out who is standing in what
// this round, and returns PROPOSALS. The caller opens a card per proposal, the
// Curator rules, and the damage lands through `adjudicateTokenVitals` like every
// other adjudicated number in the app. A system that applied 3d10 by itself
// would be the engine taking the Curator's chair, and it would take it once per
// round for as long as the field burned.
//
// The three boundaries the test file holds:
//
//   NOT A ROUND EARLY. An effect born on round B proposes nothing for B. The
//   round hook fires on a round CHANGE, so by the time it could see B the round
//   is over; charging for it would bill the table for a round that had ended
//   before the fire existed.
//
//   EXACTLY N ROUNDS. Born on B with `rounds: N`, it proposes on B+1 … B+N —
//   N rounds of burning, the number the page wrote. That is why EncounterSystem
//   runs this pass BEFORE TimelineSystem.expire: expiry removes an effect at
//   `round >= bornRound + rounds`, so a pass that ran after it would silently
//   drop the last round of every zone the corpus declares, every time.
//
//   NEVER TWICE FOR ONE ROUND. `tickedRound` is stamped on the effect the first
//   time a round produces anything, and the same round number produces nothing
//   after that. The hook is reachable from a re-render, a peer echo and a
//   Curator stepping the round back and forward, and none of those is a second
//   round of standing in the fire.
//
// Membership is `effectOccupants.tokenInEffect` — the footprint test, the same
// one the zone-status pass uses. Two different answers to "who is in the fire"
// is how a token ends up Burning without taking the burn.
import type { VttGrid, VttEffectTick, VttSceneData, VttToken } from "../../types/scene";
import { tokenInEffect } from "./effectOccupants";
import { effectSuspended } from "./effectSuspension";

/** One round of one effect landing on one token, for the Curator to rule on. */
export interface RecurringProposal {
  /** Stable by construction: effect + token + round is exactly one proposal, so
   *  a caller can key a card without inventing an id, and a duplicate delivery
   *  lands on the card that already exists instead of beside it. */
  id: string;
  effectId: string;
  tokenId: string;
  tokenName: string;
  round: number;
  /** The recurring save that gates the round, when the page declared one. With
   *  no gate the ticks are unconditional and the card carries no roll. */
  gate: VttEffectTick | null;
  /** Every recurring line, gate included, in the page's declared order. */
  ticks: VttEffectTick[];
  sourceAbilityId?: string;
  sourceAbilityName?: string;
  casterCharacterId?: string;
}

/**
 * Ceiling on the proposals one round may produce.
 *
 * A wide field over a crowded corridor is a real scene and the cap is generous
 * enough never to meet it. What it stops is the pathological one: a scripted or
 * imported map where a template covers hundreds of tokens and every round buries
 * the Curator in cards they can neither read nor clear. Truncating is visibly
 * wrong; an unbounded queue is invisibly wrong.
 */
export const MAX_ROUND_PROPOSALS = 200;

/**
 * Is this token subject to an effect's per-round lines?
 *
 * Props are excluded. A prop is scenery that happens to ride the token pipeline
 * — a crate, a tree, a ruin — and proposing a Physical Save for a crate is a
 * card the Curator has to dismiss every single round for no reason. Whether the
 * crate burns is a ruling, and a ruling is theirs to make out loud.
 *
 * Hidden tokens are NOT excluded. `visible: false` conceals an actor from the
 * players' view; it does not move them out of the fire, and a field that stopped
 * burning whatever the Curator had hidden would make concealment a defence the
 * setting never granted.
 */
export function tickableToken(token: VttToken): boolean {
  return !token.prop;
}

export class RecurringEffectSystem {
  /**
   * What this round costs the tokens standing in recurring effects.
   *
   * Stamps `tickedRound` on every effect it visits, so the guard lives beside
   * the effect and rides the scene — a snapshot restored mid-encounter cannot be
   * charged a second time for the round it was saved on.
   *
   * `gridSize` overrides the scene's own, matching the contract every other
   * system on this hook already has; the footprint maths needs the rest of the
   * grid record, which comes from the scene.
   */
  propose(data: VttSceneData, round: number, gridSize: number): RecurringProposal[] {
    const proposals: RecurringProposal[] = [];
    const grid: VttGrid = { ...data.grid, size: gridSize };
    for (const effect of data.effects) {
      const ticks = effect.data.ticks;
      if (!ticks?.length) continue;
      // Two guards, two different bugs, so they stay two lines. The first says a
      // template has not survived a round yet; the second says this round has
      // already been paid for.
      if (round <= (effect.data.bornRound ?? 0)) continue;
      if (effect.data.tickedRound === round) continue;
      // BEFORE the stamp below, deliberately: a suspended field that marked the
      // rounds it slept through as paid would skip its first round back.
      if (effectSuspended(effect, round)) continue;
      effect.data.tickedRound = round;
      const gate = ticks.find((tick) => tick.kind === "save") ?? null;
      for (const token of data.tokens) {
        if (!tickableToken(token) || !tokenInEffect(effect, grid, token)) continue;
        // Stop at the cap rather than trimming afterwards: the tokens that make
        // the cut are the ones in scene order, which is the order the Curator's
        // own token list is in, so a truncated round is at least legible.
        if (proposals.length >= MAX_ROUND_PROPOSALS) return proposals;
        proposals.push({
          id: `rt-${effect.id}-${token.id}-${round}`,
          effectId: effect.id,
          tokenId: token.id,
          tokenName: token.name,
          round,
          gate,
          ticks,
          sourceAbilityId: effect.data.sourceAbilityId,
          sourceAbilityName: effect.data.sourceAbilityName,
          casterCharacterId: effect.data.casterCharacterId,
        });
      }
    }
    return proposals;
  }
}
