// Sound-library organization: an uploaded FOLDER auto-organizes — each clip is
// stored as "Folder/Clip name" and the soundboard groups by that prefix. Pure
// and unit-tested.
import type { VttAsset } from "./assetRepo";

export interface SoundGroup {
  /** "" = ungrouped clips (uploaded individually). */
  folder: string;
  sounds: VttAsset[];
}

/** Asset name for a file from a folder upload: top folder + bare filename, no
 *  extension ("Ambience/deep/cave drips.mp3" → "Ambience/cave drips"). */
export function soundNameFromFile(relPath: string): string {
  const noExt = relPath.replace(/\.[^./\\]+$/, "");
  const parts = noExt.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? noExt;
  return `${parts[0]}/${parts[parts.length - 1]}`;
}

/** Group clips by their folder prefix — ungrouped first, folders A→Z, clips A→Z. */
export function groupSounds(sounds: VttAsset[]): SoundGroup[] {
  const map = new Map<string, VttAsset[]>();
  for (const s of sounds) {
    const i = s.name.indexOf("/");
    const folder = i > 0 ? s.name.slice(0, i) : "";
    const arr = map.get(folder);
    if (arr) arr.push(s);
    else map.set(folder, [s]);
  }
  return [...map.entries()]
    .map(([folder, list]) => ({ folder, sounds: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.folder === "" ? -1 : b.folder === "" ? 1 : a.folder.localeCompare(b.folder)));
}

/** A clip's display name without its folder prefix. */
export function soundDisplayName(name: string): string {
  const i = name.indexOf("/");
  return i > 0 ? name.slice(i + 1) : name;
}
