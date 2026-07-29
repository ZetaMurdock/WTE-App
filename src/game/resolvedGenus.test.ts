// @vitest-environment happy-dom
//
// Phase 2D: one resolved model, read by the sheet and the VTT alike.
//
// The test that matters most is the pair — a name-keyed character and an
// id-keyed one must produce the SAME row. Anything else means migrating a
// character changes what it can do, which is the one thing a migration must
// never do.
import { beforeEach, describe, expect, it } from "vitest";
import { applyCodexPages, noCodexPages, __resetCodexService } from "./codexService";
import { codexCtx, resolveGenusSpend, usableGenusResolved } from "./resolvedGenus";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const ctx = { ...codexCtx(CAMPAIGN, "char-1"), role: "curator" as const };
const domain = GENUS_DOMAIN_NAMES[0];
const first = getGenusDomain(domain)!.abilities[0];
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

beforeEach(() => {
  __resetCodexService();
  noCodexPages();
});

describe("a migrated character reads exactly like an un-migrated one", () => {
  it("produces the same row from a name and from an id", () => {
    const byName = resolveGenusSpend({ [first.name]: 3 }, ctx)[0];
    const byId = resolveGenusSpend({ [first.id!]: 3 }, ctx)[0];

    expect(byName.displayName).toBe(byId.displayName);
    expect(byName.conceptId).toBe(byId.conceptId);
    expect(byName.mechanics?.ss).toBe(byId.mechanics?.ss);
    expect(byName.mechanics?.effect).toBe(byId.mechanics?.effect);
    expect(byName.focus).toBe(byId.focus);
  });

  it("and the same action row", () => {
    const [a] = usableGenusResolved([first.name], ctx, { [first.name]: 2 });
    const [b] = usableGenusResolved([first.id!], ctx, { [first.id!]: 2 });
    expect(a).toEqual(b);
  });

  it("gives an id-keyed character real mechanics, not a blank row", () => {
    // The old name-matching path returned a nameless 0-SS row for every ability
    // a migrated character held.
    const [row] = usableGenusResolved([first.id!], ctx);
    expect(row.name).toBe(first.name);
    expect(row.ss).toBe(first.ss);
    expect(row.effect).toBe(first.effect);
  });
});

describe("nothing a player chose is dropped", () => {
  it("keeps an ability the Codex does not know, and says so", () => {
    const [row] = resolveGenusSpend({ "Homebrew Thing": 4 }, ctx);
    expect(row.unresolved).toBe(true);
    expect(row.displayName).toBe("Homebrew Thing");
    expect(row.focus).toBe(4);
  });

  it("still renders it as an action row rather than vanishing", () => {
    const [row] = usableGenusResolved(["Homebrew Thing"], ctx);
    expect(row.name).toBe("Homebrew Thing");
    expect(row.ss).toBe(0);
  });
});

describe("a campaign override reaches the sheet and the VTT together", () => {
  const override = {
    ...empty,
    campaignPages: [
      { stem: "House", title: "House Version", overrides: first.id!, data: { ss: 1, effect: "House rule." } },
    ],
  };

  it("changes the numbers the rows carry", () => {
    applyCodexPages(override);
    const [row] = usableGenusResolved([first.id!], ctx);
    expect(row.ss).toBe(1);
    expect(row.effect).toBe("House rule.");
  });

  it("reaches a character that still stores the NAME", () => {
    applyCodexPages(override);
    const [row] = usableGenusResolved([first.name], ctx);
    expect(row.ss).toBe(1);
  });

  it("marks the entry as overridden so a card can explain it", () => {
    applyCodexPages(override);
    const [row] = resolveGenusSpend({ [first.id!]: 1 }, ctx);
    expect(row.overridden).toBe(true);
    expect(row.conceptId).toBe(first.id);
  });

  it("does not blank official fields the override said nothing about", () => {
    // A campaign page that only changes SS must not erase Range and Target.
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "Just SS", overrides: first.id!, data: { ss: 9 } }],
    });
    const [row] = usableGenusResolved([first.id!], ctx);
    expect(row.ss).toBe(9);
    expect(row.range).toBe(first.range ?? undefined);
    expect(row.target).toBe(first.target ?? undefined);
  });

  it("does not reach a different campaign", () => {
    applyCodexPages(override);
    const other = { ...ctx, campaignId: "e25cc744-1111-2222-3333-444455556666" };
    const [row] = usableGenusResolved([first.id!], other);
    expect(row.ss).toBe(first.ss);
  });
});

describe("the adapter never writes", () => {
  it("leaves the spend map it was given untouched", () => {
    const spend = { [first.name]: 3 };
    const copy = { ...spend };
    resolveGenusSpend(spend, ctx);
    usableGenusResolved([first.name], ctx, spend);
    expect(spend, "resolving a character rewrote it").toEqual(copy);
  });

  it("reports a concept id without applying it", () => {
    const spend = { [first.name]: 3 };
    const [row] = resolveGenusSpend(spend, ctx);
    expect(row.conceptId).toBe(first.id);
    expect(Object.keys(spend)).toEqual([first.name]);
  });
});

describe("visibility is asked the same way by every consumer", () => {
  it("defaults to the more restrictive role when the toggle is unreadable", () => {
    expect(codexCtx(CAMPAIGN).role).toBe("player");
  });

  it("follows the Curator toggle", () => {
    localStorage.setItem("wte-curator", "1");
    expect(codexCtx(CAMPAIGN).role).toBe("curator");
    localStorage.setItem("wte-curator", "0");
    expect(codexCtx(CAMPAIGN).role).toBe("player");
  });
});
