// Phase 2C: the loader, against the real 98 official abilities.
//
// The thing being proven is that the official rules the app already plays by are
// the ones that come out — with permanent ids attached and pages wired for
// "open the full page" — and that a stale mirror page cannot change them.
import { describe, expect, it } from "vitest";
import { buildCampaignGenus, buildOfficialGenus, mergeVisibility, pageRefFor } from "./codexGenusSource";
import { CodexRegistry, type ResolveContext } from "./codexRegistry";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";
import { parseId } from "./codexId";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const curator: ResolveContext = { role: "curator", campaignId: CAMPAIGN, kind: "genus" };
const player: ResolveContext = { role: "player", campaignId: CAMPAIGN, kind: "genus" };

const officialCount = GENUS_DOMAIN_NAMES.reduce((n, d) => n + (getGenusDomain(d)?.abilities.length ?? 0), 0);
const firstAbility = getGenusDomain(GENUS_DOMAIN_NAMES[0])!.abilities[0];

describe("every official Genus ability has a permanent identity", () => {
  it("loads all of them", () => {
    expect(officialCount).toBe(98);
    expect(buildOfficialGenus().entities).toHaveLength(98);
  });

  it("gives each one a well-formed, official-scoped id", () => {
    for (const e of buildOfficialGenus().entities) {
      const p = parseId(e.id);
      expect(p, e.name).not.toBeNull();
      expect(p!.scope).toBe("wte");
      expect(p!.kind).toBe("genus");
    }
  });

  it("assigns no id twice", () => {
    const ids = buildOfficialGenus().entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("takes the id from the data file, where it is permanent", () => {
    // Not re-derived from the title at load — that is the whole point.
    const e = buildOfficialGenus().entities.find((x) => x.name === firstAbility.name)!;
    expect(e.id).toBe(firstAbility.id);
  });

  it("carries the mechanics the app already plays by", () => {
    const e = buildOfficialGenus().entities.find((x) => x.name === firstAbility.name)!;
    expect(e.data).toMatchObject({
      ss: firstAbility.ss,
      effect: firstAbility.effect,
      domain: GENUS_DOMAIN_NAMES[0],
    });
  });

  it("indexes cleanly — no duplicates, no cycles, nothing unusable", () => {
    const reg = new CodexRegistry(buildOfficialGenus().entities);
    expect(reg.status()).toBe("ready");
    expect(reg.quarantined()).toEqual([]);
    expect(reg.health()).toEqual([]);
  });

  it("resolves every ability by its own name", () => {
    const reg = new CodexRegistry(buildOfficialGenus().entities);
    const missed: string[] = [];
    for (const d of GENUS_DOMAIN_NAMES) {
      for (const a of getGenusDomain(d)!.abilities) {
        const r = reg.resolveTerm(a.name, curator);
        if (!r || r.ambiguous || r.entity.id !== a.id) missed.push(a.name);
      }
    }
    expect(missed).toEqual([]);
  });

  it("is usable before a single page has been pulled", () => {
    // A fresh install has no mirror. That is not an error state.
    const { entities, problems } = buildOfficialGenus([]);
    expect(entities).toHaveLength(98);
    expect(problems).toEqual([]);
    expect(entities.every((e) => e.sourcePage === "")).toBe(true);
  });
});

describe("pages say where to read, never what the rule is", () => {
  const stale = () => [
    {
      stem: "Lark_Page",
      title: firstAbility.name,
      anchor: "mechanics",
      aliases: ["Scatterlark"],
      // A mirror page a revision behind.
      data: { ss: 999, effect: "an old draft of this ability" },
    },
  ];

  it("wires the page in for 'open full page'", () => {
    const { entities, manifest } = buildOfficialGenus(stale());
    const e = entities.find((x) => x.name === firstAbility.name)!;
    expect(e.sourcePage).toBe("Lark_Page");
    expect(pageRefFor(e.id, manifest)).toEqual({ stem: "Lark_Page", anchor: "mechanics" });
  });

  it("keeps the OFFICIAL mechanics, not the page's", () => {
    const e = buildOfficialGenus(stale()).entities.find((x) => x.name === firstAbility.name)!;
    expect((e.data as { ss: number }).ss).toBe(firstAbility.ss);
    expect((e.data as { effect: string }).effect).toBe(firstAbility.effect);
  });

  it("reports the disagreement rather than absorbing it", () => {
    const { problems } = buildOfficialGenus(stale());
    const drift = problems.find((p) => p.kind === "page-drift")!;
    expect(drift.detail).toContain("Lark_Page");
    expect(drift.detail).toMatch(/official values are in use/);
  });

  it("takes the aliases, so a former name still resolves", () => {
    const { entities } = buildOfficialGenus(stale());
    const reg = new CodexRegistry(entities);
    const r = reg.resolveTerm("Scatterlark", curator);
    expect(r && r.ambiguous === false && r.entity.name).toBe(firstAbility.name);
    expect(r && r.ambiguous === false && r.matchedBy).toBe("alias");
  });

  it("will not let a page move an ability's id", () => {
    const { entities, problems } = buildOfficialGenus([
      { stem: "P", title: firstAbility.name, id: "wte.genus.something-else" },
    ]);
    expect(entities.find((x) => x.name === firstAbility.name)!.id).toBe(firstAbility.id);
    expect(problems.some((p) => p.kind === "identity-mismatch")).toBe(true);
  });

  it("flags two pages claiming the same official ability", () => {
    const { problems } = buildOfficialGenus([
      { stem: "A", title: firstAbility.name },
      { stem: "B", title: firstAbility.name },
    ]);
    expect(problems.some((p) => p.kind === "ambiguous-alias")).toBe(true);
  });

  it("matches a page that titles itself with a former name", () => {
    const { entities } = buildOfficialGenus([
      { stem: "Old_Name_Page", title: "Scatterlark", aliases: [firstAbility.name] },
    ]);
    expect(entities.find((x) => x.name === firstAbility.name)!.sourcePage).toBe("Old_Name_Page");
  });
});

describe("campaign pages are overlays, and they do carry mechanics", () => {
  it("stacks a declared override on top of the official rule", () => {
    const { entities: official } = buildOfficialGenus();
    const { entities: campaign } = buildCampaignGenus(
      [
        {
          stem: "Ashen_Lark",
          title: "Ashen Lark",
          overrides: firstAbility.id!,
          data: { ss: 2, effect: "The Ashen Sun version." },
        },
      ],
      CAMPAIGN
    );
    const reg = new CodexRegistry([...official, ...campaign]);
    const r = reg.resolveReference(firstAbility.id!, curator);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(2);
    // And the official is still there underneath.
    expect(r && r.ambiguous === false && (r.officialDefinition!.data as { ss: number }).ss).toBe(firstAbility.ss);
  });

  it("does not reach another campaign", () => {
    const { entities: official } = buildOfficialGenus();
    const { entities: campaign } = buildCampaignGenus(
      [{ stem: "X", title: "Ashen Lark", overrides: firstAbility.id!, data: { ss: 2 } }],
      "e25cc744-1111-2222-3333-444455556666"
    );
    const reg = new CodexRegistry([...official, ...campaign]);
    const r = reg.resolveReference(firstAbility.id!, curator);
    expect(r && r.ambiguous === false && r.resolvedDefinition.scope).toBe("wte");
  });

  it("owns its pages by stable campaign id, so a rename cannot move them", () => {
    const { entities } = buildCampaignGenus([{ stem: "X", title: "Ashen Lark" }], CAMPAIGN);
    expect(entities[0].ownerId).toBe(CAMPAIGN);
    expect(entities[0].id).toContain(CAMPAIGN);
  });

  it("refuses to build pages with no campaign to own them", () => {
    const { entities, problems } = buildCampaignGenus([{ stem: "X", title: "Y" }], "");
    expect(entities).toEqual([]);
    expect(problems[0].severity).toBe("error");
  });

  it("reports a page with no usable title instead of inventing one", () => {
    const { entities, problems } = buildCampaignGenus([{ stem: "X", title: "   " }], CAMPAIGN);
    expect(entities).toEqual([]);
    expect(problems.some((p) => p.kind === "unusable-record")).toBe(true);
  });

  it("cannot be absorbed into an official concept it did not name", () => {
    // The official layer opts out of title matching, so a campaign page that
    // happens to share a name defines its own thing and the resolver asks.
    const { entities: official } = buildOfficialGenus();
    const { entities: campaign } = buildCampaignGenus([{ stem: "X", title: firstAbility.name, data: { ss: 40 } }], CAMPAIGN);
    const reg = new CodexRegistry([...official, ...campaign]);
    // The stored official id still resolves to the official rule.
    const byId = reg.resolveReference(firstAbility.id!, curator);
    expect(byId && byId.ambiguous === false && (byId.resolvedDefinition.data as { ss: number }).ss).toBe(firstAbility.ss);
  });
});

describe("visibility is merged the restrictive way", () => {
  it("one curator source makes the whole concept curator-only", () => {
    expect(mergeVisibility("player", "curator")).toBe("curator");
    expect(mergeVisibility(undefined, "gm")).toBe("curator");
    expect(mergeVisibility("player", undefined)).toBe("player");
    expect(mergeVisibility()).toBe("player");
  });

  it("a mirror page cannot un-hide a Curator-only campaign ability", () => {
    const { entities } = buildCampaignGenus(
      [{ stem: "Secret", title: "Warden's Gambit", visibility: "curator", data: { ss: 3 } }],
      CAMPAIGN
    );
    const reg = new CodexRegistry(entities);
    expect(reg.resolveTerm("Warden's Gambit", curator)).not.toBeNull();
    expect(reg.resolveTerm("Warden's Gambit", player)).toBeNull();
    expect(reg.search("Warden", player)).toEqual([]);
  });

  it("does not leak a Curator-only page through an id conflict", () => {
    // The one resolution path that returns records without returning a definition.
    // A player must not learn a second, hidden page exists.
    const open = buildCampaignGenus([{ stem: "Open", title: "Twin", id: `campaign.${CAMPAIGN}.genus.twin` }], CAMPAIGN);
    const secret = buildCampaignGenus(
      [{ stem: "Secret", title: "Twin", id: `campaign.${CAMPAIGN}.genus.twin`, visibility: "curator" }],
      CAMPAIGN
    );
    const reg = new CodexRegistry([...open.entities, ...secret.entities]);
    const id = `campaign.${CAMPAIGN}.genus.twin`;

    const asCurator = reg.resolveReference(id, curator);
    expect(asCurator && asCurator.ambiguous).toBe(true);

    const asPlayer = reg.resolveReference(id, player);
    expect(asPlayer && asPlayer.ambiguous).toBe(false);
    expect(asPlayer && asPlayer.ambiguous === false && asPlayer.entity.sourcePage).toBe("Open");
  });
});
