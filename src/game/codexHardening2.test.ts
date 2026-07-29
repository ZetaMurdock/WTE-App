// @vitest-environment happy-dom
//
// Phase 2C.1 hardening. Each block is one way the mounted Codex could have taken
// something away from a table without saying so.
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCodexPages,
  beginCodexLoad,
  codexCanMigrate,
  codexHealth,
  codexRegistry,
  codexStatus,
  planGenusMigrationSafely,
  noCodexPages,
  __resetCodexService,
} from "./codexService";
import { buildCampaignGenus, buildOfficialGenus } from "./codexGenusSource";
import { CodexRegistry, type ResolveContext } from "./codexRegistry";
import { buildEntity } from "./codexEntity";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";
import { scanGenusCorpus } from "../lib/genusCorpus";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const OTHER = "e25cc744-1111-2222-3333-444455556666";
const curator: ResolveContext = { role: "curator", campaignId: CAMPAIGN, kind: "genus" };
const player: ResolveContext = { role: "player", campaignId: CAMPAIGN, kind: "genus" };
const first = getGenusDomain(GENUS_DOMAIN_NAMES[0])!.abilities[0];
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

beforeEach(() => __resetCodexService());

describe("hiding a page must not delete the rule", () => {
  const gmPage = [{ stem: "Secret_Lark", title: first.name, visibility: "curator" }];

  it("still lets a player resolve an official ability whose page is GM-only", () => {
    // The page is prose. The ability is a rule every player already has on their
    // sheet, and marking the wiki page GM-only used to make it unresolvable —
    // taking a mechanic out of the game as a side effect of hiding some writing.
    const reg = new CodexRegistry(buildOfficialGenus(gmPage).entities);
    expect(reg.resolveReference(first.id!, player)).not.toBeNull();
    expect(reg.resolveTerm(first.name, player)).not.toBeNull();
  });

  it("still marks the PAGE as restricted", () => {
    const reg = new CodexRegistry(buildOfficialGenus(gmPage).entities);
    const r = reg.resolveReference(first.id!, player);
    expect(r && r.ambiguous === false && r.entity.pageVisibility).toBe("curator");
  });

  it("a campaign's own secret ability IS hidden, mechanic and all", () => {
    // The opposite case, and it must keep working: here the page IS the rule.
    const { entities } = buildCampaignGenus(
      [{ stem: "Secret", title: "Warden's Gambit", visibility: "curator", data: { ss: 3 } }],
      CAMPAIGN
    );
    const reg = new CodexRegistry(entities);
    expect(reg.resolveTerm("Warden's Gambit", curator)).not.toBeNull();
    expect(reg.resolveTerm("Warden's Gambit", player)).toBeNull();
  });
});

describe("a campaign page belongs to its campaign, permanently", () => {
  const foreign = [
    {
      stem: "Their_House_Rule",
      title: "Their Lark",
      id: `campaign.${OTHER}.genus.their-lark`,
      overrides: first.id!,
      data: { ss: 99 },
    },
  ];

  it("refuses a page owned by another campaign instead of re-owning it", () => {
    const { entities, problems } = buildCampaignGenus(foreign, CAMPAIGN);
    expect(entities).toEqual([]);
    expect(problems.some((p) => p.detail.includes("belongs to another campaign"))).toBe(true);
  });

  it("so another table's rule cannot reach this one", () => {
    const reg = new CodexRegistry([
      ...buildOfficialGenus().entities,
      ...buildCampaignGenus(foreign, CAMPAIGN).entities,
    ]);
    const r = reg.resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(first.ss);
  });

  it("refuses a campaign page carrying an official-scoped id", () => {
    const { entities, problems } = buildCampaignGenus(
      [{ stem: "X", title: "Y", id: "wte.genus.something", data: {} }],
      CAMPAIGN
    );
    expect(entities).toEqual([]);
    expect(problems.some((p) => p.severity === "error")).toBe(true);
  });

  it("accepts one that names this campaign", () => {
    const { entities, problems } = buildCampaignGenus(
      [{ stem: "Ours", title: "Our Lark", id: `campaign.${CAMPAIGN}.genus.our-lark`, data: { ss: 2 } }],
      CAMPAIGN
    );
    expect(entities).toHaveLength(1);
    expect(problems).toEqual([]);
  });
});

describe("a transient failure does not rewind the Codex", () => {
  const withRule = {
    ...empty,
    campaignPages: [{ stem: "House", title: "House Lark", overrides: first.id!, data: { ss: 1 } }],
  };

  it("keeps the last good campaign rules when the next listing fails", () => {
    applyCodexPages(withRule);
    expect(codexStatus()).toBe("ready");

    applyCodexPages({ ...empty, listFailed: "database is locked" });
    // The override is STILL in force. Reverting to official-only would have
    // silently handed the table a different rule.
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(1);
  });

  it("says it is degraded and refuses to migrate while showing it", () => {
    applyCodexPages(withRule);
    applyCodexPages({ ...empty, listFailed: "database is locked" });
    expect(codexStatus()).toBe("degraded");
    expect(codexCanMigrate()).toBe(false);
    expect(codexHealth().some((p) => p.detail.includes("last good load"))).toBe(true);
  });

  it("keeps the last good rules when a page cannot be read", () => {
    applyCodexPages(withRule);
    applyCodexPages({ ...empty, skipped: [{ stem: "House", reason: "EACCES", semantic: true }] });
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(1);
  });

  it("but an ordinary lore page failing to parse is not a failure at all", () => {
    applyCodexPages(withRule);
    applyCodexPages({ ...empty, skipped: [{ stem: "Some_Lore", reason: "no Type row" }] });
    // Trustworthy, so the pass applies — and it genuinely has no campaign rules.
    expect(codexStatus()).toBe("ready");
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && r.resolvedDefinition.scope).toBe("wte");
  });
});

