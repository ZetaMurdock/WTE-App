// The Phase 2 foundation test.
//
// This is deliberately ONE narrative rather than a set of unit tests, because the
// thing being proven is that the pieces hold together: a character stores an id, a
// Curator renames the page, and nothing breaks. Testing makeId() and the registry
// separately would pass while that story still failed.
import { describe, expect, it } from "vitest";
import { buildEntity, renameEntity, withIdentityRow, type CodexEntity } from "./codexEntity";
import { CodexRegistry, type ResolveContext } from "./codexRegistry";
import { makeId } from "./codexId";

const CAMPAIGN_ID = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d"; // a real uuid shape
const OTHER_CAMPAIGN = "e25cc744-1111-2222-3333-444455556666";

/** The official Vector Swing, as parsed from a Codex page. */
function officialVectorSwing(): CodexEntity {
  return buildEntity({
    kind: "genus",
    title: "Vector Swing",
    sourcePage: "Vector_Swing",
    fields: {},
    data: {
      domain: "Kinetic",
      ss: 1,
      activation: "Active",
      range: "Self",
      target: "Self",
      effect: "The next melee attack deals one additional damage die.",
    },
  }).entity;
}

/** The Ashen Sun table's rewrite of the same ability. */
function campaignOverride(): CodexEntity {
  return buildEntity({
    kind: "genus",
    title: "Vector Swing",
    sourcePage: "Ashen_Sun_Vector_Swing",
    fields: { overrides: "wte.genus.vector-swing" },
    data: {
      domain: "Kinetic",
      ss: 2,
      activation: "Active",
      range: "Self",
      target: "Self",
      effect: "The next melee attack deals TWO additional damage dice.",
    },
    scope: "campaign",
    ownerId: CAMPAIGN_ID,
  }).entity;
}

const curator: ResolveContext = { role: "curator", campaignId: CAMPAIGN_ID };
const player: ResolveContext = { role: "player", campaignId: CAMPAIGN_ID };

describe("a character survives its ability being renamed", () => {
  it("walks the whole story end to end", () => {
    // 1. The character stores the STABLE ID, not the name.
    const stored = "wte.genus.vector-swing";
    let official = officialVectorSwing();
    expect(official.id).toBe(stored);

    // 2. The definition begins as "Vector Swing".
    let reg = new CodexRegistry([official]);
    let r = reg.resolveReference(stored, curator);
    expect(r && r.ambiguous === false && r.entity.name).toBe("Vector Swing");

    // 3. The Curator renames the page.
    official = renameEntity(official, "Vector Redirection");

    // 4. The stable id did NOT change — this is the guarantee everything rests on.
    expect(official.id).toBe(stored);

    // 5. The previous name became an alias.
    expect(official.aliases).toContain("Vector Swing");

    // 6. The character, still holding the id, now displays the new name.
    reg = new CodexRegistry([official]);
    r = reg.resolveReference(stored, curator);
    expect(r && r.ambiguous === false && r.entity.name).toBe("Vector Redirection");

    // 7. Searching the OLD name still finds it.
    const byOldName = reg.resolveTerm("Vector Swing", curator);
    expect(byOldName && byOldName.ambiguous === false && byOldName.entity.id).toBe(stored);
    expect(byOldName && byOldName.ambiguous === false && byOldName.matchedBy).toBe("alias");

    // 8. A campaign override becomes the resolved definition.
    reg = new CodexRegistry([official, campaignOverride()]);
    r = reg.resolveReference(stored, curator);
    expect(r && r.ambiguous === false).toBe(true);
    if (r && r.ambiguous === false) {
      expect(r.resolvedDefinition.scope).toBe("campaign");
      expect((r.resolvedDefinition.data as { ss: number }).ss).toBe(2);

      // 9. The card can name BOTH sources — the override never destroys the
      //    official definition beneath it.
      expect(r.officialDefinition).toBeDefined();
      expect(r.officialDefinition!.scope).toBe("wte");
      expect((r.officialDefinition!.data as { ss: number }).ss).toBe(1);
      expect(r.provenance.overridden).toBe(true);
      expect(r.provenance.overrides).toBe("wte.genus.vector-swing");

      // 11. "Open full page" reaches the right page — the OVERRIDE's page, since
      //     that is the definition in play.
      expect(r.provenance.sourcePage).toBe("Ashen_Sun_Vector_Swing");
      expect(r.officialDefinition!.sourcePage).toBe("Vector_Swing");
    }
  });

  it("10. a player cannot resolve a Curator-only definition", () => {
    const secret = buildEntity({
      kind: "genus",
      title: "Warden's Gambit",
      sourcePage: "Wardens_Gambit",
      fields: { visibility: "curator" },
      data: { domain: "Null" },
    }).entity;
    const reg = new CodexRegistry([secret]);

    expect(reg.resolveTerm("Warden's Gambit", curator)).not.toBeNull();
    // The player gets NOTHING — not a redacted stub that leaks the name exists.
    expect(reg.resolveTerm("Warden's Gambit", player)).toBeNull();
    expect(reg.search("Warden", player)).toEqual([]);
  });
});

