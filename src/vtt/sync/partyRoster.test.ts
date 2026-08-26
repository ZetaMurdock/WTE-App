// @vitest-environment happy-dom
// The roster's whole reason to exist is outliving the live room, so these tests
// drive it against a fake campaign_kv table and then throw the in-memory state
// away to prove the durability claim rather than restating the writes.
import { peerDeviceKey } from "./partyRoster";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  campaign_id: string;
  scope: string;
  key: string;
  value: string;
}
let rows: Row[] = [];
/** Simulate a database read that fails, which must not become a data leak. */
let readFails = false;

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/sqlite_master/.test(sql)) return [{ name: "campaign_kv" }] as unknown as T;
    if (readFails) throw new Error("database is locked");
    return rows.filter(
      (r) => r.campaign_id === args[0] && r.scope === args[1] && r.key === args[2]
    ) as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    if (/INSERT OR REPLACE/.test(sql)) {
      const [campaign_id, scope, key, value] = args as [string, string, string, string];
      const i = rows.findIndex((r) => r.campaign_id === campaign_id && r.scope === scope && r.key === key);
      const row = { campaign_id, scope, key, value };
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    }
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

vi.mock("../../lib/db", () => ({ getDb: async () => fakeDb, sqlAvailable: () => true }));

const { __resetCampaignStoreCache } = await import("../../lib/campaignStore");
const {
  __resetPartyRoster,
  creditSighting,
  forgetPartyMember,
  getPartyRoster,
  lastSeenLabel,
  loadPartyRoster,
  rememberPartyMember,
  subscribePartyRoster,
} = await import("./partyRoster");

const kai = { charId: "A", name: "Kai", ownerId: "peer1", ownerName: "Mara", at: 1000 };
const vess = { charId: "B", name: "Vess", ownerId: "peer2", ownerName: "Jonah", at: 2000 };

beforeEach(() => {
  rows = [];
  readFails = false;
  __resetPartyRoster();
  __resetCampaignStoreCache();
});

describe("the party roster outlives the live room", () => {
  it("still lists a member after the peer that shared them is gone", async () => {
    await rememberPartyMember("c1", kai);
    // Nothing about a peer leaving touches this store — the roster is not derived
    // from the live peer list, which is exactly the bug it exists to fix.
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["A"]);
    expect(getPartyRoster()[0].ownerName).toBe("Mara");
  });

  it("survives a restart: a cold process reads the members back out of the DB", async () => {
    await rememberPartyMember("c1", kai);
    await rememberPartyMember("c1", vess);

    __resetPartyRoster(); // the app quit
    __resetCampaignStoreCache();
    expect(getPartyRoster()).toEqual([]);

    await loadPartyRoster("c1");
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["B", "A"]); // newest sighting first
    expect(getPartyRoster().map((m) => m.lastSeen)).toEqual([2000, 1000]);
  });

  it("refreshes a returning player in place instead of duplicating them", async () => {
    await rememberPartyMember("c1", kai);
    await rememberPartyMember("c1", { ...kai, name: "Kai Ordwin", ownerId: "peer9", at: 5000 });

    expect(getPartyRoster()).toHaveLength(1);
    expect(getPartyRoster()[0]).toMatchObject({ name: "Kai Ordwin", ownerId: "peer9", lastSeen: 5000 });

    __resetPartyRoster();
    await loadPartyRoster("c1");
    expect(getPartyRoster()).toHaveLength(1);
  });

  it("keeps each campaign's table separate across a switch", async () => {
    await rememberPartyMember("c1", kai);
    await rememberPartyMember("c2", vess);

    await loadPartyRoster("c1");
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["A"]);
    await loadPartyRoster("c2");
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["B"]);
  });

  it("loads an empty roster for no campaign rather than showing the last one", async () => {
    await rememberPartyMember("c1", kai);
    await loadPartyRoster("");
    expect(getPartyRoster()).toEqual([]);
  });
});

describe("removal", () => {
  it("drops the entry from memory AND from storage, but issues no record delete", async () => {
    await rememberPartyMember("c1", kai);
    await rememberPartyMember("c1", vess);

    await forgetPartyMember("c1", "A");
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["B"]);

    __resetPartyRoster();
    await loadPartyRoster("c1");
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["B"]);

    // The roster only ever writes campaign_kv. If a removal could reach the
    // characters table the player's sheet would be destroyed by a UI gesture that
    // promises only to tidy a list.
    expect(rows.every((r) => r.scope === "misc" && r.key === "party-roster")).toBe(true);
  });

  it("is a no-op for someone who was never on the roster", async () => {
    await rememberPartyMember("c1", kai);
    const before = getPartyRoster();
    await forgetPartyMember("c1", "nobody");
    expect(getPartyRoster()).toBe(before); // same reference: no needless re-render
  });
});

