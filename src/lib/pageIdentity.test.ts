// Page identity at save time, and the two ways it was getting it wrong.
import { describe, expect, it } from "vitest";
import { customizePageForCampaign, pinPageIdentity, storedPageFor } from "./pageIdentity";
import { parseId } from "../game/codexId";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const OTHER = "e25cc744-1111-2222-3333-444455556666";

const page = (rows: string[], title = "New Ability") =>
  ["# " + title, "", "| Field | Value |", "|---|---|", "| Type | Genus |", ...rows, "", "Effect: Something."].join("\n");

describe("a homebrew ability authored in a campaign belongs to that campaign", () => {
  it("gives a blank-Overrides page a campaign id, as the template intends", () => {
    // The template tells Curators to leave Overrides blank for a new ability of
    // their own. Requiring it meant that page got a global `wte.*` id: the
    // registry treated it as an official concept it had never heard of, while
    // the legacy picker offered it — so investing Focus produced an unresolved
    // 0-SS row on the sheet and in the VTT.
    const out = pinPageIdentity({ content: page([]), stem: "New_Ability", campaignId: CAMPAIGN })!;
    expect(parseId(out.id)?.scope).toBe("campaign");
    expect(parseId(out.id)?.owner).toBe(CAMPAIGN);
  });

  it("gives a page that DOES declare an override a campaign id too", () => {
    const out = pinPageIdentity({
      content: page(["| Overrides | wte.genus.lark |"]),
      stem: "X",
      campaignId: CAMPAIGN,
    })!;
    expect(parseId(out.id)?.scope).toBe("campaign");
  });

  it("gives a page authored with no campaign open a global id", () => {
    const out = pinPageIdentity({ content: page([]), stem: "X" })!;
    expect(parseId(out.id)?.scope).toBe("wte");
  });

  it("never reassigns an id a page already carries", () => {
    const existing = page([`| ID | campaign.${CAMPAIGN}.genus.mine |`]);
    const out = pinPageIdentity({ content: existing, stem: "X", campaignId: CAMPAIGN })!;
    expect(out.id).toBe(`campaign.${CAMPAIGN}.genus.mine`);
    expect(out.assigned).toBe(false);
  });

  it("writes the id INTO the page, so it survives the next load", () => {
    const out = pinPageIdentity({ content: page([]), stem: "X", campaignId: CAMPAIGN })!;
    expect(out.content).toContain(`| ID | ${out.id} |`);
  });

  it("records the former name when a page is renamed", () => {
    const before = page([], "Old Name");
    const after = page([`| ID | campaign.${CAMPAIGN}.genus.old-name |`], "New Name");
    const out = pinPageIdentity({ content: after, stem: "X", previousContent: before, campaignId: CAMPAIGN })!;
    expect(out.aliasAdded).toBe("Old Name");
    expect(out.content).toMatch(/\|\s*Aliases\s*\|\s*Old Name\s*\|/);
  });

  it("pins campaign lore as an owned generic page", () => {
    const out = pinPageIdentity({ content: "# Some History\n\nProse.", stem: "H", campaignId: CAMPAIGN })!;
    expect(parseId(out.id)).toMatchObject({ scope: "campaign", owner: CAMPAIGN, kind: "page" });
    expect(storedPageFor("H", out.content, CAMPAIGN)?.id).toBe(out.id);
  });

  it("leaves official lore alone entirely", () => {
    expect(pinPageIdentity({ content: "# Some History\n\nProse.", stem: "H" })).toBeNull();
  });

  it.each(["constructor", "toString", "__proto__"])(
    "treats the prototype-like Type %s as generic campaign lore",
    (type) => {
      const content = `# Prototype Key\n\n| Field | Value |\n|---|---|\n| Type | ${type} |`;
      const pinned = pinPageIdentity({ content, stem: "Prototype_Key", campaignId: CAMPAIGN })!;
      const customized = customizePageForCampaign({ content, stem: "Prototype_Key", campaignId: CAMPAIGN });

      expect(parseId(pinned.id)).toMatchObject({ scope: "campaign", kind: "page" });
      expect(parseId(customized.id)).toMatchObject({ scope: "campaign", kind: "page" });
      expect(parseId(customized.overrides)).toMatchObject({ scope: "wte", kind: "page" });
      expect([pinned.id, customized.id, customized.overrides].join(" ")).not.toMatch(/function|\[object/i);
    }
  );
});

describe("only an owned page becomes a stored row", () => {
  it("builds a row for a campaign-scoped page", () => {
    const content = page([`| ID | campaign.${CAMPAIGN}.genus.mine |`, "| Visibility | curator |", "| Aliases | Old |"]);
    const row = storedPageFor("Mine", content, CAMPAIGN)!;
    expect(row.campaignId).toBe(CAMPAIGN);
    expect(row.kind).toBe("genus");
    expect(row.visibility).toBe("curator");
    expect(row.aliases).toEqual(["Old"]);
  });

  it("returns nothing for a global page, which belongs on disk", () => {
    expect(storedPageFor("L", page(["| ID | wte.genus.lark |"]), CAMPAIGN)).toBeNull();
  });

  it("returns nothing for another campaign's page", () => {
    expect(storedPageFor("X", page([`| ID | campaign.${OTHER}.genus.theirs |`]), CAMPAIGN)).toBeNull();
  });

  it("defaults visibility to player when the page does not say", () => {
    const row = storedPageFor("M", page([`| ID | campaign.${CAMPAIGN}.genus.mine |`]), CAMPAIGN)!;
    expect(row.visibility).toBe("player");
  });

  it("takes the title from the heading, not the stem", () => {
    const content = page([`| ID | campaign.${CAMPAIGN}.genus.mine |`], "Ashen Lark");
    expect(storedPageFor("Some_File", content, CAMPAIGN)!.title).toBe("Ashen Lark");
  });

  it("round-trips what pinPageIdentity produced", () => {
    // The two halves have to agree: whatever the editor pins must be storable.
    const pinned = pinPageIdentity({ content: page([]), stem: "New_Ability", campaignId: CAMPAIGN })!;
    const row = storedPageFor("New_Ability", pinned.content, CAMPAIGN);
    expect(row, "a page the editor just pinned was not recognised as owned").not.toBeNull();
    expect(row!.id).toBe(pinned.id);
  });
});
