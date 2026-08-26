// AuraSystem: effects that ride a token.
//
// `Zone: circle 15 ft, attach self` declares an AURA — a template that travels
// with its caster. Every effect in the scene is a fixed `x`/`y`, so before this
// an aura was a circle drawn where the caster USED to be: the caster stepped
// away and the cold stayed behind, still ticking on whoever now stood in the
// square they had vacated. That is not a rules disagreement, it is the map
// lying about where the ability is.
//
// The fix is deliberately not a render-time offset. An aura that only LOOKED
// attached would still be enumerated from its stale centre by every query that
// reads `effect.x` — the round tick, the zone-status pass, hit-testing, a peer's
// snapshot — so the picture and the mechanics would disagree, which is worse
// than being wrong in one place. Instead the stored position IS reconciled, by
// one idempotent pass every position-changing path calls.
//
// WHERE IT IS CALLED, and why it has to be all of them:
//   - PixiVttApp.commitTokenMove — the local drop and the authoritative commit.
//   - applyOp("token.move") in sync/patches — every move that arrives from a
//     peer, including moves the host arbitrates onto a PINNED scene it is not
//     currently viewing (VttScreen's onForeignMoveRequest mutates through this
//     same function, with no renderer involved at all).
//   - EncounterSystem.onRound — belt and braces, immediately before anything
//     reads an effect's body for the round. A path added later that forgets to
//     reconcile can therefore mis-DRAW an aura for a moment, but can never make
//     it tick from the wrong place.
// sync/moveAuthority is NOT one of them on purpose: `MoveAuthorityState` carries
// grid, tokens and walls and no effects at all. It decides whether a move is
// legal; it does not own the scene it would have to reconcile.
import type { VttSceneData } from "../../types/scene";

/**
 * What happens to an aura when its owner is gone.
 *
 * Removed: the aura goes with it. A 15-ft cold field is the caster's presence,
 * and leaving one hanging over an empty square would leave the table with an
 * effect nothing on the map explains and no handle to remove it by — the token
 * whose inspector would have offered one is the thing that just vanished.
 *
 * Moved to another scene: identical, and by the same code. Scenes own their own
 * `tokens` and `effects` arrays, so a token that crossed a border link is simply
 * absent from this scene's token list; the border-link transfer does not need to
 * know auras exist.
 *
 * Hidden (`visible: false`): the aura KEEPS RIDING, and keeps ticking. Hiding a
 * token is the Curator concealing an actor from the players' view — an unseen
 * caster is still standing there, and an aura that switched off when its owner
 * stepped out of sight would make invisibility a defence the setting never
 * granted. Whether players can SEE the template is the effect layer's question,
 * not this system's.
 */
export function auraOwnerPresent(data: VttSceneData, tokenId: string): boolean {
  return data.tokens.some((token) => token.id === tokenId);
}

/**
 * Bind an effect to a token, capturing the offset that keeps its own anchor
 * where it currently sits. Returns false when either side is missing, so a
 * caller never reports an aura it did not actually create.
 */
export function bindAura(data: VttSceneData, effectId: string, tokenId: string): boolean {
  const effect = data.effects.find((candidate) => candidate.id === effectId);
  const token = data.tokens.find((candidate) => candidate.id === tokenId);
  if (!effect || !token) return false;
  effect.data.auraTokenId = tokenId;
  effect.data.auraDx = effect.x - token.x;
  effect.data.auraDy = effect.y - token.y;
  return true;
}

/** Stop an effect following its token, leaving it exactly where it stands. */
export function unbindAura(data: VttSceneData, effectId: string): boolean {
  const effect = data.effects.find((candidate) => candidate.id === effectId);
  if (!effect?.data.auraTokenId) return false;
  delete effect.data.auraTokenId;
  delete effect.data.auraDx;
  delete effect.data.auraDy;
  return true;
}

/**
 * Move every bound aura onto its owner. Returns the ids that actually moved.
 *
 * Idempotent and allocation-free in the overwhelmingly common case: a scene with
 * no auras returns early, and a scene whose auras are already in place writes
 * nothing. Both matter — this runs on every single token move, local and remote.
 *
 * An aura whose owner is absent is left untouched rather than dragged to the
 * origin. Removal is `dropOrphanAuras`'s decision, and a reconcile pass that
 * quietly teleported an effect to (0,0) would be a worse answer than either.
 */
export function reanchorAuras(data: VttSceneData): string[] {
  const moved: string[] = [];
  for (const effect of data.effects) {
    const ownerId = effect.data.auraTokenId;
    if (!ownerId) continue;
    const owner = data.tokens.find((token) => token.id === ownerId);
    if (!owner) continue;
    const x = owner.x + (effect.data.auraDx ?? 0);
    const y = owner.y + (effect.data.auraDy ?? 0);
    if (effect.x === x && effect.y === y) continue;
    effect.x = x;
    effect.y = y;
    moved.push(effect.id);
  }
  return moved;
}

/**
 * Remove auras whose owning token is no longer on this scene. Returns the ids.
 *
 * Only effects that carry `auraTokenId` are eligible, so a Curator's own placed
 * template is never at risk: an effect nobody bound has no owner to lose.
 */
export function dropOrphanAuras(data: VttSceneData): string[] {
  const dropped: string[] = [];
  data.effects = data.effects.filter((effect) => {
    const ownerId = effect.data.auraTokenId;
    if (!ownerId || auraOwnerPresent(data, ownerId)) return true;
    dropped.push(effect.id);
    return false;
  });
  return dropped;
}
