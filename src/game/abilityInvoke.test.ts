// Ability-as-macro: what one page gets when it names another.
import { describe, expect, it } from "vitest";
import { buildAbilityCatalog, type CatalogAbility } from "./abilityCatalog";
import { parseAbilityEffects } from "./abilityEffects";
import { MAX_INVOKE_DEPTH, expandInvocations, hasInvocations, isInvokeFault } from "./abilityInvoke";

const steps = (block: string) => {
  const parsed = parseAbilityEffects(block);
  expect(parsed.errors).toEqual([]);
  return parsed.steps;
};

/** The corpus's own worked example, cut down to the parts that matter: a
 *  Warfare special that names three ciphers, one of which declares a block,
 *  one of which is prose only, one of which does not exist under that name. */
const WEAPONIZE: CatalogAbility = {
  kind: "cipher",
  id: "wte.cipher.weaponize",
  name: "WEAPONIZE",
  effect: "The weaponized object deals damage as a Tier-appropriate weapon.",
  actions: ["- Cost: 25 SS", "- Damage: 2d8 Blunt", "- Condition: Bleeding, 2 rounds"].join("\n"),
};
const HOLLOW_SHELL: CatalogAbility = {
  kind: "cipher",
  id: "wte.cipher.hollow-shell",
  name: "HOLLOW SHELL",
  effect: "An object becomes completely hollow — its structural frame intact but its internal mechanisms removed.",
};

const CATALOG = buildAbilityCatalog([WEAPONIZE, HOLLOW_SHELL]);

describe("the undeclared corpus is untouched", () => {
  it("says a block with no Invoke has none, so nothing has to expand", () => {
    expect(hasInvocations(steps("- Damage: 3d10 Cold"))).toBe(false);
  });

  it("returns the very same step objects when nothing is invoked", () => {
    // Identity, not just equality: consumers downstream memoise on this array,
    // and a fresh copy every render would rebuild work nothing asked for.
    const original = steps("- Save: Physical Save — Recovery, DV 18\n- Fail: Damage: 3d10 Cold");
    const out = expandInvocations(original, CATALOG);
    expect(out.steps).toEqual(original);
    expect(out.invocations).toEqual([]);
  });
});

describe("a resolved invocation runs the invoked page's steps", () => {
  it("splices them in where the bullet stood, not at the end", () => {
    // Order is meaning: `parseAbilityEffects` binds an `At N` to the nearest
    // track ABOVE it, so a list that appended would describe a different page.
    const out = expandInvocations(steps("- Invoke: WEAPONIZE\n- Damage: 1d6 Radiant"), CATALOG);
    expect(out.steps.map((step) => step.verb)).toEqual(["damage", "condition", "damage"]);
    expect(out.steps[0].expr).toBe("2d8");
    expect(out.steps[2].expr).toBe("1d6");
  });

  it("resolves by permanent id when the page writes one", () => {
    const out = expandInvocations(steps("- Invoke: wte.cipher.weaponize"), CATALOG);
    expect(out.invocations[0].outcome).toBe("expanded");
    expect(out.invocations[0].abilityId).toBe("wte.cipher.weaponize");
  });

  it("does NOT spend the invoked ability's price", () => {
    // ARMY OF ONE says invoked Ciphers cost nothing extra; nothing on THE LAST
    // WAR's page says either way. Splicing the cost in would charge a table the
    // corpus explicitly exempts, and dropping it silently would give away a
    // free 25 SS. It is surfaced, unspent, for the Curator to rule on.
    const out = expandInvocations(steps("- Invoke: WEAPONIZE"), CATALOG);
    expect(out.steps.some((step) => step.verb === "cost")).toBe(false);
    expect(out.invocations[0].costs.map((step) => step.expr)).toEqual(["25"]);
  });

  it("carries the invoking bullet's branch onto steps that declared none", () => {
    // `Fail: Invoke: X` says the invocation happens on a failure. Splicing X's
    // `always` steps in unchanged would land 2d8 whether the save was made or
    // not — the page's own branch deleted by the act of resolving it.
    const out = expandInvocations(steps("- Save: Physical Save — Recovery, DV 18\n- Fail: Invoke: WEAPONIZE"), CATALOG);
    expect(out.steps.filter((step) => step.verb !== "save").every((step) => step.branch === "fail")).toBe(true);
  });

  it("leaves a step that declared its own branch alone", () => {
    const catalog = buildAbilityCatalog([
      { kind: "cipher", id: "wte.cipher.x", name: "X", actions: "- Success: Heal: 2d6" },
    ]);
    const out = expandInvocations(steps("- Fail: Invoke: X"), catalog);
    expect(out.steps[0].branch).toBe("success");
  });
});

