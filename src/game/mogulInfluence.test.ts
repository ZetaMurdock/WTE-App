import { describe, expect, it } from "vitest";
import {
  INFLUENCE_LEVELS,
  VOID_CONSEQUENCES,
  beaconLine,
  consequencesAt,
  crossingWarning,
  influenceOf,
  isEscalation,
} from "./mogulInfluence";

describe("the three published bands", () => {
  it("run safe → warning → extreme, in order", () => {
    expect(INFLUENCE_LEVELS.map((l) => l.band)).toEqual(["core", "marginal", "void"]);
    expect(INFLUENCE_LEVELS.map((l) => l.severity)).toEqual([0, 1, 2]);
  });

  it("carries the published names", () => {
    expect(influenceOf("core").territory).toBe("Mogul Core Administration");
    expect(influenceOf("marginal").territory).toBe("Mogul-Influenced Dominions");
    expect(influenceOf("void").territory).toBe("Unmonitored / Lawless Space");
    expect(influenceOf("core").character).toBe("Absolute Order");
    expect(influenceOf("marginal").character).toBe("High-Pressure Border");
  });

  it("only the Void sits beyond the geofence", () => {
    expect(influenceOf("core").beyondGeofence).toBe(false);
    expect(influenceOf("marginal").beyondGeofence).toBe(false);
    expect(influenceOf("void").beyondGeofence).toBe(true);
  });

  it("falls back to the Marginal Zone on junk — the border is the default posture", () => {
    expect(influenceOf(undefined).band).toBe("marginal");
    expect(influenceOf("nonsense").band).toBe("marginal");
  });
});

describe("consequences", () => {
  it("apply only past the horizon", () => {
    expect(consequencesAt("core")).toEqual([]);
    expect(consequencesAt("marginal")).toEqual([]);
    expect(consequencesAt("void")).toHaveLength(VOID_CONSEQUENCES.length);
  });

  it("names all four published ones", () => {
    const names = consequencesAt("void").map((c) => c.name);
    expect(names).toEqual(["Operator blackout", "Cipher destabilisation", "Foreign dominion", "High treason"]);
  });

  it("keeps the specific lore rather than paraphrasing it away", () => {
    const all = consequencesAt("void").map((c) => c.detail).join(" ");
    expect(all).toContain("Bio-Tank");
    expect(all).toContain("Nigraldi Swarms");
    expect(all).toContain("Tribulas Celestials");
    expect(all).toContain("high treason");
  });
});

describe("the beacon readout", () => {
  it("reads in the published shape", () => {
    expect(beaconLine({ planet: "Ashfall", sector: "Boren", band: "marginal" })).toBe(
      "Inquisitors — new location reached · Planet: Ashfall · Sector: Boren · Mogul Influence: High"
    );
  });

  it("says Absolute in the core and None in the void", () => {
    expect(beaconLine({ planet: "X", sector: "Azimuth", band: "core" })).toContain("Mogul Influence: Absolute");
    expect(beaconLine({ planet: "X", sector: "Y", band: "void" })).toContain("Mogul Influence: None");
  });

  it("labels a blank planet or sector rather than printing an empty field", () => {
    const line = beaconLine({ planet: "  ", sector: "", band: "core" });
    expect(line).toContain("Planet: Unlogged");
    expect(line).toContain("Sector: Uncharted");
  });

  it("appends a Curator note when there is one", () => {
    expect(beaconLine({ planet: "P", sector: "S", band: "core", note: "Quarantine in force" })).toContain(
      "· Quarantine in force"
    );
    expect(beaconLine({ planet: "P", sector: "S", band: "core", note: "   " })).not.toContain("·  ");
  });
});

describe("crossing the horizon", () => {
  it("warns only when jurisdiction is actually gone", () => {
    expect(crossingWarning("core")).toBe("");
    expect(crossingWarning("marginal")).toBe("");
    expect(crossingWarning("void")).toContain("Geofenced Horizon");
    expect(crossingWarning("void")).toContain("no jurisdiction");
  });

  it("spots an escalation so the app knows when to shout", () => {
    expect(isEscalation("core", "marginal")).toBe(true);
    expect(isEscalation("marginal", "void")).toBe(true);
    expect(isEscalation("void", "core")).toBe(false);
    expect(isEscalation("marginal", "marginal")).toBe(false);
    // No previous location: arriving anywhere but the core is an escalation.
    expect(isEscalation(undefined, "core")).toBe(false);
    expect(isEscalation(undefined, "void")).toBe(true);
  });
});
