// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Equipment, Weapon } from "../models/codex";
import { getEquipment, getWeapon, listEquipment, listWeapons, setCodexCatalog } from "./codex";

const campaignWeapon: Weapon = {
  type: "weapon",
  name: "Shared Lance",
  damage: "3d6 Radiant",
  ncCost: 4,
};

const campaignGear: Equipment = {
  type: "equipment",
  name: "Shared Mantle",
  mods: "DEX +3",
  ncCost: 2,
};

beforeEach(() => {
  localStorage.clear();
  setCodexCatalog([], []);
});

afterEach(() => {
  localStorage.clear();
  setCodexCatalog([], []);
});

describe("campaign Codex catalog precedence", () => {
  it("uses authoritative campaign records over same-name local armory records", () => {
    localStorage.setItem("wte-armory-weapons", JSON.stringify([
      { ...campaignWeapon, damage: "1d4 Kinetic", ncCost: 1 },
    ]));
    localStorage.setItem("wte-armory-gear", JSON.stringify([
      { ...campaignGear, mods: "DEX -9", ncCost: 9 },
    ]));

    setCodexCatalog([campaignWeapon], [campaignGear]);

    expect(getWeapon("shared lance")).toEqual(campaignWeapon);
    expect(getEquipment("SHARED MANTLE")).toEqual(campaignGear);
  });

  it("keeps uniquely named local armory entries available", () => {
    const localWeapon: Weapon = { type: "weapon", name: "Personal Sidearm", damage: "1d6 Kinetic" };
    const localGear: Equipment = { type: "equipment", name: "Personal Rig", mods: "INT +1" };
    localStorage.setItem("wte-armory-weapons", JSON.stringify([localWeapon]));
    localStorage.setItem("wte-armory-gear", JSON.stringify([localGear]));

    setCodexCatalog([campaignWeapon], [campaignGear]);

    expect(listWeapons()).toContainEqual(localWeapon);
    expect(listEquipment()).toContainEqual(localGear);
  });
});
