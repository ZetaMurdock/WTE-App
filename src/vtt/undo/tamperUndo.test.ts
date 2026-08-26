import { describe, expect, it, beforeEach } from "vitest";
import { commitUndoableTamper, type TamperUndoEngine } from "./tamperUndo";
import { __resetUndoRedo, redoOnce, setUndoScope, undoOnce } from "../../lib/undoRedo";
import { planTamper } from "../data/tamperPlan";
import { listTamperTargets, type TamperTarget } from "../data/tamperTargets";
import { sanitizeTokenVitalsPatch, type VttOp } from "../sync/patches";
import {
  defaultSceneData,
  type VttConditionClock,
  type VttCounterTrack,
  type VttEffect,
  type VttSceneData,
  type VttToken,
} from "../types/scene";

const SIZE = 70;

/**
 * A stand-in for `PixiVttApp` with the real authorisation shape: a vitals write
 * is refused on a token this client may not touch, every accepted write emits
 * the op a peer would receive, and the effect writes sync as remove + add the
 * way the engine's own `putEffects` does. Tests here are about undo semantics,
 * not Pixi.
 */
function fakeEngine(data: VttSceneData, opts: { refuse?: string[] } = {}) {
  const ops: VttOp[] = [];
  const refuse = new Set(opts.refuse ?? []);
  const engine = {
    scene: { data },
    adjudicateTokenVitals(id: string, patch: { statuses: string[] }): boolean {
      if (refuse.has(id)) return false;
      const token = data.tokens.find((candidate) => candidate.id === id);
      if (!token) return false;
      const safe = sanitizeTokenVitalsPatch(patch as Partial<VttToken>);
      if (!Object.keys(safe).length) return false;
      Object.assign(token, safe);
      ops.push({ op: "token.update", id, patch: safe });
      return true;
    },
    setConditionClocks(clocks: VttConditionClock[]): boolean {
      if (clocks.length) data.conditionClocks = clocks;
      else delete data.conditionClocks;
      return true;
    },
    setCounterTracks(tracks: VttCounterTrack[]): boolean {
      if (tracks.length) data.counterTracks = tracks;
      else delete data.counterTracks;
      return true;
    },
    putEffects(effects: readonly VttEffect[]): boolean {
      for (const effect of effects) {
        const at = data.effects.findIndex((candidate) => candidate.id === effect.id);
        if (at >= 0) data.effects[at] = effect;
        else data.effects.push(effect);
        ops.push({ op: "effect.remove", id: effect.id });
        ops.push({ op: "effect.add", effect });
      }
      return true;
    },
    removeEffects(ids: readonly string[]): number {
      const wanted = new Set(ids);
      const before = data.effects.length;
      data.effects = data.effects.filter((effect) => !wanted.has(effect.id));
      for (const id of ids) ops.push({ op: "effect.remove", id });
      return before - data.effects.length;
    },
    ops,
    token: (id: string) => data.tokens.find((candidate) => candidate.id === id) as VttToken,
  };
  return engine satisfies TamperUndoEngine;
}

const tok = (id: string, name: string, x = 0, y = 0, statuses?: string[]): VttToken => ({
  id,
  name,
  x,
  y,
  size: 1,
  color: "#fff",
  visible: true,
  ...(statuses ? { statuses } : {}),
});

const field = (id: string, name: string, extra: Partial<VttEffect["data"]> = {}, x = 0, y = 0): VttEffect => ({
  id,
  kind: "circle",
  x,
  y,
  data: { radius: 3, sourceAbilityId: `ab-${id}`, sourceAbilityName: name, ...extra },
});

/** A field over two bodies, each with its pip, each with a countdown watching
 *  that pip, and one of them carrying a currency the cascade cannot reach. */
function burningScene(): VttSceneData {
  const data = defaultSceneData();
  data.grid = { ...data.grid, size: SIZE };
  data.timeline = { round: 4, turn: 0 };
  data.tokens = [tok("k", "Kira", 0, 0, ["Burning", "Blight 3/8"]), tok("v", "Vex", 70, 0, ["Burning"])];
  data.effects = [field("fx1", "Absolute Zero", { status: "Burning", rounds: 6, bornRound: 1, casterCharacterId: "ch-n" })];
  data.conditionClocks = [
    { tokenId: "k", status: "Burning", bornRound: 2, rounds: 6 },
    { tokenId: "v", status: "Burning", bornRound: 2, rounds: 6 },
  ];
  data.counterTracks = [{ tokenId: "k", name: "Blight", value: 3, cap: 8 }];
  return data;
}

