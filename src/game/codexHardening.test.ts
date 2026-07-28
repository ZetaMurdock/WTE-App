// Phase 2B: the engine says what it does not know.
//
// The Slice 1 tests proved the happy path — an id survives a rename, an override
// wins, a player sees nothing Curator-only. These are about the cases where the
// engine previously answered confidently and wrongly: an override nobody honoured,
// an override nobody asked for, two records claiming one id, and an id that parses
// but describes something else entirely.
import { describe, expect, it } from "vitest";
import { buildEntity, renameEntity, type CodexEntity } from "./codexEntity";
import { CodexRegistry, STANDALONE, type ResolveContext } from "./codexRegistry";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const curator: ResolveContext = { role: "curator", campaignId: CAMPAIGN };

const official = (title = "Vector Swing", ss = 1): CodexEntity =>
  buildEntity({ kind: "genus", title, sourcePage: title.replace(/\s+/g, "_"), fields: {}, data: { ss } }).entity;

const campaignPage = (title: string, fields: Record<string, string>, ss: number): CodexEntity =>
  buildEntity({
    kind: "genus",
    title,
    sourcePage: title.replace(/\s+/g, "_"),
    fields,
    data: { ss },
    scope: "campaign",
    ownerId: CAMPAIGN,
  }).entity;

const ssOf = (r: ReturnType<CodexRegistry["resolveTerm"]>) =>
  r && r.ambiguous === false ? (r.resolvedDefinition.data as { ss: number }).ss : undefined;

describe("a declared override is honoured whatever the page is called", () => {
  it("overrides a concept whose title it does not share", () => {
    // The bug this replaces: the concept was decided by kind+slug alone, so an
    // override page with its own title produced a different slug and did nothing.
    // The Curator wrote the rule, the app stored it, and the table played the
    // official version regardless.
    const reg = new CodexRegistry([
      official(),
      campaignPage("Ashen Sun Vector Swing", { overrides: "wte.genus.vector-swing" }, 4),
    ]);
    const r = reg.resolveTerm("Vector Swing", curator);
    expect(ssOf(r)).toBe(4);
    expect(r && r.ambiguous === false && r.provenance.overrides).toBe("wte.genus.vector-swing");
  });

  it("is reachable by the override's own name too", () => {
    const reg = new CodexRegistry([
      official(),
      campaignPage("Ashen Sun Vector Swing", { overrides: "wte.genus.vector-swing" }, 4),
    ]);
    expect(ssOf(reg.resolveTerm("Ashen Sun Vector Swing", curator))).toBe(4);
  });

  it("still wins after the OFFICIAL page is renamed", () => {
    const reg = new CodexRegistry([
      renameEntity(official(), "Vector Redirection"),
      campaignPage("Ashen Sun Vector Swing", { overrides: "wte.genus.vector-swing" }, 4),
    ]);
    expect(ssOf(reg.resolveReference("wte.genus.vector-swing", curator))).toBe(4);
  });

  it("still wins after the OVERRIDE page is renamed", () => {
    const over = renameEntity(
      campaignPage("Ashen Sun Vector Swing", { overrides: "wte.genus.vector-swing" }, 4),
      "The Ashen Swing"
    );
    const reg = new CodexRegistry([official(), over]);
    expect(ssOf(reg.resolveReference("wte.genus.vector-swing", curator))).toBe(4);
  });

  it("keeps the official definition alongside it", () => {
    const reg = new CodexRegistry([
      official(),
      campaignPage("Ashen Sun Vector Swing", { overrides: "wte.genus.vector-swing" }, 4),
    ]);
    const r = reg.resolveReference("wte.genus.vector-swing", curator);
    expect(r && r.ambiguous === false && (r.officialDefinition!.data as { ss: number }).ss).toBe(1);
  });

  it("reports a chain that eats its own tail instead of looping", () => {
    const a = campaignPage("A", { id: `campaign.${CAMPAIGN}.genus.a`, overrides: `campaign.${CAMPAIGN}.genus.b` }, 1);
    const b = campaignPage("B", { id: `campaign.${CAMPAIGN}.genus.b`, overrides: `campaign.${CAMPAIGN}.genus.a` }, 2);
    const reg = new CodexRegistry([a, b]);
    expect(reg.health().some((p) => p.kind === "override-cycle")).toBe(true);
    expect(reg.status()).toBe("degraded");
  });
});

