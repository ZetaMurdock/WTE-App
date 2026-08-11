// Rail grouping: presentation only, stable order, ungrouped first.
import { describe, expect, it } from "vitest";
import { folderNames, groupScenes } from "./sceneFolders";
import { newScene } from "../types/scene";

function scene(name: string, folder?: string) {
  const s = newScene("c1", name);
  if (folder !== undefined) s.data.folder = folder;
  return s;
}

describe("scene folders", () => {
  it("groups by folder, ungrouped first, folders by first appearance", () => {
    const scenes = [
      scene("Lobby"),
      scene("Vandura-Day", "Vadruna"),
      scene("Inn Explosion", "One-shots"),
      scene("Vandura-Night", "Vadruna"),
      scene("Mogul's station"),
    ];
    const groups = groupScenes(scenes);
    expect(groups.map((g) => g.folder)).toEqual([null, "Vadruna", "One-shots"]);
    expect(groups[0].scenes.map((s) => s.name)).toEqual(["Lobby", "Mogul's station"]);
    expect(groups[1].scenes.map((s) => s.name)).toEqual(["Vandura-Day", "Vandura-Night"]);
  });

  it("treats blank and whitespace folders as ungrouped", () => {
    const groups = groupScenes([scene("A", ""), scene("B", "   "), scene("C", "Real")]);
    expect(groups.map((g) => g.folder)).toEqual([null, "Real"]);
    expect(groups[0].scenes).toHaveLength(2);
  });

  it("drops the ungrouped header when every scene is foldered", () => {
    const groups = groupScenes([scene("A", "F"), scene("B", "F")]);
    expect(groups.map((g) => g.folder)).toEqual(["F"]);
  });

  it("lists folder names in rail order for the move menu", () => {
    expect(folderNames([scene("A", "Z"), scene("B", "A"), scene("C")])).toEqual(["Z", "A"]);
  });
});