describe("robustness and notification", () => {
  it("notifies subscribers on load, remember and forget", async () => {
    const seen: number[] = [];
    const stop = subscribePartyRoster(() => seen.push(getPartyRoster().length));
    await loadPartyRoster("c1");
    await rememberPartyMember("c1", kai);
    await forgetPartyMember("c1", "A");
    stop();
    await rememberPartyMember("c1", vess);
    expect(seen).toEqual([0, 1, 0]); // nothing after unsubscribe
  });

  it("discards junk entries instead of rendering ghosts that cannot be opened", async () => {
    rows.push({
      campaign_id: "c1",
      scope: "misc",
      key: "party-roster",
      // The BLANK charId matters as much as the missing one: it matches no row in
      // the vault, so it would render as a member the Curator can click forever.
      value: JSON.stringify([null, 7, { name: "no id" }, { charId: "", name: "Ghost" }, { charId: "A" }]),
    });
    await loadPartyRoster("c1");
    expect(getPartyRoster()).toHaveLength(1);
    expect(getPartyRoster()[0]).toMatchObject({ charId: "A", name: "Unnamed", ownerName: "player", lastSeen: 0 });
  });
});

describe("a failed read must not leak the previous table", () => {
  it("commits to the new campaign and shows nothing, rather than the last one's party", async () => {
    await rememberPartyMember("c1", kai);
    await loadPartyRoster("c1");
    expect(getPartyRoster()).toHaveLength(1);

    readFails = true;
    await expect(loadPartyRoster("c2")).resolves.toEqual([]); // and does not reject
    expect(getPartyRoster()).toEqual([]);

    // The dangerous half: with the load abandoned, this sighting would be appended
    // to c1's list and PERSISTED under c2, moving Mara's character to another table.
    readFails = false;
    await rememberPartyMember("c2", vess);
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["B"]);
    await loadPartyRoster("c1");
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["A"]);
  });
});

describe("who a received sheet is credited to", () => {
  const peers = [
    { id: "p1", name: "Mara" },
    { id: "host", name: "The Curator" },
  ];

  it("credits the LIVE BINDING, not the sender — a Curator edit stays the player's", () => {
    // The Curator edits Mara's sheet; the record comes back stamped "host".
    // Crediting the sender would file Mara's character under the Curator.
    expect(creditSighting({ from: "host", selfId: "host", boundOwnerId: "p1", peers })).toMatchObject({
      ownerId: "p1",
      ownerName: "Mara",
    });
  });

  it("falls back to the sender on a genuine first share", () => {
    expect(creditSighting({ from: "p1", selfId: "host", peers })).toMatchObject({ ownerId: "p1", ownerName: "Mara" });
  });

  it("treats a blank binding as no binding rather than crediting nobody", () => {
    expect(creditSighting({ from: "p1", selfId: "host", boundOwnerId: "", peers })).toMatchObject({
      ownerId: "p1",
      ownerName: "Mara",
    });
  });

  it("files nothing for the Curator's own characters", () => {
    expect(creditSighting({ from: "host", selfId: "host", peers })).toBeNull();
    expect(creditSighting({ from: "p1", selfId: "host", boundOwnerId: "host", peers })).toBeNull();
  });

  it("keeps the remembered name when the peer list has not caught up yet", () => {
    expect(creditSighting({ from: "p9", selfId: "host", peers: [], knownName: "Mara" })?.ownerName).toBe("Mara");
    expect(creditSighting({ from: "p9", selfId: "host", peers: [] })?.ownerName).toBe("player");
  });

  it("but a player sitting at the table outranks the name last written down", () => {
    // The remembered name is a fallback, not a cache. If it won, a player who
    // renamed themselves would be listed under the old name until someone edited
    // the roster by hand — which there is no way to do.
    expect(creditSighting({ from: "p1", selfId: "host", peers, knownName: "Mara (old)" })?.ownerName).toBe("Mara");
  });
});

