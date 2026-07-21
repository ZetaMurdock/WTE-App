import { describe, expect, it } from "vitest";
import {
  accordState,
  eminenceGap,
  negotiationAav,
  negotiationOutcome,
  applyAccord,
  NEGOTIATION_MAX,
} from "./negotiation";

describe("negotiation engine", () => {
  it("reads the room from remaining Resistance", () => {
    expect(accordState(0).key).toBe("accord");
    expect(accordState(15).key).toBe("receptive");
    expect(accordState(40).key).toBe("guarded");
    expect(accordState(90).key).toBe("resistant");
    expect(accordState(NEGOTIATION_MAX).key).toBe("sealed");
  });

  it("Eminence gates the room — only a shortfall costs you", () => {
    expect(eminenceGap(10, 5)).toBe(0); // clears the bar
    expect(eminenceGap(-10, 5)).toBe(15); // a known liability meeting the Directorate
    expect(eminenceGap(0, 0)).toBe(0);
  });

  it("Influence adds to the AAV and the standing gap subtracts", () => {
    const rows = [40, 40];
    expect(negotiationAav(rows, 0, 0).aav).toBe(40);
    expect(negotiationAav(rows, 6, 0).aav).toBe(46); // Influence is the social Attack Power
    expect(negotiationAav(rows, 6, 15).aav).toBe(31); // ...undercut by poor standing
    // Process soul (Influence 0) simply cannot push.
    expect(negotiationAav(rows, 0, 0).aav).toBeLessThan(negotiationAav(rows, 6, 0).aav);
  });

  it("gives the multi-skill cohesion bonus (3 -> +1, 4 -> +2)", () => {
    expect(negotiationAav([30, 30], 0, 0).cBonus).toBe(0);
    expect(negotiationAav([30, 30, 30], 0, 0).cBonus).toBe(1);
    expect(negotiationAav([30, 30, 30, 30], 0, 0).cBonus).toBe(2);
  });

  it("a strong exchange warms the client (band change is negative)", () => {
    const { diff, band } = negotiationOutcome(60, 50);
    expect(diff).toBe(10);
    expect(band.change).toBeLessThan(0); // Resistance falls toward Accord
    expect(applyAccord(50, band.change)).toBeLessThan(50);
  });

  it("a botched exchange hardens them, and the track clamps", () => {
    const bad = negotiationOutcome(30, 50);
    expect(bad.band.change).toBeGreaterThan(0);
    expect(applyAccord(0, -8)).toBe(0); // never below Accord
    expect(applyAccord(NEGOTIATION_MAX, 8)).toBe(NEGOTIATION_MAX); // never past Sealed
  });
});
