// @vitest-environment happy-dom
//
// Phase 2D.5. Migration is the only thing in the app that rewrites a character's
// ability keys, and these are the rules it works under.
import { beforeEach, describe, expect, it } from "vitest";
import { applyCodexPages, noCodexPages, planGenusMigrationSafely, __resetCodexService } from "./codexService";
import { codexCtx, genusFocusFor, genusKeyFor, resolveGenusLoadout, resolveGenusSpend } from "./resolvedGenus";
import { isCodexId } from "./codexId";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const ctx = { ...codexCtx(CAMPAIGN, "char-1"), role: "curator" as const };
const domain = GENUS_DOMAIN_NAMES[0];
const [first, second] = getGenusDomain(domain)!.abilities;
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

beforeEach(() => {
  __resetCodexService();
  noCodexPages();
});

describe("a new investment is keyed by stable id", () => {
  it("uses the id when the sheet does not already hold the name", () => {
    expect(genusKeyFor(first, {})).toBe(first.id);
  });

  it("keeps the LEGACY name when the sheet already holds it", () => {
    // Writing the id beside the name would leave one concept in two entries —
    // the collision the planner refuses to resolve — and would double the Focus
    // the character appears to have spent.
    expect(genusKeyFor(first, { [first.name]: 2 })).toBe(first.name);
  });

  it("reads Focus under whichever key the sheet uses", () => {
    expect(genusFocusFor(first, { [first.name]: 2 })).toBe(2);
    expect(genusFocusFor(first, { [first.id!]: 3 })).toBe(3);
    expect(genusFocusFor(first, {})).toBe(0);
  });

  it("falls back to the name for an ability with no id", () => {
    expect(genusKeyFor({ name: "Homebrew" }, {})).toBe("Homebrew");
  });
});

describe("migration is refused unless the Codex is sound", () => {
  it("does nothing while the Codex is still loading", () => {
    __resetCodexService(); // back to "loading"
    const plan = planGenusMigrationSafely({ [first.name]: 3 }, ctx);
    expect(plan.changed).toBe(false);
    expect(plan.next).toEqual({ [first.name]: 3 });
  });

  it("does nothing while degraded", () => {
    applyCodexPages({ ...empty, listFailed: "database is locked" });
    expect(planGenusMigrationSafely({ [first.name]: 3 }, ctx).changed).toBe(false);
  });

  it("proceeds once everything has settled", () => {
    const plan = planGenusMigrationSafely({ [first.name]: 3 }, ctx);
    expect(plan.next).toEqual({ [first.id!]: 3 });
  });
});

describe("what migration never does", () => {
  it("never changes how much Focus is spent", () => {
    const spend = { [first.name]: 3, [second.name]: 2, "Homebrew Thing": 1 };
    const before = Object.values(spend).reduce((a, b) => a + b, 0);
    const plan = planGenusMigrationSafely(spend, ctx);
    const after = Object.values(plan.next).reduce((a, b) => a + b, 0);
    expect(after).toBe(before);
  });

  it("never drops an entry", () => {
    const spend = { [first.name]: 3, "Homebrew Thing": 1 };
    const plan = planGenusMigrationSafely(spend, ctx);
    expect(Object.keys(plan.next)).toHaveLength(2);
  });

  it("never changes which abilities the character has", () => {
    const spend = { [first.name]: 3, [second.name]: 2 };
    const before = resolveGenusSpend(spend, ctx).map((r) => r.displayName).sort();
    const after = resolveGenusSpend(planGenusMigrationSafely(spend, ctx).next, ctx)
      .map((r) => r.displayName)
      .sort();
    expect(after).toEqual(before);
  });

  it("never mutates the map it was given", () => {
    const spend = { [first.name]: 3 };
    const copy = { ...spend };
    planGenusMigrationSafely(spend, ctx);
    expect(spend).toEqual(copy);
  });

  it("is idempotent — running it again changes nothing", () => {
    const once = planGenusMigrationSafely({ [first.name]: 3 }, ctx);
    const twice = planGenusMigrationSafely(once.next, ctx);
    expect(twice.changed).toBe(false);
    expect(twice.next).toEqual(once.next);
  });
});

describe("a conflict is left for a person", () => {
  it("refuses a half-migrated sheet holding both keys for one ability", () => {
    const plan = planGenusMigrationSafely({ [first.id!]: 5, [first.name]: 1 }, ctx);
    expect(plan.changed).toBe(false);
    expect(plan.conflicts).toHaveLength(1);
    // BOTH survive, with their Focus intact.
    expect(plan.next[first.id!]).toBe(5);
    expect(plan.next[first.name]).toBe(1);
  });

  it("still migrates the entries that are not in conflict", () => {
    const plan = planGenusMigrationSafely({ [first.id!]: 5, [first.name]: 1, [second.name]: 2 }, ctx);
    expect(plan.next[second.id!]).toBe(2);
    expect(plan.conflicts).toHaveLength(1);
  });
});

describe("an unresolvable choice is preserved, never tidied away", () => {
  it("keeps a name the Codex does not know", () => {
    const plan = planGenusMigrationSafely({ "Something Homebrew": 4 }, ctx);
    expect(plan.next).toEqual({ "Something Homebrew": 4 });
    expect(plan.kept[0].reason).toBe("unresolved");
  });

  it("migrates to the OFFICIAL concept even when a campaign override is in force", () => {
    // A sheet pinned to one table's override would carry those rules elsewhere.
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "House Version", overrides: first.id!, data: { ss: 1 } }],
    });
    const plan = planGenusMigrationSafely({ [first.name]: 3 }, ctx);
    expect(Object.keys(plan.next)).toEqual([first.id!]);
  });
});

describe("the compatibility field keeps display names after migration", () => {
  // genusLoadout is what the legacy sheet, exports and older readers match on,
  // and they match on NAMES. Keeping it "in step" with the Focus-map keys filled
  // it with `wte.genus.*` strings after a migration — turning the migration into
  // visible damage on the exact surface that exists to prevent it.
  const projection = (spend: Record<string, number>) =>
    resolveGenusLoadout(Object.keys(spend).filter((k) => spend[k] > 0), ctx).map((r) => r.displayName);

  it("projects names for a migrated, id-keyed character", () => {
    const migrated = planGenusMigrationSafely({ [first.name]: 3 }, ctx).next;
    expect(Object.keys(migrated)).toEqual([first.id!]);
    expect(projection(migrated)).toEqual([first.name]);
  });

  it("contains no raw ids at all", () => {
    const migrated = planGenusMigrationSafely({ [first.name]: 3, [second.name]: 1 }, ctx).next;
    for (const entry of projection(migrated)) {
      expect(isCodexId(entry), `"${entry}" is a raw id, which no legacy reader matches`).toBe(false);
    }
  });

  it("reads identically before and after migrating", () => {
    const before = projection({ [first.name]: 3, [second.name]: 1 });
    const after = projection(planGenusMigrationSafely({ [first.name]: 3, [second.name]: 1 }, ctx).next);
    expect(after.sort()).toEqual(before.sort());
  });

  it("still carries an unresolved choice through as written", () => {
    expect(projection({ "Some Homebrew": 2 })).toEqual(["Some Homebrew"]);
  });
});
