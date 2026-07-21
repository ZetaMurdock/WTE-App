import { describe, expect, it } from "vitest";
import { addFolder, renameFolder, moveFolder, removeFolder, descendantIds, wouldCycle, folderPath, pathLabel } from "./charFolders";

describe("character-vault folders", () => {
  function tree() {
    let l = addFolder([], "NPCs");
    const npcs = l[0].id;
    l = addFolder(l, "Bosses", npcs);
    const bosses = l[1].id;
    l = addFolder(l, "Act 1", bosses);
    return { l, npcs, bosses, act1: l[2].id };
  }

  it("adds nested folders and trims blank names", () => {
    const { l } = tree();
    expect(l).toHaveLength(3);
    expect(addFolder(l, "   ")).toHaveLength(3); // blank refused
    expect(l.find((f) => f.name === "Bosses")?.parentId).toBe(l[0].id);
  });

  it("renames in place", () => {
    const { l, bosses } = tree();
    expect(renameFolder(l, bosses, "Elites").find((f) => f.id === bosses)?.name).toBe("Elites");
  });

  it("lists descendants and removes a subtree", () => {
    const { l, npcs, bosses, act1 } = tree();
    expect(descendantIds(l, npcs).sort()).toEqual([bosses, act1].sort());
    const { list, removed } = removeFolder(l, npcs);
    expect(list).toHaveLength(0);
    expect(removed).toContain(act1);
  });

  it("refuses to move a folder into its own descendant (no cycles)", () => {
    const { l, npcs, act1 } = tree();
    expect(wouldCycle(l, npcs, act1)).toBe(true);
    expect(moveFolder(l, npcs, act1)).toEqual(l); // unchanged
    // a legal move re-parents to root
    expect(moveFolder(l, act1, null).find((f) => f.id === act1)?.parentId).toBeNull();
  });

  it("builds the Area › Place path for a nested folder", () => {
    const { l, act1 } = tree();
    expect(folderPath(l, act1).map((f) => f.name)).toEqual(["NPCs", "Bosses", "Act 1"]);
    expect(pathLabel(l, act1)).toBe("NPCs › Bosses › Act 1");
    expect(pathLabel(l, null)).toBe("Unfiled");
  });
});
