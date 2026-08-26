// A custom currency counted against a BODY.
//
// `game/counterTracks.ts` owns the arithmetic — the cap, the floor, the crossing
// rule — and knows nothing about where a track is kept. This file is one of the
// two homes it serves: the tracks whose owner is a token, which is the corpus's
// commonest shape (Blight on a Stygian's victim, an Overload count on a machine)
// and whose lifetime is the scene's.
//
// Modelled on `ConditionClockSystem` on purpose, down to the shape of the plan:
// nothing here writes to a token. `plan` computes the token's next `statuses`
// and the scene's next track list, and hands both back; the caller commits the
// statuses through `adjudicateTokenVitals` — the same authorised path a
// Curator's own ruling takes — and stores the tracks only once that write comes
// back authorised. A refused write therefore leaves no orphan record behind for
// a number nobody is carrying.
//
// The pip is the visibility story. `counterTag` renders "Blight 3/8", it goes
// into `VttToken.statuses`, and every surface that already draws a status draws
// it: the map pips, the inspector chips, the encounter rows. No new surface, no
// second renderer to keep in step, and a peer on an older build sees the number
// as plain text rather than nothing at all.
import {
  counterKey,
  counterTag,
  counterValue,
  isCounterTagFor,
  planCounter,
  validCounterTrack,
  type CounterApplication,
  type CounterPlan,
  type CounterTrack,
} from "../../game/counterTracks";
import type { VttCounterTrack, VttSceneData } from "../types/scene";

/** Ceiling on live tracks in one scene. Per-owner limits are enforced by the
 *  primitive; this caps the FIELD, so a scripted loop cannot grow a snapshot
 *  past the wire budget the way an unbounded clock list once could. */
export const MAX_SCENE_COUNTER_TRACKS = 2_000;

function validSceneTrack(track: unknown): track is VttCounterTrack {
  if (!track || typeof track !== "object") return false;
  const t = track as VttCounterTrack;
  return typeof t.tokenId === "string" && !!t.tokenId && validCounterTrack(t);
}

/** Keep the field ABSENT while a scene has no tracks, so a table that never
 *  moves a counter saves and syncs exactly the bytes it did before. */
function setTracks(data: VttSceneData, tracks: VttCounterTrack[]): void {
  if (tracks.length) data.counterTracks = tracks;
  else delete data.counterTracks;
}

/** One body's tracks, in the primitive's own shape.
 *
 *  A record whose pip is gone is not reported. See `planTokenCounter` for why
 *  the pip is what decides a track EXISTS: a Curator clearing it by hand is how
 *  a human ends a track, and a reader that ignored that would tell the inspector
 *  a number the map no longer shows. */
export function tracksOfToken(data: VttSceneData, tokenId: string): CounterTrack[] {
  const pips = data.tokens.find((candidate) => candidate.id === tokenId)?.statuses ?? [];
  return (data.counterTracks ?? [])
    .filter(
      (track) =>
        validSceneTrack(track) &&
        track.tokenId === tokenId &&
        pips.some((status) => isCounterTagFor(status, track.name))
    )
    .map(({ name, value, cap }) => (cap != null ? { name, value, cap } : { name, value }));
}

/** What one body's track reads right now — 0 for a track it has never carried. */
export function tokenCounterValue(data: VttSceneData, tokenId: string, name: string): number {
  return counterValue(tracksOfToken(data, tokenId), name);
}

/** One counter step landing on one body. */
export interface TokenCounterApplication extends CounterApplication {
  tokenId: string;
}

/** What a move WOULD do to a body and to the scene. Committed by the engine,
 *  never here. */
export interface TokenCounterPlan extends CounterPlan {
  tokenId: string;
  /** The target's next `statuses`, for the authorised vitals write. */
  statuses: string[];
  /** The scene's next track list, written only once that write is authorised. */
  sceneTracks: VttCounterTrack[];
}

/**
 * Move one body's track.
 *
 * Returns null when there is nothing to move — no such token, an unnamed track,
 * a `+0`, or a scene already at `MAX_SCENE_COUNTER_TRACKS`. A refusal the caller
 * can report, rather than a move that quietly loses its record.
 *
 * Exactly ONE pip per track. The old reading is removed wherever it sits and the
 * new one appended, so a track moving 3 → 4 does not leave "Blight 3/8" standing
 * beside "Blight 4/8" — two pips for one number is the failure mode that makes a
 * table stop trusting the pips at all.
 */
