import { describe, expect, it, beforeEach } from "vitest";
import { applyUndoableCounter, type CounterUndoEngine } from "./counterUndo";
import { __resetUndoRedo, redoOnce, setUndoScope, undoOnce, undoRedoState } from "../../lib/undoRedo";
import {
  commitTokenCounter,
  planTokenCounter,
  type TokenCounterApplication,
} from "../data/tokenCounters";
import { tracksOfToken } from "../data/tokenCounters";
import type { VttSceneData, VttToken } from "../types/scene";

/**
 * A stand-in for `PixiVttApp` running the REAL counter planner and the real
 * authorisation shape: the pip commits through a vitals write that a player-view
 * client refuses, and the scene's track record is stored only once that write
 * comes back authorised. Tests here are about undo semantics, not Pixi — but the
 * arithmetic, the cap and the crossing rule are the shipped ones, because an
 * inverse built against a fake planner would prove nothing about the real one.
 */
function fakeEngine(tokens: Partial<VttToken>[], opts: { playerView?: boolean } = {}) {
  const full = tokens.map((token, index) => ({
    id: `t${index}`, name: `Token ${index}`, x: 0, y: 0, size: 1, color: "#fff", visible: true, ...token,
  })) as VttToken[];
  const data = { tokens: full } as VttSceneData;
  const engine = {
    data,
    refuseAll: opts.playerView ?? false,
    applyTokenCounter(input: TokenCounterApplication & { tokenId: string }) {
      const plan = planTokenCounter(data, input);
      if (!plan) return null;
      if (engine.refuseAll) return null;
      const token = full.find((candidate) => candidate.id === plan.tokenId);
      if (!token) return null;
      token.statuses = plan.statuses;
      commitTokenCounter(data, plan.sceneTracks);
      return plan;
    },
    tokenCounters(tokenId: string) {
      return tracksOfToken(data, tokenId);
    },
    token: (id: string) => full.find((candidate) => candidate.id === id)!,
  };
  return engine satisfies CounterUndoEngine;
}

const refusals: string[] = [];
function opts(label: string) {
  return { label, subject: label, onRefused: (reason: string) => void refusals.push(reason) };
}

function pips(engine: ReturnType<typeof fakeEngine>, id: string): string[] {
  return engine.token(id).statuses ?? [];
}

beforeEach(() => {
  __resetUndoRedo();
  setUndoScope("workspace:vtt2");
  refusals.length = 0;
});

