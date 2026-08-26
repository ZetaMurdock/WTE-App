// What an `Each round:` line becomes once its template is on the map.
//
// `zoneTemplate` translates the `Zone:` step — the shape, the size, the anchor,
// the in-zone status. This module translates the OTHER half of the cadence
// grammar: the lines that fire again every round for as long as the template
// lasts. The two are separate because they have different lifetimes. A template
// is placed once and the placer forgets it; a recurring line has to survive
// inside the placed effect, be saved with the scene and be sent to every peer,
// long after the ability that declared it is out of scope.
//
// Which is why `VttEffectTick` is flat. `EffectStep` carries parsed roll refs,
// typed durations and selectors — structure the app reads, not structure a scene
// snapshot should be carrying to a peer that may be running a different build.
// A tick is the residue: what to roll, against what number, and what a verdict
// costs.
//
// The third cadence needs nothing here at all. `In zone:` is a STATE, not an
// event — the SimulationSystem has put a status on whoever is standing inside an
// effect and taken it off when they leave since slice 12, and `zoneTemplate`
// already routes in-zone conditions into that field. Re-firing them per round
// would be a second answer to a question the engine had already answered.
import type { EffectStep } from "../../game/abilityEffects";
import { effectStepLabel, parseAbilityEffects } from "../../game/abilityEffects";
import type { VttEffectTick } from "../types/scene";

/**
 * The recurring lines of a declared block, flattened for the wire.
 *
 * Order is the page's order, and it is load-bearing: the first `save` tick is
 * the GATE for the round, and every tick after it hangs off that save's verdict
 * through its own `on`. That is the same shape a one-shot resolution has — one
 * roll, several consequences — so a recurring round resolves through the
 * identical Resolution Card path rather than growing a second way to adjudicate.
 *
 * A step aimed at the caster (`who: "self"`) is dropped, for the reason
 * `consequencesFromSteps` drops it: the card speaks for the token standing in
 * the zone, and the upkeep its caster pays is not that token's to pay. Absolute
 * Zero is `Sustained up to 3 rounds` — the Scientist's per-round price and the
 * 3d10 the field deals are different bullets, and only one of them belongs on
 * the card bound to whoever is freezing.
 */
export function recurringTicks(steps: readonly EffectStep[]): VttEffectTick[] {
  const ticks: VttEffectTick[] = [];
  steps.forEach((step, i) => {
    if (step.cadence !== "each-round") return;
    if (step.who === "self") return;
    // Min and tie arm nothing anywhere else in the engine either — see
    // `consequencesFromSteps`. Treating them as failures would charge a round of
    // damage the page never promised, once per round, unattended.
    if (step.branch === "min" || step.branch === "tie") return;
    const on: VttEffectTick["on"] =
      step.branch === "always" ? "always" : step.branch === "success" ? "pass" : "fail";
    const label = effectStepLabel(step);
    if (step.verb === "save" && step.ref) {
      ticks.push({
        id: `tick-${i}`,
        kind: "save",
        label,
        // The gate is not a consequence and hangs off no verdict; it PRODUCES
        // one. `always` is the only honest value here.
        on: "always",
        // A `keyed` DV defers to the attacker-keyed number the save chips
        // compute, and a placed template has no attacker in scope any more. So
        // it carries no DV at all and the verdict stays the Curator's to declare
        // — which is what a deferred DV always meant — rather than the engine
        // inventing a number to compare against.
        ...(step.dv?.kind === "fixed" ? { dv: step.dv.value } : {}),
        path: step.ref.path,
        direction: step.ref.direction,
      });
      return;
    }
    if (step.verb === "damage" && step.expr) {
      ticks.push({
        id: `tick-${i}`,
        kind: "damage",
        label,
        on,
        expr: step.expr,
        ...(step.damageType ? { damageType: step.damageType } : {}),
        ...(step.half ? { half: true } : {}),
      });
      return;
    }
    if (step.verb === "heal" && step.expr) {
      ticks.push({ id: `tick-${i}`, kind: "heal", label, on, expr: step.expr });
      return;
    }
    if (step.verb === "condition" && step.condition) {
      ticks.push({
        id: `tick-${i}`,
        kind: "condition",
        label,
        on,
        condition: step.condition,
        ...(step.duration?.kind === "rounds" ? { rounds: step.duration.count } : {}),
      });
      return;
    }
    if (step.verb === "ruling" && step.prompt) {
      ticks.push({ id: `tick-${i}`, kind: "ruling", label: step.prompt, on, prompt: step.prompt });
    }
  });
  return ticks;
}

/** The tick that gates a round, when the block declared a recurring save. The
 *  FIRST one: a block with two recurring saves is asking for two resolutions,
 *  and the card resolves one — reporting that is `cadenceExtraSaves`'s job. */
export function cadenceGate(ticks: readonly VttEffectTick[]): VttEffectTick | null {
  return ticks.find((tick) => tick.kind === "save") ?? null;
}

