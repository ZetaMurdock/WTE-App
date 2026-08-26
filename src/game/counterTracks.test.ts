import { describe, it, expect } from "vitest";
import { parseAbilityEffects } from "./abilityEffects";
import {
  MAX_COUNTER_TRACKS,
  clearCounter,
  counterGaps,
  counterKey,
  counterTag,
  counterThresholds,
  counterValue,
  crossedThresholds,
  isCounterTagFor,
  parseCounterTag,
  planCounter,
  setCounter,
  stepsAtThreshold,
  validCounterTrack,
  type CounterTrack,
} from "./counterTracks";

/** The corpus's own shape, and the one every threshold rule is argued from. */
const BLIGHT = ["- Counter: Blight +1, cap 8", "- At 8: Damage: 1d100", "- At 8: Condition: Incapacitated"].join("\n");

const steps = (block: string) => {
  const parsed = parseAbilityEffects(block);
  expect(parsed.errors).toEqual([]);
  return parsed.steps;
};

describe("a track's identity", () => {
  it("folds case and inner whitespace, because two pips for one number is a bug", () => {
    expect(counterKey("Blight")).toBe(counterKey("  blight "));
    expect(counterKey("Overload  Charges")).toBe(counterKey("overload charges"));
  });

  it("keeps two currencies apart, however alike they read", () => {
    // "Fear" and "Fear Points" are different pages' inventions. Merging them
    // would spend one table's currency out of another's pool.
    expect(counterKey("Fear")).not.toBe(counterKey("Fear Points"));
  });

  it("re-spells the stored name the moment a page writes it properly", () => {
    const plan = planCounter([{ name: "blight", value: 2 }], { name: "Blight", delta: 1 });
    expect(plan?.tracks).toEqual([{ name: "Blight", value: 3 }]);
  });
});

describe("moving a track", () => {
  it("opens a track that was never carried", () => {
    const plan = planCounter(undefined, { name: "Blight", delta: 1, cap: 8 });
    expect(plan).toMatchObject({ from: 0, to: 1, cap: 8, capped: false, crossed: [] });
  });

  it("stops at the cap and says the ceiling refused the rest", () => {
    const plan = planCounter([{ name: "Blight", value: 8, cap: 8 }], { name: "Blight", delta: 1, cap: 8 });
    expect(plan).toMatchObject({ from: 8, to: 8, capped: true });
    expect(plan?.crossed).toEqual([]);
  });

  it("keeps the ceiling a second, cap-less ability never restated", () => {
    // Otherwise any page that nudges Blight without repeating `cap 8` becomes a
    // back door past the ceiling the page that owns the track declared.
    const plan = planCounter([{ name: "Blight", value: 8, cap: 8 }], { name: "Blight", delta: 3 });
    expect(plan).toMatchObject({ to: 8, cap: 8, capped: true });
  });

  it("floors at zero and drops a track that ran out", () => {
    const plan = planCounter([{ name: "Blight", value: 2, cap: 8 }], { name: "Blight", delta: -5 });
    // A pip reading "Blight 0/8" would sit on every body that ever took a point.
    expect(plan).toMatchObject({ to: 0 });
    expect(plan?.tracks).toEqual([]);
  });

  it("leaves other tracks on the same owner alone", () => {
    const held: CounterTrack[] = [{ name: "Blight", value: 2 }, { name: "Fear Points", value: 5 }];
    const plan = planCounter(held, { name: "Blight", delta: 1 });
    expect(plan?.tracks).toContainEqual({ name: "Fear Points", value: 5 });
  });

  it("refuses a no-op rather than reporting a move that changed nothing", () => {
    expect(planCounter([], { name: "Blight", delta: 0 })).toBeNull();
    expect(planCounter([], { name: "   ", delta: 1 })).toBeNull();
  });

  it("refuses a new track rather than evicting one the owner already carries", () => {
    const full = Array.from({ length: MAX_COUNTER_TRACKS }, (_, i) => ({ name: `Track ${i}`, value: 1 }));
    expect(planCounter(full, { name: "Blight", delta: 1 })).toBeNull();
    // An existing track still moves — the ceiling is on how many, not how far.
    expect(planCounter(full, { name: "Track 0", delta: 1 })?.to).toBe(2);
  });
});