describe("a slow load cannot land on top of a newer one", () => {
  it("ignores a stale pass that finishes late", () => {
    const slow = beginCodexLoad();
    const fast = beginCodexLoad();
    applyCodexPages({ ...empty, campaignPages: [{ stem: "New", title: "New Lark", overrides: first.id!, data: { ss: 7 } }] }, fast);
    // The earlier load, for the campaign we already left, finishes now.
    applyCodexPages({ ...empty, campaignId: OTHER }, slow);
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(7);
  });
});

describe("migration cannot be reached without the safety check", () => {
  it("changes nothing while the Codex is still loading", () => {
    const plan = planGenusMigrationSafely({ [first.name]: 3 }, curator);
    expect(plan.changed).toBe(false);
    expect(plan.blocked).toBe("registry-degraded");
    expect(plan.next).toEqual({ [first.name]: 3 });
  });

  it("changes nothing while degraded", () => {
    applyCodexPages({ ...empty, listFailed: "locked" });
    expect(planGenusMigrationSafely({ [first.name]: 3 }, curator).changed).toBe(false);
  });

  it("migrates once everything has settled", () => {
    noCodexPages();
    const plan = planGenusMigrationSafely({ [first.name]: 3 }, curator);
    expect(plan.next).toEqual({ [first.id!]: 3 });
  });
});

describe("a canonical id must actually point at something", () => {
  it("will not migrate through an override naming a Genus that is not installed", () => {
    const orphan = buildEntity({
      kind: "genus",
      title: "Borrowed Lark",
      sourcePage: "B",
      fields: { overrides: "wte.genus.not-installed" },
      data: { ss: 2 },
      scope: "campaign",
      ownerId: CAMPAIGN,
    }).entity;
    const reg = new CodexRegistry([orphan]);
    const r = reg.resolveTerm("Borrowed Lark", curator);
    expect(r && r.ambiguous === false && r.conceptIdValid).toBe(false);
  });

  it("will not migrate through an override naming a Cipher", () => {
    const cipher = buildEntity({ kind: "cipher", title: "Ghost", sourcePage: "C", fields: {}, data: {} }).entity;
    const crossKind = buildEntity({
      kind: "genus",
      title: "Wrong Target",
      sourcePage: "W",
      fields: { overrides: cipher.id },
      data: { ss: 1 },
      scope: "campaign",
      ownerId: CAMPAIGN,
    }).entity;
    const reg = new CodexRegistry([cipher, crossKind]);
    const r = reg.resolveTerm("Wrong Target", curator);
    expect(r && r.ambiguous === false && r.conceptIdValid).toBe(false);
  });

  it("is happy with an override naming a real official Genus", () => {
    const reg = new CodexRegistry([
      ...buildOfficialGenus().entities,
      ...buildCampaignGenus([{ stem: "H", title: "House Lark", overrides: first.id!, data: { ss: 1 } }], CAMPAIGN).entities,
    ]);
    const r = reg.resolveTerm("House Lark", curator);
    expect(r && r.ambiguous === false && r.conceptIdValid).toBe(true);
    expect(r && r.ambiguous === false && r.conceptId).toBe(first.id);
  });
});

describe("the grouped official corpus", () => {
  // The real pages are five domain files of exported wiki HTML, each holding
  // every ability in that domain — nothing the field-table parser recognises.
  const page = (stem: string, names: string[]) => ({
    stem,
    text: names.map((n) => `<div style="font-weight:700">${n}</div><p>prose</p>`).join(""),
  });

  it("locates abilities inside their domain page", () => {
    const domain = GENUS_DOMAIN_NAMES[0];
    const names = getGenusDomain(domain)!.abilities.map((a) => a.name);
    const scan = scanGenusCorpus([page(`${domain}_Genus`, names)]);
    expect(scan.pages.length).toBe(names.length);
    expect(scan.pages[0]).toMatchObject({ stem: `${domain}_Genus` });
  });

  it("gives each one an anchor to scroll to", () => {
    const domain = GENUS_DOMAIN_NAMES[0];
    const scan = scanGenusCorpus([page(`${domain}_Genus`, [first.name])]);
    expect(scan.pages[0].anchor).toBeTruthy();
  });

  it("takes no mechanics from the page, whatever it says", () => {
    // The one thing a grouped scraper must never do.
    const domain = GENUS_DOMAIN_NAMES[0];
    const scan = scanGenusCorpus([
      { stem: `${domain}_Genus`, text: `<div>${first.name}</div><div>SS 999</div>` },
    ]);
    expect(scan.pages[0].data).toBeUndefined();
    const reg = new CodexRegistry(buildOfficialGenus(scan.pages).entities);
    const r = reg.resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(first.ss);
  });

  it("reports a domain with no page rather than losing it quietly", () => {
    const scan = scanGenusCorpus([]);
    expect(scan.domainMismatch.missingPages).toEqual([...GENUS_DOMAIN_NAMES]);
    expect(scan.unlocated).toHaveLength(98);
  });

  it("reports a genus page for a domain the rules do not have", () => {
    // The installed corpus ships Kinetic_Genus while the data file calls that
    // domain Photonic — so one page describes nothing and 20 abilities have no
    // page. Both halves need saying.
    const scan = scanGenusCorpus([{ stem: "Kinetic_Genus", text: "<div>Something</div>" }]);
    expect(scan.domainMismatch.unknownPages).toContain("Kinetic_Genus");
  });

  it("ignores ordinary lore pages", () => {
    const scan = scanGenusCorpus([{ stem: "Some_History", text: "<p>Long ago…</p>" }]);
    expect(scan.domainMismatch.unknownPages).toEqual([]);
  });
});