/** Recurring saves beyond the gate. A caller that cannot resolve them has to be
 *  able to SAY so, rather than let a page quietly do less than it declared. */
export function cadenceExtraSaves(ticks: readonly VttEffectTick[]): VttEffectTick[] {
  return ticks.filter((tick) => tick.kind === "save").slice(1);
}

/** Does this block keep happening? A predicate over raw steps, for a caller
 *  holding steps rather than a page — the placement path holds the page and asks
 *  `declaredPlacement(...).ticks.length`, which is the same question answered
 *  from the flattened form it already needed. */
export function hasCadence(steps: readonly EffectStep[]): boolean {
  return steps.some((step) => step.cadence === "each-round");
}

/**
 * What the declared `Zone:` step anchors to.
 *
 * `self` is the aura: the placer binds the template to the caster's token and
 * it travels from then on. A page that named no anchor put a thing on the
 * ground, not on a body — which is why the default is `point` and not the more
 * convenient guess.
 *
 * Shape, size and lifetime are deliberately NOT read here. Those belong to the
 * AoE prompt, where the Curator re-aims and resizes before anything lands, and
 * a declared block must not quietly take that away. The anchor is different: it
 * is a mechanic, not a placement, and it is the page's to state.
 */
export function zoneAttachOf(steps: readonly EffectStep[]): "self" | "target" | "point" {
  return steps.find((step) => step.verb === "zone")?.attach ?? "point";
}

/**
 * The status an `In zone:` condition hands whoever is standing inside.
 *
 * ONE, because `VttEffectData.status` is one field and the SimulationSystem
 * reconciles by exact tag. A page declaring two in-zone conditions gets a
 * template that applies the first; `zoneExtraStatuses` reports the rest, so a
 * caller can say what it could not do rather than let the page quietly promise
 * more than the map delivers.
 */
export function zoneStatusOf(steps: readonly EffectStep[]): string | null {
  return inZoneConditions(steps)[0] ?? null;
}

/** In-zone conditions past the first — what one template cannot carry. */
export function zoneExtraStatuses(steps: readonly EffectStep[]): string[] {
  return inZoneConditions(steps).slice(1);
}

function inZoneConditions(steps: readonly EffectStep[]): string[] {
  const out: string[] = [];
  for (const step of steps) {
    if (step.cadence !== "in-zone" || step.verb !== "condition") continue;
    const tag = step.condition?.trim();
    if (tag) out.push(tag);
  }
  return out;
}

/**
 * Everything a declared block contributes to a template about to be placed.
 *
 * Derived in ONE place because there is more than one way to put a template on
 * the map — the prompt's self/selected/centre modes drop it immediately, and its
 * "click" mode arms the cursor and lands it on a later pointer event. Those two
 * paths used to read the page separately, and the second one did not read it at
 * all: a `Zone:` clicked onto the floor came down with no `Each round:` lines,
 * no `In zone:` tag and no provenance, so the most natural way to aim a field
 * was also the one that quietly placed an inert circle. One derivation, both
 * paths, no second answer.
 *
 * `extraStatuses` and `extraSaves` are what one template CANNOT carry — a second
 * in-zone tag, a second recurring save. They are returned rather than dropped so
 * the caller can say so out loud; a page that declared two saves is asking for
 * two resolutions, and silence would let it deliver one and look complete.
 */
export interface DeclaredPlacement {
  /** The `In zone:` tag, when the page declared one. */
  status: string | null;
  /** The `Each round:` lines, flattened for the wire. */
  ticks: VttEffectTick[];
  attach: "self" | "target" | "point";
  extraStatuses: string[];
  extraSaves: VttEffectTick[];
}

/** Read a page's `## Actions` block for what it says about a placed template.
 *  An ability with no block — which is the entire shipped corpus — yields the
 *  empty placement, so nothing about how it places changes. */
export function declaredPlacement(actions: string | null | undefined): DeclaredPlacement {
  if (!actions) return { status: null, ticks: [], attach: "point", extraStatuses: [], extraSaves: [] };
  const steps = parseAbilityEffects(actions).steps;
  const ticks = recurringTicks(steps);
  return {
    status: zoneStatusOf(steps),
    ticks,
    attach: zoneAttachOf(steps),
    extraStatuses: zoneExtraStatuses(steps),
    extraSaves: cadenceExtraSaves(ticks),
  };
}

/**
 * The token an `attach self` aura rides — the CASTER's, and nobody else's.
 *
 * The anchor the Curator aims at and the body the aura belongs to are different
 * questions, and conflating them was a live bug: placing on a selected token
 * bound the caster's own field to whatever was selected, which in a fight is
 * almost always their target. A page that says `attach self` named the caster.
 * With no caster token on the scene there is no body to ride, so the template
 * stays where it landed rather than being stapled to a stand-in.
 */
export function declaredAuraOwner(placement: DeclaredPlacement, casterTokenId: string | null): string | null {
  return placement.attach === "self" ? casterTokenId : null;
}
