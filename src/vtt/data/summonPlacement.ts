// A declared `Summon:` step, turned into bodies standing on the map.
//
// This is the P3 zone path's sibling and is built the same way on purpose:
// `effectTicks.declaredPlacement` reads a page for what it says about a
// template, and this reads a page for what it says about the creatures it
// calls. Both are pure, both are derived once and handed to a Curator-facing
// prompt, and neither writes anything. The engine proposes; a human confirms.
//
// THE SCALE PROBLEM IS THE DESIGN PROBLEM. Minion Conjuration conjures 100
// Lesser Stygian Minions in one act, so every step here is written for a
// hundred bodies rather than for one repeated a hundred times:
//
//   PLACEMENT. `nearestFreeCell` re-scans every token in the scene for every
//   candidate cell, which is exactly right for one spawn and quadratic for a
//   swarm: the 100th minion would walk a growing token list once per cell it
//   rejects. `packSummonCells` walks the same deterministic expanding rings
//   against an occupancy SET it updates as it reserves, so the batch costs one
//   pass. The test file holds it to `canOccupy`'s answer body by body — a
//   faster packer that disagreed with the engine's own occupancy rule would
//   put minions inside walls of tokens.
//
//   THE WIRE. `vttSnapshotFits` stringifies the entire scene. Asking it 100
//   times, once per token, is 100 serialisations of a scene that is growing as
//   you go. The plan is measured ONCE, whole, before anything is placed.
//
//   THE COUNT. A map with room for 63 more bodies cannot hold 100, and there
//   are only two honest answers: refuse, or say so before the Curator commits.
//   Silently placing 63 and reporting success is the one answer that is a lie,
//   so `summonPlan` reports `placed` against `requested` and the prompt shows
//   the shortfall while it is still cancellable.
//
//   THE REGISTRY. `tokenRegistry` gives each linked CHARACTER exactly one live
//   token, and 100 bodies of one creature would be 100 duplicates if they went
//   through it. They do not: a summon is a creature token — `actorKind:
//   "creature"`, no `characterId` — and the registry only ever considers tokens
//   that carry a character link. The test file holds that boundary, because a
//   swarm that started registering profiles would make its own caster's token
//   ambiguous and freeze every later transfer.
import type { EffectStep } from "../../game/abilityEffects";
import { parseAbilityEffects } from "../../game/abilityEffects";
import type { VttGrid, VttScene, VttSummonOrigin, VttToken } from "../types/scene";
import { tokenBlocksMovement, tokenFootprint } from "./occupancy";
import { creatureToTokenSpec } from "./actorSpawn";
import { vttSnapshotFits } from "../sync/wireBudget";
import { resolveSummon, type SummonResolution, type SummonRoster } from "./summonRoster";

/**
 * Ceiling on the bodies one confirmed step may place.
 *
 * Minion Conjuration's 100 is the largest summon the shipped corpus declares,
 * and this is five times that. The grammar accepts a four-digit count, so the
 * thing this stops is not a big scene but a typo — `Summon: 1000 Lesser
 * Stygian` for 100 — which would otherwise spend a minute packing cells and
 * leave a map nobody can play on. A refusal that names the cap is recoverable;
 * a table that has to delete 1000 tokens by hand is not.
 */
export const MAX_SUMMON_BATCH = 500;

/** One `Summon:` bullet, as the page declared it. */
export interface DeclaredSummon {
  /** Stable within its block, so a prompt can key a row without inventing one. */
  id: string;
  /** The page's word for the creature, verbatim. */
  name: string;
  count: number;
  /** Which verdict arms it, matching `OutcomeConsequence.on`. A summon on the
   *  `fail` branch is the target's failure calling something up. */
  on: "always" | "fail" | "pass";
}

/**
 * The `Summon:` bullets of a declared block.
 *
 * `min` and `tie` are dropped for the reason `consequencesFromSteps` and
 * `recurringTicks` drop them: no phase of the engine executes those branches,
 * and treating them as failures would put bodies on the map the page never
 * promised.
 *
 * A summon's default selector is `self` — the caster calls it — so unlike a
 * consequence it is NOT filtered by `who`. Nothing lands on a target here; a
 * creature arrives beside the person who called it.
 */
