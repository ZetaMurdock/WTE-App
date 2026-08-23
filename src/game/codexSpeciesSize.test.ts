import { afterEach, describe, expect, it } from "vitest";
import { registerCodexGameData, SPECIES_SIZE } from "./wte";

afterEach(() => registerCodexGameData({}));

describe("Codex species size registration", () => {
  it("resets the previous campaign's size overlay before applying the next one", () => {
    const bakedHyomen = SPECIES_SIZE.hyomen;
    registerCodexGameData({ sizes: { hyomen: "huge", homebrew: "small" } });
    expect(SPECIES_SIZE).toMatchObject({ hyomen: "huge", homebrew: "small" });

    registerCodexGameData({ sizes: {} });
    expect(SPECIES_SIZE.hyomen).toBe(bakedHyomen);
    expect(SPECIES_SIZE.homebrew).toBeUndefined();
  });
});
