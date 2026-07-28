import { describe, expect, it } from "vitest";
import { buildEntity, renameEntity, type CodexEntity } from "./codexEntity";
import { CodexRegistry, type ResolveContext } from "./codexRegistry";
import { planGenusMigration, resolveGenusRefs } from "./genusRef";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const ctx: ResolveContext = { role: "curator", campaignId: CAMPAIGN };

const genus = (title: string, over: Partial<Parameters<typeof buildEntity>[0]> = {}): CodexEntity =>
  buildEntity({ kind: "genus", title, sourcePage: title.replace(/\s+/g, "_"), fields: {}, data: { ss: 1 }, ...over })
    .entity;

describe("a sheet reads the same whether it has migrated or not", () => {
  const reg = new CodexRegistry([genus("Vector Swing")]);

  it("resolves a legacy NAME key", () => {
    const [ref] = resolveGenusRefs({ "Vector Swing": 3 }, reg, ctx);
    expect(ref.displayName).toBe("Vector Swing");
    expect(ref.migrated).toBe(false);
    expect(ref.unresolved).toBe(false);
    expect(ref.focus).toBe(3);
  });

  it("resolves a stable ID key identically", () => {
    const [ref] = resolveGenusRefs({ "wte.genus.vector-swing": 3 }, reg, ctx);
    expect(ref.displayName).toBe("Vector Swing");
    expect(ref.migrated).toBe(true);
    expect(ref.focus).toBe(3);
  });

  it("shows the CURRENT name after a rename, for a migrated sheet", () => {
    const renamed = new CodexRegistry([renameEntity(genus("Vector Swing"), "Vector Redirection")]);
    const [ref] = resolveGenusRefs({ "wte.genus.vector-swing": 2 }, renamed, ctx);
    // Nobody touched the character, and it now reads the new name.
    expect(ref.displayName).toBe("Vector Redirection");
  });

  it("an un-migrated sheet ALSO survives the rename, via the alias", () => {
    const renamed = new CodexRegistry([renameEntity(genus("Vector Swing"), "Vector Redirection")]);
    const [ref] = resolveGenusRefs({ "Vector Swing": 2 }, renamed, ctx);
    expect(ref.unresolved).toBe(false);
    expect(ref.displayName).toBe("Vector Redirection");
  });
});

describe("nothing a player chose is ever dropped", () => {
  it("keeps a name the Codex does not know, and says so", () => {
    // The page may simply not be pulled on this machine yet.
    const [ref] = resolveGenusRefs({ "Some Homebrew Thing": 4 }, new CodexRegistry([]), ctx);
    expect(ref.unresolved).toBe(true);
    expect(ref.displayName).toBe("Some Homebrew Thing");
    expect(ref.focus).toBe(4);
  });

  it("reports ambiguity instead of picking", () => {
    const reg = new CodexRegistry([
      genus("Phase"),
      buildEntity({ kind: "genus", title: "Phase", sourcePage: "Other_Phase", fields: { id: "wte.genus.phase-two" }, data: {} }).entity,
    ]);
    const [ref] = resolveGenusRefs({ Phase: 1 }, reg, ctx);
    expect(ref.ambiguousWith?.length).toBe(2);
  });
});

