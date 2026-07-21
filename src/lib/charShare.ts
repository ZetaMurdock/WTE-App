// Share a character: a portable, offline JSON export/import. Works between
// vaults, across machines, and alongside the legacy sheet (which round-trips
// its own JSON). Live table-sharing already rides netplay (partySheets); this
// is the file-based path for handing a character to another player/Curator.
import type { CharacterSheet } from "../models/character";
import type { CharacterRecord } from "./characters";

export interface SharedCharacter {
  wte: "character";
  version: 1;
  name: string;
  sheet: CharacterSheet;
}

/** Build the portable object for a character (folder id is intentionally
 *  dropped — the receiver files it into their own vault). */
export function toSharedCharacter(rec: CharacterRecord): SharedCharacter {
  const { folderId: _folderId, ...sheet } = rec.sheet;
  return { wte: "character", version: 1, name: rec.name, sheet };
}

/** Parse an imported blob — accepts the native export AND a bare sheet, so a
 *  hand-edited or legacy-adjacent file still loads. Null when unrecognizable. */
export function fromSharedCharacter(raw: unknown): { name: string; sheet: CharacterSheet } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<SharedCharacter> & { sheet?: CharacterSheet; attributes?: unknown };
  if (o.wte === "character" && o.sheet) return { name: o.name || "Shared Inquisitor", sheet: o.sheet };
  // A bare sheet object (has attributes/specialties) — wrap it.
  if (o.attributes || o.sheet) {
    const sheet = (o.sheet ?? (o as unknown as CharacterSheet)) as CharacterSheet;
    return { name: o.name || "Imported Inquisitor", sheet };
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