export function planTokenCounter(
  data: VttSceneData,
  application: TokenCounterApplication
): TokenCounterPlan | null {
  const token = data.tokens.find((candidate) => candidate.id === application.tokenId);
  if (!token) return null;

  const all = (data.counterTracks ?? []).filter(validSceneTrack);
  const pips = token.statuses ?? [];
  // THE PIP DECIDES WHETHER A TRACK EXISTS; the record decides what it reads.
  //
  // A Curator can take a pip off by hand from the inspector, and that is how a
  // human says "this track is over". `pruneCounterTracks` collects the orphaned
  // record, but it runs when a scene is adopted — so between the click and the
  // next load the record was still sitting there, and the next `Counter: Blight
  // +1` would have resumed from 3 and stamped a pip reading 4 onto a body the
  // table had just cleared. Reconciling here as well as in the prune means the
  // two answers cannot disagree, whichever runs first.
  const mine = all.filter(
    (track) => track.tokenId === token.id && pips.some((status) => isCounterTagFor(status, track.name))
  );
  // Every other body's tracks, which also DROPS this body's pipless ones: they
  // are rebuilt below from `plan.tracks`, and one the Curator cleared is not in
  // it. The orphan is collected by the same act that noticed it.
  const rest = all.filter((track) => track.tokenId !== token.id);
  const held = mine.map(({ name, value, cap }) => (cap != null ? { name, value, cap } : { name, value }));
  const plan = planCounter(held, application);
  if (!plan) return null;
  // A brand-new track on a scene already at the ceiling is refused. Trimming
  // somebody else's Blight to make room would be the scene silently rewriting a
  // fight it is only supposed to be recording.
  const opening = plan.tracks.length > held.length;
  if (opening && all.length >= MAX_SCENE_COUNTER_TRACKS) return null;

  const next = plan.tracks.find((track) => counterKey(track.name) === counterKey(plan.name)) ?? null;
  const statuses = pips.filter((status) => !isCounterTagFor(status, plan.name));
  if (next) statuses.push(counterTag(next));

  return {
    ...plan,
    tokenId: token.id,
    statuses,
    sceneTracks: [...rest, ...plan.tracks.map((track) => ({ tokenId: token.id, ...track }))],
  };
}

/** Take one body's track off, pip and record together — the Curator's eraser,
 *  and the only removal this file has, because a decay rule is a thing only a
 *  page can declare and no page can yet say it. */
export function planClearTokenCounter(
  data: VttSceneData,
  tokenId: string,
  name: string
): { tokenId: string; statuses: string[]; sceneTracks: VttCounterTrack[] } | null {
  const token = data.tokens.find((candidate) => candidate.id === tokenId);
  if (!token) return null;
  const all = (data.counterTracks ?? []).filter(validSceneTrack);
  const kept = all.filter((track) => track.tokenId !== token.id || counterKey(track.name) !== counterKey(name));
  const statuses = (token.statuses ?? []).filter((status) => !isCounterTagFor(status, name));
  if (kept.length === all.length && statuses.length === (token.statuses ?? []).length) return null;
  return { tokenId: token.id, statuses, sceneTracks: kept };
}

/** Commit a planned move's tracks. Split from `plan` so the caller can put the
 *  authorised vitals write between the two, exactly as `applyTokenCondition`
 *  does with its clocks. */
export function commitTokenCounter(data: VttSceneData, tracks: VttCounterTrack[]): void {
  setTracks(data, tracks.filter(validSceneTrack).slice(0, MAX_SCENE_COUNTER_TRACKS));
}

/**
 * Drop tracks with nothing left to count: a deleted token, a pip a Curator
 * cleared by hand, a malformed entry from a peer.
 *
 * Returns whether anything was dropped. The pip is what a table reads, so
 * clearing it is how a human says "this track is over" — and a record that
 * survived that would keep a body's Blight alive invisibly, then resurrect the
 * pip out of nowhere the next time an ability touched the track.
 *
 * Deliberately NOT a decay pass. Nothing here expires on a round, on an
 * encounter, or on a timer; see the header of game/counterTracks.ts for why the
 * grammar cannot ask for that and why the gap is reported instead of filled.
 */
export function pruneCounterTracks(data: VttSceneData): boolean {
  const tracks = data.counterTracks;
  if (!tracks?.length) return false;
  const seen = new Set<string>();
  // Indexed once rather than scanned per track. A summon batch puts a hundred
  // bodies on the map in one act, and this runs on every scene adopt: a
  // `tokens.find` inside the filter makes the pass tokens×tracks, so a swarm
  // that each carry a track turns an adopt into ten thousand comparisons for a
  // pass that usually removes nothing.
  const byId = new Map(data.tokens.map((token) => [token.id, token]));
  const kept = tracks
    .filter((track) => {
      if (!validSceneTrack(track)) return false;
      const token = byId.get(track.tokenId);
      if (!token) return false;
      if (!(token.statuses ?? []).some((status) => isCounterTagFor(status, track.name))) return false;
      // NUL joins the halves so a name carrying the separator cannot collide
      // with another token's key. Written as an escape because a raw NUL byte in
      // source makes grep skip the whole file as binary.
      const key = `${track.tokenId}\u0000${counterKey(track.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SCENE_COUNTER_TRACKS);
  if (kept.length === tracks.length) return false;
  setTracks(data, kept);
  return true;
}