describe("applyUndoableCounter", () => {
  it("puts the pip AND the scene's record back together", async () => {
    // The record is the half a status-only inverse would have missed: with the
    // pip fixed and the record still reading 3, the next `+1` resumes from 3 and
    // stamps a 4 nobody can explain.
    const engine = fakeEngine([{}]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 3, cap: 8 }, opts("Blight +3"));
    expect(pips(engine, "t0")).toEqual(["Blight 3/8"]);

    await undoOnce();
    expect(pips(engine, "t0")).toEqual([]);
    expect(engine.tokenCounters("t0")).toEqual([]);
    // The proof the record came back too: a fresh move starts from zero.
    expect(engine.applyTokenCounter({ tokenId: "t0", name: "Blight", delta: 1, cap: 8 })!.to).toBe(1);
  });

  it("restores a track that already held a value rather than clearing it", async () => {
    const engine = fakeEngine([{ statuses: ["Blight 5/8"] }]);
    commitTokenCounter(engine.data, [{ tokenId: "t0", name: "Blight", value: 5, cap: 8 }]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 2, cap: 8 }, opts("Blight +2"));
    expect(pips(engine, "t0")).toEqual(["Blight 7/8"]);
    await undoOnce();
    expect(pips(engine, "t0")).toEqual(["Blight 5/8"]);
    await redoOnce();
    expect(pips(engine, "t0")).toEqual(["Blight 7/8"]);
  });

  it("undoes the CLAMPED move, not the delta the page wrote", async () => {
    // `+5` into a cap of 8 from 6 lands on 8, having moved 2. An inverse built
    // from the declared delta would drive the track to 3 and invent five points
    // of Blight that were never taken off.
    const engine = fakeEngine([{ statuses: ["Blight 6/8"] }]);
    commitTokenCounter(engine.data, [{ tokenId: "t0", name: "Blight", value: 6, cap: 8 }]);
    const plan = applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 5, cap: 8 }, opts("Blight +5"));
    expect(plan).toMatchObject({ from: 6, to: 8, capped: true });
    await undoOnce();
    expect(pips(engine, "t0")).toEqual(["Blight 6/8"]);
  });

  it("registers nothing for a move the ceiling refused outright", async () => {
    // `+1` on a track already at 8. The pip is byte-identical; an entry here
    // would spend the Curator's next press on an act that changed nothing while
    // the real mistake sat one press deeper in the stack.
    const engine = fakeEngine([{ statuses: ["Blight 8/8"] }]);
    commitTokenCounter(engine.data, [{ tokenId: "t0", name: "Blight", value: 8, cap: 8 }]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 1, cap: 8 }, opts("Blight +1"));
    expect(undoRedoState().canUndo).toBe(false);
  });

  it("refuses out loud when the track moved underneath the entry", async () => {
    // Another ability nudged the same track between the write and the press.
    // Replaying the recorded move would take back the LATER change instead —
    // undo becoming a new way to lose a ruling.
    const engine = fakeEngine([{}]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 3, cap: 8 }, opts("Blight +3"));
    engine.applyTokenCounter({ tokenId: "t0", name: "Blight", delta: 2, cap: 8 });
    await undoOnce();
    expect(pips(engine, "t0")).toEqual(["Blight 5/8"]);
    expect(refusals[0]).toContain("has changed since");
  });

  it("reports a refused inverse instead of dropping the press in silence", async () => {
    const engine = fakeEngine([{}]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 3, cap: 8 }, opts("Blight +3"));
    engine.refuseAll = true;
    await undoOnce();
    expect(pips(engine, "t0")).toEqual(["Blight 3/8"]);
    expect(refusals[0]).toContain("could not be written to");
  });

  it("returns null and registers nothing when the move never landed", async () => {
    const engine = fakeEngine([{}], { playerView: true });
    expect(
      applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 1 }, opts("Blight +1"))
    ).toBeNull();
    expect(undoRedoState().canUndo).toBe(false);
  });

  it("swaps the caller's bookkeeping in step with the number", async () => {
    // The resolution card's "applied" mark and the threshold card ride this.
    const phases: string[] = [];
    const engine = fakeEngine([{}]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 3, cap: 8 }, {
      ...opts("Blight +3"),
      restore: (phase) => phases.push(phase),
    });
    expect(phases).toEqual([]);
    await undoOnce();
    expect(phases).toEqual(["undo"]);
    await redoOnce();
    expect(phases).toEqual(["undo", "redo"]);
  });

  it("leaves the bookkeeping alone when the inverse was refused", async () => {
    // Re-arming a row over a count still standing is the failure this ordering
    // exists to prevent: the mark comes back only once the body did.
    const phases: string[] = [];
    const engine = fakeEngine([{}]);
    applyUndoableCounter(engine, { tokenId: "t0", name: "Blight", delta: 3, cap: 8 }, {
      ...opts("Blight +3"),
      restore: (phase) => phases.push(phase),
    });
    engine.refuseAll = true;
    await undoOnce();
    expect(phases).toEqual([]);
    expect(pips(engine, "t0")).toEqual(["Blight 3/8"]);
  });

  it("does not re-fire the crossing on redo", async () => {
    // The card the first crossing produced is what `restore` hands back. A redo
    // that re-derived it would put two Resolution Cards on screen for one
    // arrival at 8.
    const engine = fakeEngine([{}]);
    const plan = applyUndoableCounter(
      engine,
      { tokenId: "t0", name: "Blight", delta: 8, cap: 8, thresholds: [8] },
      opts("Blight +8")
    );
    expect(plan!.crossed).toEqual([8]);
    const seen: number[][] = [];
    const real = engine.applyTokenCounter;
    engine.applyTokenCounter = (input) => {
      const out = real.call(engine, input);
      if (out) seen.push(out.crossed);
      return out;
    };
    await undoOnce();
    await redoOnce();
    expect(pips(engine, "t0")).toEqual(["Blight 8/8"]);
    expect(seen).toEqual([[], []]);
  });
});
