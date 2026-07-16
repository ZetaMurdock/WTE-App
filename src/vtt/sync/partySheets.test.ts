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

// We are the host ("self" is the Curator) unless a case says otherwise.
const ctx = { selfId: "self", hostId: "self" };

describe("partySheets store", () => {
  it("accepts a peer's first share and binds them as owner", () => {
    expect(applyRemoteSheet(rec("A", "Kai", 3), "peer1", ctx)).toBe(true);
    expect(getPartySheets().find((e) => e.record.id === "A")?.ownerId).toBe("peer1");
  });

  it("blocks the receive→remount-save echo (the loop breaker)", () => {
    expect(shouldBroadcastSheet(rec("A", "Kai", 3), "self")).toBe(false);
  });

  it("lets a REAL local edit broadcast, exactly once", () => {
    expect(shouldBroadcastSheet(rec("A", "Kai", 5), "self")).toBe(true);
    expect(shouldBroadcastSheet(rec("A", "Kai", 5), "self")).toBe(false); // identical resend suppressed
  });

  it("REJECTS another peer updating a record they don't own", () => {
    expect(applyRemoteSheet(rec("A", "Kai", 99), "peer2", ctx)).toBe(false);
    expect(getPartySheets().find((e) => e.record.id === "A")?.record.sheet.rank).toBe(5); // unchanged
    expect(getPartySheets().find((e) => e.record.id === "A")?.ownerId).toBe("peer1"); // still peer1's
  });

  it("lets the OWNER update their own record", () => {
    expect(applyRemoteSheet(rec("A", "Kai", 6), "peer1", ctx)).toBe(true);
    expect(getPartySheets().find((e) => e.record.id === "A")?.record.sheet.rank).toBe(6);
  });

  it("lets the HOST (Curator) update anyone's record WITHOUT rebinding the owner", () => {
    expect(applyRemoteSheet(rec("A", "Kai", 7), "self", ctx)).toBe(true);
    const entry = getPartySheets().find((e) => e.record.id === "A");
    expect(entry?.record.sheet.rank).toBe(7);
    expect(entry?.ownerId).toBe("peer1"); // host edit preserves the player's ownership
  });

  it("lets a non-self host update too (player-side view)", () => {
    const playerCtx = { selfId: "playerMe", hostId: "hostGm" };
    expect(applyRemoteSheet(rec("H", "Hero", 1), "playerMe", playerCtx)).toBe(true); // own echo binds self as owner
    expect(applyRemoteSheet(rec("H", "Hero", 2), "hostGm", playerCtx)).toBe(true); // Curator edit accepted
    expect(applyRemoteSheet(rec("H", "Hero", 3), "peerX", playerCtx)).toBe(false); // stranger rejected
    expect(getPartySheets().find((e) => e.record.id === "H")?.ownerId).toBe("playerMe");
  });

  it("tracks owners per character", () => {
    applyRemoteSheet(rec("B", "Vex", 1), "peer2", ctx);
    const owners = getPartySheets().map((e) => e.record.id + ":" + e.ownerId).sort();
    expect(owners).toContain("A:peer1");
    expect(owners).toContain("B:peer2");
  });

  it("binds a brand-new local record to self", () => {
    expect(shouldBroadcastSheet(rec("C", "Me", 0), "self")).toBe(true);
    expect(getPartySheets().find((e) => e.record.id === "C")?.ownerId).toBe("self");
  });

  it("drops sheets owned by departed peers, keeps self + living", () => {
    pruneOwners(new Set(["peer1"]), "self"); // peer2 + hostGm/playerMe entries' owners left
    const ids = getPartySheets().map((e) => e.record.id).sort();
    expect(ids).toEqual(["A", "C"]);
  });

  it("returns a stable snapshot reference between mutations", () => {
    expect(getPartySheets()).toBe(getPartySheets());
  });
});