describe("migration is conservative", () => {
  const reg = new CodexRegistry([genus("Vector Swing")]);

  it("rewrites a resolved legacy name to its stable id", () => {
    const plan = planGenusMigration({ "Vector Swing": 3 }, reg, ctx);
    expect(plan.changed).toBe(true);
    expect(plan.next).toEqual({ "wte.genus.vector-swing": 3 });
    expect(plan.migrated).toEqual([{ from: "Vector Swing", to: "wte.genus.vector-swing" }]);
  });

  it("leaves an unresolved name exactly as it was", () => {
    const plan = planGenusMigration({ "Unknown Ability": 2 }, reg, ctx);
    expect(plan.changed).toBe(false);
    expect(plan.next).toEqual({ "Unknown Ability": 2 });
    expect(plan.kept[0].reason).toBe("unresolved");
  });

  it("leaves an AMBIGUOUS name alone rather than binding the character to a guess", () => {
    const amb = new CodexRegistry([
      genus("Phase"),
      buildEntity({ kind: "genus", title: "Phase", sourcePage: "P2", fields: { id: "wte.genus.phase-two" }, data: {} }).entity,
    ]);
    const plan = planGenusMigration({ Phase: 1 }, amb, ctx);
    expect(plan.changed).toBe(false);
    expect(plan.kept[0].reason).toBe("ambiguous");
  });

  it("is idempotent — running it twice changes nothing the second time", () => {
    const once = planGenusMigration({ "Vector Swing": 3 }, reg, ctx);
    const twice = planGenusMigration(once.next, reg, ctx);
    expect(twice.changed).toBe(false);
    expect(twice.next).toEqual(once.next);
  });

  it("migrates to the OFFICIAL id, not the campaign override's", () => {
    // A sheet pinned to one table's override would carry those rules to another
    // campaign. The character holds a CONCEPT; which layer wins is per context.
    const withOverride = new CodexRegistry([
      genus("Vector Swing"),
      buildEntity({
        kind: "genus",
        title: "Vector Swing",
        sourcePage: "Ashen_VS",
        fields: { overrides: "wte.genus.vector-swing" },
        data: { ss: 2 },
        scope: "campaign",
        ownerId: CAMPAIGN,
      }).entity,
    ]);
    const plan = planGenusMigration({ "Vector Swing": 3 }, withOverride, ctx);
    expect(Object.keys(plan.next)).toEqual(["wte.genus.vector-swing"]);
  });

  it("refuses to collapse a name and its alias, and says why", () => {
    // Both entries are the same concept, so migrating them writes one key twice.
    // Keeping the larger — what this used to do — silently changes how much Focus
    // the character has spent and destroys the evidence that it did.
    const renamed = new CodexRegistry([renameEntity(genus("Vector Swing"), "Vector Redirection")]);
    const plan = planGenusMigration({ "Vector Swing": 2, "Vector Redirection": 4 }, renamed, ctx);

    expect(plan.changed).toBe(false);
    expect(plan.next).toEqual({ "Vector Swing": 2, "Vector Redirection": 4 });
    expect(plan.conflicts).toEqual([
      {
        target: "wte.genus.vector-swing",
        entries: [
          { stored: "Vector Swing", focus: 2 },
          { stored: "Vector Redirection", focus: 4 },
        ],
      },
    ]);
    expect(plan.kept.every((k) => k.reason === "collision")).toBe(true);
  });

  it("refuses when a legacy name would land on an id the sheet already holds", () => {
    // The half-migrated sheet. The id entry is not being changed by anyone, and
    // writing the name's Focus over it would lose points nothing was touching.
    const plan = planGenusMigration({ "wte.genus.vector-swing": 5, "Vector Swing": 1 }, reg, ctx);
    expect(plan.changed).toBe(false);
    expect(plan.next["wte.genus.vector-swing"]).toBe(5);
    expect(plan.next["Vector Swing"]).toBe(1);
    expect(plan.conflicts[0].target).toBe("wte.genus.vector-swing");
  });

  it("does not rewrite anyone's sheet against a Codex that is not sound", () => {
    // Duplicate ids mean the registry cannot say what a reference points at. That
    // is not a state to permanently rewrite characters from.
    const broken = new CodexRegistry([
      genus("Vector Swing"),
      buildEntity({ kind: "genus", title: "Vector Swing", sourcePage: "Other_Page", fields: {}, data: {} }).entity,
    ]);
    expect(broken.status()).toBe("degraded");
    const plan = planGenusMigration({ "Vector Swing": 3 }, broken, ctx);
    expect(plan.blocked).toBe("registry-degraded");
    expect(plan.changed).toBe(false);
    expect(plan.next).toEqual({ "Vector Swing": 3 });
  });

  it("handles an empty sheet without inventing anything", () => {
    expect(planGenusMigration({}, reg, ctx)).toMatchObject({ next: {}, changed: false });
  });
});