export function declaredSummons(steps: readonly EffectStep[]): DeclaredSummon[] {
  const out: DeclaredSummon[] = [];
  steps.forEach((step, i) => {
    if (step.verb !== "summon" || !step.summon) return;
    if (step.branch === "min" || step.branch === "tie") return;
    // `At 8: Summon: 100 Lesser Stygian` is armed by a TRACK reaching 8, not by
    // the ability that moves the track resolving. `consequencesFromSteps` skips
    // the same cadence at the same place for the same reason, and it shipped
    // here without the guard: a page pairing `Counter: Blight +1` with an
    // `At 8:` summon put all hundred bodies on the map the instant the ability
    // was used, before the first point of Blight existed. Nothing carries a
    // summon down to a crossing yet — `counterOutcome` derives consequences,
    // and a summon is not one — so placing none is the only honest answer;
    // placing them early is a promise the page did not make.
    if (step.cadence === "at-threshold") return;
    out.push({
      id: `sum-${i}`,
      name: step.summon,
      count: Math.max(1, Math.floor(step.count ?? 1)),
      on: step.branch === "always" ? "always" : step.branch === "success" ? "pass" : "fail",
    });
  });
  return out;
}

/** Read a page's `## Actions` block for the creatures it calls.
 *
 *  Eighteen shipped abilities DO carry a declared block (genus.json and
 *  ciphers.json, since P1) — the corpus is not blockless and a comment saying
 *  so would be wrong. What is true is narrower and is the invariant the test
 *  file holds over the real data: not one of those blocks declares a `Summon:`,
 *  so every shipped ability reaches the panel with no summon prompt attached,
 *  exactly as it did before this module existed. */
export function pageSummons(actions: string | null | undefined): DeclaredSummon[] {
  if (!actions) return [];
  return declaredSummons(parseAbilityEffects(actions).steps);
}

const cellKey = (col: number, row: number): string => `${col},${row}`;

/**
 * Pack `count` bodies of one size into the free cells nearest an anchor.
 *
 * Deterministic expanding Chebyshev rings, tie-broken by squared distance then
 * row then column — the same order `nearestFreeCell` searches in, so a swarm
 * grows outward the way a single spawn steps aside. Returns as many positions
 * as the map can hold, which may be fewer than asked; deciding what to do about
 * a shortfall belongs to the Curator, not to a packer.
 */
