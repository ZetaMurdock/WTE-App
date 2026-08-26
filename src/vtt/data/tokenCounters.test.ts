import { describe, it, expect } from "vitest";
import { defaultSceneData, type VttSceneData, type VttToken } from "../types/scene";
import {
  MAX_SCENE_COUNTER_TRACKS,
  commitTokenCounter,
  planClearTokenCounter,
  planTokenCounter,
  pruneCounterTracks,
  tokenCounterValue,
  tracksOfToken,
} from "./tokenCounters";

function token(id: string, statuses?: string[]): VttToken {
  return { id, name: id, x: 0, y: 0, size: 1, color: "#fff", visible: true, ...(statuses ? { statuses } : {}) };
}

function scene(...tokens: VttToken[]): VttSceneData {
  return { ...defaultSceneData(), tokens };
}

/** Move a track and commit it, which is what the engine does between the two
 *  once the authorised vitals write comes back allowed. */
function move(data: VttSceneData, tokenId: string, name: string, delta: number, extra: { cap?: number; thresholds?: number[] } = {}) {
  const plan = planTokenCounter(data, { tokenId, name, delta, ...extra });
  if (!plan) return null;
  const target = data.tokens.find((t) => t.id === plan.tokenId);
  if (target) target.statuses = plan.statuses;
  commitTokenCounter(data, plan.sceneTracks);
  return plan;
}

describe("a track counted against a body", () => {
  it("shows up as exactly one pip, on the surface statuses already use", () => {
    const data = scene(token("t1", ["Slowed"]));
    move(data, "t1", "Blight", 1, { cap: 8 });
    expect(data.tokens[0].statuses).toEqual(["Slowed", "Blight 1/8"]);
    expect(tokenCounterValue(data, "t1", "blight")).toBe(1);
  });

  it("replaces its own pip rather than stacking a second reading of one number", () => {
    // Two pips for one number is the failure that makes a table stop trusting
    // the pips at all.
    const data = scene(token("t1"));
    move(data, "t1", "Blight", 3, { cap: 8 });
    move(data, "t1", "Blight", 1, { cap: 8 });
    expect(data.tokens[0].statuses).toEqual(["Blight 4/8"]);
    expect(data.counterTracks).toHaveLength(1);
  });

  it("keeps a Curator's own tags exactly where they sit", () => {
    const data = scene(token("t1", ["Marked", "Slowed"]));
    move(data, "t1", "Blight", 1);
    move(data, "t1", "Blight", 1);
    expect(data.tokens[0].statuses).toEqual(["Marked", "Slowed", "Blight 2"]);
  });

  it("takes the pip off with the record when the track runs out", () => {
    const data = scene(token("t1", ["Slowed"]));
    move(data, "t1", "Blight", 2);
    move(data, "t1", "Blight", -2);
    expect(data.tokens[0].statuses).toEqual(["Slowed"]);
    expect(data.counterTracks).toBeUndefined();
  });

  it("leaves the field absent for a scene that never moves a counter", () => {
    // A scene that never uses a track must save and sync exactly the bytes it
    // did before tracks existed.
    const data = scene(token("t1"));
    expect("counterTracks" in data).toBe(false);
    expect(planTokenCounter(data, { tokenId: "nobody", name: "Blight", delta: 1 })).toBeNull();
    expect("counterTracks" in data).toBe(false);
  });

  it("counts each body's track separately", () => {
    const data = scene(token("t1"), token("t2"));
    move(data, "t1", "Blight", 3, { cap: 8 });
    move(data, "t2", "Blight", 1, { cap: 8 });
    expect(tokenCounterValue(data, "t1", "Blight")).toBe(3);
    expect(tokenCounterValue(data, "t2", "Blight")).toBe(1);
    expect(tracksOfToken(data, "t2")).toEqual([{ name: "Blight", value: 1, cap: 8 }]);
  });

  it("reports the marks the move crossed without acting on them", () => {
    const data = scene(token("t1"));
    const plan = move(data, "t1", "Blight", 8, { cap: 8, thresholds: [8] });
    expect(plan?.crossed).toEqual([8]);
    // Nothing here applies a threshold. The 1d100 belongs on a card in front of
    // a human, not inside the writer.
    expect(data.tokens[0].hp).toBeUndefined();
    expect(data.tokens[0].statuses).toEqual(["Blight 8/8"]);
  });

  it("refuses a new track once the scene is full, rather than trimming someone else's", () => {
    const data = scene(token("t1"), token("t2"));
    data.counterTracks = Array.from({ length: MAX_SCENE_COUNTER_TRACKS }, (_, i) => ({
      tokenId: "t2",
      name: `Track ${i}`,
      value: 1,
    }));
    expect(planTokenCounter(data, { tokenId: "t1", name: "Blight", delta: 1 })).toBeNull();
    expect(data.counterTracks).toHaveLength(MAX_SCENE_COUNTER_TRACKS);
  });
});

