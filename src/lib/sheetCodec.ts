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

/** The schema version stamped on every sheet this build writes.
 *
 *  Bump ONLY alongside a migration in upgradeSheet(). A record carrying a HIGHER
 *  version than this was written by a newer build and must not be silently
 *  rewritten — see parseSheetSafe. */
export const SHEET_VERSION = 1;

/** The key the version lives under. Prefixed so it can never collide with a real
 *  sheet field, and stripped before the sheet reaches the app. */
const VERSION_KEY = "_v";

/** Bring an older record up to the current shape. One case per version step, so a
 *  v1 record opened by a future v3 build walks 1 -> 2 -> 3.
 *
 *  Nothing to do yet: version 1 IS the current shape, and pre-versioning records
 *  (no _v at all) are treated as version 1 because that is exactly what they are —
 *  the field was added without changing any other field's meaning. */
function upgradeSheet(raw: Record<string, unknown>, from: number): Record<string, unknown> {
  let out = raw;
  let v = from;
  while (v < SHEET_VERSION) {
    // switch (v) { case 1: out = ...; break; }
    v++;
  }
  return out;
}

/** Build a sheet from an already-parsed JSON value. Every field is coerced to the
 *  shape the app expects; a field that is present but the wrong type is dropped
 *  rather than trusted, and one bad field never discards the others.
 *
 *  UNKNOWN KEYS PASS THROUGH. The coerced known fields are laid over a copy of the
 *  raw object rather than replacing it, so a field written by a NEWER build
 *  survives a round trip through this one instead of being deleted on the next
 *  save. Without that, opening a character on a second machine running an older
 *  version silently stripped whatever the newer version had added. */
export function sheetFromJson(raw: unknown): CharacterSheet {
  const p0 = (isObj(raw) ? raw : {}) as Partial<CharacterSheet> & Record<string, unknown>;
  const storedV = num(p0[VERSION_KEY]) ?? 1;
  const p = upgradeSheet({ ...p0 }, storedV) as Partial<CharacterSheet> & Record<string, unknown>;
  // The version marker is bookkeeping, not a sheet field; serializeSheet re-adds it.
  delete p[VERSION_KEY];
  const rank = num(p.rank) ?? 0;
  return prune({
    ...(p as object),
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
  /** Set when the record was written by a NEWER build than this one. The sheet is
   *  still readable — unknown fields pass through — but the caller must treat it as
   *  read-only, because this build cannot know what the newer fields mean and
   *  saving would normalise them under rules that no longer apply. */
  futureVersion?: number;
  /** True when the stored text could not be parsed as JSON at all. The caller
   *  still gets a usable empty sheet, but MUST NOT overwrite the original: the
   *  raw text is handed back so the record can be recovered rather than replaced
   *  by a blank character. */
  corrupt: boolean;
  /** The unparseable text, kept verbatim for recovery. */
  raw?: string;
  error?: string;
}

/**
 * Parse the stored `data` column. Never throws.
 *
 * A JSON syntax error is NOT the only way a row can be damaged, and the first
 * version of this function only caught that one — which meant the guard missed the
 * most probable corruption of all. Two more shapes are treated as corrupt:
 *
 *   - AN EMPTY STRING. A zero-length blob is what an interrupted or failed write
 *     leaves behind, so it is damage, not absence. Only `null` means "this row
 *     genuinely has no sheet yet"; every row this app creates is written with a
 *     serialized object, so "" can never be legitimate.
 *   - VALID JSON THAT IS NOT AN OBJECT. `null`, `5`, `false`, `"str"` and `[1,2]`
 *     all parse without throwing. Coercing them to {} produced a complete blank
 *     rank-0 sheet that reported corrupt:false, so the write guard let the autosave
 *     replace the real row with it.
 */
export function parseSheetSafe(raw: string | null): SheetParse {
  if (raw === null || raw === undefined) return { sheet: emptySheet(), corrupt: false };
  if (raw === "") {
    return { sheet: emptySheet(), corrupt: true, raw, error: "the stored sheet was empty (an interrupted write)" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { sheet: emptySheet(), corrupt: true, raw, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isObj(parsed)) {
    return {
      sheet: emptySheet(),
      corrupt: true,
      raw,
      error: `the stored sheet was ${Array.isArray(parsed) ? "an array" : typeof parsed}, not a character`,
    };
  }
  // A record from a NEWER build is readable but not writable. Refusing to save is
  // the point: this build would normalise fields it does not understand, and the
  // old behaviour — strip on load, delete on the next save — destroyed them.
  const storedV = num((parsed as Record<string, unknown>)[VERSION_KEY]) ?? 1;
  const sheet = sheetFromJson(parsed);
  if (storedV > SHEET_VERSION) return { sheet, corrupt: false, futureVersion: storedV, raw };
  return { sheet, corrupt: false };
}

/** The stored form of a sheet, stamped with the schema version. */
export function serializeSheet(sheet: CharacterSheet): string {
  return JSON.stringify(prune({ ...sheet, [VERSION_KEY]: SHEET_VERSION } as Record<string, unknown>));
}
