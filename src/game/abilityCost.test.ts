// A price is the one number a table notices immediately when it is wrong.
//
// Four ways to get it wrong live in the grammar the block is written in: a
// declared `- Cost: 9 SS` ignored in favour of the header field beside it; a
// cost in a pool the sheet does not spend taken out of SS because SS is the pool
// it knows; a price the page gated on a branch charged before anything is
// rolled; and a price the page put on the target taken off the caster. The first
// charges the wrong number, the rest charge the wrong player or the wrong
// moment. Each is asserted against here.
import { describe, expect, it } from "vitest";
import genusData from "./data/genus.json";
import cipherData from "./data/ciphers.json";
import { abilityCostPlan, declaredCosts } from "./abilityCost";
import { parseAbilityEffects } from "./abilityEffects";

/** Blocks come from the SHIPPED corpus wherever a shipped page declares the
 *  shape under test — a plan proven against invented bullets proves nothing. */
function genusBlock(domain: string, name: string): string {
  const domains = genusData as unknown as Record<string, { abilities: { name: string; actions?: string }[] } | undefined>;
  const hit = domains[domain]?.abilities.find((ability) => ability.name === name);
  if (!hit?.actions) throw new Error(`genus.json no longer declares ${domain} / ${name}`);
  return hit.actions;
}

function cipherBlock(paradigm: string, name: string): string {
  const paradigms = cipherData as unknown as Record<string, { name: string; actions?: string }[] | undefined>;
  const hit = paradigms[paradigm]?.find((ability) => ability.name === name);
  if (!hit?.actions) throw new Error(`ciphers.json no longer declares ${paradigm} / ${name}`);
  return hit.actions;
}

function costsOf(block: string) {
  return declaredCosts(parseAbilityEffects(block).steps);
}

function planFor(block: string, fieldSs: number, availableSs: number) {
  return abilityCostPlan(costsOf(block), fieldSs, availableSs);
}

describe("the prices a block declares", () => {
  it("reads a shipped block's one flat SS cost", () => {
    // Hail Rain opens `- Cost: 5 SS` and says nothing else about price.
    expect(costsOf(genusBlock("Elemental", "Hail Rain"))).toEqual([
      { key: "cost0", resource: "ss", amount: 5, expr: "5", perRound: false, branch: "always", who: "self", label: "5 SS" },
    ]);
  });

  it("reads the largest shipped price without rounding it into something else", () => {
    // S1 — ABSOLUTE ZERO costs 80 SS. A cost path that silently capped or
    // clamped would be invisible until a table tried to pay it.
    expect(costsOf(cipherBlock("science", "S1 — ABSOLUTE ZERO"))[0]).toMatchObject({ amount: 80, resource: "ss" });
  });

  it("finds nothing to charge in a block that names no price", () => {
    expect(costsOf("- Fail: Damage: 3d10 Cold\n- Fail: Condition: Slowed, 2 rounds")).toEqual([]);
  });

  it("defaults a bare amount to SS, the way the grammar writes it back", () => {
    expect(costsOf("- Cost: 6")).toEqual([
      { key: "cost0", resource: "ss", amount: 6, expr: "6", perRound: false, branch: "always", who: "self", label: "6 SS" },
    ]);
  });

  it("keeps a rolled price as dice rather than inventing a number for it", () => {
    expect(costsOf("- Cost: 1d4 SS")[0]).toMatchObject({ amount: null, expr: "1d4", label: "1d4 SS" });
  });

  it("keeps the pool a non-SS price names", () => {
    expect(costsOf("- Cost: 4 health\n- Cost: 2 focus").map((c) => c.resource)).toEqual(["health", "focus"]);
  });

  it("keeps the page's order and gives each price its own key", () => {
    const costs = costsOf("- Cost: 5 SS\n- Fail: Damage: 1d6\n- Cost: 3 SS");
    expect(costs.map((c) => c.key)).toEqual(["cost0", "cost2"]);
    expect(costs.map((c) => c.amount)).toEqual([5, 3]);
  });
});

describe("what the Use button spends", () => {
  it("spends the declared price rather than the header field beside it", () => {
    // The whole reason for declaring. A page carrying both used to charge the
    // header, so the block was decoration.
    const plan = planFor("- Cost: 9 SS", 6, 99);
    expect(plan).toMatchObject({ source: "declared", ss: 9, shortfall: null });
    expect(plan.unhandled).toEqual([]);
  });

  it("falls back to the header field when the block names no price", () => {
    // A partial block declares what it declares and deletes nothing else.
    expect(planFor("- Fail: Damage: 3d10 Cold", 6, 99)).toMatchObject({ source: "field", ss: 6 });
  });

  it("behaves for an undeclared ability exactly as the header always did", () => {
    expect(abilityCostPlan([], 5, 99)).toEqual({ source: "field", ss: 5, unhandled: [], shortfall: null });
    // No price, no button — the state most shipped abilities are in.
    expect(abilityCostPlan([], 0, 99)).toMatchObject({ ss: 0, shortfall: null });
  });

  it("never turns a nonsense header into a spend", () => {
    // `ss` is a number off a page field, and a negative one would credit the
    // pool rather than charge it.
    expect(abilityCostPlan([], -4, 99).ss).toBe(0);
    expect(abilityCostPlan([], Number.NaN, 99).ss).toBe(0);
    expect(abilityCostPlan([], 2.7, 99).ss).toBe(2);
  });

  it("adds two declared prices into the one number a click takes", () => {
    expect(planFor("- Cost: 5 SS\n- Cost: 3 SS", 0, 99).ss).toBe(8);
  });
});