describe("clearing a track", () => {
  it("removes pip and record together", () => {
    const data = scene(token("t1", ["Slowed"]));
    move(data, "t1", "Blight", 4, { cap: 8 });
    const plan = planClearTokenCounter(data, "t1", "blight");
    expect(plan?.statuses).toEqual(["Slowed"]);
    expect(plan?.sceneTracks).toEqual([]);
  });

  it("does not resume a track whose pip the Curator already cleared", () => {
    // The pip is how a human ends a track. Resuming from the stored 3 and
    // stamping "Blight 4/8" onto a body the table had just cleared would make
    // the eraser look broken until the next scene load ran the prune.
    const data = scene(token("t1"));
    move(data, "t1", "Blight", 3, { cap: 8 });
    data.tokens[0].statuses = [];
    const plan = move(data, "t1", "Blight", 1, { cap: 8 });
    expect(plan).toMatchObject({ from: 0, to: 1 });
    expect(data.tokens[0].statuses).toEqual(["Blight 1/8"]);
    expect(data.counterTracks).toEqual([{ tokenId: "t1", name: "Blight", value: 1, cap: 8 }]);
  });

  it("reports nothing to do rather than an empty write", () => {
    const data = scene(token("t1", ["Slowed"]));
    expect(planClearTokenCounter(data, "t1", "Blight")).toBeNull();
  });
});

describe("pruning", () => {
  it("drops a track whose body is gone", () => {
    // A record outliving its token would keep a fight's Blight alive invisibly.
    const data = scene(token("t1"));
    move(data, "t1", "Blight", 2);
    data.tokens = [];
    expect(pruneCounterTracks(data)).toBe(true);
    expect(data.counterTracks).toBeUndefined();
  });

  it("drops a track whose pip the Curator cleared by hand", () => {
    // The pip is what a table reads, so clearing it is how a human says the
    // track is over. A surviving record would resurrect the pip out of nowhere
    // the next time an ability touched the track.
    const data = scene(token("t1"));
    move(data, "t1", "Blight", 2);
    data.tokens[0].statuses = [];
    expect(pruneCounterTracks(data)).toBe(true);
    expect(data.counterTracks).toBeUndefined();
  });

  it("keeps a live track and reports no change", () => {
    const data = scene(token("t1"));
    move(data, "t1", "Blight", 2, { cap: 8 });
    expect(pruneCounterTracks(data)).toBe(false);
    expect(data.counterTracks).toHaveLength(1);
  });

  it("drops a duplicate record for one body's one track", () => {
    const data = scene(token("t1", ["Blight 2"]));
    data.counterTracks = [
      { tokenId: "t1", name: "Blight", value: 2 },
      { tokenId: "t1", name: "blight", value: 7 },
    ];
    expect(pruneCounterTracks(data)).toBe(true);
    expect(data.counterTracks).toEqual([{ tokenId: "t1", name: "Blight", value: 2 }]);
  });

  it("does NOT decay anything a round or an encounter went past", () => {
    // No page in the corpus can declare a decay, so nothing here invents one.
    const data = scene(token("t1"));
    move(data, "t1", "Blight", 5, { cap: 8 });
    data.timeline = { round: 40, turn: 3 };
    expect(pruneCounterTracks(data)).toBe(false);
    expect(tokenCounterValue(data, "t1", "Blight")).toBe(5);
  });
});