describe("the threshold edge", () => {
  const marks = [8];

  it("fires AT the cap, not one before", () => {
    expect(crossedThresholds(6, 7, marks)).toEqual([]);
    expect(crossedThresholds(7, 8, marks)).toEqual([8]);
  });

  it("does not fire again on a later increment", () => {
    // Blight caps at 8 and fires at 8. A rule that asked `value >= 8` would deal
    // 1d100 every round, forever, to a victim already sitting at the ceiling.
    const at8: CounterTrack[] = [{ name: "Blight", value: 8, cap: 8 }];
    const again = planCounter(at8, { name: "Blight", delta: 1, cap: 8, thresholds: marks });
    expect(again?.crossed).toEqual([]);
  });

  it("does not fire again on a track that has no cap to stop it", () => {
    // The case above is held by the CLAMP, not by the crossing rule: with `cap
    // 8` a `+1` at 8 lands on 8, so `to > from` is false and any rule at all
    // would return []. The Sbeindlaer's own page declares no ceiling — the
    // blight "additively increases by 1 per round of exposure" and fires at 8
    // stacks — so a cap-less track really does walk past its mark, and it is
    // only `from < at` that keeps 1d100 from landing again every single round.
    expect(crossedThresholds(8, 9, marks)).toEqual([]);
    expect(crossedThresholds(20, 21, marks)).toEqual([]);
    const past = planCounter([{ name: "Blight", value: 8 }], { name: "Blight", delta: 1, thresholds: marks });
    expect(past).toMatchObject({ to: 9, capped: false });
    expect(past?.crossed).toEqual([]);
  });

  it("fires again after the track falls below the mark and climbs back", () => {
    const down = planCounter([{ name: "Blight", value: 8, cap: 8 }], { name: "Blight", delta: -1, thresholds: marks });
    expect(down?.crossed).toEqual([]);
    const back = planCounter(down!.tracks, { name: "Blight", delta: 1, thresholds: marks });
    expect(back?.crossed).toEqual([8]);
  });

  it("fires every mark a big jump flew over, ascending", () => {
    // Skipping the one it passed would silently drop a consequence the page
    // declared; page order is not the same as ascending order.
    expect(crossedThresholds(0, 5, [5, 3])).toEqual([3, 5]);
  });

  it("fires nothing on the way down", () => {
    expect(crossedThresholds(9, 2, [3, 8])).toEqual([]);
  });

  it("fires nothing for a track that never reaches its mark", () => {
    let tracks: CounterTrack[] = [];
    for (let i = 0; i < 7; i++) {
      const plan = planCounter(tracks, { name: "Blight", delta: 1, cap: 8, thresholds: marks });
      expect(plan?.crossed).toEqual([]);
      tracks = plan!.tracks;
    }
    expect(counterValue(tracks, "Blight")).toBe(7);
  });

  it("binds each mark to the track declared above it, whatever the bullet order", () => {
    const parsed = steps(
      [
        "- Counter: Blight +1, cap 8",
        "- At 8: Damage: 1d100",
        "- Counter: Fear Points +2",
        "- At 4: Condition: Frightened",
      ].join("\n")
    );
    expect(counterThresholds(parsed, "Blight")).toEqual([8]);
    expect(counterThresholds(parsed, "Fear Points")).toEqual([4]);
    expect(stepsAtThreshold(parsed, "Blight", 8).map((step) => step.verb)).toEqual(["damage"]);
  });

  it("lists a mark once however many steps hang off it", () => {
    const parsed = steps(BLIGHT);
    expect(counterThresholds(parsed, "Blight")).toEqual([8]);
    expect(stepsAtThreshold(parsed, "Blight", 8)).toHaveLength(2);
  });
});

