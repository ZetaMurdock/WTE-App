// @vitest-environment happy-dom
// Two things are being proven here, and they pull in opposite directions:
//
//  - the Curator must be able to edit a player's sheet whether or not that player
//    is connected, and both sides' work must survive the reunion;
//  - and no peer may ever write a sheet that is not theirs.
//
// So the authorization cases are kept ADVERSARIAL (a peer trying it on, a forged
// first share, a stranger claiming the host's privilege) and run against the same
// module-level store the app uses.
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPartySheets,
  agreedSheetBase,
  applyRemoteSheet,
  getPartySheets,
  isForeignSheet,
  pruneOwners,
  ownSharedSheetIds,
  sheetHomePeer,
  shouldBroadcastSheet,
} from "./partySheets";
import type { CharacterRecord } from "../../lib/characters";
import type { CharacterSheet } from "../../models/character";

const rec = (id: string, name: string, over: Partial<CharacterSheet> = {}): CharacterRecord => ({
  id,
  campaignId: "c1",
  name,
  createdAt: 1,
  updatedAt: 2,
  sheet: {
    attributes: {} as CharacterSheet["attributes"],
    specialties: {} as CharacterSheet["specialties"],
    rank: 3,
    hpDamage: 0,
    notes: "",
    ...over,
  },
});

// We are the host ("self" is the Curator) unless a case says otherwise.
const ctx = { selfId: "self", hostId: "self" };
const entry = (id: string) => getPartySheets().find((e) => e.record.id === id);

beforeEach(() => {
  __resetPartySheets();
  localStorage.clear();
});

