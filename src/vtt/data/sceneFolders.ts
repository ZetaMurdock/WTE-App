// Scene Rail grouping: one level of Curator-named folders, because a campaign
// past ten scenes turns the rail into a scroll chore. Grouping is pure
// presentation over the scenes array — nothing about scene order, stepping,
// or storage changes.
import type { VttScene } from "../types/scene";

export interface SceneGroup {
  /** null = the ungrouped scenes, always shown first. */
  folder: string | null;
  scenes: VttScene[];
}

/** The rail's display order: ungrouped scenes first, then folders in order of
 *  first appearance. Scene order inside a group is the campaign's own. */
export function groupScenes(scenes: VttScene[]): SceneGroup[] {
  const groups: SceneGroup[] = [];
  const byName = new Map<string | null, SceneGroup>();
  const get = (folder: string | null): SceneGroup => {
    const hit = byName.get(folder);
    if (hit) return hit;
    const g = { folder, scenes: [] };
    byName.set(folder, g);
    groups.push(g);
    return g;
  };
  get(null); // ungrouped leads even when empty (dropped below)
  for (const s of scenes) {
    const folder = s.data.folder?.trim() || null;
    get(folder).scenes.push(s);
  }
  return groups.filter((g) => g.scenes.length > 0);
}

/** Every folder name in use, in rail order — the "Move to folder…" choices. */
export function folderNames(scenes: VttScene[]): string[] {
  return groupScenes(scenes)
    .map((g) => g.folder)
    .filter((f): f is string => f !== null);
}
