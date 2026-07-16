// Ordered sequence against the module-level store (mirrors app runtime).
import { describe, it, expect } from "vitest";
import { applyRemoteSheet, getPartySheets, pruneOwners, shouldBroadcastSheet } from "./partySheets";
import type { CharacterRecord } from "../../lib/characters";

const rec = (id: string, name: string, rank: number): CharacterRecord => ({
  id,
  campaignId: "c1",
  name,
  createdAt: 1,
  updatedAt: 2,
  sheet: { attributes: {} as CharacterRecord["sheet"]["attributes"], specialties: {} as CharacterRecord["sheet"]["specialties"], rank, notes: "" },
});

describe("partySheets store", () => {
  it("blocks the receive→remount-save echo (the loop breaker)", () => {
    applyRemoteSheet(rec("A", "Kai", 3), "peer1");
    expect(shouldBroadcastSheet(rec("A", "Kai", 3), "self")).toBe(false);
  });

  it("lets a REAL local edit broadcast, exactly once", () => {
    expect(shouldBroadcastSheet(rec("A", "Kai", 5), "self")).toBe(true);
    expect(shouldBroadcastSheet(rec("A", "Kai", 5), "self")).toBe(false); // identical resend suppressed
  });

  it("suppresses the peer echo of our own edit", () => {
    applyRemoteSheet(rec("A", "Kai", 5), "peer1");
    expect(shouldBroadcastSheet(rec("A", "Kai", 5), "self")).toBe(false);
  });

  it("tracks owners per character", () => {
    applyRemoteSheet(rec("B", "Vex", 1), "peer2");
    const owners = getPartySheets().map((e) => e.record.id + ":" + e.ownerId).sort();
    expect(owners).toContain("A:peer1");
    expect(owners).toContain("B:peer2");
  });

  it("binds a brand-new local record to self", () => {
    expect(shouldBroadcastSheet(rec("C", "Me", 0), "self")).toBe(true);
    expect(getPartySheets().find((e) => e.record.id === "C")?.ownerId).toBe("self");
  });

  it("drops sheets owned by departed peers, keeps self + living", () => {
    pruneOwners(new Set(["peer1"]), "self"); // peer2 left
    const ids = getPartySheets().map((e) => e.record.id).sort();
    expect(ids).toEqual(["A", "C"]);
  });

  it("returns a stable snapshot reference between mutations", () => {
    expect(getPartySheets()).toBe(getPartySheets());
  });
});
