// Codex Notes (Remaster slice 5): first-class notes — scratch notes, or notes
// attached to a page (optionally quoting a highlighted selection). GM-only notes
// stay hidden unless Curator mode is on. Tags cover session/clue/NPC/etc.

export interface CodexNote {
  id: string;
  title: string;
  body: string;
  /** Page stem this note is attached to; null = scratch/personal note. */
  attachedTo: string | null;
  /** The highlighted text this note annotates, if created from a selection. */
  quote: string | null;
  visibility: "player" | "gm";
  tags: string[];
  campaignId?: string | null;
  updatedAt: number;
}

export function newNote(attachedTo: string | null, quote: string | null = null): CodexNote {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  return {
    id,
    title: "",
    body: "",
    attachedTo,
    quote,
    visibility: "player",
    tags: [],
    campaignId: null,
    updatedAt: Date.now(),
  };
}