describe("who may write a sheet", () => {
  it("accepts a peer's first share and binds them as owner", () => {
    expect(applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null }).kind).toBe("applied");
    expect(entry("A")?.ownerId).toBe("peer1");
  });

  it("REJECTS another peer updating a record they don't own", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    const held = entry("A")?.record;
    expect(applyRemoteSheet(rec("A", "Kai", { rank: 99 }), "peer2", { ...ctx, local: held }).kind).toBe("denied");
    expect(entry("A")?.record.sheet.rank).toBe(3); // unchanged
    expect(entry("A")?.ownerId).toBe("peer1"); // still peer1's
  });

  it("lets the OWNER update their own record", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    const out = applyRemoteSheet(rec("A", "Kai", { rank: 6 }), "peer1", { ...ctx, local: entry("A")?.record });
    expect(out.kind).toBe("applied");
    expect(out.record?.sheet.rank).toBe(6);
  });

  it("lets the HOST (Curator) update anyone's record WITHOUT rebinding the owner", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    const out = applyRemoteSheet(rec("A", "Kai", { rank: 7 }), "self", { ...ctx, local: entry("A")?.record });
    expect(out.record?.sheet.rank).toBe(7);
    expect(entry("A")?.ownerId).toBe("peer1"); // a host edit preserves the player's ownership
  });

  it("lets a non-self host update too, and refuses a stranger (player-side view)", () => {
    const playerCtx = { selfId: "playerMe", hostId: "hostGm" };
    expect(applyRemoteSheet(rec("H", "Hero"), "playerMe", { ...playerCtx, local: null }).kind).toBe("applied");
    const mine = entry("H")?.record;
    expect(applyRemoteSheet(rec("H", "Hero", { rank: 5 }), "hostGm", { ...playerCtx, local: mine }).kind).toBe("applied");
    expect(applyRemoteSheet(rec("H", "Hero", { rank: 9 }), "peerX", { ...playerCtx, local: entry("H")?.record }).kind).toBe(
      "denied"
    );
    expect(entry("H")?.ownerId).toBe("playerMe");
  });

  it("REFUSES a forged first share over a record already in this vault", () => {
    // "A" is the Curator's own character. peer2 has never shared it, and there is
    // no agreement for it, so their record is not a sync — it is an overwrite.
    const mine = rec("A", "The Curator's NPC", { rank: 2 });
    expect(applyRemoteSheet(rec("A", "Stolen", { rank: 9 }), "peer2", { ...ctx, local: mine }).kind).toBe("denied");
    expect(entry("A")).toBeUndefined(); // nothing was even remembered
  });

  it("still lets the HOST hand down a record this vault already has", () => {
    const playerCtx = { selfId: "playerMe", hostId: "hostGm" };
    const mine = rec("A", "Kai", { rank: 2 });
    expect(applyRemoteSheet(rec("A", "Kai", { rank: 4 }), "hostGm", { ...playerCtx, local: mine }).kind).toBe("applied");
  });

  it("lets the RECOGNISED owner come back with a new peer id", () => {
    // Peer ids are regenerated every session. Without a way to recognise a
    // returning player, they look exactly like a forger and could never sync
    // again — so the caller, which alone keeps the durable roster, says so.
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    const stored = entry("A")?.record;
    __resetPartySheets(); // the room closed; the agreement on disk is all that is left
    const out = applyRemoteSheet(rec("A", "Kai", { rank: 4 }), "peer1-next-session", {
      ...ctx,
      local: stored,
      ownerClaim: true,
    });
    expect(out.kind).toBe("applied");
    expect(entry("A")?.ownerId).toBe("peer1-next-session");
    // and once it is bound again, everyone else is back outside.
    expect(applyRemoteSheet(rec("A", "Kai", { rank: 1 }), "peer9", { ...ctx, local: out.record }).kind).toBe("denied");
  });

  it("REFUSES an unrecognised peer the same reconnection it grants the owner", () => {
    // The whole difference between a returning player and a peer forging someone
    // else's character id is the caller's recognition. Everything else about
    // these two messages — the id, the shape, the fact that the sheet has been
    // shared before and its owner is not connected — is identical.
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    const stored = entry("A")?.record;
    __resetPartySheets();
    const out = applyRemoteSheet(rec("A", "Kai", { rank: 99 }), "impostor", { ...ctx, local: stored });
    expect(out.kind).toBe("denied");
    expect(entry("A")).toBeUndefined(); // and nothing was bound to them
  });

  it("REFUSES a peer who waits for the owner to disconnect", () => {
    // pruneOwners empties the live room when a peer leaves, and the agreement it
    // deliberately keeps says only THAT the sheet was shared, never by whom.
    // Reading that as permission made every sleeping player's sheet writable by
    // everyone still in the room.
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    const kai = entry("A")!.record;
    pruneOwners(new Set(["peer2"]), "self"); // Kai's player closes their app
    const out = applyRemoteSheet(rec("A", "Kai", { rank: 99, hpDamage: 40 }), "peer2", { ...ctx, local: kai });
    expect(out.kind).toBe("denied");
  });

  it("REFUSES a peer any sheet at all on a PLAYER's machine", () => {
    // A player never displays another player's sheet, so a peer-authored record
    // arriving here can only overwrite their character or plant a stranger's in
    // their vault. Only the Curator and themselves may write on this device.
    const mine = { selfId: "me", hostId: "gm" };
    shouldBroadcastSheet(rec("M", "Mine"), "me");
    const held = entry("M")!.record;
    __resetPartySheets(); // the app restarts; the agreement survives on disk
    expect(applyRemoteSheet(rec("M", "Mine", { rank: 99 }), "peer2", { ...mine, local: held }).kind).toBe("denied");
    // ...including a sheet this device has never seen, which is how another
    // player's character used to end up in a player's own vault.
    expect(applyRemoteSheet(rec("OTHER", "Theirs"), "peer2", { ...mine, local: null }).kind).toBe("denied");
    // The Curator still has full control here, which is the point of the feature.
    expect(applyRemoteSheet(rec("M", "Mine", { rank: 5 }), "gm", { ...mine, local: held }).kind).toBe("applied");
  });

  it("REFUSES a peer the reclaim that exists for the sheet's real owner", () => {
    // The reclaim path reopens a sheet the Curator touched while its owner was
    // away — and it is reached through a live entry the Curator's own save
    // re-created under the CURATOR's id, so none of the earlier ownership checks
    // apply to it. Without the durable owner match it read as "any peer may seize
    // any sheet the Curator has edited", which is the whole lockout fix pointed
    // backwards.
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    pruneOwners(new Set(), "self"); // Kai's player closes their app
    const curatorEdit = rec("A", "Kai", { hpDamage: 12 });
    shouldBroadcastSheet(curatorEdit, "self"); // the entry comes back as the Curator's
    expect(entry("A")?.ownerId).toBe("self");
    const thief = applyRemoteSheet(rec("A", "Stolen", { rank: 99 }), "peer2", { ...ctx, local: curatorEdit });
    expect(thief.kind).toBe("denied");
    expect(entry("A")?.ownerId).toBe("self"); // and the sheet was not handed over
    // The same wire traffic WITH the roster's recognition is the returning owner.
    expect(applyRemoteSheet(rec("A", "Kai", { rank: 4 }), "peer2", {
      ...ctx,
      local: curatorEdit,
      ownerClaim: true,
    }).kind).not.toBe("denied");
  });

  it("refuses a record whose sender could not read it", () => {
    const damaged: CharacterRecord = { ...rec("A", "Kai"), corrupt: true, rawData: "{{{" };
    expect(applyRemoteSheet(damaged, "peer1", { ...ctx, local: null }).kind).toBe("denied");
  });

  it("refuses to write over a local row this device could not read, or one from a newer build", () => {
    const unreadable: CharacterRecord = { ...rec("A", "Kai"), corrupt: true, rawData: "{{{" };
    expect(applyRemoteSheet(rec("A", "Kai", { rank: 4 }), "self", { ...ctx, local: unreadable }).kind).toBe("denied");
    const future: CharacterRecord = { ...rec("A", "Kai"), futureVersion: 99 };
    expect(applyRemoteSheet(rec("A", "Kai", { rank: 4 }), "self", { ...ctx, local: future }).kind).toBe("denied");
  });
});

