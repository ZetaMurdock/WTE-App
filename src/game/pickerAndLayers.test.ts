// @vitest-environment happy-dom
//
// Two disagreements between what the Codex says and what play uses.
//
//  1. The picker was a SECOND mechanics authority — a global overlay that knew
//     nothing about campaign ownership, visibility or stable identity.
//  2. Numeric rule layers were explained by the card and ignored by everything
//     that actually charges Synaptic Space.
import { beforeEach, describe, expect, it } from "vitest";
import { applyCodexPages, noCodexPages, __resetCodexService } from "./codexService";
import { codexCtx, genusCatalogFor, resolveGenusSpend, usableGenusResolved } from "./resolvedGenus";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";
import type { RuleLayer } from "./ruleLayers";
import type { ResolveContext } from "./codexRegistry";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const OTHER = "e25cc744-1111-2222-3333-444455556666";
const domain = GENUS_DOMAIN_NAMES[0];
const first = getGenusDomain(domain)!.abilities[0];
const paradigm = getGenusDomain(domain)!.paradigmAccess[0];
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

const curator = { ...codexCtx(CAMPAIGN, "c1"), role: "curator" as const };
const player = { ...codexCtx(CAMPAIGN, "c1"), role: "player" as const };
const flat = (ctx: ResolveContext = curator, layers?: RuleLayer[]) => genusCatalogFor(paradigm, ctx, layers).flatMap((g) => g.abilities);

beforeEach(() => {
  __resetCodexService();
  noCodexPages();
});

describe("the picker is the registry, not a second authority", () => {
  it("offers the official abilities of the paradigm's domains", () => {
    const names = flat().map((a) => a.name);
    expect(names).toContain(first.name);
    expect(flat().length).toBeGreaterThan(0);
  });

  it("keys every entry by stable id, not by name", () => {
    for (const a of flat()) expect(a.id, `${a.name} is keyed by name`).toMatch(/^(wte|campaign)\./);
  });

  it("offers each concept ONCE, not once per layer", () => {
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "House Version", overrides: first.id!, data: { ss: 1 } }],
    });
    const hits = flat().filter((a) => a.id === first.id);
    expect(hits).toHaveLength(1);
  });

  it("shows the campaign's cost, not the official one, when overridden", () => {
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "House Version", overrides: first.id!, data: { ss: 1 } }],
    });
    const row = flat().find((a) => a.id === first.id)!;
    expect(row.ss).toBe(1);
    expect(row.overridden).toBe(true);
  });

  it("does not offer a Curator-only ability to a player", () => {
    // The legacy picker read a global overlay with no notion of visibility, so a
    // player was offered abilities the resolver would never have returned.
    applyCodexPages({
      ...empty,
      campaignPages: [
        { stem: "S", title: "Warden's Gambit", visibility: "curator", data: { ss: 3, domain } },
      ],
    });
    expect(flat(curator).some((a) => a.name === "Warden's Gambit")).toBe(true);
    expect(flat(player).some((a) => a.name === "Warden's Gambit"), "a hidden ability was offered").toBe(false);
  });

  it("does not offer another campaign's homebrew", () => {
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "T", title: "Their Thing", data: { ss: 2, domain } }],
    });
    const elsewhere = { ...curator, campaignId: OTHER };
    expect(flat(curator).some((a) => a.name === "Their Thing")).toBe(true);
    expect(flat(elsewhere).some((a) => a.name === "Their Thing")).toBe(false);
  });

  it("marks a campaign's own creation as homebrew", () => {
    applyCodexPages({ ...empty, campaignPages: [{ stem: "M", title: "Mine", data: { ss: 2, domain } }] });
    const row = flat().find((a) => a.name === "Mine");
    expect(row?.homebrew).toBe(true);
    expect(flat().find((a) => a.id === first.id)?.homebrew).toBe(false);
  });

  it("offers nothing for a paradigm that does not exist", () => {
    expect(genusCatalogFor("not-a-paradigm", curator)).toEqual([]);
    expect(genusCatalogFor(undefined, curator)).toEqual([]);
  });

  it("only offers domains the paradigm can reach", () => {
    const reachable = new Set(genusCatalogFor(paradigm, curator).map((g) => g.domain));
    expect(reachable.size).toBeGreaterThan(0);
    for (const d of reachable) expect(getGenusDomain(d)!.paradigmAccess).toContain(paradigm);
  });
});

describe("a numeric layer changes what play charges, not just what the card says", () => {
  const layer: RuleLayer[] = [
    { id: "L", targetId: first.id!, scope: "campaign", owner: CAMPAIGN, op: "add", value: 3, note: "surcharge" },
  ];

  it("applies to the action row's SS", () => {
    const [row] = usableGenusResolved([first.id!], curator, { [first.id!]: 1 }, layer);
    expect(row.ss).toBe((first.ss ?? 0) + 3);
  });

  it("applies for a character that still stores the NAME", () => {
    const [row] = usableGenusResolved([first.name], curator, undefined, layer);
    expect(row.ss).toBe((first.ss ?? 0) + 3);
  });

  it("applies in the picker too, so the cost is the same before and after taking it", () => {
    expect(flat(curator, layer).find((a) => a.id === first.id)!.ss).toBe((first.ss ?? 0) + 3);
  });

  it("stacks on the CAMPAIGN's value when the rule is overridden", () => {
    // The card computes definition-then-layers; so must play, or the two disagree.
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "House", overrides: first.id!, data: { ss: 2 } }],
    });
    const [row] = usableGenusResolved([first.id!], curator, undefined, layer);
    expect(row.ss).toBe(5);
  });

  it("keeps the unlayered value recoverable, so nothing double-applies", () => {
    const [r] = resolveGenusSpend({ [first.id!]: 1 }, curator, layer);
    expect(r.mechanics?.ss).toBe(first.ss);
    expect(r.layered).toEqual({ ss: (first.ss ?? 0) + 3, base: first.ss, trail: 1 });
  });

  it("ignores a layer aimed at another character", () => {
    const mine: RuleLayer[] = [
      { id: "X", targetId: first.id!, scope: "character", owner: "someone-else", op: "add", value: 9 },
    ];
    const [row] = usableGenusResolved([first.id!], curator, undefined, mine);
    expect(row.ss).toBe(first.ss);
  });

  it("applies a layer aimed at THIS character", () => {
    const mine: RuleLayer[] = [
      { id: "X", targetId: first.id!, scope: "character", owner: "c1", op: "add", value: 9 },
    ];
    const [row] = usableGenusResolved([first.id!], curator, undefined, mine);
    expect(row.ss).toBe((first.ss ?? 0) + 9);
  });

  it("ignores a layer aimed at a different ability", () => {
    const other: RuleLayer[] = [
      { id: "Y", targetId: "wte.genus.something-else", scope: "campaign", owner: CAMPAIGN, op: "add", value: 4 },
    ];
    const [row] = usableGenusResolved([first.id!], curator, undefined, other);
    expect(row.ss).toBe(first.ss);
  });

  it("changes nothing when no layers are supplied at all", () => {
    const [row] = usableGenusResolved([first.id!], curator);
    expect(row.ss).toBe(first.ss);
  });
});
