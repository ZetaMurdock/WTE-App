// EffectSystem: factory + defaults for AoE / zone effects. CRUD lives on the
// engine (so it can emit sync ops); this owns the per-kind default shape.
import { newId, type VttEffect, type VttEffectKind } from "../../types/scene";

const EFFECT_COLOR = "#837aae";

export class EffectSystem {
  create(kind: VttEffectKind, x: number, y: number, round: number): VttEffect {
    const e: VttEffect = { id: newId("fx"), kind, x, y, data: { color: EFFECT_COLOR, bornRound: round } };
    if (kind === "circle") e.data.radius = 3;
    else if (kind === "cone") {
      e.data.radius = 4;
      e.data.angle = 60;
      e.data.dir = 0;
    } else {
      e.data.w = 4;
      e.data.h = 4;
    }
    return e;
  }
}
