import { describe, expect, it, beforeEach } from "vitest";
import { adjudicateUndoableVitals, applyUndoableCondition, type VitalsUndoEngine } from "./vitalsUndo";
import { __resetUndoRedo, redoOnce, setUndoScope, undoOnce, undoRedoState } from "../../lib/undoRedo";
import { sanitizeTokenVitalsPatch } from "../sync/patches";
import type { VttConditionClock, VttToken } from "../types/scene";
import type { VttOp } from "../sync/patches";

/**
 * A stand-in for `PixiVttApp` with the real authorisation shape: vitals writes
 * are refused on a player-owned token unless this client is the Curator, they
 * are sanitised to hp/statuses, and every accepted write emits the op a peer
 * would receive. Tests here are about undo semantics, not Pixi.
 */
function fakeEngine(
  tokens: Partial<VttToken>[],
  opts: { playerView?: boolean; stacking?: "stack" | "refresh" } = {}
) {
  const full = tokens.map((token, index) => ({
    id: `t${index}`, name: `Token ${index}`, x: 0, y: 0, size: 1, color: "#fff", visible: true, ...token,
  })) as VttToken[];
  const ops: VttOp[] = [];
  const engine = {
    scene: { data: { tokens: full, conditionClocks: undefined as VttConditionClock[] | undefined } },
    refuseAll: opts.playerView ?? false,
    stacking: opts.stacking ?? "stack",
    adjudicateTokenVitals(id: string, patch: Partial<VttToken>): boolean {
      if (engine.refuseAll) return false;
      const token = full.find((candidate) => candidate.id === id);
      if (!token) return false;
      const safe = sanitizeTokenVitalsPatch(patch);
      if (!Object.keys(safe).length) return false;
      Object.assign(token, safe);
      ops.push({ op: "token.update", id, patch: safe });
      return true;
    },
    /** The round a fresh clock is born on, so a test can move time forward. */
    round: 3,
    applyTokenCondition(input: { tokenId: string; status: string; rounds?: number }): boolean {
      const token = full.find((candidate) => candidate.id === input.tokenId);
      if (!token) return false;
      // `refresh` is what the real ConditionClockSystem does for every stacking
      // rule but `stack`: one pip, and the clock is replaced. It is the shape
      // that leaves `statuses` byte-equal while the duration moves.
      const held = token.statuses ?? [];
      const refreshing = engine.stacking === "refresh" && held.includes(input.status);
      const statuses = refreshing ? [...held] : [...held, input.status];
      if (!engine.adjudicateTokenVitals(input.tokenId, { statuses })) return false;
      const rest = (engine.scene.data.conditionClocks ?? []).filter(
        (clock) => !(refreshing && clock.tokenId === input.tokenId && clock.status === input.status)
      );
      engine.scene.data.conditionClocks = input.rounds
        ? [...rest, { tokenId: input.tokenId, status: input.status, bornRound: engine.round, rounds: input.rounds }]
        : rest.length ? rest : undefined;
      return true;
    },
    setConditionClocks(clocks: VttConditionClock[]): boolean {
      engine.scene.data.conditionClocks = clocks.length ? clocks : undefined;
      return true;
    },
    ops,
    token: (id: string) => full.find((candidate) => candidate.id === id)!,
  };
  return engine satisfies VitalsUndoEngine;
}

const refusals: string[] = [];
function opts(label: string) {
  return { label, subject: label, onRefused: (reason: string) => void refusals.push(reason) };
}

beforeEach(() => {
  __resetUndoRedo();
  setUndoScope("workspace:vtt2");
  refusals.length = 0;
});

