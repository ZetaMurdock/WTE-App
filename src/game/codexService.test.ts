// @vitest-environment happy-dom
//
// Phase 2C.1: the running app's Codex.
//
// One property matters more than the rest and every test here circles it —
// NOTHING ABOUT READING PAGES CAN SUBTRACT AN ABILITY FROM THE APP. A locked
// database, an unreadable file, a failed listing, a page that will not parse:
// each of those leaves all 98 official abilities exactly as they were.
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCodexPages,
  codexCanMigrate,
  codexHealth,
  codexRegistry,
  codexStatus,
  noCodexPages,
  __resetCodexService,
} from "./codexService";
import {
  GENUS_DOMAIN_NAMES,
  getGenusDomain,
  genusForParadigm,
  domainOfGenus,
  registerCodexGameData,
} from "./wte";
import { planGenusMigration } from "./genusRef";
import type { ResolveContext } from "./codexRegistry";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const curator: ResolveContext = { role: "curator", campaignId: CAMPAIGN, kind: "genus" };
const first = getGenusDomain(GENUS_DOMAIN_NAMES[0])!.abilities[0];

const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };
const count = () => codexRegistry().ofKind("genus").length;

beforeEach(() => {
  __resetCodexService();
  // Clear any page overlay a previous test registered.
  registerCodexGameData({} as Parameters<typeof registerCodexGameData>[0]);
});

describe("official mechanics exist before any page is read", () => {
  it("has all 98 the moment the module loads", () => {
    expect(count()).toBe(98);
  });

  it("starts as loading — usable, but not yet a basis for rewriting anyone", () => {
    expect(codexStatus()).toBe("loading");
    expect(codexCanMigrate()).toBe(false);
  });

  it("settles when there are genuinely no pages to read", () => {
    noCodexPages();
    expect(codexStatus()).toBe("ready");
    expect(codexCanMigrate()).toBe(true);
    expect(count()).toBe(98);
  });

  it("resolves an ability with no pages at all", () => {
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && r.entity.name).toBe(first.name);
  });
});

describe("a failed page pass never costs an ability", () => {
  it("keeps all 98 when the page listing fails outright", () => {
    applyCodexPages({ ...empty, listFailed: "database is locked" });
    expect(count()).toBe(98);
  });

  it("says so, and refuses to migrate on it", () => {
    applyCodexPages({ ...empty, listFailed: "database is locked" });
    expect(codexStatus()).toBe("degraded");
    expect(codexCanMigrate()).toBe(false);
    expect(codexHealth().some((p) => p.detail.includes("could not be listed"))).toBe(true);
  });

  it("keeps all 98 when every page is unreadable", () => {
    applyCodexPages({
      ...empty,
      skipped: [
        { stem: "Lark", reason: "could not be read (EACCES)" },
        { stem: "Bind", reason: "no recognised Type row" },
      ],
    });
    expect(count()).toBe(98);
    expect(codexHealth().filter((p) => p.detail.includes("was not used"))).toHaveLength(2);
  });

  it("treats unreadable pages as a warning, not a reason to distrust the rules", () => {
    // The mechanics do not come from pages, so a page that will not parse is
    // worth reporting without making the whole Codex untrustworthy.
    applyCodexPages({ ...empty, skipped: [{ stem: "Lark", reason: "could not be read" }] });
    expect(codexStatus()).toBe("ready");
  });

  it("still has all 98 after a pass that found nothing", () => {
    applyCodexPages(empty);
    expect(count()).toBe(98);
    expect(codexStatus()).toBe("ready");
  });
});