describe("an override nobody declared is allowed, but never quietly", () => {
  it("still resolves by title, because that is the documented scope stack", () => {
    const reg = new CodexRegistry([official(), campaignPage("Vector Swing", {}, 3)]);
    expect(ssOf(reg.resolveTerm("Vector Swing", curator))).toBe(3);
  });

  it("says the join was made on the title alone", () => {
    const reg = new CodexRegistry([official(), campaignPage("Vector Swing", {}, 3)]);
    const r = reg.resolveTerm("Vector Swing", curator);
    expect(r && r.ambiguous === false && r.provenance.byTitleOnly).toBe(true);
    expect(reg.health().some((p) => p.kind === "undeclared-override")).toBe(true);
  });

  it("does not say that about a declared one", () => {
    const reg = new CodexRegistry([
      official(),
      campaignPage("Vector Swing", { overrides: "wte.genus.vector-swing" }, 3),
    ]);
    const r = reg.resolveTerm("Vector Swing", curator);
    expect(r && r.ambiguous === false && r.provenance.byTitleOnly).toBeUndefined();
    expect(reg.health().some((p) => p.kind === "undeclared-override")).toBe(false);
  });

  it("lets a page opt out of being absorbed by a name it merely shares", () => {
    // A campaign's own "Phase" that has nothing to do with the official one.
    const reg = new CodexRegistry([official("Phase", 1), campaignPage("Phase", { overrides: STANDALONE }, 9)]);
    const r = reg.resolveTerm("Phase", curator);
    // Two genuinely different concepts now — so the resolver asks rather than
    // letting one silently replace the other.
    expect(r && r.ambiguous).toBe(true);
  });

  it("and the official one is still reachable by its id when it does", () => {
    const reg = new CodexRegistry([official("Phase", 1), campaignPage("Phase", { overrides: STANDALONE }, 9)]);
    expect(ssOf(reg.resolveReference("wte.genus.phase", curator))).toBe(1);
  });
});

describe("two records claiming one id is a question, not an answer", () => {
  const dupes = () => [
    buildEntity({ kind: "genus", title: "Vector Swing", sourcePage: "Page_A", fields: {}, data: { ss: 1 } }).entity,
    buildEntity({ kind: "genus", title: "Vector Swing", sourcePage: "Page_B", fields: {}, data: { ss: 8 } }).entity,
  ];

  it("refuses to resolve the contested id", () => {
    const r = new CodexRegistry(dupes()).resolveReference("wte.genus.vector-swing", curator);
    expect(r && r.ambiguous).toBe(true);
    expect(r && r.ambiguous && r.conflictingId).toBe("wte.genus.vector-swing");
    expect(r && r.ambiguous && r.candidates).toHaveLength(2);
  });

  it("refuses to resolve it by name either", () => {
    expect(new CodexRegistry(dupes()).resolveTerm("Vector Swing", curator)!.ambiguous).toBe(true);
  });

  it("names both pages in health, and marks the registry degraded", () => {
    const reg = new CodexRegistry(dupes());
    const p = reg.health().find((x) => x.kind === "duplicate-id")!;
    expect(p.detail).toContain("Page_A");
    expect(p.detail).toContain("Page_B");
    expect(p.severity).toBe("error");
    expect(reg.status()).toBe("degraded");
  });

  it("does not treat the same page loaded twice as a conflict", () => {
    const one = official();
    expect(new CodexRegistry([one, { ...one }]).status()).toBe("ready");
  });
});

