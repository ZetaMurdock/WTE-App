// TimelineSystem: the round clock's effect on timed effects. On round advance it
// expires effects whose lifetime has elapsed (bornRound + rounds <= round).
import type { VttSceneData } from "../../types/scene";
import { effectSuspended } from "./effectSuspension";

export class TimelineSystem {
  /** Remove effects that have outlived their `rounds`. Returns removed ids. */
  expire(data: VttSceneData, round: number): string[] {
    const removed: string[] = [];
    data.effects = data.effects.filter((e) => {
      // A suspended effect does not age. Expiring one would make `Tamper: delay`
      // a slower `end` for any field delayed past its own lifetime — the one
      // reading the verb cannot mean. See effectSuspension.ts.
      if (effectSuspended(e, round)) return true;
      const life = e.data.rounds ?? 0;
      if (life <= 0) return true; // permanent
      const born = e.data.bornRound ?? 0;
      if (round >= born + life) {
        removed.push(e.id);
        return false;
      }
      return true;
    });
    return removed;
  }
}
