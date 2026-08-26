// Information the Curator hands a character — a rumour, a contract, the words on
// a scrap of paper the party just took off a body.
//
// WHY THIS IS NOT `notesMd`. The obvious implementation is appending the text to
// the character's journal, and it is wrong for one specific reason: `notesMd` is
// a SINGLE field, and `sync/sheetMerge` reconciles field by field. A Curator
// handing a note to a player who is offline, while that player writes in their
// own journal on their own machine, produces two edits to one field with no
// common ancestor — a real conflict, reported to the Curator as a decision, with
// one side's paragraph at stake. An append-only list of separate records
// conflicts only with another handout, which is the honest shape of the thing:
// the Curator's words and the player's words are not the same document.
//
// APPEND-ONLY, and attributed. A handout records WHO said it and WHEN, because
// a line of prose with no attribution appearing on your sheet three sessions
// later is indistinguishable from something you wrote yourself and forgot.
//
// This module states no setting rules. A handout carries text and nothing the
// engine reads — no mechanical effect, no trigger, no cost. If a piece of
// information does something in W.T.E, that is a page's job to say and a
// Curator's to apply.

/** One piece of information given to a character. */
export interface Handout {
  /** Unique per entry, so a list can be keyed and one entry dropped by identity. */
  id: string;
  /** Short label, shown in the notice and as the entry's heading. */
  title: string;
  /** The body — Markdown, rendered by the same renderer the journal uses. */
  text: string;
  /** Who handed it over, as the table reads it ("The Curator"). */
  by: string;
  /** When it was given, on the machine that gave it. */
  at: number;
}

/** Handouts one character may carry. A bound on the record, not a rule about
 *  how much a person can know. */
export const MAX_HANDOUTS = 40;

/** Longest title. Titles ride into change notices, which are one line each. */
export const MAX_HANDOUT_TITLE = 80;

/** Longest body. Generous — a handout is a page of prose, not a novel — and
 *  bounded so one gift cannot make a sheet too large to broadcast. */
export const MAX_HANDOUT_TEXT = 8_000;

/** Whether a stored value is a handout this build can trust. Re-validated rather
 *  than assumed: this JSON can have been hand-edited or written by another
 *  build, and a malformed entry would crash the surface meant to display it. */
export function validHandout(v: unknown): v is Handout {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    !!h.id &&
    typeof h.title === "string" &&
    typeof h.text === "string" &&
    typeof h.by === "string" &&
    typeof h.at === "number" &&
    Number.isFinite(h.at)
  );
}

function newHandoutId(now: number): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ho-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface GiveHandoutArgs {
  title: string;
  text: string;
  by: string;
  now?: number;
}

/**
 * Append a handout. Returns a NEW array, or null when there is nothing to give —
 * an entry with neither a title nor a body says nothing on arrival.
 *
 * The OLDEST entry is dropped when the list is full, not the newest: what the
 * Curator just handed over is the thing the player is about to be told about,
 * and a gift that silently failed to land is the bug this whole path exists to
 * avoid.
 */
export function giveHandout(
  handouts: readonly Handout[] | undefined,
  args: GiveHandoutArgs
): Handout[] | null {
  const title = String(args.title ?? "").trim().slice(0, MAX_HANDOUT_TITLE);
  const text = String(args.text ?? "").trim().slice(0, MAX_HANDOUT_TEXT);
  if (!title && !text) return null;
  const now = args.now ?? Date.now();
  const entry: Handout = {
    id: newHandoutId(now),
    title: title || "Untitled",
    text,
    by: String(args.by ?? "").trim() || "The Curator",
    at: now,
  };
  const kept = (handouts ?? []).filter(validHandout);
  return [...kept, entry].slice(-MAX_HANDOUTS);
}

/** Take one back — the Curator handed over the wrong page. Null when there was
 *  no such entry, so a caller never reports a removal that did not happen. */
export function removeHandout(handouts: readonly Handout[] | undefined, id: string): Handout[] | null {
  const kept = (handouts ?? []).filter(validHandout);
  const next = kept.filter((h) => h.id !== id);
  return next.length === kept.length ? null : next;
}
