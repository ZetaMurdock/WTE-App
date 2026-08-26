// An origin word, turned into a real square on the map — or into a question.
//
// `game/abilityOrigin` reads WHAT an ability fires from. This turns that into
// WHERE, against the scene actually on screen, and its most important answer is
// the one it refuses to guess: the corpus is full of origins the app has no
// object for. "Battlefield environment" is not a token. Nothing in the app
// should invent a Medium entity with stats so that a template has something to
// hang off — that would be the engine authoring a setting rule, and the Curator
// would be playing against a body they never placed.
//
// So there are exactly three answers: the caster's own body, a thing already on
// the map whose NAME the origin says, or "you place it". The third is the
// common one and is not a failure.
//
// ANCHORING REUSES THE AURA. A resolved origin token is handed to the same
// `auraTokenId` binding P3 built for `Zone: … attach self`, so an ability
// mounted on a Component travels with that Component exactly the way a caster's
// aura travels with the caster — one reconcile pass, one wire field, one set of
// callers already proven to cover every path that moves a body. A second
// anchoring mechanism beside it would have to be taught about peer moves,
// pinned scenes and the round tick all over again, and the two would disagree
// the first time one of them was forgotten.
//
// An origin resolved to a placed EFFECT yields a point and not a ride: the aura
// binding attaches an effect to a TOKEN, and effects do not move on their own.
// Said out loud rather than silently downgraded — see `OriginPlan.note`.
import { originMatchText, type DeclaredOrigin } from "../../game/abilityOrigin";
import type { VttSceneData } from "../types/scene";

export interface OriginCandidate {
  kind: "token" | "effect";
  id: string;
  name: string;
  x: number;
  y: number;
}

/**
 * Everything on the scene an origin could name.
 *
 * Props are included and creatures are not excluded: a Cipher's Component is
 * far more often a lamp, a door or a corpse than it is an actor, and the prop
 * flag is about whether a thing takes turns, not about whether an ability can
 * be mounted on it. Placed effects come along because a Curator with no object
 * for "the Medium" can drop a labelled marker and have the ability anchor to
 * it — which is the supported way to give an unmodelled origin a location.
 */
export function originCandidates(data: VttSceneData): OriginCandidate[] {
  const out: OriginCandidate[] = [];
  for (const token of data.tokens) {
    out.push({ kind: "token", id: token.id, name: token.name, x: token.x, y: token.y });
  }
  for (const effect of data.effects) {
    const label = effect.data.label?.trim();
    if (label) out.push({ kind: "effect", id: effect.id, name: label, x: effect.x, y: effect.y });
  }
  return out;
}

/**
 * The one thing on the map this origin names, or nothing.
 *
 * CONTAINMENT BOTH WAYS, and nothing looser. A scene names a lamp "Streetlamp"
 * and a Cipher's Component says "Inanimate object": no shared word, no match,
 * and the Curator places it — which is right, because the alternative rules
 * that any inanimate object on the map is THE object the Cipher is mounted on.
 * Word-overlap scoring was the first draft and it bound "Group of targets" to a
 * token called "Target Dummy".
 *
 * AMBIGUITY IS NOT A MATCH. Two tokens both called "Medium" is the Curator's
 * question, not the engine's, and picking the first would silently anchor to
 * whichever happened to be spawned first.
 */
export function matchOriginCandidate(text: string, candidates: readonly OriginCandidate[]): OriginCandidate | null {
  const want = originMatchText(text);
  if (!want) return null;
  const hits = candidates.filter((candidate) => {
    const name = originMatchText(candidate.name);
    return !!name && (name === want || name.includes(want) || want.includes(name));
  });
  return hits.length === 1 ? hits[0] : null;
}

export interface OriginPlan {
  /** The origin as the page words it, for the prompt to echo back. */
  text: string | null;
  /** Where that wording came from, so a table knows which line to edit. */
  source: DeclaredOrigin["source"];
  /** The token the template should ride, when there is one. Feeds the same
   *  `auraTokenId` binding an `attach self` aura uses. */
  tokenId: string | null;
  /** Where the template should land. Null when nothing on the map answers. */
  at: { x: number; y: number } | null;
  /** The origin resolved to the caster, so nothing changes from before. */
  self: boolean;
  /** The page named an origin and the map has no object for it. Not an error —
   *  the Curator places it, and the prompt says what they are placing. */
  needsPlacement: boolean;
  /** One sentence for the Curator, or null when there is nothing to say. */
  note: string | null;
}

const NO_ORIGIN: OriginPlan = {
  text: null,
  source: null,
  tokenId: null,
  at: null,
  self: false,
  needsPlacement: false,
  note: null,
};

/**
 * Resolve a declared origin against a scene.
 *
 * `casterTokenId` may be null — the caster's own body is not always on the map,
 * and an origin that resolves to a caster who is not there is `needsPlacement`
 * rather than a silent fall-through to the view centre. The Curator being asked
 * where the Inquisitor is standing is a better outcome than a template landing
 * wherever the camera happened to be pointing.
 */
export function planOrigin(
  origin: DeclaredOrigin,
  data: VttSceneData | null | undefined,
  casterTokenId: string | null
): OriginPlan {
  if (!origin.text) return NO_ORIGIN;
  const base = { text: origin.text, source: origin.source, self: origin.isSelf };
  if (origin.isSelf) {
    const caster = casterTokenId ? data?.tokens.find((token) => token.id === casterTokenId) ?? null : null;
    if (!caster) {
      return { ...base, tokenId: null, at: null, needsPlacement: true, note: `${origin.text} — this ability fires from the caster's own body, which is not on this scene.` };
    }
    return { ...base, tokenId: caster.id, at: { x: caster.x, y: caster.y }, needsPlacement: false, note: null };
  }
  const match = data ? matchOriginCandidate(origin.text, originCandidates(data)) : null;
  if (!match) {
    return {
      ...base,
      tokenId: null,
      at: null,
      needsPlacement: true,
      note: `${origin.text} — nothing on this scene answers to that, so place the origin yourself. The app will not invent a body for it.`,
    };
  }
  if (match.kind === "effect") {
    return {
      ...base,
      tokenId: null,
      at: { x: match.x, y: match.y },
      needsPlacement: false,
      note: `${origin.text} — anchored to the placed marker "${match.name}", which does not move on its own.`,
    };
  }
  return {
    ...base,
    tokenId: match.id,
    at: { x: match.x, y: match.y },
    needsPlacement: false,
    note: `${origin.text} — riding ${match.name}.`,
  };
}