describe("the three states survive being invoked", () => {
  it("quotes the prose of an invoked ability that declares nothing", () => {
    const out = expandInvocations(steps("- Invoke: HOLLOW SHELL"), CATALOG);
    expect(out.invocations[0].outcome).toBe("prose");
    expect(out.invocations[0].steps).toEqual([]);
    expect(out.invocations[0].prose).toContain("completely hollow");
    // Nothing executable, and no invented step standing in for the prose.
    expect(out.steps).toEqual([]);
  });

  it("does not call a prose-only invocation a fault", () => {
    const out = expandInvocations(steps("- Invoke: HOLLOW SHELL"), CATALOG);
    expect(out.invocations.some(isInvokeFault)).toBe(false);
  });
});

describe("a reference that cannot be honoured is reported, never swallowed", () => {
  it("reports a name this campaign has no page for", () => {
    const out = expandInvocations(steps("- Invoke: TRIXT LINK"), CATALOG);
    expect(out.invocations[0].outcome).toBe("unresolved");
    expect(out.invocations[0].ref).toBe("TRIXT LINK");
    expect(out.invocations.filter(isInvokeFault)).toHaveLength(1);
    expect(out.steps).toEqual([]);
  });
});

describe("a chain cannot hang the app", () => {
  it("refuses a page that invokes itself", () => {
    const catalog = buildAbilityCatalog([{ kind: "cipher", id: "wte.cipher.a", name: "A", actions: "- Invoke: A" }]);
    const out = expandInvocations(steps("- Invoke: A"), catalog);
    expect(out.invocations.map((one) => one.outcome)).toEqual(["expanded", "cycle"]);
    expect(out.steps).toEqual([]);
  });

  it("refuses a pair that invoke each other, and says which chain it refused", () => {
    const catalog = buildAbilityCatalog([
      { kind: "cipher", id: "wte.cipher.a", name: "A", actions: "- Invoke: B" },
      { kind: "cipher", id: "wte.cipher.b", name: "B", actions: "- Invoke: A\n- Damage: 1d4" },
    ]);
    const out = expandInvocations(steps("- Invoke: A"), catalog);
    const cycle = out.invocations.find((one) => one.outcome === "cycle");
    expect(cycle?.via).toEqual(["A", "B", "A"]);
    // The loop is refused; everything BESIDE it still runs. A cycle is one bad
    // bullet, not grounds for discarding the page.
    expect(out.steps.map((step) => step.expr)).toEqual(["1d4"]);
  });

  it("recognises a cycle written through a former name", () => {
    // The kind a human proof-reading the pages does not see: two pages that
    // name each other, one of them by an alias.
    const catalog = buildAbilityCatalog([
      { kind: "cipher", id: "wte.cipher.a", name: "A", aliases: ["Ancient A"], actions: "- Invoke: B" },
      { kind: "cipher", id: "wte.cipher.b", name: "B", actions: "- Invoke: Ancient A" },
    ]);
    const out = expandInvocations(steps("- Invoke: A"), catalog);
    expect(out.invocations.some((one) => one.outcome === "cycle")).toBe(true);
  });

  it("stops a long chain of DISTINCT pages, which cycle detection cannot catch", () => {
    const depth = MAX_INVOKE_DEPTH + 2;
    const catalog = buildAbilityCatalog(
      Array.from({ length: depth }, (_, i) => ({
        kind: "cipher" as const,
        id: `wte.cipher.a${i}`,
        name: `A${i}`,
        actions: i + 1 < depth ? `- Invoke: A${i + 1}` : "- Damage: 1d4",
      }))
    );
    const out = expandInvocations(steps("- Invoke: A0"), catalog);
    expect(out.invocations.some((one) => one.outcome === "depth")).toBe(true);
    // Nothing beyond the cap ran, so the 1d4 at the bottom never arrives.
    expect(out.steps).toEqual([]);
  });

  it("allows a chain that stays within the cap", () => {
    const catalog = buildAbilityCatalog([
      { kind: "cipher", id: "wte.cipher.a", name: "A", actions: "- Invoke: B" },
      { kind: "cipher", id: "wte.cipher.b", name: "B", actions: "- Damage: 1d4" },
    ]);
    const out = expandInvocations(steps("- Invoke: A"), catalog);
    expect(out.invocations.some(isInvokeFault)).toBe(false);
    expect(out.steps.map((step) => step.expr)).toEqual(["1d4"]);
  });
});