describe("another table's rules never leak in", () => {
  it("ignores a campaign override owned by a different campaign", () => {
    const foreign = buildEntity({
      kind: "genus",
      title: "Vector Swing",
      sourcePage: "Other_Table_Vector_Swing",
      fields: {},
      data: { ss: 99 },
      scope: "campaign",
      ownerId: OTHER_CAMPAIGN,
    }).entity;
    const reg = new CodexRegistry([officialVectorSwing(), foreign]);

    const r = reg.resolveTerm("Vector Swing", curator);
    expect(r && r.ambiguous === false && r.resolvedDefinition.scope).toBe("wte");
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(1);
  });

  it("ignores a pack definition when that pack is not enabled", () => {
    const packEntity = buildEntity({
      kind: "genus",
      title: "Vector Swing",
      sourcePage: "Pack_Vector_Swing",
      fields: {},
      data: { ss: 7 },
      scope: "pack",
      ownerId: "red-choir",
    }).entity;
    const reg = new CodexRegistry([officialVectorSwing(), packEntity]);

    expect(reg.resolveTerm("Vector Swing", curator)!).toMatchObject({
      resolvedDefinition: { scope: "wte" },
    });
    // With the pack enabled it wins, because pack outranks official.
    const withPack = reg.resolveTerm("Vector Swing", { ...curator, packIds: ["red-choir"] });
    expect(withPack && withPack.ambiguous === false && withPack.resolvedDefinition.scope).toBe("pack");
  });

  it("stacks scopes in the documented order", () => {
    const mk = (scope: "pack" | "campaign" | "character" | "session", owner: string, ss: number) =>
      buildEntity({
        kind: "genus",
        title: "Vector Swing",
        sourcePage: `${scope}_page`,
        fields: {},
        data: { ss },
        scope,
        ownerId: owner,
      }).entity;

    const reg = new CodexRegistry([
      officialVectorSwing(),
      mk("pack", "p1", 2),
      mk("campaign", CAMPAIGN_ID, 3),
      mk("character", "ch1", 4),
      mk("session", "s1", 5),
    ]);
    const full = reg.resolveTerm("Vector Swing", {
      role: "curator",
      campaignId: CAMPAIGN_ID,
      packIds: ["p1"],
      characterId: "ch1",
      sessionId: "s1",
    });
    // session is strongest
    expect(full && full.ambiguous === false && (full.resolvedDefinition.data as { ss: number }).ss).toBe(5);
  });
});

describe("the resolver refuses to guess", () => {
  it("reports ambiguity rather than picking between two different concepts", () => {
    // A real case from the corpus shape: a cipher and a genus ability can share a
    // name. They are different concepts, so a bare term cannot choose.
    const genus = buildEntity({ kind: "genus", title: "Phase", sourcePage: "Phase_G", fields: {}, data: {} }).entity;
    const cipher = buildEntity({ kind: "cipher", title: "PHASE", sourcePage: "Phase_C", fields: {}, data: {} }).entity;
    const reg = new CodexRegistry([genus, cipher]);

    const r = reg.resolveTerm("Phase", curator);
    expect(r && r.ambiguous).toBe(true);
    if (r && r.ambiguous) {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates.map((c) => c.kind).sort()).toEqual(["cipher", "genus"]);
    }
  });

  it("resolves cleanly once the caller says which kind it means", () => {
    const genus = buildEntity({ kind: "genus", title: "Phase", sourcePage: "Phase_G", fields: {}, data: {} }).entity;
    const cipher = buildEntity({ kind: "cipher", title: "PHASE", sourcePage: "Phase_C", fields: {}, data: {} }).entity;
    const reg = new CodexRegistry([genus, cipher]);

    const r = reg.resolveTerm("Phase", { ...curator, kind: "genus" });
    expect(r && r.ambiguous === false && r.entity.kind).toBe("genus");
  });

  it("returns null for a term nothing answers to", () => {
    expect(new CodexRegistry([officialVectorSwing()]).resolveTerm("Nonexistent", curator)).toBeNull();
  });
});

describe("authoring problems are reported, not absorbed", () => {
  it("flags two pages claiming the same id", () => {
    const a = buildEntity({ kind: "genus", title: "Vector Swing", sourcePage: "A", fields: {}, data: {} }).entity;
    const b = buildEntity({ kind: "genus", title: "Vector Swing", sourcePage: "B", fields: {}, data: {} }).entity;
    const problems = new CodexRegistry([a, b]).health();
    expect(problems.some((p) => p.kind === "duplicate-id")).toBe(true);
  });

  it("flags an override pointing at a definition that is not there", () => {
    const orphan = buildEntity({
      kind: "genus",
      title: "Ghost",
      sourcePage: "Ghost",
      fields: { overrides: "wte.genus.does-not-exist" },
      data: {},
      scope: "campaign",
      ownerId: CAMPAIGN_ID,
    }).entity;
    const problems = new CodexRegistry([orphan]).health();
    expect(problems.some((p) => p.kind === "dangling-override")).toBe(true);
  });

  it("flags an alias that reaches two different concepts", () => {
    const a = buildEntity({ kind: "genus", title: "Alpha", sourcePage: "A", fields: { aliases: "Shared" }, data: {} }).entity;
    const b = buildEntity({ kind: "cipher", title: "Beta", sourcePage: "B", fields: { aliases: "Shared" }, data: {} }).entity;
    const problems = new CodexRegistry([a, b]).health();
    expect(problems.some((p) => p.kind === "ambiguous-alias")).toBe(true);
  });

  it("reports a malformed declared id instead of silently replacing it", () => {
    const built = buildEntity({
      kind: "genus",
      title: "Broken",
      sourcePage: "Broken",
      fields: { id: "not-a-valid-id" },
      data: {},
    });
    // Substituting a different id would detach every reference already using theirs.
    expect(built.malformed).toBeTruthy();
    expect(built.entity.id).toBe("not-a-valid-id");
    expect(new CodexRegistry([built.entity]).health().some((p) => p.kind === "malformed-id")).toBe(true);
  });
});

