import { describe, expect, it } from "vitest";
import { buildSynopsis, carriedLines, giveHandoutPatch, giveItemPatch, payablePeer, planMoneyGift } from "./synopsis";
import { clampShrives, SHRIVES_PER_CREDIT } from "../../game/money";
import { emptySheet, sheetFromJson } from "../../lib/sheetCodec";
import type { CharacterRecord } from "../../lib/characters";
import type { CharacterSheet } from "../../models/character";
import type { VttToken } from "../types/scene";

function rec(sheet: Partial<CharacterSheet> = {}, over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "ch-1",
    campaignId: "camp-1",
    name: "Vex",
    createdAt: 1,
    updatedAt: 2,
    sheet: { ...emptySheet(), ...sheet },
    ...over,
  };
}

function token(over: Partial<VttToken> = {}): VttToken {
  return { id: "t1", name: "Vex", x: 0, y: 0, size: 1, color: "#fff", visible: true, ...over } as VttToken;
}

function view(sheet: Partial<CharacterSheet> = {}, tok: VttToken | null = token(), over: Partial<Parameters<typeof buildSynopsis>[0]> = {}) {
  return buildSynopsis({ role: "host", record: rec(sheet), token: tok, ownerName: "Ada", ...over });
}

describe("buildSynopsis", () => {
  it("refuses a player — this console is the Curator's, for anyone including themselves", () => {
    expect(buildSynopsis({ role: "player", record: rec(), token: token(), ownerName: "Ada" })).toBeNull();
  });

  it("refuses a record the vault could not read", () => {
    // A corrupt row is a blank sheet wearing the right name; a gift written into
    // one would persist the blank over the real character.
    expect(buildSynopsis({ role: "host", record: rec({}, { corrupt: true }), token: token(), ownerName: "Ada" })).toBeNull();
    expect(buildSynopsis({ role: "host", record: null, token: token(), ownerName: "Ada" })).toBeNull();
  });

  it("reads vitals off the BODY, so it agrees with the party HUD", () => {
    const v = view({ hpDamage: 0 }, token({ hp: 12, hpMax: 30, statuses: ["Bleeding"], vision: 6 }));
    expect(v).toMatchObject({ hp: 12, hpMax: 30, vision: 6, tokenId: "t1" });
    expect(v!.statuses).toEqual(["Bleeding"]);
  });

  it("distinguishes a body with no vision set from a body that cannot see", () => {
    expect(view({}, token({}))!.vision).toBeNull();
    expect(view({}, token({ vision: 0 }))!.vision).toBe(0);
  });

  it("still opens for a member with no body on this scene", () => {
    const v = view({ rank: 3 }, null);
    expect(v).not.toBeNull();
    expect(v!.tokenId).toBeNull();
    expect(v!.hp).toBeNull();
    expect(v!.statuses).toEqual([]);
  });

  it("prints only the identity a character actually has", () => {
    expect(view({ rank: 4 })!.identity).toEqual(["Rank 4"]);
    expect(view({ speciesId: "hyomen", variantName: "Tidewalker", rank: 2 })!.identity).toEqual([
      "Hyomen",
      "Tidewalker",
      "Rank 2",
    ]);
  });
});

describe("carriedLines", () => {
  it("folds stacked catalog gear into one line per name", () => {
    const lines = carriedLines({
      ...emptySheet(),
      weaponLoadout: ["Paradigm Rifle"],
      gearLoadout: ["Ration", "Ration", "Rope"],
      equipment: [{ id: "e1", name: "Torn ledger", weight: "minute", equipped: false, mods: "", qty: 2 }],
    });
    expect(lines).toEqual([
      { name: "Paradigm Rifle", from: "weapon" },
      { name: "Ration", qty: 2, from: "gear" },
      { name: "Rope", qty: 1, from: "gear" },
      { name: "Torn ledger", qty: 2, from: "item" },
    ]);
  });

  it("skips the blank row an empty equipment entry leaves behind", () => {
    const lines = carriedLines({
      ...emptySheet(),
      equipment: [{ id: "e1", name: "  ", weight: "light", equipped: true, mods: "" }],
    });
    expect(lines).toEqual([]);
  });
});