describe("a broken record is reported, never deleted", () => {
  it("keeps a page with a mistyped id findable by name", () => {
    // "one typo silently removes content" is the outcome this exists to prevent.
    const broken = buildEntity({
      kind: "genus",
      title: "Vector Swing",
      sourcePage: "V",
      fields: { id: "wte-genus-vector-swing" },
      data: { ss: 1 },
    }).entity;
    const reg = new CodexRegistry([broken]);
    expect(reg.resolveTerm("Vector Swing", curator)).not.toBeNull();
    expect(reg.health().some((p) => p.kind === "malformed-id")).toBe(true);
  });

  it("quarantines a record that can be found by nothing at all", () => {
    const nameless = { ...official(), id: "???", name: "   " };
    const reg = new CodexRegistry([nameless]);
    expect(reg.quarantined()).toHaveLength(1);
    expect(reg.all()).toHaveLength(0);
    expect(reg.health().some((p) => p.kind === "unusable-record")).toBe(true);
  });
});

describe("an id that parses can still describe the wrong thing", () => {
  it("catches an id whose kind disagrees with the page", () => {
    const built = buildEntity({
      kind: "cipher",
      title: "Vector Swing",
      sourcePage: "V",
      fields: { id: "wte.genus.vector-swing" },
      data: {},
    });
    expect(built.mismatch).toMatch(/genus/);
    expect(new CodexRegistry([built.entity]).health().some((p) => p.kind === "identity-mismatch")).toBe(true);
  });

  it("catches a campaign page filed under the official layer", () => {
    // Left as written — references already use it — but it would have taken over
    // the official concept for every table, not just this one.
    const built = buildEntity({
      kind: "genus",
      title: "Vector Swing",
      sourcePage: "V",
      fields: { id: "wte.genus.vector-swing" },
      data: {},
      scope: "campaign",
      ownerId: CAMPAIGN,
    });
    expect(built.mismatch).toMatch(/scoped/);
    expect(built.entity.id).toBe("wte.genus.vector-swing");
  });

  it("catches a campaign page carrying another campaign's owner", () => {
    const built = buildEntity({
      kind: "genus",
      title: "Vector Swing",
      sourcePage: "V",
      fields: { id: "campaign.someone-else.genus.vector-swing" },
      data: {},
      scope: "campaign",
      ownerId: CAMPAIGN,
    });
    expect(built.mismatch).toMatch(/owner/);
  });

  it("says nothing when the id agrees", () => {
    expect(
      buildEntity({
        kind: "genus",
        title: "Vector Swing",
        sourcePage: "V",
        fields: { id: "wte.genus.vector-swing" },
        data: {},
      }).mismatch
    ).toBeUndefined();
  });
});

describe("the indexes never disagree with the entities", () => {
  it("sees an entity added after construction", () => {
    const reg = new CodexRegistry([official()]);
    expect(ssOf(reg.resolveTerm("Vector Swing", curator))).toBe(1);
    reg.add(campaignPage("Vector Swing", { overrides: "wte.genus.vector-swing" }, 6));
    expect(ssOf(reg.resolveTerm("Vector Swing", curator))).toBe(6);
  });

  it("forgets an entity that replaceAll dropped", () => {
    // A reload that leaves the previous contents behind resolves against pages the
    // Codex no longer has.
    const reg = new CodexRegistry([official(), campaignPage("Vector Swing", { overrides: "wte.genus.vector-swing" }, 6)]);
    reg.replaceAll([official()]);
    expect(ssOf(reg.resolveTerm("Vector Swing", curator))).toBe(1);
    expect(reg.all()).toHaveLength(1);
  });

  it("recomputes health on reload rather than accumulating it", () => {
    const reg = new CodexRegistry([
      buildEntity({ kind: "genus", title: "X", sourcePage: "A", fields: {}, data: {} }).entity,
      buildEntity({ kind: "genus", title: "X", sourcePage: "B", fields: {}, data: {} }).entity,
    ]);
    expect(reg.status()).toBe("degraded");
    reg.replaceAll([official()]);
    expect(reg.health()).toEqual([]);
    expect(reg.status()).toBe("ready");
  });
});