function rowFor(data: VttSceneData, match: (target: TamperTarget) => boolean): TamperTarget {
  const found = listTamperTargets(data).find(match);
  if (!found) throw new Error("no such tamperable row");
  return found;
}

const refusals: string[] = [];
const opts = (label: string) => ({ label, onRefused: (reason: string) => void refusals.push(reason) });

beforeEach(() => {
  __resetUndoRedo();
  setUndoScope("workspace:vtt2");
  refusals.length = 0;
});

describe("commitUndoableTamper — end", () => {
  it("removes the field, the pips and the clocks, and brings all three back", async () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });

    expect(commitUndoableTamper(engine, plan.write!, opts("Absolute Zero negated"))).toBe(true);
    expect(data.effects).toEqual([]);
    expect(engine.token("k").statuses).toEqual(["Blight 3/8"]);
    expect(engine.token("v").statuses).toEqual([]);
    expect(data.conditionClocks).toBeUndefined();

    expect(await undoOnce()).toBe(true);
    expect(data.effects.map((effect) => effect.id)).toEqual(["fx1"]);
    expect(engine.token("k").statuses).toEqual(["Burning", "Blight 3/8"]);
    expect(engine.token("v").statuses).toEqual(["Burning"]);
    expect(data.conditionClocks).toHaveLength(2);

    expect(await redoOnce()).toBe(true);
    expect(data.effects).toEqual([]);
    expect(engine.token("k").statuses).toEqual(["Blight 3/8"]);
  });

  it("puts the field back through an op a peer would hear, never by reaching in", async () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });
    commitUndoableTamper(engine, plan.write!, opts("negate"));
    engine.ops.length = 0;
    await undoOnce();
    // A restore that pushed onto `scene.data.effects` would put the field back
    // on the Curator's screen and on nobody else's — a desync with no symptom on
    // the machine that caused it.
    expect(engine.ops.some((op) => op.op === "effect.add")).toBe(true);
    expect(engine.ops.some((op) => op.op === "token.update")).toBe(true);
  });

  it("leaves a clock that landed on somebody else while the entry sat on the stack", async () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });
    commitUndoableTamper(engine, plan.write!, opts("negate"));

    // A third body, untouched by the tamper, picks up a condition afterwards.
    data.tokens.push(tok("g", "Ghost", 700, 700, ["Slowed"]));
    data.conditionClocks = [{ tokenId: "g", status: "Slowed", bornRound: 4, rounds: 2 }];

    await undoOnce();
    // Restoring the scene's WHOLE clock list would have deleted Ghost's.
    expect(data.conditionClocks?.some((clock) => clock.tokenId === "g")).toBe(true);
    expect(data.conditionClocks).toHaveLength(3);
  });

  it("writes nothing at all when one body refuses the pip", () => {
    const data = burningScene();
    // Vex is a player's token and this client may not write to her.
    const engine = fakeEngine(data, { refuse: ["v"] });
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });

    expect(commitUndoableTamper(engine, plan.write!, opts("negate"))).toBe(false);
    // A field removed beside a body that kept its pip is exactly the stranded
    // state this verb exists to avoid, so the first refusal rolls the pass back.
    expect(data.effects.map((effect) => effect.id)).toEqual(["fx1"]);
    expect(engine.token("k").statuses).toEqual(["Burning", "Blight 3/8"]);
    expect(refusals[0]).toContain("Vex");
  });

  it("refuses the second negate of the same field instead of pushing an empty entry", () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const target = rowFor(data, (t) => t.kind === "effect");
    const plan = planTamper({ data, target, mode: "negate" });
    expect(commitUndoableTamper(engine, plan.write!, opts("negate"))).toBe(true);
    // The same plan again, which is what a double-click or a re-sent proposal is.
    expect(commitUndoableTamper(engine, plan.write!, opts("negate"))).toBe(false);
    expect(refusals[0]).toContain("already been dealt with");
  });

  it("refuses to reverse a negate the round has already overtaken", async () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });
    commitUndoableTamper(engine, plan.write!, opts("Absolute Zero negated"));
    // Something else moved the pips: a recurring tick, a peer's snapshot, the
    // Curator's own hand. Replaying the `before` would erase that instead.
    engine.token("k").statuses = ["Burning", "Blight 3/8", "Stunned"];
    expect(await undoOnce()).toBe(false);
    expect(refusals[0]).toContain("would undo the later change instead");
    expect(engine.token("k").statuses).toEqual(["Burning", "Blight 3/8", "Stunned"]);
  });
});