describe("lastSeenLabel", () => {
  const now = Date.UTC(2026, 7, 26, 12, 0, 0);
  const ago = (ms: number) => lastSeenLabel(now - ms, now);

  it("separates tonight's players from the ones who left the campaign", () => {
    expect(ago(30_000)).toBe("seen just now");
    expect(ago(20 * 60_000)).toBe("seen 20 min ago");
    expect(ago(5 * 3_600_000)).toBe("seen 5h ago");
    expect(ago(24 * 3_600_000)).toBe("seen 1 day ago");
    expect(ago(9 * 24 * 3_600_000)).toBe("seen 9 days ago");
    // Past a month a relative count stops meaning anything; show the date so the
    // Curator can decide whether this player is really gone before removing them.
    expect(ago(200 * 24 * 3_600_000)).toMatch(/^seen \d/);
  });

  it("never renders a negative age from a clock that ran backwards", () => {
    expect(lastSeenLabel(now + 60_000, now)).toBe("seen just now");
  });

  it("says so plainly when the timestamp was lost", () => {
    expect(lastSeenLabel(0, now)).toBe("last seen unknown");
  });
});

// The exact sequence that used to lose the sheet: a peer shares, then drops.
describe("the live store and the roster are independent", () => {
  it("pruneOwners still empties the live store, and the roster still has the member", async () => {
    const { applyRemoteSheet, getPartySheets, pruneOwners } = await import("./partySheets");
    const record = {
      id: "A",
      campaignId: "c1",
      name: "Kai",
      createdAt: 1,
      updatedAt: 2,
      sheet: { attributes: {}, specialties: {}, rank: 3, notes: "" },
    } as unknown as Parameters<typeof applyRemoteSheet>[0];

    applyRemoteSheet(record, "peer1", { selfId: "self", hostId: "self" });
    await rememberPartyMember("c1", { charId: "A", name: "Kai", ownerId: "peer1", ownerName: "Mara", at: 1000 });

    pruneOwners(new Set<string>(), "self"); // peer1 closed the app
    expect(getPartySheets().some((e) => e.record.id === "A")).toBe(false); // live control is gone
    expect(getPartyRoster().map((m) => m.charId)).toEqual(["A"]); // the Curator can still reach the sheet
  });
});

// The player-side path: VttScreen loads the roster with an empty campaign id when
// asPlayer, so a player can never accumulate a list of the table's characters.
describe("a player holds no roster", () => {
  it("clearing the load leaves nothing behind, even mid-session", async () => {
    await rememberPartyMember("c1", kai);
    await loadPartyRoster(""); // the Curator handed the view to a player / preview
    expect(getPartyRoster()).toEqual([]);

    // And a sighting arriving with no campaign is refused rather than starting a
    // fresh roster under a blank id.
    await rememberPartyMember("", vess);
    expect(getPartyRoster()).toEqual([]);
  });
});

describe("recognising a returning player", () => {
  it("keys on the device, which survives a new session", () => {
    // discovery.ts mints `<device base>-<6 random chars>`: the base lives in
    // localStorage and outlives sessions, the suffix keeps two tabs apart.
    expect(peerDeviceKey("abc123def456-a1b2c3")).toBe("abc123def456");
    expect(peerDeviceKey("abc123def456-zzzzzz")).toBe("abc123def456");
    // Two sessions on one machine agree; that is the whole point.
    expect(peerDeviceKey("abc123def456-a1b2c3")).toBe(peerDeviceKey("abc123def456-q9q9q9"));
  });

  it("does not mistake one device for another", () => {
    expect(peerDeviceKey("abc123def456-a1b2c3")).not.toBe(peerDeviceKey("zzz999yyy888-a1b2c3"));
  });

  it("survives an id with no session suffix rather than inventing one", () => {
    expect(peerDeviceKey("plainid12345")).toBe("plainid12345");
    expect(peerDeviceKey("")).toBe("");
    expect(peerDeviceKey(null)).toBe("");
  });

  it("credits a sighting with the device key, never only a name", () => {
    // A peer's display name is taken verbatim from their own hello message, so
    // it is a label. If the roster ever gates a write on it again, anyone who
    // types "Mara" inherits Mara's character.
    const credit = creditSighting({
      from: "device-aaaaaa",
      selfId: "host-bbbbbb",
      peers: [{ id: "device-aaaaaa", name: "Mara" }],
    });
    expect(credit).toMatchObject({ ownerKey: "device", ownerName: "Mara" });
    expect(credit!.ownerKey).toBe(peerDeviceKey("device-aaaaaa"));
  });
});
