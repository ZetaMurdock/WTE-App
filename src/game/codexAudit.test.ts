// @vitest-environment happy-dom
//
// Regression cover for five reported faults, written against the reported
// mechanism rather than against the fix — so each one fails again if the
// behaviour comes back by another route.
import { beforeEach, describe, expect, it } from "vitest";
import { applyCodexPages, codexRegistry, codexStatus, __resetCodexService } from "./codexService";
import { buildCampaignGenus, buildOfficialGenus } from "./codexGenusSource";
import { CodexRegistry, type ResolveContext } from "./codexRegistry";
import { buildEntity } from "./codexEntity";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const OTHER = "e25cc744-1111-2222-3333-444455556666";
const curator: ResolveContext = { role: "curator", campaignId: CAMPAIGN, kind: "genus" };
const player: ResolveContext = { role: "player", campaignId: CAMPAIGN, kind: "genus" };
const first = getGenusDomain(GENUS_DOMAIN_NAMES[0])!.abilities[0];
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

beforeEach(() => __resetCodexService());

describe("P0 — page secrecy must not remove official mechanics", () => {
  it("a player still resolves the ability when its mirror page is GM-only", () => {
    const reg = new CodexRegistry(
      buildOfficialGenus([{ stem: "M", title: first.name, visibility: "curator" }]).entities
    );
    expect(reg.resolveReference(first.id!, player), "the official ability vanished for players").not.toBeNull();
  });

  it("and it is still in the player's searchable set", () => {
    const reg = new CodexRegistry(
      buildOfficialGenus([{ stem: "M", title: first.name, visibility: "curator" }]).entities
    );
    expect(reg.search(first.name, player).length).toBeGreaterThan(0);
  });

  it("while the page itself is still marked restricted", () => {
    const reg = new CodexRegistry(
      buildOfficialGenus([{ stem: "M", title: first.name, visibility: "curator" }]).entities
    );
    const r = reg.resolveReference(first.id!, player);
    expect(r && r.ambiguous === false && r.entity.pageVisibility).toBe("curator");
  });
});

describe("P0 — a campaign page must not be re-owned", () => {
  const theirs = {
    stem: "Their_Rule",
    title: "Their Lark",
    id: `campaign.${OTHER}.genus.their-lark`,
    overrides: first.id!,
    data: { ss: 99 },
  };

  it("is refused, not adopted, when loaded under a different campaign", () => {
    const { entities } = buildCampaignGenus([theirs], CAMPAIGN);
    expect(entities, "another campaign's rule was adopted by this one").toEqual([]);
  });

  it("so the official rule still stands here", () => {
    const reg = new CodexRegistry([
      ...buildOfficialGenus().entities,
      ...buildCampaignGenus([theirs], CAMPAIGN).entities,
    ]);
    const r = reg.resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(first.ss);
  });

  it("and the owning campaign still gets it", () => {
    const { entities } = buildCampaignGenus([theirs], OTHER);
    expect(entities).toHaveLength(1);
  });
});

describe("P0 — a dangling canonical id must not validate", () => {
  it("refuses an override pointing at an id that is not present", () => {
    const orphan = buildEntity({
      kind: "genus",
      title: "Orphan",
      sourcePage: "O",
      fields: { overrides: "wte.genus.never-installed" },
      data: { ss: 2 },
      scope: "campaign",
      ownerId: CAMPAIGN,
    }).entity;
    const r = new CodexRegistry([orphan]).resolveTerm("Orphan", curator);
    expect(r && r.ambiguous === false && r.conceptIdValid, "a missing target passed validation").toBe(false);
  });

  it("refuses a canonical id whose kind is not genus", () => {
    const cipher = buildEntity({ kind: "cipher", title: "Ghost", sourcePage: "C", fields: {}, data: {} }).entity;
    const wrong = buildEntity({
      kind: "genus",
      title: "Crosswired",
      sourcePage: "W",
      fields: { overrides: cipher.id },
      data: { ss: 1 },
      scope: "campaign",
      ownerId: CAMPAIGN,
    }).entity;
    const r = new CodexRegistry([cipher, wrong]).resolveTerm("Crosswired", curator);
    expect(r && r.ambiguous === false && r.conceptIdValid).toBe(false);
  });

  it("refuses a contested canonical id", () => {
    const a = buildEntity({ kind: "genus", title: "Twin", sourcePage: "A", fields: {}, data: {} }).entity;
    const b = buildEntity({ kind: "genus", title: "Twin", sourcePage: "B", fields: {}, data: {} }).entity;
    const r = new CodexRegistry([a, b]).resolveTerm("Twin", curator);
    // Contested ids resolve to an ambiguity, which is itself the refusal.
    expect(r && r.ambiguous).toBe(true);
  });
});

describe("P1 — a failed refresh must not discard sound rules", () => {
  const houseRule = {
    ...empty,
    campaignPages: [{ stem: "House", title: "House Lark", overrides: first.id!, data: { ss: 1 } }],
  };
  const ssNow = () => {
    const r = codexRegistry().resolveReference(first.id!, curator);
    return r && r.ambiguous === false ? (r.resolvedDefinition.data as { ss: number }).ss : null;
  };

  it("keeps the campaign rule when the next listing fails", () => {
    applyCodexPages(houseRule);
    applyCodexPages({ ...empty, listFailed: "database is locked" });
    expect(ssNow(), "the table's house rule was replaced by the official one").toBe(1);
  });

  it("keeps it when a page read fails part-way", () => {
    applyCodexPages(houseRule);
    applyCodexPages({ ...empty, skipped: [{ stem: "House", reason: "EACCES", semantic: true }] });
    expect(ssNow()).toBe(1);
  });

  it("marks itself degraded rather than pretending the load was clean", () => {
    applyCodexPages(houseRule);
    applyCodexPages({ ...empty, listFailed: "locked" });
    expect(codexStatus()).toBe("degraded");
  });

  it("does apply a genuinely clean pass that removed the rule", () => {
    // The rule really was deleted — that must still take effect, or a Curator
    // could never remove one.
    applyCodexPages(houseRule);
    applyCodexPages(empty);
    expect(ssNow()).toBe(first.ss);
  });
});