describe("commitUndoableTamper — the other modes", () => {
  it("reflects a field onto its source and puts it back where it stood", async () => {
    const data = burningScene();
    data.tokens.push(tok("n", "Null", 350, 210));
    data.effects[0].data.auraTokenId = "k";
    data.effects[0].data.auraDx = 0;
    data.effects[0].data.auraDy = 0;
    const engine = fakeEngine(data);
    const plan = planTamper({
      data,
      target: rowFor(data, (t) => t.kind === "effect"),
      mode: "reflect",
      sourceTokenId: "n",
      sourceName: "Null",
    });
    expect(commitUndoableTamper(engine, plan.write!, opts("reflect"))).toBe(true);
    expect(data.effects[0].x).toBe(350);
    expect(data.effects[0].data.auraTokenId).toBe("n");

    await undoOnce();
    expect(data.effects[0].x).toBe(0);
    expect(data.effects[0].data.auraTokenId).toBe("k");
  });

  it("suspends a field and wakes it again on undo, keys and all", async () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "delay", rounds: 2 });
    expect(commitUndoableTamper(engine, plan.write!, opts("delay"))).toBe(true);
    expect(data.effects[0].data.suspendedUntil).toBe(6);
    expect(engine.token("k").statuses).toEqual(["Blight 3/8"]);

    await undoOnce();
    // The KEYS have to be gone, not set to undefined: a peer handed
    // `{ suspendedUntil: undefined }` receives `{}` and goes on treating a woken
    // field as asleep, which is why `putEffects` syncs as remove + add.
    expect(data.effects[0].data.suspendedUntil).toBeUndefined();
    expect("suspendedUntil" in data.effects[0].data).toBe(false);
    expect(engine.token("k").statuses).toEqual(["Burning", "Blight 3/8"]);
  });

  it("wipes a counter track and restores pip and record together", async () => {
    const data = burningScene();
    const engine = fakeEngine(data);
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "counter"), mode: "end" });
    expect(commitUndoableTamper(engine, plan.write!, opts("Blight cleared"))).toBe(true);
    expect(engine.token("k").statuses).toEqual(["Burning"]);
    expect(data.counterTracks).toBeUndefined();

    await undoOnce();
    expect(engine.token("k").statuses).toEqual(["Burning", "Blight 3/8"]);
    expect(data.counterTracks).toEqual([{ tokenId: "k", name: "Blight", value: 3, cap: 8 }]);
  });
});

describe("an effect a write ADDS", () => {
  it("is taken away again by the inverse, not left behind", async () => {
    // No shipped mode adds a brand-new effect yet — reflect and delay both
    // replace one that is already there — but `putEffects` means "make these
    // present", and an addition whose inverse did nothing would be a write with
    // no way back the first time a mode grew one.
    const data = burningScene();
    const engine = fakeEngine(data);
    expect(
      commitUndoableTamper(
        engine,
        {
          statuses: [],
          removeEffects: [],
          putEffects: [field("fx9", "Echo")],
          clockTokens: [],
          clocks: [],
          trackTokens: [],
          tracks: [],
        },
        opts("Echo placed")
      )
    ).toBe(true);
    expect(data.effects.map((effect) => effect.id)).toEqual(["fx1", "fx9"]);
    await undoOnce();
    expect(data.effects.map((effect) => effect.id)).toEqual(["fx1"]);
  });
});
