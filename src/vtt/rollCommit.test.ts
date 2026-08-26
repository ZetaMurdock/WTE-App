import { afterEach, describe, expect, it, vi } from "vitest";
import { commitRoll, prepareRoll, rollLockExpired, rollLockLabel, type RollLock } from "./rollCommit";
import { clearSessionRolls, getSessionRolls } from "./sync/rollSession";
import { logRoll } from "../lib/rolls";
import type { RollMessage } from "../net/protocol";

// Only the durable write is stubbed — the id minting and the expression parser
// have to stay real, because what the host validates is what THEY produce.
vi.mock("../lib/rolls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/rolls")>()),
  logRoll: vi.fn(async () => {}),
}));

afterEach(() => {
  clearSessionRolls();
  vi.mocked(logRoll).mockClear();
});

const deps = (over: Partial<Parameters<typeof commitRoll>[3]> = {}) => ({
  campaignId: null,
  feedKey: "table-1",
  selfId: "player-1",
  ...over,
});

describe("the roll path the tray and the prompt share", () => {
  it("files a requested roll under the lock's actor, not the roller's own", () => {
    const publishRoll = vi.fn<(message: RollMessage) => void>();
    const lock: RollLock = {
      label: "Gravitic Snare — Physical Save",
      requestId: "req-1",
      actor: { characterId: "npc-7", tokenId: "tok-7", name: "Stygian Warden" },
    };
    const prepared = prepareRoll(rollLockLabel(lock, "Balance"), "1d40+29")!;

    commitRoll(prepared.roll, prepared.baseExpr, lock, deps({ publishRoll, actor: { characterId: "pc-1", name: "Vale" } }));

    const message = publishRoll.mock.calls[0][0];
    expect(message.requestId).toBe("req-1");
    expect(message.actor?.characterId).toBe("npc-7");
    expect(message.actor?.tokenId).toBe("tok-7");
    expect(message.label).toBe("Gravitic Snare — Physical Save · Balance");
    // The host compares the canonical form it precomputed, so what ships as
    // baseExpr must be canonical rather than whatever text armed the lock.
    expect(message.baseExpr).toBe(prepared.baseExpr);
    expect(getSessionRolls("table-1")[0].who).toBe("Stygian Warden");
  });

  it("whispers to the host instead of broadcasting when a publishRoll is supplied", () => {
    const publishRoll = vi.fn<(message: RollMessage) => void>();
    const broadcast = vi.fn<(message: RollMessage) => void>();
    const prepared = prepareRoll("Evasion", "1d20+2")!;

    commitRoll(prepared.roll, prepared.baseExpr, null, deps({ publishRoll, broadcast }));

    expect(publishRoll).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("writes the campaign's durable history row, not only the session feed", () => {
    const prepared = prepareRoll("Evasion", "1d20+2")!;
    const lock: RollLock = { label: "Evasion", requestId: "req-9", actor: { characterId: "pc-3", name: "Vale" } };

    commitRoll(prepared.roll, prepared.baseExpr, lock, deps({ campaignId: "camp-1", publishRoll: vi.fn() }));

    // The roll history survives the session; a roll that reached only the feed
    // is gone at the next launch and absent from the campaign log entirely.
    expect(vi.mocked(logRoll)).toHaveBeenCalledTimes(1);
    const [campaignId, characterId, roll, meta] = vi.mocked(logRoll).mock.calls[0];
    expect(campaignId).toBe("camp-1");
    expect(characterId).toBe("pc-3");
    expect(roll.result).toBe(prepared.roll.result);
    expect(meta).toMatchObject({ baseExpr: prepared.baseExpr, actorName: "Vale", requestId: "req-9" });
  });

  it("never writes history for a campaign that is not open", () => {
    const prepared = prepareRoll("Evasion", "1d20+2")!;
    commitRoll(prepared.roll, prepared.baseExpr, null, deps({ publishRoll: vi.fn() }));
    expect(vi.mocked(logRoll)).not.toHaveBeenCalled();
  });

  it("throws the posture it was asked for, not a flat die", () => {
    // The prompt's Shift-click and right-click reach the dice through here and
    // nowhere else. Dropping the argument would leave Advantage looking exactly
    // like a normal roll, on the wire and in the log.
    expect(prepareRoll("Evasion", "1d20+2", "adv")!.roll.detail.mode).toBe("adv");
    expect(prepareRoll("Evasion", "1d20+2", "dis")!.roll.detail.mode).toBe("dis");
    expect(prepareRoll("Evasion", "1d20+2")!.roll.detail.mode ?? "normal").toBe("normal");
  });

  it("names the lock alone when no Roll Axis source answered it", () => {
    expect(rollLockLabel({ label: "Physical Save" })).toBe("Physical Save");
    expect(rollLockLabel({ label: "Physical Save" }, null)).toBe("Physical Save");
    expect(rollLockLabel({ label: "Physical Save" }, "Balance")).toBe("Physical Save · Balance");
  });

  it("refuses dice it cannot parse rather than substituting a bare die", () => {
    expect(prepareRoll("Evasion", "banana")).toBeNull();
    expect(prepareRoll("Evasion", "")).toBeNull();
  });

  it("treats only a passed deadline as expired, and an undated lock as live", () => {
    const now = 1_000_000;
    expect(rollLockExpired({ label: "Save", expiresAt: now - 1 }, now)).toBe(true);
    expect(rollLockExpired({ label: "Save", expiresAt: now + 1 }, now)).toBe(false);
    // ON the deadline the host has already freed the slot, so the last legal
    // millisecond is the one before it.
    expect(rollLockExpired({ label: "Save", expiresAt: now }, now)).toBe(true);
    // A Curator rolling locally has no host slot to lose, so no deadline.
    expect(rollLockExpired({ label: "Save" }, now)).toBe(false);
  });
});
