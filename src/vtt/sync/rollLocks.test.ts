import { describe, expect, it } from "vitest";
import { dequeueRollLock, enqueueRollLock } from "./rollLocks";

describe("Roll Axis lock queue", () => {
  it("replaces a stale ordinary formula immediately", () => {
    const next = enqueueRollLock(
      [{ label: "STR Check", expr: "1d20+2" }],
      { label: "Evasion Save", expr: "1d20-3" }
    );
    expect(next).toEqual([{ label: "Evasion Save", expr: "1d20-3" }]);
  });

  it("keeps Curator requests ahead of an ordinary selection", () => {
    const requested = { label: "Requested Save", expr: "1d20", requestId: "req-1" };
    expect(enqueueRollLock([requested], { label: "Power Check", expr: "1d20+4" })).toEqual([
      requested,
      { label: "Power Check", expr: "1d20+4" },
    ]);
  });

  it("deduplicates a repeated Curator request", () => {
    const requested = { label: "Requested Save", expr: "1d20", requestId: "req-1" };
    const current = [requested];
    expect(enqueueRollLock(current, requested)).toBe(current);
  });
});

describe("removing an answered request", () => {
  it("removes the request that was answered, not the head of the queue", () => {
    const first = { label: "First", expr: "1d20", requestId: "req-1" };
    const second = { label: "Second", expr: "1d20", requestId: "req-2" };
    const third = { label: "Third", expr: "1d20", requestId: "req-3" };
    expect(dequeueRollLock([first, second, third], second)).toEqual([first, third]);
  });

  it("drops an ordinary lock by identity so a duplicate label survives", () => {
    const armed = { label: "Power Check", expr: "1d20+4" };
    const twin = { label: "Power Check", expr: "1d20+4" };
    expect(dequeueRollLock([twin, armed], armed)).toEqual([twin]);
  });

  it("leaves the queue alone when the lock is already gone", () => {
    const queue = [{ label: "First", expr: "1d20", requestId: "req-1" }];
    expect(dequeueRollLock(queue, { label: "Stale", expr: "1d20" })).toBe(queue);
  });
});
