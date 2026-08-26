// Reconciling two versions of one character sheet that were both edited apart.
//
// WHY THIS EXISTS: the Curator can now open and edit a player's sheet while that
// player is offline, and the player can edit the same sheet on their own machine.
// The wire is last-writer-wins with host privilege, so the Curator adjusting HP on
// Tuesday and the player levelling up on Wednesday used to mean that whoever
// connected second silently erased the other's week. Neither side's copy is a
// patch — each is a whole sheet — so "who wrote last" is the only question a bare
// record can answer, and it is the wrong one.
//
// The answer is a THREE-WAY merge against the last content both sides held (the
// agreement, kept per character by partySheets). Per field:
//   - both sides say the same thing            -> nothing to decide;
//   - only THEY moved it away from the base    -> take theirs (delivery);
//   - only WE moved it                         -> keep ours (their copy is stale);
//   - both moved it, to different values       -> a CONFLICT, reported, not guessed.
// Nothing here picks a winner for a contested field. A field-level merge is
// truthful because each value is taken WHOLE from the side that changed it — no
// value is ever synthesised, averaged, or reordered.
//
// The base is stored as one digest PER FIELD rather than as a copy of the sheet:
// every question this file asks of the base is an equality test, and a fingerprint
// answers those without keeping a second copy of every portrait data URL on every
// device.
import type { CharacterRecord } from "../../lib/characters";
import type { CharacterSheet } from "../../models/character";
import { SHEET_KEYS, parseSheetSafe, serializeSheet, type SheetKey } from "../../lib/sheetCodec";

/** A merged field is addressed by its sheet key, or by the record's own name. */
export type SheetField = SheetKey | "name";

const FIELDS: readonly SheetField[] = ["name", ...SHEET_KEYS];

/** Per-field digests of one version of a sheet — see the header for why. */
export interface SheetFingerprint {
  keys: Record<string, string>;
}

export interface SheetConflictField {
  key: SheetField;
  /** What the reader calls this field, for a sentence a person can act on. */
  label: string;
  ours: unknown;
  theirs: unknown;
}

export type SheetMergeStatus =
  /** Both sides already hold the same content. */
  | "identical"
  /** Only they moved: their record is the whole answer. */
  | "theirs"
  /** Only we moved: their copy is behind and needs ours. */
  | "ours"
  /** Both moved, in different fields: every edit survives. */
  | "merged"
  /** Both moved the SAME field to different values. */
  | "conflict";

export interface SheetMergeResult {
  status: SheetMergeStatus;
  /** What this device should now hold. On a conflict this carries the
   *  uncontested part of the merge; the contested fields keep OUR value. */
  record: CharacterRecord;
  /** Fields adopted from their record. */
  took: SheetField[];
  /** Fields where ours is ahead of theirs. */
  kept: SheetField[];
  /** Fields BOTH sides are now known to hold the same value for — the ones
   *  already equal, plus the ones just taken. This is what the agreement may
   *  advance to without a reply; nothing else has been shown to the other side. */
  agreed: SheetField[];
  /** Fields both sides moved differently. Empty unless status is "conflict". */
  conflicts: SheetConflictField[];
}

/** A field that is absent. Distinct from any digest, so "absent on both sides"
 *  compares equal and "deleted by one side" compares as a change. */
const ABSENT = "-";

/** JSON with object keys in a fixed order, so two records that reached this
 *  device by different routes (one parsed off the wire, one rebuilt by the sheet)
 *  are not called different because their fields are in a different order. */
function stableJson(v: unknown): string {
  if (v === undefined) return ABSENT;
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? ABSENT;
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableJson(o[k])).join(",") + "}";
}

/** FNV-1a over the stable JSON, with the length mixed in. Short enough that a
 *  whole party's fingerprints cost a few hundred bytes on disk. */
function digestValue(v: unknown): string {
  const s = stableJson(v);
  if (s === ABSENT) return ABSENT;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return s.length.toString(36) + ":" + h.toString(16);
}

/** Put a sheet through the storage round trip. A record read from the database and
 *  one that arrived as JSON must be compared on equal terms: the codec fills in
 *  defaults and migrates legacy fields, so without this every field of a sheet
 *  that had not been re-saved yet would read as "changed" and an ordinary save
 *  would look like a party-wide conflict. */
function normalizeSheet(sheet: CharacterSheet): CharacterSheet {
  return parseSheetSafe(serializeSheet(sheet)).sheet;
}

function fieldOf(rec: { name: string; sheet: CharacterSheet }, key: SheetField): unknown {
  return key === "name" ? rec.name : (rec.sheet as unknown as Record<string, unknown>)[key];
}

/** The per-field digests of a record — what "we agree" is stored as. */
export function fingerprintRecord(rec: CharacterRecord): SheetFingerprint {
  const norm = { name: rec.name, sheet: normalizeSheet(rec.sheet) };
  const keys: Record<string, string> = {};
  for (const k of FIELDS) {
    const d = digestValue(fieldOf(norm, k));
    if (d !== ABSENT) keys[k] = d;
  }
  return { keys };
}

/** One digest for the whole record — the loop-breaker partySheets uses to tell an
 *  echo of what we just sent from real new information. */
export function digestRecord(rec: CharacterRecord): string {
  return digestValue([rec.id, rec.name, normalizeSheet(rec.sheet)]);
}

