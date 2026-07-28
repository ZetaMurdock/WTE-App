// The CharacterSheet codec — the ONE place a sheet is turned into stored JSON and
// back. Kept free of any DB or Tauri import so it is directly testable.
//
// Why this module exists: parseSheet used to be an allowlist that rebuilt the sheet
// field by field, and it silently dropped SEVEN fields the app was actively writing
// (innateChoice, sector, morality, eminence, pressure, allowOverrides,
// derivedOverrides — plus focusBonus/focusBonusRank, found earlier). Because every
// save re-serializes the object the parser returned, the first save after any reload
// deleted those fields from storage for good.
//
// Nothing here may be an allowlist that a new field can fall out of. SHEET_KEYS is
// checked against keyof CharacterSheet at COMPILE time, so adding a field to the
// model and forgetting it here is a build error, not a silent loss.
import type { CharacterSheet } from "../models/character";
import { zeroAttributes, zeroSpecialties } from "../game/wte";
import { migrateLoadout, parseSpend } from "../game/synapticFocus";
import { parseBioFields } from "./bioFields";

/** Every field a stored sheet may carry. Exhaustive by construction — see the
 *  compile-time checks below. */
export const SHEET_KEYS = [
  "attributes",
  "specialties",
  "speciesId",
  "variantName",
  "variantOption",
  "innateChoice",
  "paradigmId",
  "rank",
  "portrait",
  "background",
  "sizeId",
  "sector",
  "morality",
  "eminence",
  "pressure",
  "negotiation",
  "equipment",
  "genusLoadout",
  "cipherLoadout",
  "bioFields",
  "focusSpend",
  "focusBonus",
  "focusBonusRank",
  "weaponLoadout",
  "gearLoadout",
  "ssSpent",
  "allowOverrides",
  "derivedOverrides",
  "notes",
  "folderId",
  "tags",
  "notesMd",
] as const;

export type SheetKey = (typeof SHEET_KEYS)[number];

// ── Compile-time exhaustiveness ─────────────────────────────────────────────────
// Add a field to CharacterSheet without adding it to SHEET_KEYS and `_missing`
// stops being `never`, so this file fails to build. Name a key that is not on the
// model and `_extra` does the same. This is the guard that makes the bug class
// above impossible to reintroduce quietly.
// (A plain `const x: Missing[] = []` would NOT work — an empty array satisfies any
// element type. The constraint has to be on a type parameter to bite.)
type MustBeNever<T extends never> = T;
export type _NoSheetKeyMissing = MustBeNever<Exclude<keyof CharacterSheet, SheetKey>>;
export type _NoSheetKeyExtra = MustBeNever<Exclude<SheetKey, keyof CharacterSheet>>;

/** A brand-new sheet. */
export function emptySheet(): CharacterSheet {
  return { attributes: zeroAttributes(), specialties: zeroSpecialties(), rank: 0, notes: "" };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strArr = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Drop keys whose value is undefined, so a round trip through JSON is stable and
 *  a deep-equal test means what it looks like it means. */
function prune<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Build a sheet from an already-parsed JSON value. Every field is coerced to the
 *  shape the app expects; a field that is present but the wrong type is dropped
 *  rather than trusted, and one bad field never discards the others. */
export function sheetFromJson(raw: unknown): CharacterSheet {
  const p = (isObj(raw) ? raw : {}) as Partial<CharacterSheet> & Record<string, unknown>;
  const rank = num(p.rank) ?? 0;
  return prune({
    attributes: { ...zeroAttributes(), ...(isObj(p.attributes) ? p.attributes : {}) },
    specialties: { ...zeroSpecialties(), ...(isObj(p.specialties) ? p.specialties : {}) },
    speciesId: str(p.speciesId),
    variantName: str(p.variantName),
    variantOption: str(p.variantOption),
    // Empty/undefined means "all innates active" for pre-choose-2-of-4 sheets, so
    // an empty array must NOT be normalised away into undefined or vice versa.
    innateChoice: strArr(p.innateChoice),
    paradigmId: str(p.paradigmId),
    rank,
    portrait: str(p.portrait),
    background: isObj(p.background) ? (p.background as CharacterSheet["background"]) : undefined,
    sizeId: str(p.sizeId) || "auto",
    sector: str(p.sector),
    morality: num(p.morality),
    eminence: num(p.eminence),
    pressure: num(p.pressure),
    negotiation: isObj(p.negotiation) ? (p.negotiation as CharacterSheet["negotiation"]) : undefined,
    equipment: Array.isArray(p.equipment) ? p.equipment : [],
    genusLoadout: strArr(p.genusLoadout) ?? [],
    cipherLoadout: strArr(p.cipherLoadout) ?? [],
    bioFields: parseBioFields(p.bioFields),
    // Focus is the source of truth for genus. A sheet written before the rework has
    // no focusSpend, so seed it from the old flat loadout at Focus 1 each — within
    // budget, never silently upgraded.
    focusSpend: p.focusSpend ? parseSpend(p.focusSpend) : migrateLoadout(strArr(p.genusLoadout) ?? [], rank),
    focusBonus: num(p.focusBonus),
    focusBonusRank: num(p.focusBonusRank),
    weaponLoadout: strArr(p.weaponLoadout) ?? [],
    gearLoadout: strArr(p.gearLoadout) ?? [],
    ssSpent: num(p.ssSpent) ?? 0,
    allowOverrides: bool(p.allowOverrides),
    derivedOverrides: isObj(p.derivedOverrides) ? (p.derivedOverrides as CharacterSheet["derivedOverrides"]) : undefined,
    notes: str(p.notes) ?? "",
    folderId: p.folderId === null ? null : str(p.folderId),
    tags: strArr(p.tags) ?? [],
    notesMd: str(p.notesMd) ?? "",
  });
}

export interface SheetParse {
  sheet: CharacterSheet;
  /** True when the stored text could not be parsed as JSON at all. The caller
   *  still gets a usable empty sheet, but MUST NOT overwrite the original: the
   *  raw text is handed back so the record can be recovered rather than replaced
   *  by a blank character. */
  corrupt: boolean;
  /** The unparseable text, kept verbatim for recovery. */
  raw?: string;
  error?: string;
}

/** Parse the stored `data` column. Never throws. */
export function parseSheetSafe(raw: string | null): SheetParse {
  if (!raw) return { sheet: emptySheet(), corrupt: false };
  try {
    return { sheet: sheetFromJson(JSON.parse(raw)), corrupt: false };
  } catch (e) {
    return { sheet: emptySheet(), corrupt: true, raw, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The stored form of a sheet. */
export function serializeSheet(sheet: CharacterSheet): string {
  return JSON.stringify(prune({ ...sheet }));
}
