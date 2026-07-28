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
    // With the owning campaign in context this layer applies...
    expect(layersFor(all, "wte.stat.something-else", { campaignId: "ashen-sun" }).length).toBe(1);
    // ...and with NO campaign in context it does not. An owned layer belongs to
    // its owner; a missing context is not a licence to apply everywhere.
    expect(layersFor(all, "wte.stat.something-else").length).toBe(0);
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

describe("every owned scope is filtered, not just campaign", () => {
  // Before this, layersFor only kept ANOTHER CAMPAIGN's layers out. Character and
  // session layers would have leaked into every other character and every later
  // session the moment those scopes gained real data.
  const T = "wte.stat.focus";
  const mk = (scope: RuleLayer["scope"], owner: string | undefined, value: number): RuleLayer => ({
    id: `${scope}-${owner ?? "none"}`,
    targetId: T,
    scope,
    owner,
    op: "add",
    value,
  });

  const all: RuleLayer[] = [
    mk("wte", undefined, 1),
    mk("pack", "pack-a", 2),
    mk("pack", "pack-b", 4),
    mk("campaign", "camp-1", 8),
    mk("campaign", "camp-2", 16),
    mk("character", "char-1", 32),
    mk("character", "char-2", 64),
    mk("session", "sess-1", 128),
    mk("session", "sess-2", 256),
  ];

  const sum = (ls: RuleLayer[]) => ls.reduce((n, l) => n + l.value, 0);

  it("official layers always apply", () => {
    expect(sum(layersFor(all, T))).toBe(1);
  });

  it("keeps another character's exception out", () => {
    expect(sum(layersFor(all, T, { characterId: "char-1" }))).toBe(1 + 32);
  });

  it("keeps another session's temporary effect out", () => {
    expect(sum(layersFor(all, T, { sessionId: "sess-2" }))).toBe(1 + 256);
  });

  it("only applies packs that are enabled", () => {
    expect(sum(layersFor(all, T, { packIds: ["pack-b"] }))).toBe(1 + 4);
  });

  it("combines every scope in one context without cross-talk", () => {
    const ls = layersFor(all, T, {
      packIds: ["pack-a"],
      campaignId: "camp-1",
      characterId: "char-1",
      sessionId: "sess-1",
    });
    expect(sum(ls)).toBe(1 + 2 + 8 + 32 + 128);
    expect(resolveRule(0, ls).value).toBe(171);
  });

  it("treats an owned layer with no owner as belonging to nobody", () => {
    // A character exception that forgot to say whose it is must apply to no one,
    // not to everyone.
    const orphan: RuleLayer[] = [mk("character", undefined, 99)];
    expect(layersFor(orphan, T, { characterId: "char-1" })).toEqual([]);
    expect(layersFor(orphan, T)).toEqual([]);
  });
});

describe("same-scope order is explicit, not incidental", () => {
  const T = "wte.stat.focus";
  const l = (id: string, op: RuleLayer["op"], value: number, order?: number): RuleLayer => ({
    id,
    targetId: T,
    scope: "campaign",
    owner: "c1",
    op,
    value,
    order,
  });

  it("applies `order` within a scope so the database row order cannot decide mechanics", () => {
    // set-then-add and add-then-set give different answers; without an explicit
    // order, whichever the query happened to return first would win.
    const setThenAdd = [l("a", "add", 5, 2), l("b", "set", 20, 1)];
    expect(resolveRule(10, setThenAdd).value).toBe(25);

    const addThenSet = [l("a", "add", 5, 1), l("b", "set", 20, 2)];
    expect(resolveRule(10, addThenSet).value).toBe(20);
  });

  it("falls back to the given order when nothing declares one", () => {
    // Existing layers without `order` keep behaving exactly as before.
    expect(resolveRule(10, [l("a", "set", 20), l("b", "add", 5)]).value).toBe(25);
  });

  it("still puts scope ahead of order", () => {
    const layers: RuleLayer[] = [
      { id: "s", targetId: T, scope: "session", owner: "s1", op: "add", value: 1, order: 0 },
      { id: "c", targetId: T, scope: "campaign", owner: "c1", op: "set", value: 100, order: 99 },
    ];
    // The campaign `set` runs first despite its higher order, because scope wins.
    expect(resolveRule(0, layers).value).toBe(101);
  });
});