export function packSummonCells(
  grid: VttGrid,
  tokens: readonly VttToken[],
  anchor: { x: number; y: number },
  size: number,
  count: number
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return out;
  if (grid.size <= 0 || grid.cols <= 0 || grid.rows <= 0 || count <= 0) return out;
  const span = Math.max(1, Math.ceil(size));

  const taken = new Set<string>();
  for (const token of tokens) {
    if (!tokenBlocksMovement(token)) continue;
    for (const cell of tokenFootprint(grid, token)) taken.add(cellKey(cell.col, cell.row));
  }

  const startCol = Math.max(0, Math.min(grid.cols - 1, Math.floor(anchor.x / grid.size)));
  const startRow = Math.max(0, Math.min(grid.rows - 1, Math.floor(anchor.y / grid.size)));
  const maxRing = Math.max(grid.cols, grid.rows);

  for (let ring = 0; ring <= maxRing && out.length < count; ring++) {
    const candidates: { col: number; row: number }[] = [];
    for (let row = startRow - ring; row <= startRow + ring; row++) {
      for (let col = startCol - ring; col <= startCol + ring; col++) {
        if (Math.max(Math.abs(col - startCol), Math.abs(row - startRow)) !== ring) continue;
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
        candidates.push({ col, row });
      }
    }
    candidates.sort((a, b) => {
      const ad = (a.col - startCol) ** 2 + (a.row - startRow) ** 2;
      const bd = (b.col - startCol) ** 2 + (b.row - startRow) ** 2;
      return ad - bd || a.row - b.row || a.col - b.col;
    });
    for (const cell of candidates) {
      if (out.length >= count) break;
      // The footprint a body of this size would claim, anchored the way
      // `tokenFootprint` anchors one — not the single cell we are standing on.
      const x = (cell.col + 0.5) * grid.size;
      const y = (cell.row + 0.5) * grid.size;
      const claim = tokenFootprint(grid, { x, y, size: span });
      if (!claim.length) continue;
      if (claim.some((c) => c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows)) continue;
      if (claim.some((c) => taken.has(cellKey(c.col, c.row)))) continue;
      for (const c of claim) taken.add(cellKey(c.col, c.row));
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * How many cells across one summoned body stands.
 *
 * Exported because the PREVIEW and the PLAN must agree: the prompt tells the
 * Curator the map has room for 63, and if it measured size-1 bodies while the
 * plan placed size-2 ones, the number they confirmed against was never real.
 * One answer, asked twice.
 */
export function summonBodySize(resolution: SummonResolution): number {
  const declared = resolution.status === "resolved" ? resolution.profile.spawn.size : 1;
  return Math.max(1, Math.min(6, Math.floor(Number(declared) || 1)));
}

export interface SummonPlanInput {
  summon: DeclaredSummon;
  resolution: SummonResolution;
  scene: VttScene;
  /** Where the bodies gather — the caster's token, or wherever the Curator aimed. */
  anchor: { x: number; y: number };
  origin: Omit<VttSummonOrigin, "batchId" | "name">;
  batchId: string;
  /** Token ids, supplied by the caller so this module stays pure. Must be at
   *  least as long as the bodies actually placed; a short list truncates the
   *  batch rather than minting a duplicate id. */
  tokenIds: readonly string[];
}

export type SummonPlan =
  | {
      ok: true;
      tokens: VttToken[];
      requested: number;
      placed: number;
      /** Requested minus placed — how many the map had no room for. Zero on a
       *  plan that fits, and the number the prompt puts in front of the Curator
       *  when it does not. */
      shortfall: number;
      /** The bodies carry no statline because nothing was named for them. */
      unstatted: boolean;
    }
  | {
      ok: false;
      reason: "over-cap" | "no-room" | "too-large-for-wire" | "ambiguous-statline";
      requested: number;
      detail: string;
    };

/**
 * Everything one confirmed `Summon:` step would put on the map, or why it cannot.
 *
 * Nothing is mutated: the caller receives token records and commits them
 * through the engine, exactly as the Resolution Card receives numbers and
 * commits them through `adjudicateTokenVitals`. A planner that pushed straight
 * into `scene.data.tokens` would be the engine spawning without being asked.
 */
export function summonPlan(input: SummonPlanInput): SummonPlan {
  const { summon, resolution, scene, anchor, origin, batchId, tokenIds } = input;
  const requested = Math.max(1, Math.floor(summon.count));
  if (requested > MAX_SUMMON_BATCH) {
    return {
      ok: false,
      reason: "over-cap",
      requested,
      detail: `${summon.name} declares ${requested} bodies; this table places at most ${MAX_SUMMON_BATCH} in one act.`,
    };
  }
  // An ambiguous name is a refusal and not a shortfall: placing bodies whose
  // statline the engine had to guess between is worse than placing none, and
  // the fix — rename one of the two entries — is the table's to make.
  if (resolution.status === "ambiguous") {
    return {
      ok: false,
      reason: "ambiguous-statline",
      requested,
      detail: `Two entries are named “${resolution.name}”; rename one so these bodies have one statline.`,
    };
  }

  const unstatted = resolution.status === "unstatted";
  // An unstatted body is a NAMED MARKER and nothing else: no hp, no hpMax, no
  // stats. Inventing 1 HP, or reading the 75 HP that Kirkndomou's prose gives,
  // would compile a rule into this file that no page could correct.
  const spec: Partial<VttToken> = unstatted
    ? { name: summon.name, actorKind: "creature", color: "#5c6470", size: 1 }
    : creatureToTokenSpec(resolution.profile.spawn);
  // The page's word for the creature is what the Curator recognises on the map,
  // even when the statline it resolved to is spelled differently.
  spec.name = summon.name;
  const size = summonBodySize(resolution);

  const points = packSummonCells(scene.data.grid, scene.data.tokens, anchor, size, requested);
  if (points.length === 0) {
    return {
      ok: false,
      reason: "no-room",
      requested,
      detail: `There is no open space near the caster for ${summon.name}.`,
    };
  }
  const placed = Math.min(points.length, tokenIds.length);
  const summonMeta: VttSummonOrigin = { ...origin, batchId, name: summon.name };
  const tokens: VttToken[] = points.slice(0, placed).map((point, i) => ({
    visible: true,
    color: "#a1584a",
    ...spec,
    id: tokenIds[i],
    name: spec.name || summon.name,
    size,
    x: point.x,
    y: point.y,
    // Every body owns its meta outright, nested objects included. One profile
    // produced all hundred of them, and leaving them pointing at one shared
    // `stats` record means any in-place edit — an import, a migration, a future
    // inspector that patches rather than replaces — silently rewrites the whole
    // swarm. `cloneToken` guards the same aliasing on the registry's side.
    meta: {
      ...(spec.meta ?? {}),
      ...(spec.meta?.stats ? { stats: { ...spec.meta.stats } } : {}),
      ...(spec.meta?.flags ? { flags: [...spec.meta.flags] } : {}),
      summon: { ...summonMeta },
    },
  }));

  // Measured once, on the whole batch. A per-token check would serialise a
  // growing scene a hundred times to answer one question.
  const probe: VttScene = { ...scene, data: { ...scene.data, tokens: [...scene.data.tokens, ...tokens] } };
  if (!vttSnapshotFits(probe)) {
    return {
      ok: false,
      reason: "too-large-for-wire",
      requested,
      detail: `${placed} ${summon.name} would make this scene too large for players to receive.`,
    };
  }
  return { ok: true, tokens, requested, placed, shortfall: requested - placed, unstatted };
}

/** The bodies of one batch, wherever they have wandered to since. Identity is
 *  the batch id and not position: minions move, and a dismissal that only found
 *  the ones still standing where they arrived would leave the strays behind. */
export function summonBatchTokens(tokens: readonly VttToken[], batchId: string): VttToken[] {
  return tokens.filter((token) => token.meta?.summon?.batchId === batchId);
}

/**
 * Ids in a planned batch that the scene already carries.
 *
 * The engine's commit is all-or-nothing on this answer. `applyOp` silently
 * refuses a `token.add` whose id already exists, so a batch containing one
 * collision would land 99 bodies on the host and 99 on every peer — with the
 * Curator told 100 arrived and one minion missing from a swarm nobody can
 * recount. Pure and separate from the renderer so the refusal is testable
 * without a WebGL context.
 */
export function duplicateSummonIds(existing: readonly VttToken[], batch: readonly VttToken[]): string[] {
  const seen = new Set(existing.map((token) => token.id));
  const clashes: string[] = [];
  for (const token of batch) {
    if (!token.id || seen.has(token.id)) clashes.push(token.id ?? "");
    else seen.add(token.id);
  }
  return clashes;
}

/**
 * Split a batch into the bodies a principal may remove and the ones it may not.
 *
 * "Dismiss swarm" is a removal, and removal obeys `canControlToken` like every
 * other one: a Curator does not ordinarily delete a token assigned to a player.
 * `deleteSelected` has enforced that for a single body since the ownership rule
 * shipped, and a batch path that skipped it would be a way to delete a player's
 * token by summoning it — the same hole in a different shape. The refused ones
 * are RETURNED rather than dropped, so the caller can say which minions stayed
 * instead of leaving a Curator to count them.
 */
export function dismissibleSummonBodies(
  tokens: readonly VttToken[],
  batchId: string,
  canRemove: (token: VttToken) => boolean
): { going: VttToken[]; refused: VttToken[] } {
  const going: VttToken[] = [];
  const refused: VttToken[] = [];
  for (const token of summonBatchTokens(tokens, batchId)) (canRemove(token) ? going : refused).push(token);
  return { going, refused };
}

/**
 * Resolve a page's summons against the table's content, in one call.
 *
 * Derived HERE, in one place, for the reason `declaredPlacement` is: there is
 * more than one way to reach a summon — the ability panel's prompt today, and
 * whatever a later phase adds — and two callers reading the page separately is
 * how one of them ends up not reading it at all.
 */
export function resolvePageSummons(
  actions: string | null | undefined,
  roster: SummonRoster
): { summon: DeclaredSummon; resolution: SummonResolution }[] {
  return pageSummons(actions).map((summon) => ({ summon, resolution: resolveSummon(summon.name, roster) }));
}
