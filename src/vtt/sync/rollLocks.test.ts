import { describe, expect, it } from "vitest";
import { enqueueRollLock } from "./rollLocks";

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
