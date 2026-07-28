import { describe, expect, it } from "vitest";
import { explain, layersFor, resolveRule, type RuleLayer } from "./ruleLayers";

const layer = (p: Partial<RuleLayer> & Pick<RuleLayer, "scope" | "op" | "value">): RuleLayer => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  targetId: p.targetId ?? "wte.stat.synaptic-focus",
  owner: p.owner,
  note: p.note,
  enabled: p.enabled,
  ...p,
});

describe("the worked example from the concept doc", () => {
  // Base 10, Ashen Sun +4, Voaulton +2, Null Storm -1, final 15.
  const layers = [
    layer({ scope: "campaign", owner: "ashen-sun", op: "add", value: 4, note: "Ashen Sun campaign override" }),
    layer({ scope: "character", owner: "voaulton", op: "add", value: 2, note: "Voaulton species rule" }),
    layer({ scope: "session", owner: "null-storm", op: "add", value: -1, note: "Null Storm scene effect" }),
  ];

  it("resolves to 15", () => {
    expect(resolveRule(10, layers).value).toBe(15);
  });

  it("can explain itself line by line", () => {
    expect(explain(resolveRule(10, layers))).toEqual([
      { label: "Base W.T.E rule", value: "10" },
      { label: "Ashen Sun campaign override", value: "+4" },
      { label: "Voaulton species rule", value: "+2" },
      { label: "Null Storm scene effect", value: "-1" },
      { label: "Final", value: "15" },
    ]);
  });

  it("shows the running total at each step", () => {
    expect(resolveRule(10, layers).trail.map((c) => c.runningTotal)).toEqual([14, 16, 15]);
  });
});

describe("layers apply weakest scope first, whatever order they arrive in", () => {
  it("sorts by scope rather than trusting the array", () => {
    // Deliberately shuffled: a session effect listed before the campaign override.
    const shuffled = [
      layer({ scope: "session", op: "add", value: -1, note: "session" }),
      layer({ scope: "pack", op: "add", value: 5, note: "pack" }),
      layer({ scope: "campaign", op: "add", value: 4, note: "campaign" }),
    ];
    expect(resolveRule(10, shuffled).trail.map((c) => c.note)).toEqual(["pack", "campaign", "session"]);
  });

  it("makes order matter for non-commutative ops", () => {
    // A campaign SET then a session ADD is 20+1; the reverse would be 20.
    const layers = [
      layer({ scope: "session", op: "add", value: 1, note: "session" }),
      layer({ scope: "campaign", op: "set", value: 20, note: "campaign" }),
    ];
    expect(resolveRule(10, layers).value).toBe(21);
  });
});

describe("operations", () => {
  it("set replaces everything beneath it", () => {
    expect(resolveRule(10, [layer({ scope: "campaign", op: "set", value: 14 })]).value).toBe(14);
  });

  it("add stacks", () => {
    expect(
      resolveRule(10, [
        layer({ scope: "campaign", op: "add", value: 4 }),
        layer({ scope: "campaign", op: "add", value: 3 }),
      ]).value
    ).toBe(17);
  });

  it("multiply scales", () => {
    expect(resolveRule(10, [layer({ scope: "campaign", op: "multiply", value: 1.5 })]).value).toBe(15);
  });

  it("min raises the value to a floor and leaves a higher one alone", () => {
    expect(resolveRule(3, [layer({ scope: "campaign", op: "min", value: 5 })]).value).toBe(5);
    expect(resolveRule(9, [layer({ scope: "campaign", op: "min", value: 5 })]).value).toBe(9);
  });

  it("max caps the value and leaves a lower one alone", () => {
    expect(resolveRule(9, [layer({ scope: "campaign", op: "max", value: 5 })]).value).toBe(5);
    expect(resolveRule(3, [layer({ scope: "campaign", op: "max", value: 5 })]).value).toBe(3);
  });
});

describe("nothing is lost or hidden", () => {
  it("reports the untouched official value when no layer applies", () => {
    const r = resolveRule(10, []);
    expect(r.value).toBe(10);
    expect(r.base).toBe(10);
    expect(r.overridden).toBe(false);
    expect(r.trail).toEqual([]);
  });

  it("keeps the base recoverable even after a set", () => {
    // The whole point of layering: an override does not destroy what it replaced.
    const r = resolveRule(10, [layer({ scope: "campaign", op: "set", value: 99 })]);
    expect(r.value).toBe(99);
    expect(r.base).toBe(10);
  });

  it("records a layer that had no effect, rather than omitting it", () => {
    // "applied and changed nothing" and "was not in play" are different facts.
    const r = resolveRule(10, [layer({ scope: "campaign", op: "add", value: 0, note: "no-op rule" })]);
    expect(r.trail).toHaveLength(1);
    expect(r.trail[0].note).toBe("no-op rule");
    expect(r.overridden).toBe(true);
  });

  it("skips a disabled layer but does not delete it", () => {
    const off = layer({ scope: "campaign", op: "add", value: 4, enabled: false });
    const r = resolveRule(10, [off]);
    expect(r.value).toBe(10);
    expect(r.trail).toEqual([]);
    // The record itself is untouched, so the Curator can switch it back on.
    expect(off.value).toBe(4);
  });

  it("falls back to a readable note when none was given", () => {
    const r = resolveRule(10, [layer({ scope: "campaign", owner: "ashen-sun", op: "add", value: 1 })]);
    expect(r.trail[0].note).toContain("campaign");
    expect(r.trail[0].note).toContain("ashen-sun");
  });
});

describe("another campaign's layers never leak in", () => {
  const all = [
    layer({ scope: "campaign", owner: "ashen-sun", op: "add", value: 4, targetId: "wte.stat.focus" }),
    layer({ scope: "campaign", owner: "other-table", op: "add", value: 99, targetId: "wte.stat.focus" }),
    layer({ scope: "wte", op: "add", value: 1, targetId: "wte.stat.focus" }),
    layer({ scope: "campaign", owner: "ashen-sun", op: "add", value: 7, targetId: "wte.stat.something-else" }),
  ];

  it("filters to the target", () => {
    expect(layersFor(all, "wte.stat.something-else").length).toBe(1);
  });

  it("filters out other campaigns while keeping unowned layers", () => {
    const mine = layersFor(all, "wte.stat.focus", { campaignId: "ashen-sun" });
    expect(mine.map((l) => l.value).sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it("resolves to this table's numbers, not the other table's", () => {
    const mine = layersFor(all, "wte.stat.focus", { campaignId: "ashen-sun" });
    expect(resolveRule(10, mine).value).toBe(15);
  });
});
