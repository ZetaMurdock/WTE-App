// EncounterSystem: orchestrates the per-round scene reaction. When the encounter
// round advances (driven by the React Encounter panel via engine.setTimeline), it
// reanchors auras, proposes the round's recurring ticks, runs the TimelineSystem
// (expire timed effects), the ConditionClockSystem (run out condition durations),
// then the SimulationSystem (zone statuses). Returns whether the scene changed so
// the engine can redraw + persist.
import type { VttSceneData } from "../../types/scene";
import { TimelineSystem } from "./TimelineSystem";
import { SimulationSystem } from "./SimulationSystem";
import { ConditionClockSystem, type ConditionVitalsWriter } from "./ConditionClockSystem";
import { RecurringEffectSystem, type RecurringProposal } from "./RecurringEffectSystem";
import { dropOrphanAuras, reanchorAuras } from "./AuraSystem";

/** Hands the round's recurring proposals to whoever opens Resolution Cards.
 *  Nothing in this system applies one — see RecurringEffectSystem's header. */
export type RecurringProposalSink = (proposals: RecurringProposal[]) => void;

export class EncounterSystem {
  constructor(
    private timeline: TimelineSystem,
    private sim: SimulationSystem,
    private conditions: ConditionClockSystem,
    private recurring: RecurringEffectSystem = new RecurringEffectSystem()
  ) {}

  /** `write` commits a token's statuses through the Curator's authorised path;
   *  the condition clocks have no other way to reach a body. `propose` receives
   *  what the round costs the tokens standing in recurring effects — proposals
   *  only, for the Curator to rule on. */
  onRound(
    data: VttSceneData,
    round: number,
    gridSize: number,
    write: ConditionVitalsWriter,
    propose?: RecurringProposalSink
  ): boolean {
    // Auras first, and orphans before that. Everything below asks WHERE an
    // effect is; a 15-ft aura still sitting on the square its caster left two
    // rounds ago would enumerate the wrong tokens for the tick, the zone status
    // and the expiry alike — one stale coordinate, three wrong answers.
    const orphaned = dropOrphanAuras(data);
    const moved = reanchorAuras(data);
    // BEFORE expiry, deliberately. Expiry removes an effect at
    // `bornRound + rounds`, so a recurring pass that ran after it would drop the
    // last round of every zone the corpus ever declared — a 2-round field would
    // burn once. See RecurringEffectSystem's "EXACTLY N ROUNDS".
    const proposals = this.recurring.propose(data, round, gridSize);
    if (proposals.length && propose) propose(proposals);
    const removed = this.timeline.expire(data, round);
    // Conditions run out BEFORE the zone pass on purpose: a token still standing
    // in the fire has its tag put straight back by the sim, because a status you
    // are currently inside of is the zone's to own, not the clock's.
    const expired = this.conditions.expire(data, round, write);
    const simChanged = this.sim.tick(data, gridSize, write);
    // The sim may have cleared a zone status a clock was still counting; pruning
    // last means no clock survives the tag it was watching.
    const pruned = this.conditions.prune(data);
    // A `tickedRound` stamp on an effect nobody was standing in is not reported
    // as a change: it guards a repeat of a round that proposed nothing, so a
    // redraw and a scene write would be spent on a number no reader can see.
    return (
      orphaned.length > 0 ||
      moved.length > 0 ||
      proposals.length > 0 ||
      removed.length > 0 ||
      expired.length > 0 ||
      simChanged ||
      pruned
    );
  }
}
