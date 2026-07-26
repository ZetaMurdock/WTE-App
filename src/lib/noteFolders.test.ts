import { describe, expect, it } from "vitest";
import {
  addFolder,
  descendantIds,
  notesInFolder,
  notesUnderFolder,
  pathLabel,
  removeFolderKeepingNotes,
  type NoteFolder,
} from "./noteFolders";

type N = { id: string; folderId?: string | null };

function tree() {
  let f: NoteFolder[] = addFolder([], "Act 2");
  const act = f[0].id;
  f = addFolder(f, "The Vault", act);
  const vault = f[1].id;
  f = addFolder(f, "Floor 3", vault);
  return { f, act, vault, floor: f[2].id };
}

describe("note folders reuse the vault tree logic", () => {
  it("nests, and reads back a breadcrumb", () => {
    const { f, floor } = tree();
    expect(f).toHaveLength(3);
    expect(pathLabel(f, floor)).toBe("Act 2 › The Vault › Floor 3");
  });

  it("knows its descendants", () => {
    const { f, act, vault, floor } = tree();
    expect(descendantIds(f, act).sort()).toEqual([floor, vault].sort());
    expect(descendantIds(f, floor)).toEqual([]);
  });
});

describe("filing notes", () => {
  const { f, act, vault, floor } = tree();
  const notes: N[] = [
    { id: "n1", folderId: act },
    { id: "n2", folderId: vault },
    { id: "n3", folderId: floor },
    { id: "n4", folderId: null },
    { id: "n5" },
  ];

  it("lists only what sits DIRECTLY in a folder", () => {
    expect(notesInFolder(notes, vault).map((n) => n.id)).toEqual(["n2"]);
  });

  it("treats a missing folderId as loose at the root", () => {
    expect(notesInFolder(notes, null).map((n) => n.id)).toEqual(["n4", "n5"]);
  });

  it("counts everything BENEATH a folder, so a folder of folders isn't 'empty'", () => {
    // The bug this guards: Act 2 holds one note directly but three in its subtree.
    expect(notesInFolder(notes, act)).toHaveLength(1);
    expect(notesUnderFolder(f, notes, act).map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
  });
});

describe("deleting a folder", () => {
  it("re-homes its notes to the root instead of destroying them", () => {
    const { f, vault } = tree();
    const notes: N[] = [
      { id: "keep", folderId: null },
      { id: "inVault", folderId: vault },
      { id: "inFloor", folderId: f[2].id },
    ];
    const out = removeFolderKeepingNotes(f, notes, vault);
    // The folder and its child are gone...
    expect(out.folders.map((x) => x.name)).toEqual(["Act 2"]);
    expect(out.removed).toHaveLength(2);
    // ...but every note survives, loose at the root.
    expect(out.notes).toHaveLength(3);
    expect(out.notes.filter((n) => n.folderId == null).map((n) => n.id).sort()).toEqual(
      ["inFloor", "inVault", "keep"]
    );
  });

  it("leaves notes in unrelated folders alone", () => {
    const { f, act, vault } = tree();
    const notes: N[] = [{ id: "a", folderId: act }];
    const out = removeFolderKeepingNotes(f, notes, vault);
    expect(out.notes[0].folderId).toBe(act);
  });
});