describe("gifts are sheet patches", () => {
  it("puts an item in the pack rather than on the body", () => {
    // Equipping it would move their carry load and their modifiers without
    // anyone choosing that.
    const patch = giveItemPatch(emptySheet(), { name: "Torch", qty: 3, weight: "light", notes: "burns 1 hour" });
    expect(patch!.equipment).toHaveLength(1);
    expect(patch!.equipment![0]).toMatchObject({
      name: "Torch",
      qty: 3,
      weight: "light",
      equipped: false,
      notes: "burns 1 hour",
      mods: "",
    });
    expect(patch!.equipment![0].id).toBeTruthy();
  });

  it("stacks onto an item they already carry instead of adding a second row", () => {
    const sheet: CharacterSheet = {
      ...emptySheet(),
      equipment: [{ id: "e1", name: "Torch", weight: "light", equipped: true, mods: "", qty: 1 }],
    };
    const patch = giveItemPatch(sheet, { name: "torch", qty: 2 });
    expect(patch!.equipment).toHaveLength(1);
    expect(patch!.equipment![0]).toMatchObject({ id: "e1", qty: 3, equipped: true });
  });

  it("refuses a nameless item", () => {
    expect(giveItemPatch(emptySheet(), { name: "   " })).toBeNull();
  });

  it("hands over information as its own attributed record", () => {
    const patch = giveHandoutPatch(emptySheet(), { title: "Torn ledger page", text: "…paid in Scrap.", now: 99 });
    expect(patch!.handouts![0]).toMatchObject({ title: "Torn ledger page", by: "The Curator", at: 99 });
    expect(giveHandoutPatch(emptySheet(), { title: " ", text: " " })).toBeNull();
  });

  it("produces patches the codec stores and hands back unchanged", () => {
    // A gift that did not survive the sheet round trip would vanish on the next
    // reload, and the player would be left holding a change notice for nothing.
    let sheet = emptySheet();
    for (const patch of [
      giveItemPatch(sheet, { name: "Sigil fragment" }),
      giveHandoutPatch(sheet, { title: "The password is “ash”", text: "Whispered by a dying courier.", now: 7 }),
    ]) {
      sheet = { ...sheet, ...patch };
    }
    const round = sheetFromJson(JSON.parse(JSON.stringify(sheet)));
    expect(round.handouts).toEqual(sheet.handouts);
    expect(round.equipment).toEqual(sheet.equipment);
  });
});

