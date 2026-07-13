// TimelineSystem: the round clock's effect on timed effects. On round advance it
// expires effects whose lifetime has elapsed (bornRound + rounds <= round).
import type { VttSceneData } from "../../types/scene";

export class TimelineSystem {
  /** Remove effects that have outlived their `rounds`. Returns removed ids. */
  expire(data: VttSceneData, round: number): string[] {
    const removed: string[] = [];
    data.effects = data.effects.filter((e) => {
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
