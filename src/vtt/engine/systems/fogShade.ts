// Pure fog shading math — what alpha the fog rect over a cell gets, per mode.
// Kept Pixi-free so the three darkness levels are unit-testable.
import type { VttFogMode } from "../../types/scene";

export const DEFAULT_DECAY_SECONDS = 90;

export interface FogCell {
  mode: VttFogMode;
  /** Cell is in the CURRENT visible set. */
  visible: boolean;
  /** Cell has been explored at some point (fog.revealed). */
  explored: boolean;
  /** realistic: when this cell was last seen (epoch ms). */
  seenAt?: number;
  now?: number;
  decaySeconds?: number;
  /** Players get opaque unseen fog; the Curator keeps a translucent overlay. */
  playerView: boolean;
}

/** Alpha of the fog overlay for one cell — 0 fully clear, 1 pitch black. */
export function fogCellAlpha(c: FogCell): number {
  if (c.visible) return 0;
  const unseen = c.playerView ? 1 : 0.9;
  const explored = c.playerView ? 0.72 : 0.55;
  switch (c.mode) {
    case "pitch":
      // No memory: the moment you leave, it's as black as the unexplored void.
      return unseen;
    case "remembered":
      return c.explored ? explored : unseen;
    case "realistic": {
      if (!c.explored || c.seenAt == null) return unseen;
      const decay = Math.max(1, c.decaySeconds ?? DEFAULT_DECAY_SECONDS);
      const age = Math.max(0, ((c.now ?? Date.now()) - c.seenAt) / 1000);
      const f = Math.min(1, age / decay);
      // Freshly-left cells read like memory; old memories sink back to the dark.
      return explored + (unseen - explored) * f;
    }
  }
}
