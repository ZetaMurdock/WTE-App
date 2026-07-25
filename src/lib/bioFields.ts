// Modular bio fields — whatever a player wants to track that the sheet does not
// already have a box for: age, favourite food, how many times they've died, a
// callsign, a debt owed. Three kinds cover it:
//
//   text    — free text ("Favourite food: cold noodles")
//   number  — a plain number ("Age: 34")
//   counter — a number with +/− at the table ("Times arrested: 3")
//
// Stored on the sheet so it travels with the character (share, export, netplay).

export type BioFieldKind = "text" | "number" | "counter";

export interface BioField {
  id: string;
  label: string;
  value: string;
  kind: BioFieldKind;
}

export const BIO_FIELD_KINDS: { kind: BioFieldKind; label: string; hint: string }[] = [
  { kind: "text", label: "Text", hint: "Anything — a name, a phrase, a note" },
  { kind: "number", label: "Number", hint: "A value you type, like age or height" },
  { kind: "counter", label: "Counter", hint: "Tally something with + and − at the table" },
];

/** Longest a label may be, so the bubble grid stays readable. */
export const BIO_LABEL_MAX = 40;
export const BIO_VALUE_MAX = 240;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "bf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/** Normalise anything read off a saved sheet — a hand-edited blob still loads. */
export function parseBioFields(raw: unknown): BioField[] {
  if (!Array.isArray(raw)) return [];
  const out: BioField[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Partial<BioField>;
    const label = String(o.label ?? "").trim().slice(0, BIO_LABEL_MAX);
    if (!label) continue; // an unlabelled bubble is noise
    const kind: BioFieldKind = o.kind === "number" || o.kind === "counter" ? o.kind : "text";
    let value = String(o.value ?? "").slice(0, BIO_VALUE_MAX);
    if (kind !== "text") value = String(numOf(value));
    out.push({ id: typeof o.id === "string" && o.id ? o.id : uid(), label, value, kind });
  }
  return out;
}

/** The number inside a value, or 0. Counters and numbers are stored as strings
 *  so one shape round-trips through JSON without special-casing. */
export function numOf(value: string): number {
  const n = parseInt(String(value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function addBioField(list: BioField[], label: string, kind: BioFieldKind): BioField[] {
  const clean = label.trim().slice(0, BIO_LABEL_MAX);
  if (!clean) return list;
  return [...list, { id: uid(), label: clean, value: kind === "text" ? "" : "0", kind }];
}

export function setBioValue(list: BioField[], id: string, value: string): BioField[] {
  return list.map((f) => (f.id === id ? { ...f, value: String(value).slice(0, BIO_VALUE_MAX) } : f));
}

export function renameBioField(list: BioField[], id: string, label: string): BioField[] {
  const clean = label.trim().slice(0, BIO_LABEL_MAX);
  if (!clean) return list;
  return list.map((f) => (f.id === id ? { ...f, label: clean } : f));
}

/** Step a counter. Counters may go negative — a debt is a real thing to track. */
export function stepBioField(list: BioField[], id: string, by: number): BioField[] {
  return list.map((f) => (f.id === id && f.kind !== "text" ? { ...f, value: String(numOf(f.value) + by) } : f));
}

export function removeBioField(list: BioField[], id: string): BioField[] {
  return list.filter((f) => f.id !== id);
}

/** Move a bubble one slot left or right, so a player can order their own sheet. */
export function moveBioField(list: BioField[], id: string, dir: -1 | 1): BioField[] {
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return list;
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