describe("a stale mirror page cannot rewrite a live rule", () => {
  const staleMirror = {
    ...empty,
    officialMirrors: [
      {
        stem: "Lark_Page",
        title: first.name,
        anchor: "mechanics",
        data: { ss: 999, effect: "a draft from three revisions ago" },
      },
    ],
  };

  it("keeps the official SS and effect", () => {
    applyCodexPages(staleMirror);
    const r = codexRegistry().resolveReference(first.id!, curator);
    const data = r && r.ambiguous === false ? (r.resolvedDefinition.data as { ss: number; effect: string }) : null;
    expect(data?.ss).toBe(first.ss);
    expect(data?.effect).toBe(first.effect);
  });

  it("still takes the page's link, which is all a mirror is good for", () => {
    applyCodexPages(staleMirror);
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && r.entity.sourcePage).toBe("Lark_Page");
  });

  it("reports the disagreement", () => {
    applyCodexPages(staleMirror);
    expect(codexHealth().some((p) => p.kind === "page-drift")).toBe(true);
  });

  it("does not let a pulled page delete an official ability from the picker", () => {
    // genusForParadigm used to REPLACE a baked ability whose name a page matched,
    // so a mirror one revision behind rewrote the rules a table played by — and
    // restored them whenever that page failed to parse.
    const domain = GENUS_DOMAIN_NAMES[0];
    const paradigmId = getGenusDomain(domain)!.paradigmAccess[0];
    const official = getGenusDomain(domain)!.abilities;

    registerCodexGameData({
      genus: { [domain]: [{ name: first.name, ss: 999, effect: "stale draft" }] },
    } as Parameters<typeof registerCodexGameData>[0]);

    const group = genusForParadigm(paradigmId).find((g) => g.domain === domain)!;
    const shown = group.abilities.find((a) => a.name === first.name)!;
    expect(shown.ss, "the picker is showing the stale page's cost").toBe(first.ss);
    expect(group.abilities).toHaveLength(official.length);
  });

  it("still shows an ability a page adds that is not official", () => {
    // Homebrew must keep working; only IMPERSONATION of an official rule is refused.
    const domain = GENUS_DOMAIN_NAMES[0];
    const paradigmId = getGenusDomain(domain)!.paradigmAccess[0];
    const before = getGenusDomain(domain)!.abilities.length;

    registerCodexGameData({
      genus: { [domain]: [{ name: "Wholly Invented Thing", ss: 4, effect: "new" }] },
    } as Parameters<typeof registerCodexGameData>[0]);

    const group = genusForParadigm(paradigmId).find((g) => g.domain === domain)!;
    expect(group.abilities).toHaveLength(before + 1);
    expect(group.abilities.some((a) => a.name === "Wholly Invented Thing")).toBe(true);
  });
});

describe("a campaign page changes the rule, and says that it did", () => {
  const withOverride = {
    ...empty,
    campaignPages: [
      {
        stem: "Ashen_Lark",
        title: "Ashen Lark",
        overrides: first.id!,
        data: { ss: 1, effect: "The Ashen Sun rewrite." },
      },
    ],
  };

  it("wins for that campaign", () => {
    applyCodexPages(withOverride);
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(1);
  });

  it("keeps the official definition underneath it", () => {
    applyCodexPages(withOverride);
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && (r.officialDefinition!.data as { ss: number }).ss).toBe(first.ss);
  });

  it("does not reach a different campaign", () => {
    applyCodexPages(withOverride);
    const other = { ...curator, campaignId: "e25cc744-1111-2222-3333-444455556666" };
    const r = codexRegistry().resolveReference(first.id!, other);
    expect(r && r.ambiguous === false && r.resolvedDefinition.scope).toBe("wte");
  });

  it("still names the OFFICIAL concept, so a sheet is never pinned to one table", () => {
    applyCodexPages(withOverride);
    const r = codexRegistry().resolveReference(first.id!, curator);
    expect(r && r.ambiguous === false && r.conceptId).toBe(first.id);
  });
});

describe("migration waits for a Codex worth migrating against", () => {
  const spend = { [first.name]: 3 };

  it("does not rewrite a sheet while pages are still loading", () => {
    expect(codexCanMigrate()).toBe(false);
  });

  it("rewrites to the canonical concept id once everything has settled", () => {
    noCodexPages();
    const plan = planGenusMigration(spend, codexRegistry(), curator);
    expect(plan.changed).toBe(true);
    expect(plan.next).toEqual({ [first.id!]: 3 });
  });

  it("refuses when the page listing failed, even though the rules are fine", () => {
    applyCodexPages({ ...empty, listFailed: "database is locked" });
    expect(codexCanMigrate()).toBe(false);
    // Reading still works — only writing is withheld.
    const r = codexRegistry().resolveTerm(first.name, curator);
    expect(r && r.ambiguous === false).toBe(true);
  });
});

describe("id-keyed lookups keep working for a migrated sheet", () => {
  it("finds an ability's domain by its stable id, not just its name", () => {
    // domainOfGenus decides SNR posture. Name-only, a migrated sheet lost it and
    // the ability quietly changed how it resolved in initiative.
    expect(domainOfGenus(first.id!)).toBe(GENUS_DOMAIN_NAMES[0]);
    expect(domainOfGenus(first.name)).toBe(GENUS_DOMAIN_NAMES[0]);
  });

  it("returns nothing for a term that is neither", () => {
    expect(domainOfGenus("not an ability")).toBeUndefined();
  });
});
