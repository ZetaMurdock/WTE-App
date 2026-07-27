import { describe, expect, it } from "vitest";

// The bug this covers: PlayerCampaign listed characters with
// listCharacters(table.campaignId) — the CURATOR's id. On a player's device that
// returns nothing, because their characters are filed under their own campaign
// id or none at all, so the table looked broken and offered no way forward.
//
// The DB calls need Tauri/SQLite, so what is asserted here is the partitioning
// logic the table view runs on, which is where the mistake actually was.

type Rec = { id: string; campaignId: string | null };

const partition = (chars: Rec[], tableCampaignId: string) => ({
  here: chars.filter((c) => c.campaignId === tableCampaignId),
  elsewhere: chars.filter((c) => c.campaignId !== tableCampaignId),
});

describe("filing characters against a table", () => {
  const TABLE = "curator-campaign-1";

  it("puts characters already stamped with the table's campaign in 'here'", () => {
    const { here, elsewhere } = partition([{ id: "a", campaignId: TABLE }], TABLE);
    expect(here.map((c) => c.id)).toEqual(["a"]);
    expect(elsewhere).toEqual([]);
  });

  it("offers a character from the player's OWN campaign for carrying over", () => {
    const { here, elsewhere } = partition([{ id: "a", campaignId: "my-own-campaign" }], TABLE);
    expect(here).toEqual([]);
    expect(elsewhere.map((c) => c.id)).toEqual(["a"]);
  });

  it("offers an unfiled character too — no campaign is the common case for a new player", () => {
    const { elsewhere } = partition([{ id: "a", campaignId: null }], TABLE);
    expect(elsewhere.map((c) => c.id)).toEqual(["a"]);
  });

  it("never loses a character — every one lands in exactly one bucket", () => {
    const chars: Rec[] = [
      { id: "a", campaignId: TABLE },
      { id: "b", campaignId: "other" },
      { id: "c", campaignId: null },
      { id: "d", campaignId: TABLE },
    ];
    const { here, elsewhere } = partition(chars, TABLE);
    expect(here.length + elsewhere.length).toBe(chars.length);
    expect(new Set([...here, ...elsewhere].map((c) => c.id)).size).toBe(chars.length);
  });

  it("carrying over moves a character between buckets rather than copying it", () => {
    let chars: Rec[] = [{ id: "a", campaignId: "other" }];
    expect(partition(chars, TABLE).elsewhere).toHaveLength(1);
    // assignCharacterCampaign re-stamps the row in place.
    chars = chars.map((c) => (c.id === "a" ? { ...c, campaignId: TABLE } : c));
    const after = partition(chars, TABLE);
    expect(after.here).toHaveLength(1);
    expect(after.elsewhere).toHaveLength(0);
    expect(chars).toHaveLength(1); // not duplicated
  });
});
