// SimulationSystem: per-round scene simulation. Ports the legacy zone-enter
// behaviour — tokens standing inside a zone effect gain that zone's status;
// tokens that leave lose it. Manually-set statuses (not owned by any zone) are
// left untouched.
import type { VttSceneData } from "../../types/scene";
import { EffectLayer } from "../layers/EffectLayer";

export class SimulationSystem {
  /** Reconcile zone-applied statuses on all tokens. Returns true if changed. */
  tick(data: VttSceneData, gridSize: number): boolean {
    const zones = data.effects.filter((e) => e.kind === "zone" && e.data.status);
    const zoneStatuses = new Set(zones.map((z) => z.data.status as string));
    if (zoneStatuses.size === 0) return false;

    let changed = false;
    for (const t of data.tokens) {
      const inside = new Set<string>();
      for (const z of zones) {
        if (EffectLayer.zoneContains(z, gridSize, t.x, t.y)) inside.add(z.data.status as string);
      }
      const cur = t.statuses ?? [];
      // keep manual statuses + zone statuses the token is currently inside
      const next = cur.filter((s) => !zoneStatuses.has(s) || inside.has(s));
      for (const s of inside) if (!next.includes(s)) next.push(s);
      if (next.length !== cur.length || next.some((s, i) => s !== cur[i])) {
        t.statuses = next;
        changed = true;
      }
    }
    return changed;
  }
}