describe("warning about a price bigger than the pool", () => {
  it("names both numbers when the pool cannot cover the price", () => {
    const plan = planFor(genusBlock("Null", "Reality Break"), 15, 9);
    expect(plan.ss).toBe(15);
    expect(plan.shortfall).toBe("Overspends — needs 15, 9 left");
  });

  it("says nothing about a price the pool exactly covers", () => {
    expect(planFor("- Cost: 6 SS", 0, 6).shortfall).toBeNull();
  });

  it("warns about a header-sourced price too — one button, one rule", () => {
    expect(abilityCostPlan([], 6, 5).shortfall).toBe("Overspends — needs 6, 5 left");
  });

  it("prints the reservoir a character is already in the red by", () => {
    // The sheet shows "−3 / 40" in red, so the chip must show −3 as well.
    // Flooring it to 0 here would put two different numbers on one pool.
    expect(abilityCostPlan([], 6, -3).shortfall).toBe("Overspends — needs 6, -3 left");
  });

  it("never warns when there is nothing to spend", () => {
    expect(abilityCostPlan([], 0, 0).shortfall).toBeNull();
    expect(planFor("- Cost: 4 health", 0, 0).shortfall).toBeNull();
  });
});

describe("prices this build will not take", () => {
  it("leaves a Health cost unspent instead of taking it out of SS", () => {
    const plan = planFor("- Cost: 4 health", 0, 99);
    expect(plan.ss).toBe(0);
    expect(plan.unhandled).toEqual([
      {
        key: "cost0",
        label: "4 HEALTH",
        note: "Health is not a pool an ability row spends — take it by hand.",
      },
    ]);
  });

  it("leaves a Focus cost unspent as well, naming its own pool", () => {
    expect(planFor("- Cost: 2 focus", 0, 99).unhandled[0].note).toMatch(/^Focus is not a pool/);
  });

  it("does not let an unspendable price fall back to the header field", () => {
    // Falling back would charge SS for a Health cost — the wrong pool, silently,
    // which is the exact failure `unhandled` exists to make visible.
    expect(planFor("- Cost: 4 health", 6, 99)).toMatchObject({ source: "declared", ss: 0 });
  });

  it("leaves an upkeep unspent — nothing here keeps a round clock", () => {
    const plan = planFor("- Cost: 6 SS, per round", 0, 99);
    expect(plan.ss).toBe(0);
    expect(plan.unhandled[0]).toMatchObject({ label: "6 SS/round" });
    expect(plan.unhandled[0].note).toMatch(/each round it is sustained/);
  });

  it("leaves a rolled price unspent and tells the player what to roll", () => {
    const plan = planFor("- Cost: 1d4 SS", 0, 99);
    expect(plan.ss).toBe(0);
    expect(plan.unhandled[0].note).toBe("Roll 1d4 and spend it by hand — a rolled price is not one to guess at.");
  });

  it("leaves a branch-gated price unspent rather than charging it up front", () => {
    // `effectStepLabel` prints no branch prefix on a Cost, so a chip reading
    // "5 SS" is the ONLY thing a player would see of a price the page said is
    // owed on a failure. Charging it on the click charges a branch nobody rolled.
    const plan = planFor("- Fail: Cost: 5 SS", 0, 99);
    expect(costsOf("- Fail: Cost: 5 SS")[0].branch).toBe("fail");
    expect(plan.ss).toBe(0);
    expect(plan.unhandled[0].note).toBe(
      "Owed only on a fail — the row spends before the roll, so spend this one by hand."
    );
  });

  it("leaves a price the page put on the target off the caster's pool", () => {
    // `- Cost (target): 5 SS` is somebody else's expenditure. Taking it out of
    // the pool of whoever pressed Use charges the wrong sheet, silently.
    const plan = planFor("- Cost (target): 5 SS", 0, 99);
    expect(costsOf("- Cost (target): 5 SS")[0].who).toBe("target");
    expect(plan.ss).toBe(0);
    expect(plan.unhandled[0].note).toBe("This price is the target's, not the caster's — take it on their sheet.");
  });

  it("still spends the flat SS beside a price it cannot take", () => {
    const plan = planFor("- Cost: 5 SS\n- Cost: 4 health", 0, 99);
    expect(plan.ss).toBe(5);
    expect(plan.unhandled.map((u) => u.label)).toEqual(["4 HEALTH"]);
  });
});

describe("every shipped block's price is one this sheet can take", () => {
  it("charges flat SS for all of them, with nothing left unspent", () => {
    // A corpus-wide sweep rather than a sample: the day a page declares
    // `- Cost: 1d6 SS` or an upkeep, this fails and somebody decides what the
    // sheet should do about it — instead of a table finding out at play.
    const blocks: { name: string; block: string }[] = [];
    for (const [domain, entry] of Object.entries(genusData as Record<string, { abilities: { name: string; actions?: string }[] }>)) {
      for (const ability of entry.abilities) {
        if (ability.actions) blocks.push({ name: `${domain} / ${ability.name}`, block: ability.actions });
      }
    }
    for (const [paradigm, list] of Object.entries(cipherData as Record<string, { name: string; actions?: string }[]>)) {
      for (const ability of list) {
        if (ability.actions) blocks.push({ name: `${paradigm} / ${ability.name}`, block: ability.actions });
      }
    }
    expect(blocks.length).toBeGreaterThan(0);
    for (const { name, block } of blocks) {
      const plan = abilityCostPlan(costsOf(block), 0, Number.MAX_SAFE_INTEGER);
      expect(plan.unhandled, `${name} declares a price the sheet cannot spend`).toEqual([]);
      expect(
        costsOf(block).map((c) => `${c.branch}/${c.who}`),
        `${name} gates a price on a branch or a selector`
      ).toEqual(costsOf(block).map(() => "always/self"));
      expect(plan.ss, `${name} declares no spendable price`).toBeGreaterThan(0);
    }
  });
});
