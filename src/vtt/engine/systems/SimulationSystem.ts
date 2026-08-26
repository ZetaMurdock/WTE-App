// SimulationSystem: per-round scene simulation. Ports the legacy zone-enter
// behaviour — tokens standing inside a status-bearing effect gain that status;
// tokens that leave lose it. Manually-set statuses (not owned by any effect) are
// left untouched.
//
// "Inside" is `effectOccupants`, so EVERY shape counts, not only the rectangular
// `zone` kind. The old membership test was `EffectLayer.zoneContains`, which
// returned false for any other kind outright: a declared `In zone: Condition:
// Slowed` under a circular aura enumerated nobody, forever, and the tag simply
// never landed. Rectangular zones are unaffected — `effectBodyContains`'s zone
// branch is the same rectangle test, point for point (proved in the test file).
import type { VttEffect, VttGrid, VttSceneData } from "../../types/scene";
import { tokenInEffect } from "./effectOccupants";
import type { ConditionVitalsWriter } from "./ConditionClockSystem";

/** A status-bearing effect owns its tag: standing in it grants, leaving revokes. */
function statusOf(effect: VttEffect): string | null {
  const status = effect.data.status;
  return typeof status === "string" && status ? status : null;
}

export class SimulationSystem {
  /**
   * Reconcile effect-applied statuses on all tokens. Returns true if changed.
   *
   * `write` is the Curator's authorised path, the same one the condition clocks
   * use. Assigning `token.statuses` here instead would emit no `token.update`,
   * and the round tick only calls `onChanged()` — which persists and redraws but
   * never broadcasts. Every pip a field granted would then be Curator-local
   * until some unrelated full snapshot happened to go out, so players would
   * stand in a fire nobody at their table could see. Harmless while this only
   * covered hand-drawn rectangles; auras re-anchor every round, so the tags now
   * churn every round.
   */
  tick(data: VttSceneData, gridSize: number, write: ConditionVitalsWriter): boolean {
    const zones = data.effects.filter((e) => statusOf(e));
    const zoneStatuses = new Set(zones.map((z) => statusOf(z) as string));
    if (zoneStatuses.size === 0) return false;

    // The caller's gridSize wins over the scene's own, which is the contract the
    // signature already had; footprint maths needs the rest of the grid record.
    const grid: VttGrid = { ...data.grid, size: gridSize };
    let changed = false;
    for (const t of data.tokens) {
      const inside = new Set<string>();
      for (const z of zones) {
        if (tokenInEffect(z, grid, t)) inside.add(statusOf(z) as string);
      }
      const cur = t.statuses ?? [];
      // keep manual statuses + zone statuses the token is currently inside
      const next = cur.filter((s) => !zoneStatuses.has(s) || inside.has(s));
      for (const s of inside) if (!next.includes(s)) next.push(s);
      if (next.length !== cur.length || next.some((s, i) => s !== cur[i])) {
        // A refused write leaves the token as it was rather than desyncing the
        // pip from the body it is drawn on.
        if (write(t.id, next)) changed = true;
      }
    }
    return changed;
  }
}
