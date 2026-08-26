// EncounterSystem: orchestrates the per-round scene reaction. When the encounter
// round advances (driven by the React Encounter panel via engine.setTimeline), it
// runs the TimelineSystem (expire timed effects), the ConditionClockSystem (run
// out condition durations), then the SimulationSystem (zone statuses). Returns
// whether the scene changed so the engine can redraw + persist.
import type { VttSceneData } from "../../types/scene";
import { TimelineSystem } from "./TimelineSystem";
import { SimulationSystem } from "./SimulationSystem";
import { ConditionClockSystem, type ConditionVitalsWriter } from "./ConditionClockSystem";

export class EncounterSystem {
  constructor(
    private timeline: TimelineSystem,
    private sim: SimulationSystem,
    private conditions: ConditionClockSystem
  ) {}

  /** `write` commits a token's statuses through the Curator's authorised path;
   *  the condition clocks have no other way to reach a body. */
  onRound(data: VttSceneData, round: number, gridSize: number, write: ConditionVitalsWriter): boolean {
    const removed = this.timeline.expire(data, round);
    // Conditions run out BEFORE the zone pass on purpose: a token still standing
    // in the fire has its tag put straight back by the sim, because a status you
    // are currently inside of is the zone's to own, not the clock's.
    const expired = this.conditions.expire(data, round, write);
    const simChanged = this.sim.tick(data, gridSize);
    // The sim may have cleared a zone status a clock was still counting; pruning
    // last means no clock survives the tag it was watching.
    const pruned = this.conditions.prune(data);
    return removed.length > 0 || expired.length > 0 || simChanged || pruned;
  }
}
