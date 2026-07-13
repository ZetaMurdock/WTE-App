// EncounterSystem: orchestrates the per-round scene reaction. When the encounter
// round advances (driven by the React Encounter panel via engine.setTimeline), it
// runs the TimelineSystem (expire timed effects) then the SimulationSystem (zone
// statuses). Returns whether the scene changed so the engine can redraw + persist.
import type { VttSceneData } from "../../types/scene";
import { TimelineSystem } from "./TimelineSystem";
import { SimulationSystem } from "./SimulationSystem";

export class EncounterSystem {
  constructor(
    private timeline: TimelineSystem,
    private sim: SimulationSystem
  ) {}

  onRound(data: VttSceneData, round: number, gridSize: number): boolean {
    const removed = this.timeline.expire(data, round);
    const simChanged = this.sim.tick(data, gridSize);
    return removed.length > 0 || simChanged;
  }
}
