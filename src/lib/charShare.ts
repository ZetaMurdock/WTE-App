// Share a character: a portable, offline JSON export/import. Works between
// vaults, across machines, and alongside the legacy sheet (which round-trips
// its own JSON). Live table-sharing already rides netplay (partySheets); this
// is the file-based path for handing a character to another player/Curator.
import type { CharacterSheet } from "../models/character";
import type { CharacterRecord } from "./characters";
import { sheetFromJson } from "./sheetCodec";

/** The FILE format version. Bump when the envelope changes; the sheet inside
 *  carries its own version (see sheetCodec.SHEET_VERSION). */
export const SHARE_VERSION = 1;

export interface SharedCharacter {
  wte: "character";
  version: number;
  name: string;
  sheet: CharacterSheet;
}

/** Build the portable object for a character (folder id is intentionally
 *  dropped — the receiver files it into their own vault). */
export function toSharedCharacter(rec: CharacterRecord): SharedCharacter {
  const { folderId: _folderId, ...sheet } = rec.sheet;
  return { wte: "character", version: SHARE_VERSION, name: rec.name, sheet };
}

/** Raised when a file is from a newer W.T.E than this one. */
export class ShareVersionError extends Error {
  constructor(public readonly version: number) {
    super(
      `This character file was made by a newer version of W.T.E (format ${version}). Update W.T.E to import it — importing it here could drop parts of the character.`
    );
    this.name = "ShareVersionError";
  }
}

/** Parse an imported blob — accepts the native export AND a bare sheet, so a
 *  hand-edited or legacy-adjacent file still loads. Null when unrecognizable.
 *
 *  Two things changed here.
 *
 *  The `version` field is now READ. It was written from the very first release and
 *  never checked, so a file from a future format imported as though it were this
 *  one: its unrecognised fields were dropped by the read side and then erased from
 *  storage by the next save. Refusing an import is recoverable; silently importing a
 *  mangled character is not.
 *
 *  And the sheet now goes through sheetFromJson rather than being trusted verbatim.
 *  An imported file is untrusted input — a hand-edited file, or one written by
 *  another tool, can carry a number as a JSON string ("4" instead of 4). That used
 *  to be stored as-is, read back as undefined, and erased on the next save: the
 *  character imported with a success message, looked right, then came back rank 0
 *  with default morality after a reload. */
export function fromSharedCharacter(raw: unknown): { name: string; sheet: CharacterSheet } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<SharedCharacter> & { sheet?: unknown; attributes?: unknown };
  if (o.wte === "character" && o.sheet) {
    const v = typeof o.version === "number" ? o.version : 1;
    if (v > SHARE_VERSION) throw new ShareVersionError(v);
    return { name: (typeof o.name === "string" && o.name) || "Shared Inquisitor", sheet: sheetFromJson(o.sheet) };
  }
  // A bare sheet object (has attributes/specialties) — wrap it.
  if (o.attributes || o.sheet) {
    return {
      name: (typeof o.name === "string" && o.name) || "Imported Inquisitor",
      sheet: sheetFromJson(o.sheet ?? o),
    };
  }
  return null;
}

/** Trigger a browser download of the character as `<name>.wte-character.json`. */
export function downloadCharacter(rec: CharacterRecord): void {
  const blob = new Blob([JSON.stringify(toSharedCharacter(rec), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${rec.name.replace(/[^\w.-]+/g, "_") || "character"}.wte-character.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