describe("how a track is seen", () => {
  it("reads as a number over its ceiling, or a bare number without one", () => {
    expect(counterTag({ name: "Blight", value: 3, cap: 8 })).toBe("Blight 3/8");
    expect(counterTag({ name: "Fear Points", value: 3 })).toBe("Fear Points 3");
  });

  it("round-trips through the pip a table actually reads", () => {
    for (const track of [{ name: "Blight", value: 3, cap: 8 }, { name: "Fear Points", value: 12 }]) {
      expect(parseCounterTag(counterTag(track))).toEqual(track);
    }
  });

  it("recognises its own pip and nobody else's", () => {
    expect(isCounterTagFor("Blight 3/8", "blight")).toBe(true);
    expect(isCounterTagFor("Blight 3/8", "Fear Points")).toBe(false);
    // An ordinary condition is not a track, whatever it is named.
    expect(isCounterTagFor("Slowed", "Slowed")).toBe(false);
    expect(parseCounterTag("Slowed (2)")).toBeNull();
  });
});

describe("what survives a peer, a hand edit, and an import", () => {
  it("refuses a record with nothing to count", () => {
    expect(validCounterTrack({ name: "Blight", value: 0 })).toBe(false);
    expect(validCounterTrack({ name: "", value: 3 })).toBe(false);
    expect(validCounterTrack({ name: "Blight", value: Number.NaN })).toBe(false);
    expect(validCounterTrack({ name: "Blight", value: 3, cap: -1 })).toBe(false);
    expect(validCounterTrack({ name: "Blight", value: 3 })).toBe(true);
  });

  it("ignores a malformed entry rather than letting it become a pip", () => {
    const held = [{ name: "Blight", value: 0 }, { name: "Fear Points", value: 4 }] as CounterTrack[];
    expect(planCounter(held, { name: "Blight", delta: 1 })?.tracks).toEqual([
      { name: "Fear Points", value: 4 },
      { name: "Blight", value: 1 },
    ]);
  });
});

describe("removal, and the removals that do not exist", () => {
  it("clears a track by name, folded", () => {
    expect(clearCounter([{ name: "Blight", value: 3 }], "  BLIGHT ")).toEqual([]);
  });

  it("lets a Curator set the number outright, still inside the ceiling", () => {
    expect(setCounter([{ name: "Blight", value: 3, cap: 8 }], "Blight", 99)).toEqual([
      { name: "Blight", value: 8, cap: 8 },
    ]);
    expect(setCounter([{ name: "Blight", value: 3, cap: 8 }], "Blight", 0)).toEqual([]);
  });

  it("reports what the grammar cannot say instead of inventing a decay", () => {
    // Reporting IS the deliverable here. A block whose prose says "resets each
    // encounter" and whose bullets cannot say it has declared a rule the engine
    // will not keep, and the table has to be told which rule that is.
    const gaps = counterGaps(steps(BLIGHT));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("Blight");
    expect(gaps[0]).toContain("once per crossing");
    expect(gaps[0]).toMatch(/clear|Curator/);
  });

  it("says nothing about a track that watches no mark", () => {
    expect(counterGaps(steps("- Counter: Wryde charges +1"))).toEqual([]);
  });

  it("refuses to claim a mark at zero fires, because it never can", () => {
    // Radiant's Energy Bleed says "At 0 charges, gain +1 ADA", so this is a
    // block a Curator really writes. It parses without an error, and the mark
    // is unreachable: firing is ARRIVING, and zero is the floor. Telling the
    // table it "fires at 0 once per crossing" would be the engine affirming a
    // rule it does not keep — the Curator then stops watching for it.
    const block = ["- Counter: Overload Charges -1, cap 3", "- At 0: Ruling: gain +1 ADA"].join("\n");
    const parsed = steps(block);
    expect(counterThresholds(parsed, "Overload Charges")).toEqual([0]);
    expect(crossedThresholds(1, 0, [0])).toEqual([]);
    const gaps = counterGaps(parsed);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("mark at 0");
    expect(gaps[0]).not.toContain("once per crossing");
  });

  it("still reports the reachable marks on a track that also declares zero", () => {
    const gaps = counterGaps(
      steps(["- Counter: Overload Charges +1, cap 3", "- At 0: Ruling: stabilised", "- At 3: Ruling: bleed"].join("\n"))
    );
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain("mark at 0");
    expect(gaps[1]).toContain("fires at 3 once per crossing");
  });
});