describe("adjudicateUndoableVitals", () => {
  it("puts back the HP the write replaced, not a value read later", async () => {
    const engine = fakeEngine([{ hp: 30, hpMax: 30 }]);
    expect(adjudicateUndoableVitals(engine, "t0", { hp: 3 }, opts("damage"))).toBe(true);
    expect(engine.token("t0").hp).toBe(3);
    expect(await undoOnce()).toBe(true);
    expect(engine.token("t0").hp).toBe(30);
    expect(await redoOnce()).toBe(true);
    expect(engine.token("t0").hp).toBe(3);
  });

  it("undoes one adjudication per press, newest first", async () => {
    const engine = fakeEngine([{ hp: 30 }]);
    adjudicateUndoableVitals(engine, "t0", { hp: 20 }, opts("first"));
    adjudicateUndoableVitals(engine, "t0", { hp: 5 }, opts("second"));
    await undoOnce();
    expect(engine.token("t0").hp).toBe(20);
    await undoOnce();
    expect(engine.token("t0").hp).toBe(30);
  });

  // The property the whole module exists for: HP also moves through paths that
  // register nothing (a recurring tick, a peer snapshot). An inverse that fired
  // anyway would erase that later write instead of its own.
  it("refuses — visibly — when the value it wrote is no longer on the token", async () => {
    const engine = fakeEngine([{ hp: 30 }]);
    adjudicateUndoableVitals(engine, "t0", { hp: 20 }, opts("damage"));
    engine.adjudicateTokenVitals("t0", { hp: 12 }); // an unregistered write, e.g. a round tick
    expect(await undoOnce()).toBe(false);
    expect(engine.token("t0").hp).toBe(12);
    expect(refusals.join(" ")).toContain("has changed");
    // The unusable entry is gone rather than sitting there re-failing.
    expect(undoRedoState().canUndo).toBe(false);
  });

  it("refuses visibly when the token has left the scene", async () => {
    const engine = fakeEngine([{ hp: 30 }]);
    adjudicateUndoableVitals(engine, "t0", { hp: 20 }, opts("damage"));
    engine.scene.data.tokens.length = 0;
    expect(await undoOnce()).toBe(false);
    expect(refusals.join(" ")).toContain("no longer on this scene");
  });

  // A local-only undo is worse than no undo: the Curator sees the HP restored
  // and the table keeps looking at the damage.
  it("emits the same authorised op on the inverse that the write emitted", async () => {
    const engine = fakeEngine([{ hp: 30, owner: "peer-b" }]);
    adjudicateUndoableVitals(engine, "t0", { hp: 20 }, opts("damage"));
    await undoOnce();
    await redoOnce();
    expect(engine.ops).toEqual([
      { op: "token.update", id: "t0", patch: { hp: 20 } },
      { op: "token.update", id: "t0", patch: { hp: 30 } },
      { op: "token.update", id: "t0", patch: { hp: 20 } },
    ]);
  });

  it("registers nothing when the write was refused", () => {
    const engine = fakeEngine([{ hp: 30 }], { playerView: true });
    expect(adjudicateUndoableVitals(engine, "t0", { hp: 3 }, opts("damage"))).toBe(false);
    expect(undoRedoState().canUndo).toBe(false);
  });

  it("reports a refused inverse instead of desyncing, and drops the entry", async () => {
    const engine = fakeEngine([{ hp: 30 }]);
    adjudicateUndoableVitals(engine, "t0", { hp: 20 }, opts("damage"));
    engine.refuseAll = true;
    expect(await undoOnce()).toBe(false);
    expect(engine.token("t0").hp).toBe(20);
    expect(refusals.join(" ")).toContain("could not be written to");
  });

  // The resolution card's "applied" mark rides this hook. Re-arming a row over
  // damage that is still standing would invite the Curator to apply it twice.
  it("runs the caller's bookkeeping only after the body actually came back", async () => {
    const engine = fakeEngine([{ hp: 30 }]);
    const phases: string[] = [];
    adjudicateUndoableVitals(engine, "t0", { hp: 20 }, {
      ...opts("damage"),
      restore: (phase) => void phases.push(phase),
    });
    expect(phases).toEqual([]);
    engine.refuseAll = true;
    await undoOnce();
    expect(phases).toEqual([]);
    engine.refuseAll = false;
    // The refused entry was dropped, so re-register to reach the successful path.
    adjudicateUndoableVitals(engine, "t0", { hp: 5 }, {
      ...opts("damage"),
      restore: (phase) => void phases.push(phase),
    });
    await undoOnce();
    await redoOnce();
    expect(phases).toEqual(["undo", "redo"]);
  });

  it("registers nothing for a write that moved no number", () => {
    const engine = fakeEngine([{ hp: 30 }]);
    expect(adjudicateUndoableVitals(engine, "t0", { hp: 30 }, opts("damage"))).toBe(true);
    expect(undoRedoState().canUndo).toBe(false);
  });

  // `{ hp: undefined }` serialises to `{}`, so this inverse could only ever
  // work on the Curator's own screen.
  it("stays out of the trail when the token tracked no HP to restore", () => {
    const engine = fakeEngine([{}]);
    expect(adjudicateUndoableVitals(engine, "t0", { hp: 10 }, opts("damage"))).toBe(true);
    expect(engine.token("t0").hp).toBe(10);
    expect(undoRedoState().canUndo).toBe(false);
  });

  // The wrapper asks the SANITIZER which fields a patch will really write. A
  // caller that hands it a wider patch — the tracker's row carries hpMax beside
  // hp — must not get an inverse that also rewrites fields the write never
  // touched: those extra keys ride the wire to every peer, and they widen the
  // staleness test, so an unrelated status landing in between would refuse an
  // HP undo that was still perfectly good.
  it("builds the inverse only from the fields the writer actually accepts", async () => {
    const engine = fakeEngine([{ hp: 30, hpMax: 30, statuses: ["Prone"] }]);
    adjudicateUndoableVitals(engine, "t0", { hp: 5, hpMax: 40 }, opts("damage"));
    expect(engine.token("t0").hpMax).toBe(30);
    expect(await undoOnce()).toBe(true);
    expect(engine.ops[1]).toEqual({ op: "token.update", id: "t0", patch: { hp: 30 } });
  });

  it("restores an empty status list rather than an unwritable undefined", async () => {
    const engine = fakeEngine([{}]);
    adjudicateUndoableVitals(engine, "t0", { statuses: ["Burning"] }, opts("burn"));
    await undoOnce();
    expect(engine.token("t0").statuses).toEqual([]);
    expect(engine.ops[1]).toEqual({ op: "token.update", id: "t0", patch: { statuses: [] } });
  });

  // The sanitizer hands the patch's own array straight to the token, so an
  // inverse that passed its snapshot by reference would make the undo entry's
  // record and the live token the same array — and the next in-place edit would
  // rewrite the history the entry is holding.
  it("never hands its own record to the token as the live array", async () => {
    const engine = fakeEngine([{ statuses: ["Prone"] }]);
    adjudicateUndoableVitals(engine, "t0", { statuses: ["Prone", "Slowed"] }, opts("slow"));
    await undoOnce();
    expect(engine.token("t0").statuses).toEqual(["Prone"]);
    engine.token("t0").statuses!.push("Blinded"); // another system edits in place
    // Redo replays what the write did, not what the later edit made of it.
    expect(await redoOnce()).toBe(false);
    expect(refusals.join(" ")).toContain("has changed");
    expect(engine.token("t0").statuses).toEqual(["Prone", "Blinded"]);
  });

  it("keeps its own record when the token's live array is edited afterwards", async () => {
    const engine = fakeEngine([{ statuses: ["Prone"] }]);
    adjudicateUndoableVitals(engine, "t0", { statuses: ["Prone", "Slowed"] }, opts("slow"));
    engine.token("t0").statuses!.push("Blinded"); // in-place edit by another system
    expect(await undoOnce()).toBe(false); // stale, and refused rather than guessed
    expect(engine.token("t0").statuses).toEqual(["Prone", "Slowed", "Blinded"]);
  });
});

