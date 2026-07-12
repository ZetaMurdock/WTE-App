// Codex Sequences (Remaster slice 4): user-created knowledge paths through the
// archive. A Sequence holds an ordered set of records, embedded Scripts (guided
// page trails), and Variables (filter tags). Stored as one JSON doc per sequence
// so it stays flexible and packable/exportable later.

export interface ScriptStep {
  stem: string; // page stem the step opens
}
export interface Script {
  id: string;
  title: string;
  steps: ScriptStep[];
  variables: string[];
  visibility: "player" | "gm";
}
export type SequenceScope = "official" | "campaign" | "personal" | "community";

export interface Sequence {
  id: string;
  title: string;
  description: string;
  icon: string; // glyph character shown on the wheel
  color: string; // accent hex
  scope: SequenceScope;
  variables: string[];
  recordIds: string[]; // ordered page stems
  scripts: Script[];
  visibility: "player" | "gm";
  campaignId?: string | null;
  updatedAt: number;
}

export const SEQ_ICONS = ["◈", "☍", "✶", "⌬", "♁", "⚚", "☌", "⟁"];
export const SEQ_COLORS = ["#689a96", "#837aae", "#a7aebd", "#a1584a", "#6f9a68", "#a08a4f"];

export function newSequence(title: string): Sequence {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "sq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  return {
    id,
    title,
    description: "",
    icon: SEQ_ICONS[0],
    color: SEQ_COLORS[0],
    scope: "personal",
    variables: [],
    recordIds: [],
    scripts: [],
    visibility: "player",
    campaignId: null,
    updatedAt: Date.now(),
  };
}

export function newScript(title: string): Script {
  const id = "sc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  return { id, title, steps: [], variables: [], visibility: "player" };
}