describe("money is not a sheet patch — it is sent to a device", () => {
  // The purse lives in the player's table link (net/activeTable), which the
  // Curator's database has no copy of. Nothing here returns a patch; a gift is a
  // peer id and a signed number of Shrives for `NetContext.grantPurse`.
  const online = (over: Partial<CharacterSheet> = {}) =>
    view(over, token(), { peerId: "peer-7", purseShrives: 30_000 })!;

  it("hands the Curator's words to the wire in Shrives", () => {
    const gift = planMoneyGift(online(), "2 Credits");
    expect(gift).toMatchObject({ ok: true, peerId: "peer-7", shrives: 2 * SHRIVES_PER_CREDIT });
    expect(gift.ok && gift.said).toContain("2 Cr");
  });

  it("takes money back on a leading minus, and says which way it went", () => {
    const gift = planMoneyGift(online(), "-500 sh");
    expect(gift).toMatchObject({ ok: true, shrives: -500 });
    expect(gift.ok && gift.said).toBe("500 Sh was taken from Vex.");
  });

  it("refuses an amount that is not one, rather than sending zero", () => {
    for (const typed of ["", "   ", "gold", "0"]) {
      expect(planMoneyGift(online(), typed).ok).toBe(false);
    }
  });

  it("refuses OUT LOUD when nobody is holding the purse", () => {
    // THE FAILURE THIS PREVENTS: the grant is applied by the player's own client,
    // so publishing one for an absent peer does nothing at all. Reported as a
    // success, the Curator would believe the table had been paid.
    const away = view({}, token(), { peerId: null })!;
    const gift = planMoneyGift(away, "2 Credits");
    expect(gift.ok).toBe(false);
    expect(!gift.ok && gift.reason).toContain("nobody is holding it");
  });

  it("checks the amount first, so a typo is not reported as an absence", () => {
    const away = view({}, token(), { peerId: null })!;
    expect(!planMoneyGift(away, "gold").ok && planMoneyGift(away, "gold")).toMatchObject({
      reason: expect.stringContaining("Type an amount"),
    });
  });

  it("reads the purse as unknown, not as zero, until a device announces one", () => {
    expect(view()!.purseShrives).toBeNull();
    expect(view({}, token(), { peerId: "peer-7", purseShrives: 0 })!.purseShrives).toBe(0);
  });

  // THE FAILURE THESE PREVENT: the payee's device floors its purse at zero, so a
  // confiscation larger than the balance moves only the balance. Reported with
  // the typed figure, the Curator was told "5 Cr was taken from Vex" while ONE
  // Credit moved — a partial gift wearing a completed gift's sentence.
  it("says what can actually be taken, not what was typed", () => {
    const thin = view({}, token(), { peerId: "peer-7", purseShrives: SHRIVES_PER_CREDIT })!;
    const gift = planMoneyGift(thin, "-5 Credits");
    expect(gift.ok && gift.said).toBe("Vex only had 1 Cr, so that is all that was taken.");
    // and the full delta is still what goes out — the payee's clamp is the authority
    expect(gift).toMatchObject({ ok: true, shrives: -5 * SHRIVES_PER_CREDIT });
    expect(gift.ok && clampShrives((thin.purseShrives ?? 0) + gift.shrives)).toBe(0);
  });

  it("does not pretend an empty purse was emptied", () => {
    const broke = view({}, token(), { peerId: "peer-7", purseShrives: 0 })!;
    expect(planMoneyGift(broke, "-1 Cr")).toMatchObject({
      ok: true,
      said: "Vex's purse was already empty — nothing was taken.",
    });
  });

  it("words a take-back plainly when the whole amount is covered", () => {
    const flush = view({}, token(), { peerId: "peer-7", purseShrives: 5 * SHRIVES_PER_CREDIT })!;
    expect(planMoneyGift(flush, "-5 Cr")).toMatchObject({ said: "5 Cr was taken from Vex." });
    // Exactly covered is covered, not short.
    expect(planMoneyGift(flush, "-5 Cr").ok).toBe(true);
  });

  it("never softens the sentence on a total nobody has announced", () => {
    // An unannounced purse is unknown, not empty. Quoting a shortfall from it
    // would invent a balance the table has never been told.
    const quiet = view({}, token(), { peerId: "peer-7", purseShrives: null })!;
    expect(planMoneyGift(quiet, "-5 Cr")).toMatchObject({ said: "5 Cr was taken from Vex." });
  });

  it("a stale total never REFUSES a take-back, it only words it", () => {
    const stale = view({}, token(), { peerId: "peer-7", purseShrives: 0 })!;
    expect(planMoneyGift(stale, "-9 Cr")).toMatchObject({ ok: true, shrives: -9 * SHRIVES_PER_CREDIT });
  });

  it("still calls a gift a gift whatever the balance", () => {
    const broke = view({}, token(), { peerId: "peer-7", purseShrives: 0 })!;
    expect(planMoneyGift(broke, "2 Cr")).toMatchObject({ said: "Vex received 2 Cr." });
  });
});

describe("payablePeer — which device may be handed money", () => {
  const living = new Set(["peer-7", "peer-9"]);

  it("pays the peer who shared the sheet", () => {
    expect(payablePeer({ homePeer: "peer-7", tokenOwner: "peer-9", selfId: "me", livingPeerIds: living })).toBe("peer-7");
  });

  it("falls back to the body when the sheet has not been re-pushed", () => {
    // partySheets is emptied on disconnect, so a reconnected player has no home
    // peer until they share again — without this the Curator is told the purse
    // is unreachable while the player sits there looking at their own token.
    expect(payablePeer({ homePeer: null, tokenOwner: "peer-9", selfId: "me", livingPeerIds: living })).toBe("peer-9");
  });

  it("REFUSES a peer id that is only in the scene file", () => {
    // THE FAILURE THIS PREVENTS: peer ids are minted fresh each session and the
    // token's owner is saved to disk, so last week's id belongs to somebody else
    // tonight. Paying it puts a player's money in a stranger's purse.
    expect(payablePeer({ homePeer: null, tokenOwner: "peer-from-last-week", selfId: "me", livingPeerIds: living })).toBeNull();
  });

  it("never answers with this device", () => {
    const withSelf = new Set([...living, "me"]);
    expect(payablePeer({ homePeer: null, tokenOwner: "me", selfId: "me", livingPeerIds: withSelf })).toBeNull();
  });

  it("is null when there is no body and no shared sheet", () => {
    expect(payablePeer({ homePeer: null, tokenOwner: null, selfId: "me", livingPeerIds: living })).toBeNull();
    expect(payablePeer({ homePeer: undefined, tokenOwner: undefined, selfId: "me", livingPeerIds: living })).toBeNull();
    expect(payablePeer({ homePeer: "", tokenOwner: "", selfId: "me", livingPeerIds: living })).toBeNull();
  });
});
