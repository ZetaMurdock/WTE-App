import { describe, expect, it } from "vitest";
import { groupSounds, soundDisplayName, soundNameFromFile } from "./soundLib";
import type { VttAsset } from "./assetRepo";

function asset(name: string): VttAsset {
  return { id: "as-" + name, campaignId: "c1", kind: "sound", name, uri: "data:x", createdAt: 0 };
}

describe("soundNameFromFile", () => {
  it("keeps the top folder and drops the extension", () => {
    expect(soundNameFromFile("Ambience/cave drips.mp3")).toBe("Ambience/cave drips");
  });
  it("collapses nested folders to the top one", () => {
    expect(soundNameFromFile("Ambience/deep/cave drips.mp3")).toBe("Ambience/cave drips");
  });
  it("handles backslash separators", () => {
    expect(soundNameFromFile("Combat\\sword clash.ogg")).toBe("Combat/sword clash");
  });
  it("a bare file has no folder", () => {
    expect(soundNameFromFile("thunder.wav")).toBe("thunder");
  });
  it("only the trailing extension is stripped", () => {
    expect(soundNameFromFile("FX/dr. strange.laugh.mp3")).toBe("FX/dr. strange.laugh");
  });
});

describe("groupSounds", () => {
  it("groups by folder prefix with ungrouped first", () => {
    const groups = groupSounds([asset("Combat/clash"), asset("thunder"), asset("Ambience/drips"), asset("Ambience/wind")]);
    expect(groups.map((g) => g.folder)).toEqual(["", "Ambience", "Combat"]);
    expect(groups[1].sounds.map((s) => s.name)).toEqual(["Ambience/drips", "Ambience/wind"]);
  });
  it("sorts clips alphabetically inside a group", () => {
    const groups = groupSounds([asset("Ambience/wind"), asset("Ambience/drips")]);
    expect(groups[0].sounds.map((s) => s.name)).toEqual(["Ambience/drips", "Ambience/wind"]);
  });
  it("empty in, empty out", () => {
    expect(groupSounds([])).toEqual([]);
  });
});

describe("soundDisplayName", () => {
  it("strips the folder prefix", () => {
    expect(soundDisplayName("Ambience/drips")).toBe("drips");
  });
  it("leaves ungrouped names alone", () => {
    expect(soundDisplayName("thunder")).toBe("thunder");
  });
});
