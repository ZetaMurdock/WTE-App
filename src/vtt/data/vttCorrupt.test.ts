import { describe, expect, it } from "vitest";
import { parseSceneData } from "./sceneRepo";
import { parseEncounterData } from "./encounterRepo";

// Scenes and encounters had the character-sheet bug verbatim: fall back to an empty
// document on any read failure, and because the NAME is its own column the row
// rendered with the right title and no content — reading as "my map was reset" —
// after which the 500ms (scene) / 400ms (encounter) autosave overwrote the original.
describe("scene data: damage is reported, not silently emptied", () => {
  it("treats a zero-length blob as damage", () => {
    const r = parseSceneData("");
    expect(r.corrupt).toBe(true);
    expect(r.raw).toBe("");
    expect(r.error).toMatch(/empty/i);
  });

  it("treats valid JSON that is not an object as damage", () => {
    for (const raw of ["null", "12", "true", '"str"', "[1,2]"]) {
      const r = parseSceneData(raw);
      expect(r.corrupt, raw).toBe(true);
      expect(r.raw, raw).toBe(raw);
    }
  });

  it("treats a syntax error as damage and keeps the bytes", () => {
    const raw = '{"tokens":[{"id":"t1"';
    const r = parseSceneData(raw);
    expect(r.corrupt).toBe(true);
    expect(r.raw).toBe(raw);
  });

  it("treats an absent column as a new scene, not damage", () => {
    const r = parseSceneData(null);
    expect(r.corrupt).toBe(false);
    expect(r.raw).toBeUndefined();
  });

  it("reads a real scene and merges it over the defaults", () => {
    const r = parseSceneData(JSON.stringify({ tokens: [{ id: "t1" }] }));
    expect(r.corrupt).toBe(false);
    expect(r.data.tokens).toHaveLength(1);
    // A field the stored blob omitted still comes from the defaults.
    expect(r.data.grid).toBeDefined();
  });

  it("hands back a usable blank so the UI can still render something", () => {
    const r = parseSceneData("{oops");
    expect(Array.isArray(r.data.tokens)).toBe(true);
    expect(r.data.tokens).toHaveLength(0);
  });
});

describe("encounter data: damage is reported, not silently emptied", () => {
  it("catches all three shapes", () => {
    expect(parseEncounterData("").corrupt).toBe(true);
    expect(parseEncounterData("[]").corrupt).toBe(true);
    expect(parseEncounterData("{broken").corrupt).toBe(true);
  });

  it("treats an absent column as a new encounter", () => {
    expect(parseEncounterData(null).corrupt).toBe(false);
  });

  it("reads a real encounter", () => {
    const r = parseEncounterData(JSON.stringify({ round: 3, combatants: [{ name: "A" }] }));
    expect(r.corrupt).toBe(false);
    expect(r.data.round).toBe(3);
    expect(r.data.combatants).toHaveLength(1);
  });

  it("names what it found, so a recovery screen can explain it", () => {
    expect(parseEncounterData("[1]").error).toMatch(/array/);
    expect(parseEncounterData("7").error).toMatch(/number/);
  });
});