describe("applyUndoableCondition", () => {
  it("takes the countdown back with the pip", async () => {
    const engine = fakeEngine([{ statuses: [] }]);
    expect(applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed"))).toBe(true);
    expect(engine.scene.data.conditionClocks).toHaveLength(1);
    await undoOnce();
    expect(engine.token("t0").statuses).toEqual([]);
    expect(engine.scene.data.conditionClocks).toBeUndefined();
    await redoOnce();
    expect(engine.token("t0").statuses).toEqual(["Slowed"]);
    // Re-planned clocks would re-anchor bornRound to the current round; the
    // recorded one is the duration the table actually watched land.
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 3, rounds: 2 },
    ]);
  });

  it("leaves another token's clock alone when it undoes this one", async () => {
    const engine = fakeEngine([{ statuses: [] }, { statuses: [] }]);
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed"));
    applyUndoableCondition(engine, { tokenId: "t1", status: "Burning", rounds: 4 }, opts("Burning"));
    await undoOnce(); // undoes t1's condition
    await undoOnce(); // undoes t0's condition — the scene-wide array must not be stomped
    expect(engine.scene.data.conditionClocks).toBeUndefined();
    await redoOnce();
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 3, rounds: 2 },
    ]);
    expect(engine.token("t1").statuses).toEqual([]);
  });

  // The clock list is SCENE-wide. An inverse that wrote its whole recorded
  // array back would delete the countdown of a condition that landed on someone
  // else while this entry sat on the stack — a second body silently losing its
  // duration because the Curator took back something done to a first.
  it("leaves a bystander's countdown standing when it undoes this token's", async () => {
    const engine = fakeEngine([{ statuses: [] }, { statuses: [] }]);
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed"));
    applyUndoableCondition(engine, { tokenId: "t1", status: "Burning", rounds: 4 }, opts("Burning"));
    expect(await undoOnce()).toBe(true); // only t1's application comes off
    expect(engine.token("t1").statuses).toEqual([]);
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 3, rounds: 2 },
    ]);
  });

  // `plan` hands the SAME clock objects back out in its next list, so the scene
  // holds live references. An entry that recorded those references rather than
  // copies would have its history rewritten underneath it, and redo would put
  // back whatever the clock had since become instead of what landed.
  it("keeps its own copy of a countdown the scene later edits in place", async () => {
    const engine = fakeEngine([{ statuses: [] }]);
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed"));
    engine.scene.data.conditionClocks![0].rounds = 99; // another system edits the live clock
    expect(await undoOnce()).toBe(true);
    expect(await redoOnce()).toBe(true);
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 3, rounds: 2 },
    ]);
    // And the restore does not hand its record BACK to the scene as the live
    // clock either: that would make the very next in-place edit rewrite the
    // history the entry is still holding, one press further along.
    engine.scene.data.conditionClocks![0].rounds = 99;
    expect(await undoOnce()).toBe(true);
    expect(await redoOnce()).toBe(true);
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 3, rounds: 2 },
    ]);
  });

  // The bug this covers: every stacking rule but `stack` keeps ONE pip, so a
  // second application leaves `statuses` byte-equal and moves only the clock.
  // Registering nothing there did not merely lose the extension — it left the
  // FIRST application on top of the stack, so the next Ctrl+Z pulled the
  // condition off the token entirely under a tooltip naming the wrong act.
  it("takes back an application that moved only the countdown", async () => {
    const engine = fakeEngine([{ statuses: [] }], { stacking: "refresh" });
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed"));
    engine.round = 7; // two rounds of fight later, the Curator re-applies
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed again"));
    expect(engine.token("t0").statuses).toEqual(["Slowed"]);
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 7, rounds: 2 },
    ]);
    expect(undoRedoState().undoLabel).toBe("Slowed again");
    expect(await undoOnce()).toBe(true);
    // The refresh is gone and the condition is still standing on its original
    // clock — not stripped off the body by an inverse belonging to the earlier
    // application.
    expect(engine.token("t0").statuses).toEqual(["Slowed"]);
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Slowed", bornRound: 3, rounds: 2 },
    ]);
    // Only now does the first application come off.
    expect(await undoOnce()).toBe(true);
    expect(engine.token("t0").statuses).toEqual([]);
    expect(engine.scene.data.conditionClocks).toBeUndefined();
  });

  // The other half: a re-application that changed nothing at all must still
  // stay off the stack, or every duplicate Apply would cost a press to unwind.
  // The token carries a SECOND condition on purpose — the engine rebuilds the
  // clock list as `[...rest, winner]`, so the same clocks come back in a
  // different order, and an order-sensitive comparison would read that shuffle
  // as a change and charge the Curator a press for nothing.
  it("stays off the trail when neither the pip nor the countdown moved", () => {
    const engine = fakeEngine([{ statuses: [] }], { stacking: "refresh" });
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed"));
    applyUndoableCondition(engine, { tokenId: "t0", status: "Burning", rounds: 4 }, opts("Burning"));
    applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed", rounds: 2 }, opts("Slowed again"));
    expect(engine.scene.data.conditionClocks).toHaveLength(2);
    expect(undoRedoState().undoLabel).toBe("Burning");
  });

  // A tag with no clock is endless. Putting a duration on it is a real act on
  // the world with no visible pip change at all: the clock list grows from
  // nothing, which is the one direction a length-blind comparison misses.
  it("takes back a duration put on a condition that had none", async () => {
    const engine = fakeEngine([{ statuses: ["Marked"] }], { stacking: "refresh" });
    expect(engine.scene.data.conditionClocks).toBeUndefined();
    applyUndoableCondition(engine, { tokenId: "t0", status: "Marked", rounds: 3 }, opts("Marked"));
    expect(engine.scene.data.conditionClocks).toEqual([
      { tokenId: "t0", status: "Marked", bornRound: 3, rounds: 3 },
    ]);
    expect(await undoOnce()).toBe(true);
    expect(engine.token("t0").statuses).toEqual(["Marked"]);
    expect(engine.scene.data.conditionClocks).toBeUndefined();
  });

  it("registers nothing when the application was refused", () => {
    const engine = fakeEngine([{ statuses: [] }], { playerView: true });
    expect(applyUndoableCondition(engine, { tokenId: "t0", status: "Slowed" }, opts("Slowed"))).toBe(false);
    expect(undoRedoState().canUndo).toBe(false);
  });
});