const LABELS: Partial<Record<SheetField, string>> = {
  name: "name",
  attributes: "attributes",
  specialties: "specialties",
  speciesId: "species",
  variantName: "lineage",
  variantOption: "lineage option",
  innateChoice: "innate abilities",
  paradigmId: "paradigm",
  rank: "Rank",
  favoredAttr: "favoured attribute",
  favoredSpec: "favoured specialty",
  portrait: "portrait",
  background: "background",
  sizeId: "size",
  sector: "Sector",
  morality: "Polarized Soul",
  eminence: "Eminence",
  pressure: "Pressure",
  negotiation: "negotiation",
  equipment: "equipment",
  genusLoadout: "genus loadout",
  cipherLoadout: "Cipher loadout",
  bioFields: "bio fields",
  focusSpend: "Synaptic Focus",
  focusBonus: "banked Focus",
  focusBonusRank: "banked Focus rank",
  weaponLoadout: "weapons",
  gearLoadout: "gear",
  ssSpent: "Synaptic Space spent",
  hpDamage: "HP damage",
  dhpDamage: "DHP damage",
  allowOverrides: "override switch",
  derivedOverrides: "stat overrides",
  notes: "notes",
  folderId: "vault folder",
  tags: "tags",
  notesMd: "written notes",
  counterTracks: "counters",
};

function labelOf(key: SheetField): string {
  return LABELS[key] ?? key;
}

/**
 * Merge THEIR record into OURS against the base both sides last agreed on.
 *
 * `base` of null means no agreement was ever recorded — the two sides have no
 * common ancestor to reason from, so everything that differs reads as "theirs"
 * (the last-writer-wins behaviour that predates the agreement ledger) rather than
 * inventing a conflict out of an unknown.
 */
export function mergeSheetRecords(
  base: SheetFingerprint | null,
  ours: CharacterRecord,
  theirs: CharacterRecord
): SheetMergeResult {
  const ourN = { name: ours.name, sheet: normalizeSheet(ours.sheet) };
  const theirN = { name: theirs.name, sheet: normalizeSheet(theirs.sheet) };
  const baseKeys = base ? base.keys : fingerprintRecord(ours).keys;

  const took: SheetField[] = [];
  const kept: SheetField[] = [];
  const agreed: SheetField[] = [];
  const conflicts: SheetConflictField[] = [];
  const sheet: Record<string, unknown> = { ...(ourN.sheet as unknown as Record<string, unknown>) };
  let name = ourN.name;

  for (const k of FIELDS) {
    const o = fieldOf(ourN, k);
    const t = fieldOf(theirN, k);
    const dO = digestValue(o);
    const dT = digestValue(t);
    if (dO === dT) {
      agreed.push(k);
      continue;
    }
    const dB = baseKeys[k] ?? ABSENT;
    if (dB === dO) {
      took.push(k);
      agreed.push(k);
      if (k === "name") name = theirN.name;
      else if (t === undefined) delete sheet[k];
      else sheet[k] = t;
    } else if (dB === dT) {
      kept.push(k);
    } else {
      conflicts.push({ key: k, label: labelOf(k), ours: o, theirs: t });
    }
  }

  const status: SheetMergeStatus =
    conflicts.length > 0
      ? "conflict"
      : took.length && kept.length
        ? "merged"
        : took.length
          ? "theirs"
          : kept.length
            ? "ours"
            : "identical";

  // Only the real columns are rebuilt: a record loaded from a damaged row carries
  // `corrupt`/`rawData`, and copying those onto a merge result would hand the
  // vault a record the write path is obliged to refuse.
  const record: CharacterRecord = {
    id: ours.id,
    campaignId: ours.campaignId,
    name,
    createdAt: ours.createdAt,
    updatedAt: Math.max(ours.updatedAt || 0, theirs.updatedAt || 0),
    sheet: sheet as unknown as CharacterSheet,
  };
  return { status, record, took, kept, agreed, conflicts };
}

/** Move an agreement forward for SOME fields only, leaving the rest where they
 *  were. A partial merge advances only the fields both sides now hold alike: a
 *  contested field whose base moved would stop reading as contested on the next
 *  exchange, and the disagreement would quietly resolve itself in favour of
 *  whoever spoke last — the exact failure this whole path exists to prevent. */
export function advanceFingerprint(
  base: SheetFingerprint | null,
  rec: CharacterRecord,
  fields: readonly SheetField[]
): SheetFingerprint {
  const keys: Record<string, string> = { ...(base?.keys ?? {}) };
  const norm = { name: rec.name, sheet: normalizeSheet(rec.sheet) };
  for (const k of fields) {
    const d = digestValue(fieldOf(norm, k));
    if (d === ABSENT) delete keys[k];
    else keys[k] = d;
  }
  return { keys };
}

/** Render one value for a person. Numbers and short text are shown outright,
 *  because "Rank: yours 5, theirs 6" is the whole decision; a portrait or a
 *  loadout is not something one line can show, so it says only that they differ. */
function showValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "empty";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v.length <= 40 ? `"${v}"` : `${v.length} characters`;
  if (Array.isArray(v)) return `${v.length} entries`;
  return "a different value";
}

/** The sentence shown when two versions of one sheet disagree. It names the
 *  character, the fields, and BOTH values — a person cannot settle a disagreement
 *  they are not allowed to see. */
export function describeSheetConflict(charName: string, conflicts: readonly SheetConflictField[]): string {
  if (conflicts.length === 0) return "";
  const shown = conflicts.slice(0, 3).map((c) => `${c.label} (yours ${showValue(c.ours)}, theirs ${showValue(c.theirs)})`);
  const more = conflicts.length > shown.length ? `, and ${conflicts.length - shown.length} more` : "";
  return `${charName || "A character"} was edited on both machines while they were apart — ${shown.join("; ")}${more}. Nothing was overwritten; the two copies still disagree.`;
}
