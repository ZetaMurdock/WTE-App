// Who is standing in a placed effect?
//
// `effectBodyContains` answers that for a POINT, for every VttEffectKind, and
// its own header reserved it for "future token-in-area queries". This is that
// query, and it lives here rather than inside any one caller: the round tick
// asks it (RecurringEffectSystem) and the zone-status pass asks it
// (SimulationSystem). Two answers to "who is in the fire" is how a token ends up
// Burning without ever taking the burn.
//
// CONTAINMENT IS FOOTPRINT-BASED, and the choice is deliberate.
//
// A token is inside an effect when its own position is inside the body, or when
// ANY cell of the square footprint `occupancy.tokenFootprint` gives it has its
// CENTRE inside the body. The footprint half is the deliberate part: it is the
// same footprint the movement rules reserve, so "the space you occupy" means one
// thing in this app instead of two: a cell a Large body fills so completely that
// nothing else may step into it is also a cell whose fire burns it. The centre-
// only alternative is worse in the direction that matters — it exempts exactly
// the biggest creatures, which are the ones most obviously standing in the
// blast, and it does so invisibly.
//
// EVERY token is ALSO sampled at its own position, whatever its size, and the
// footprint cells are added to that rather than replacing it. The pre-
// generalisation test read token.x/token.y and nothing else, so this keeps the
// new rule a strict SUPERSET of the old one: nobody who was standing in a field
// before this pass stops standing in it now. Footprint-only sampling failed that
// in a direction the argument above never covers — a 1x1 rect zone dropped at an
// unsnapped corner, say (0, 23), holds y from 23 to 93, and a size-2 token at
// (5, 80) is inside it by the old test while both of its footprint rows sit at
// y = 105 and y = 175, outside. The tag came off a Large creature nobody moved,
// in the very rectangles this pass promised not to disturb. The anchor point
// always lies in a cell the body fills, so counting it samples the body, not
// something beside it.
//
// This module answers geometry only. WHICH tokens are eligible — actors versus
// scenery, visible versus hidden — is the caller's rule, because the answers
// differ: a burning crate may legitimately hold a status pip while never being
// worth a Resolution Card.
//
// PERFORMANCE. The scan is O(effects x tokens x cells-per-token) point tests,
// each a handful of float ops, over one point for a size-1 token and n^2 + 1 for
// an n-square body. The realistic ceiling is one per-ROUND tick of a fight: 100
// tokens against 8 live effects, nearly all size 1, is ~800 tests — tens of
// microseconds, once when the round NUMBER changes, not per frame. A spatial
// index would have to be rebuilt on every token move, which happens per drag
// frame and so far more often than this runs; it would cost more than the scan
// it replaced. There deliberately is none. The structural win taken instead is
// that callers ask per effect, so each token's footprint is derived once per
// effect rather than the effect list being re-walked per token.
import type { VttEffect, VttGrid, VttToken } from "../../types/scene";
import { tokenFootprint, type TokenPlacement } from "../../data/occupancy";
import { effectBodyContains } from "./effectGeometry";

export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * The world points that stand for a token's body in an area test.
 *
 * Always the token's own position, plus one per occupied cell centre once the
 * body is bigger than a square — see the header for why the own point is never
 * dropped. Exposed because it is the whole of the containment rule: a test that
 * pins these points pins the rule.
 */
export function tokenSamplePoints(grid: VttGrid, token: TokenPlacement): WorldPoint[] {
  if (!Number.isFinite(token.x) || !Number.isFinite(token.y)) return [];
  const here: WorldPoint = { x: token.x, y: token.y };
  // A corrupt `size` spans one square rather than none: a token with a broken
  // number on it is still a body standing somewhere, and dropping it out of
  // every area would hide it from the fire instead of reporting it.
  const span = Number.isFinite(token.size) ? Math.max(1, Math.ceil(token.size)) : 1;
  if (span === 1) return [here];
  // `tokenFootprint` yields nothing for a degenerate grid, which leaves the
  // anchor point alone to answer — the same one point a size-1 body offers.
  const cells = tokenFootprint(grid, token).map((cell) => ({
    x: (cell.col + 0.5) * grid.size,
    y: (cell.row + 0.5) * grid.size,
  }));
  return [here, ...cells];
}

/** Is this token inside the effect's body? */
export function tokenInEffect(effect: VttEffect, grid: VttGrid, token: TokenPlacement): boolean {
  for (const point of tokenSamplePoints(grid, token)) {
    if (effectBodyContains(effect, grid.size, point.x, point.y)) return true;
  }
  return false;
}

/** Every token standing in the effect, in scene order — stable for the Curator,
 *  who reads a list of names and must not see it reshuffle between rounds. */
export function occupantsOf(effect: VttEffect, grid: VttGrid, tokens: readonly VttToken[]): VttToken[] {
  const inside: VttToken[] = [];
  for (const token of tokens) if (tokenInEffect(effect, grid, token)) inside.push(token);
  return inside;
}

/** Just the ids — what a proposal or a status pass wants to carry. */
export function occupantIdsOf(effect: VttEffect, grid: VttGrid, tokens: readonly VttToken[]): string[] {
  return occupantsOf(effect, grid, tokens).map((token) => token.id);
}

/**
 * Occupants of every effect at once, keyed by effect id.
 *
 * An effect with nobody inside still gets an entry (an empty array): "the fire
 * caught nobody this round" and "there is no fire" are different answers, and a
 * caller has to be able to tell them apart.
 */
export function occupancyByEffect(
  effects: readonly VttEffect[],
  grid: VttGrid,
  tokens: readonly VttToken[]
): Map<string, VttToken[]> {
  const out = new Map<string, VttToken[]>();
  for (const effect of effects) out.set(effect.id, occupantsOf(effect, grid, tokens));
  return out;
}