describe("the echo, and what counts as news", () => {
  it("blocks the receive to remount-save echo (the loop breaker)", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    expect(shouldBroadcastSheet(rec("A", "Kai"), "self")).toBe(false);
  });

  it("lets a REAL local edit broadcast, exactly once", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    expect(shouldBroadcastSheet(rec("A", "Kai", { rank: 5 }), "self")).toBe(true);
    expect(shouldBroadcastSheet(rec("A", "Kai", { rank: 5 }), "self")).toBe(false);
  });

  it("binds a brand-new local record to self", () => {
    expect(shouldBroadcastSheet(rec("C", "Me"), "self")).toBe(true);
    expect(entry("C")?.ownerId).toBe("self");
  });

  it("drops sheets owned by departed peers, keeps self + living", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    applyRemoteSheet(rec("B", "Vex"), "peer2", { ...ctx, local: null });
    shouldBroadcastSheet(rec("C", "Me"), "self");
    pruneOwners(new Set(["peer1"]), "self");
    expect(getPartySheets().map((e) => e.record.id).sort()).toEqual(["A", "C"]);
  });

  it("keeps the AGREEMENT when the peer leaves — that is what the Curator edits against", () => {
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    pruneOwners(new Set(), "self");
    expect(entry("A")).toBeUndefined(); // gone from the live room
    expect(agreedSheetBase("A")).not.toBeNull(); // but not from this device's memory
  });

  it("announces only the sheets that LIVE on this machine", () => {
    shouldBroadcastSheet(rec("C", "Mine"), "self"); // shared from here
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null }); // shared with us
    // Both have an agreement, and only one of them is ours to push on reconnect:
    // announcing the other would be this machine circulating a copy of someone
    // else's character that it does not edit.
    expect(ownSharedSheetIds()).toEqual(["C"]);
  });

  it("addresses a sheet to the machine it lives on, and to nobody else", () => {
    // A host publish with no target reaches EVERY player, and a player accepts
    // whatever the host sends. So the Curator opening a player's sheet used to
    // write that player's character into every other player's vault. The send has
    // to name one recipient, and there is exactly one.
    applyRemoteSheet(rec("A", "Kai"), "peer1", { ...ctx, local: null });
    expect(sheetHomePeer("A", "self", new Set(["peer1", "peer2"]))).toBe("peer1");
    // Our own characters have no other home: nothing player-facing reads them.
    shouldBroadcastSheet(rec("N", "The Curator's NPC"), "self");
    expect(sheetHomePeer("N", "self", new Set(["peer1"]))).toBeNull();
    // An owner who is asleep is not a recipient — their copy is reconciled when
    // they announce on reconnect, and a send that cannot happen must not pretend
    // to. A character this room has never shared is nobody's either.
    expect(sheetHomePeer("A", "self", new Set(["peer2"]))).toBeNull();
    expect(sheetHomePeer("nothing-like-this", "self", new Set(["peer1"]))).toBeNull();
  });

  it("knows which sheets are the table's rather than ours", () => {
    // What stops a player pushing back a sheet the Curator shared with them: a
    // copy that can only be staler than the owner's, which the host refuses as
    // not-theirs — one sticky toast to the Curator per attempt.
    applyRemoteSheet(rec("A", "Kai"), "gm", { selfId: "me", hostId: "gm", local: null });
    shouldBroadcastSheet(rec("M", "Mine"), "me");
    expect(isForeignSheet("A")).toBe(true);
    expect(isForeignSheet("M")).toBe(false);
    // Never shared, never received: an ordinary local character is not foreign,
    // or a player's first share would never leave their machine.
    expect(isForeignSheet("brand-new")).toBe(false);
  });

  it("returns a stable snapshot reference between mutations", () => {
    expect(getPartySheets()).toBe(getPartySheets());
  });
});