describe("identity is assigned once and pinned to the page", () => {
  it("derives an id when the page declares none, and says it did", () => {
    const built = buildEntity({ kind: "genus", title: "Vector Swing", sourcePage: "V", fields: {}, data: {} });
    expect(built.assigned).toBe(true);
    expect(built.entity.id).toBe("wte.genus.vector-swing");
  });

  it("uses the declared id verbatim and does not re-derive from the title", () => {
    // This is the case that matters: the page was renamed, and the id must NOT
    // follow the new title.
    const built = buildEntity({
      kind: "genus",
      title: "Vector Redirection",
      sourcePage: "V",
      fields: { id: "wte.genus.vector-swing" },
      data: {},
    });
    expect(built.assigned).toBe(false);
    expect(built.entity.id).toBe("wte.genus.vector-swing");
  });

  it("owns a campaign concept by stable campaign ID, never by name", () => {
    const built = buildEntity({
      kind: "ability",
      title: "Gravitic Blood",
      sourcePage: "G",
      fields: {},
      data: {},
      scope: "campaign",
      ownerId: CAMPAIGN_ID,
    });
    // A campaign rename must not move the id.
    expect(built.entity.id).toBe(makeId("ability", "Gravitic Blood", { scope: "campaign", owner: CAMPAIGN_ID }));
    expect(built.entity.id).toContain(CAMPAIGN_ID);
  });

  it("writes the id back into an existing field table", () => {
    const md = ["# Vector Swing", "", "| Field | Value |", "|---|---|", "| Type | Genus |", "| SS | 1 |", "", "Effect: ..."].join("\n");
    const out = withIdentityRow(md, "wte.genus.vector-swing");
    expect(out).toContain("| ID | wte.genus.vector-swing |");
    // Still one contiguous table, and nothing else was disturbed.
    expect(out).toContain("| SS | 1 |");
    expect(out.indexOf("| ID |")).toBeGreaterThan(out.indexOf("| Type | Genus |"));
    expect(out).toContain("Effect: ...");
  });

  it("replaces an existing ID row rather than adding a second", () => {
    const md = ["# X", "| Field | Value |", "|---|---|", "| ID | wte.genus.old |", "| SS | 1 |"].join("\n");
    const out = withIdentityRow(md, "wte.genus.new");
    expect(out).toContain("| ID | wte.genus.new |");
    expect(out).not.toContain("wte.genus.old");
    expect(out.match(/\| ID \|/g)).toHaveLength(1);
  });

  it("creates a table when the page has none", () => {
    const out = withIdentityRow("# Lonely Page\n\nJust prose.", "wte.genus.lonely-page");
    expect(out).toContain("| ID | wte.genus.lonely-page |");
    expect(out).toContain("Just prose.");
  });
});

describe("stored references work during the dual-read period", () => {
  it("resolves a legacy NAME reference the same as an id reference", () => {
    const reg = new CodexRegistry([officialVectorSwing()]);
    const byId = reg.resolveReference("wte.genus.vector-swing", curator);
    const byName = reg.resolveReference("Vector Swing", curator);
    expect(byId && byId.ambiguous === false && byId.entity.id).toBe("wte.genus.vector-swing");
    expect(byName && byName.ambiguous === false && byName.entity.id).toBe("wte.genus.vector-swing");
  });

  it("a legacy name reference still picks up the campaign override", () => {
    // An un-migrated character must get the same rules as a migrated one.
    const reg = new CodexRegistry([officialVectorSwing(), campaignOverride()]);
    const r = reg.resolveReference("Vector Swing", curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(2);
  });

  it("an id reference survives the rename that breaks a name reference", () => {
    const renamed = renameEntity(officialVectorSwing(), "Vector Redirection");
    const reg = new CodexRegistry([renamed]);
    // The id keeps working.
    expect(reg.resolveReference("wte.genus.vector-swing", curator)).not.toBeNull();
    // And so does the old name, because renaming filed it as an alias — which is
    // what protects characters that have not migrated yet.
    expect(reg.resolveReference("Vector Swing", curator)).not.toBeNull();
  });
});