describe("the week apart", () => {
  /** Tuesday's starting point: the player shared Kai, both sides hold it. */
  const shared = rec("A", "Kai", { rank: 3, hpDamage: 0 });
  /** The returning player, recognised. Peer ids die with the session, so the
   *  caller (the Curator, who keeps the roster) is the one that matches a new
   *  peer id to the character's durable owner and says so. Every case below is
   *  that player coming back; the adversarial twin at the end is the same wire
   *  traffic WITHOUT the recognition. */
  const owner = { ...ctx, ownerClaim: true };
  const meet = () => {
    applyRemoteSheet(shared, "peer1", { ...ctx, local: null });
    // The room closes. Only what is on disk survives — this is the restart.
    __resetPartySheets();
  };

  it("delivers a CURATOR-ONLY offline edit back to the player who reconnects", () => {
    meet();
    const curatorEdited = rec("A", "Kai", { rank: 3, hpDamage: 12 }); // Tuesday, alone
    const out = applyRemoteSheet(shared, "peer1-again", { ...owner, local: curatorEdited });
    expect(out.kind).toBe("unchanged"); // the player's copy taught us nothing
    expect(out.record).toBeUndefined(); // so nothing was written over the Curator's edit
    expect(out.reply?.sheet.hpDamage).toBe(12); // and this is what goes back to them
  });

  it("accepts a PLAYER-ONLY offline edit", () => {
    meet();
    const playerLevelled = rec("A", "Kai", { rank: 4 });
    const out = applyRemoteSheet(playerLevelled, "peer1-again", { ...owner, local: shared });
    expect(out.kind).toBe("applied");
    expect(out.record?.sheet.rank).toBe(4);
    expect(out.reply).toBeUndefined(); // they already have everything we hold
  });

  it("keeps BOTH sides' work when they edited different things", () => {
    meet();
    const curatorEdited = rec("A", "Kai", { rank: 3, hpDamage: 12 });
    const playerLevelled = rec("A", "Kai", { rank: 4, hpDamage: 0 });
    const out = applyRemoteSheet(playerLevelled, "peer1-again", { ...owner, local: curatorEdited });
    expect(out.kind).toBe("applied");
    expect(out.record?.sheet.hpDamage).toBe(12);
    expect(out.record?.sheet.rank).toBe(4);
    expect(out.reply?.sheet.hpDamage).toBe(12); // the merge goes back so both converge
  });

  it("REFUSES to pick a winner when both moved the same field", () => {
    meet();
    const curatorSaid5 = rec("A", "Kai", { rank: 5 });
    const playerSaid4 = rec("A", "Kai", { rank: 4 });
    const out = applyRemoteSheet(playerSaid4, "peer1-again", { ...owner, local: curatorSaid5 });
    expect(out.kind).toBe("conflict");
    expect(out.record).toBeUndefined(); // nothing written: the Curator's 5 stands here
    expect(out.reply).toBeUndefined(); // and nothing sent: their 4 stands there
    expect(out.conflicts?.map((c) => c.key)).toEqual(["rank"]);
  });

  it("does not re-resolve a conflict the next time the same two copies meet", () => {
    meet();
    const curatorSaid5 = rec("A", "Kai", { rank: 5 });
    const playerSaid4 = rec("A", "Kai", { rank: 4 });
    applyRemoteSheet(playerSaid4, "peer1-again", { ...owner, local: curatorSaid5 });
    // The agreement must NOT have moved, or the second exchange would read the
    // disagreement as "only they changed it" and hand the Curator's 5 away.
    const again = applyRemoteSheet(playerSaid4, "peer1-again", { ...owner, local: curatorSaid5 });
    expect(again.kind).toBe("conflict");
  });

  it("does not let the uncontested half of a merge settle the contested half", () => {
    // A conflict that ALSO carries deliverable fields takes the other branch: it
    // writes a record and advances the agreement. Advancing it to the whole
    // written record would move the base of the contested field to our value, and
    // the very next exchange would read their unchanged 4 as "only they moved it"
    // — the disagreement resolving itself in favour of whoever spoke last, which
    // is the one outcome this path exists to prevent.
    meet();
    const curatorSaid5 = rec("A", "Kai", { rank: 5, hpDamage: 0 });
    const playerSaid4 = rec("A", "Kai", { rank: 4, hpDamage: 9 }); // rank contested, HP theirs alone
    const first = applyRemoteSheet(playerSaid4, "peer1-again", { ...owner, local: curatorSaid5 });
    expect(first.kind).toBe("conflict");
    expect(first.record?.sheet.hpDamage).toBe(9); // the uncontested edit still lands
    expect(first.record?.sheet.rank).toBe(5); // and the contested field is not guessed
    const again = applyRemoteSheet(playerSaid4, "peer1-again", { ...owner, local: first.record! });
    expect(again.kind).toBe("conflict");
    expect(again.conflicts?.map((c) => c.key)).toEqual(["rank"]);
  });

  it("settles once the two humans agree, without anyone forcing it", () => {
    meet();
    const curatorSaid5 = rec("A", "Kai", { rank: 5 });
    applyRemoteSheet(rec("A", "Kai", { rank: 4 }), "peer1-again", { ...owner, local: curatorSaid5 });
    // The player types the number they agreed on at the table.
    const out = applyRemoteSheet(rec("A", "Kai", { rank: 5 }), "peer1-again", { ...owner, local: curatorSaid5 });
    expect(out.kind).toBe("unchanged");
    expect(out.conflicts).toBeUndefined();
  });

  it("does not lock the player out of their own sheet by editing it while they are away", () => {
    // The live room forgets ownership when a peer disconnects, so the Curator's
    // own save re-creates the entry under the Curator's id. If that counted as
    // ownership, the returning player's record would be refused — for good.
    applyRemoteSheet(shared, "peer1", { ...ctx, local: null });
    pruneOwners(new Set(), "self"); // the player closes their app
    const curatorEdit = rec("A", "Kai", { hpDamage: 12 });
    shouldBroadcastSheet(curatorEdit, "self"); // and the Curator edits the sheet
    const out = applyRemoteSheet(shared, "peer1-again", { ...owner, local: curatorEdit });
    expect(out.kind).not.toBe("denied");
    expect(out.reply?.sheet.hpDamage).toBe(12); // the edit reaches them instead
    expect(entry("A")?.ownerId).toBe("peer1-again"); // and the sheet is theirs again
  });

  it("does NOT let a peer reclaim a character of the Curator's own that was shared", () => {
    // The same reclaim path, aimed at a sheet this device really does own.
    shouldBroadcastSheet(rec("N", "The Curator's NPC"), "self");
    pruneOwners(new Set(), "self");
    shouldBroadcastSheet(rec("N", "The Curator's NPC", { rank: 4 }), "self");
    const out = applyRemoteSheet(rec("N", "Stolen", { rank: 9 }), "peer7", {
      ...ctx,
      local: rec("N", "The Curator's NPC", { rank: 4 }),
    });
    expect(out.kind).toBe("denied");
  });

  it("an ordinary live edit after a sync is not mistaken for a week apart", () => {
    // The stale-agreement trap: the Curator pushes a change, the player adopts it
    // and then edits the SAME field a minute later. Reconciled against a base that
    // never moved, that reads as "both changed it" — a conflict on every keystroke.
    applyRemoteSheet(shared, "peer1", { ...ctx, local: null });
    const curatorEdit = rec("A", "Kai", { rank: 4 });
    shouldBroadcastSheet(curatorEdit, "self"); // the Curator's own save goes out
    const playerFollowUp = rec("A", "Kai", { rank: 6 });
    const out = applyRemoteSheet(playerFollowUp, "peer1", { ...ctx, local: curatorEdit });
    expect(out.kind).toBe("applied");
    expect(out.record?.sheet.rank).toBe(6);
  });
});
