import { describe, expect, it } from "vitest";
import { buildPartyHud, woundBand, type PartyHudInput } from "./partyHud";
import { FT_PER_CELL } from "./effectMeta";
import type { VttToken } from "../types/scene";

const CELL = 50;

function token(over: Partial<VttToken> & { id: string }): VttToken {
  return {
    name: over.id,
    x: 0,
    y: 0,
    size: 1,
    color: "#fff",
    visible: true,
    ...over,
  } as VttToken;
}

function input(over: Partial<PartyHudInput> = {}): PartyHudInput {
  return {
    tokens: [],
    roster: [],
    peers: [],
    selfId: "",
    hostId: "gm",
    selectedTokenId: null,
    cellPx: CELL,
    ...over,
  };
}

/** The distance arithmetic, exercised through the shipped path rather than a
 *  private helper: `hud.members[0].distanceFt` IS what a card prints. */
function ftBetween(dx: number, dy: number, cellPx = CELL): number | null {
  return buildPartyHud(
    input({
      cellPx,
      selfId: "p1",
      tokens: [token({ id: "a", owner: "p1", x: 0, y: 0 }), token({ id: "b", owner: "p2", x: dx, y: dy })],
    })
  ).members.find((m) => m.key === "token:b")!.distanceFt;
}

describe("distance in feet", () => {
  it("agrees with the ruler: hypotenuse in cells times the one ft-per-cell constant", () => {
    // 3-4-5 triangle at 50px cells => 5 cells.
    expect(ftBetween(150, 200)).toBe(5 * FT_PER_CELL);
  });

  it("measures diagonals as longer than orthogonals, like the ruler does", () => {
    const straight = ftBetween(CELL * 4, 0);
    const diagonal = ftBetween(CELL * 4, CELL * 4);
    expect(straight).toBe(4 * FT_PER_CELL);
    expect(diagonal).toBeGreaterThan(straight!);
  });

  it("prints nothing rather than Infinity feet on a scene with no grid scale", () => {
    expect(ftBetween(100, 0, 0)).toBeNull();
    expect(ftBetween(100, 0, Number.NaN)).toBeNull();
  });

  // The whole promise of this function is that the card and the ruler never
  // disagree, and `MeasurementLayer` prints `Math.round(cells * FT_PER_CELL)`.
  // Drop the rounding and a card 1.41 cells away reads "7.0710678118654755 ft"
  // — which is not a distance a table can act on, and does not fit the card.
  it("rounds to whole feet the way the ruler does, off the grid as well as on it", () => {
    const diagonal = ftBetween(CELL, CELL);
    expect(diagonal).toBe(Math.round(Math.SQRT2 * FT_PER_CELL));
    expect(Number.isInteger(diagonal!)).toBe(true);
    expect(Number.isInteger(ftBetween(CELL * 2 + 17, CELL - 3)!)).toBe(true);
  });

  // A coordinate that is not a number survives every validator between here and
  // the card: `sync/patches` vets hp, size and vision but never x or y. Printing
  // "NaN ft" in the party strip is worse than printing nothing.
  it("prints nothing rather than NaN feet when a body has a broken coordinate", () => {
    expect(ftBetween(Number.NaN, 0)).toBeNull();
    expect(ftBetween(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("the measuring anchor", () => {
  const kira = token({ id: "k", name: "Kira", owner: "p1", x: 0, y: 0 });
  const ghoul = token({ id: "g", name: "Ghoul", x: 500, y: 0 });

  it("measures from the selected token, even when it is an NPC", () => {
    const hud = buildPartyHud(input({ tokens: [kira, ghoul], selfId: "p1", selectedTokenId: "g" }));
    expect(hud.anchor).toMatchObject({ tokenId: "g", name: "Ghoul", isSelf: false });
  });

  it("calls the anchor 'you' when the selected token is the viewer's own body", () => {
    const hud = buildPartyHud(input({ tokens: [kira, ghoul], selfId: "p1", selectedTokenId: "k" }));
    expect(hud.anchor).toMatchObject({ tokenId: "k", name: "you", isSelf: true });
  });

  it("falls back to the viewer's own body when nothing is selected", () => {
    expect(buildPartyHud(input({ tokens: [kira, ghoul], selfId: "p1" })).anchor?.tokenId).toBe("k");
  });

  it("has no anchor for a Curator with nothing selected and no body of their own", () => {
    expect(buildPartyHud(input({ tokens: [kira, ghoul], selfId: "gm" })).anchor).toBeNull();
  });

  it("will not anchor on a token the Curator has hidden", () => {
    const hidden = token({ id: "h", name: "Hidden", visible: false });
    expect(buildPartyHud(input({ tokens: [hidden], selectedTokenId: "h" })).anchor).toBeNull();
  });
});

describe("buildPartyHud membership", () => {
  it("is empty when there is no party", () => {
    expect(buildPartyHud(input()).members).toEqual([]);
  });

  it("lists player bodies and leaves NPCs, props and the Curator's own pieces off", () => {
    const hud = buildPartyHud(
      input({
        selfId: "gm",
        tokens: [
          token({ id: "k", name: "Kira", owner: "p1" }),
          token({ id: "ghoul", name: "Ghoul" }),
          token({ id: "crate", name: "Crate", prop: true, owner: "p1" }),
          token({ id: "gmpawn", name: "GM pawn", owner: "gm" }),
        ],
      })
    );
    expect(hud.members.map((m) => m.name)).toEqual(["Kira"]);
  });

  it("counts an unowned body as a party member when the roster claims its character", () => {
    const hud = buildPartyHud(
      input({
        tokens: [token({ id: "t", name: "Bram", characterId: "c-bram" })],
        roster: [{ charId: "c-bram", name: "Bram", ownerName: "Sam" }],
      })
    );
    expect(hud.members).toHaveLength(1);
    expect(hud.members[0]).toMatchObject({ tokenId: "t", onScene: true, ownerName: "Sam" });
  });

  it("keeps a roster member with no body on this scene, marked off-scene and vitals-free", () => {
    const hud = buildPartyHud(
      input({
        tokens: [token({ id: "k", name: "Kira", owner: "p1", characterId: "c-kira" })],
        roster: [
          { charId: "c-kira", name: "Kira", ownerName: "Ada" },
          { charId: "c-bram", name: "Bram", ownerName: "Sam" },
        ],
      })
    );
    const bram = hud.members.find((m) => m.name === "Bram")!;
    expect(bram).toMatchObject({ onScene: false, tokenId: null, hp: null, damage: null, remaining: null, distanceFt: null });
  });

  it("does not duplicate a member who is both on the roster and on the map", () => {
    const hud = buildPartyHud(
      input({
        tokens: [token({ id: "k", name: "Kira", owner: "p1", characterId: "c-kira" })],
        roster: [{ charId: "c-kira", name: "Kira", ownerName: "Ada" }],
      })
    );
    expect(hud.members).toHaveLength(1);
  });

  it("treats a hidden body as off-scene rather than leaking where it is", () => {
    const hud = buildPartyHud(
      input({
        tokens: [
          token({ id: "k", name: "Kira", owner: "p1", characterId: "c-kira", visible: false, x: 900 }),
          token({ id: "b", name: "Bram", owner: "p2", characterId: "c-bram" }),
        ],
        roster: [
          { charId: "c-kira", name: "Kira", ownerName: "Ada" },
          { charId: "c-bram", name: "Bram", ownerName: "Sam" },
        ],
        selectedTokenId: "b",
      })
    );
    const kira = hud.members.find((m) => m.name === "Kira")!;
    expect(kira.onScene).toBe(false);
    expect(kira.distanceFt).toBeNull();
  });

  // `data/tokenRegistry` exists to consolidate scenes that hold two tokens for
  // one character, and a sandbox scene never runs that reconcile. Both bodies
  // must still get their own card: one key each, or React drops one of them.
  it("gives each of two bodies sharing one characterId its own card key", () => {
    const hud = buildPartyHud(
      input({
        tokens: [
          token({ id: "k1", name: "Kira", owner: "p1", characterId: "c-kira" }),
          token({ id: "k2", name: "Kira", owner: "p1", characterId: "c-kira" }),
        ],
      })
    );
    expect(hud.members).toHaveLength(2);
    expect(new Set(hud.members.map((m) => m.key)).size).toBe(2);
    // The character still resolves to exactly one off-scene row's worth of
    // roster: a duplicate body must not also print a phantom "off scene" card.
    expect(hud.members.every((m) => m.charId === "c-kira")).toBe(true);
  });

  it("labels the viewer's own body 'you' and every other body by its peer's name", () => {
    const hud = buildPartyHud(
      input({
        selfId: "p1",
        peers: [
          { id: "p1", name: "Ada" },
          { id: "p2", name: "Sam" },
        ],
        tokens: [token({ id: "k", name: "Kira", owner: "p1" }), token({ id: "b", name: "Bram", owner: "p2" })],
      })
    );
    expect(hud.members.find((m) => m.name === "Kira")?.ownerName).toBe("you");
    expect(hud.members.find((m) => m.name === "Bram")?.ownerName).toBe("Sam");
  });
});

describe("buildPartyHud ordering", () => {
  it("puts the viewer's own character first, then on-scene by name, then off-scene", () => {
    const hud = buildPartyHud(
      input({
        selfId: "p2",
        tokens: [
          token({ id: "z", name: "Zara", owner: "p1", characterId: "c-z" }),
          token({ id: "a", name: "Alia", owner: "p3", characterId: "c-a" }),
          token({ id: "m", name: "Mox", owner: "p2", characterId: "c-m" }),
        ],
        roster: [
          { charId: "c-z", name: "Zara", ownerName: "Ada" },
          { charId: "c-a", name: "Alia", ownerName: "Ben" },
          { charId: "c-m", name: "Mox", ownerName: "Cy" },
          { charId: "c-b", name: "Bram", ownerName: "Sam" },
        ],
      })
    );
    expect(hud.members.map((m) => m.name)).toEqual(["Mox", "Alia", "Zara", "Bram"]);
  });

  it("does not reorder when a member is hurt, moved or selected", () => {
    const before = buildPartyHud(
      input({
        tokens: [
          token({ id: "a", name: "Alia", owner: "p1", hp: 20, hpMax: 20 }),
          token({ id: "z", name: "Zara", owner: "p2", hp: 20, hpMax: 20 }),
        ],
      })
    );
    const after = buildPartyHud(
      input({
        selectedTokenId: "z",
        tokens: [
          token({ id: "a", name: "Alia", owner: "p1", hp: 1, hpMax: 20, x: 800 }),
          token({ id: "z", name: "Zara", owner: "p2", hp: 20, hpMax: 20 }),
        ],
      })
    );
    expect(after.members.map((m) => m.key)).toEqual(before.members.map((m) => m.key));
  });
});

describe("buildPartyHud vitals", () => {
  it("reports damage taken, not remaining HP, and zero when untouched", () => {
    const hud = buildPartyHud(
      input({
        tokens: [
          token({ id: "a", name: "Alia", owner: "p1", hp: 9, hpMax: 21 }),
          token({ id: "z", name: "Zara", owner: "p2", hp: 21, hpMax: 21 }),
        ],
      })
    );
    expect(hud.members.find((m) => m.name === "Alia")).toMatchObject({ damage: 12, remaining: 9 / 21 });
    expect(hud.members.find((m) => m.name === "Zara")).toMatchObject({ damage: 0, remaining: 1 });
  });

  it("clamps overheal and overkill instead of drawing a bar past its ends", () => {
    const hud = buildPartyHud(
      input({
        tokens: [
          token({ id: "a", name: "Alia", owner: "p1", hp: 30, hpMax: 21 }),
          token({ id: "z", name: "Zara", owner: "p2", hp: -6, hpMax: 21 }),
        ],
      })
    );
    expect(hud.members.find((m) => m.name === "Alia")).toMatchObject({ damage: 0, remaining: 1 });
    expect(hud.members.find((m) => m.name === "Zara")).toMatchObject({ damage: 27, remaining: 0 });
  });

  it("reads no vitals off a body with no HP track", () => {
    const hud = buildPartyHud(input({ tokens: [token({ id: "a", name: "Alia", owner: "p1" })] }));
    expect(hud.members[0]).toMatchObject({ hp: null, hpMax: null, damage: null, remaining: null });
  });

  // The Curator's "Max" field in VttInspector is `parseInt(value) || 0`, so
  // clearing it writes hpMax 0 — and `sync/patches` accepts 0 and negatives as
  // valid hpMax. Divided through, that is `hp / 0`: a NaN fraction, a bar drawn
  // at `width: NaN%`, and a wound band of "hurt" for a body with no HP track at
  // all. A max that cannot be divided by is no max, and the card says so.
  it("treats a cleared or negative HP maximum as no HP track, not as a NaN bar", () => {
    const hud = buildPartyHud(
      input({
        tokens: [
          token({ id: "a", name: "Alia", owner: "p1", hp: 0, hpMax: 0 }),
          token({ id: "z", name: "Zara", owner: "p2", hp: 5, hpMax: 0 }),
          token({ id: "n", name: "Nef", owner: "p3", hp: 5, hpMax: -21 }),
        ],
      })
    );
    for (const m of hud.members) {
      expect(m).toMatchObject({ hpMax: null, damage: null, remaining: null });
      expect(woundBand(m.remaining)).toBe("unknown");
    }
  });
});

describe("buildPartyHud distance", () => {
  it("measures every member from the anchor, and the anchor from nothing", () => {
    const hud = buildPartyHud(
      input({
        selfId: "p1",
        tokens: [
          token({ id: "k", name: "Kira", owner: "p1", x: 0, y: 0 }),
          token({ id: "b", name: "Bram", owner: "p2", x: CELL * 6, y: 0 }),
        ],
      })
    );
    const kira = hud.members.find((m) => m.name === "Kira")!;
    const bram = hud.members.find((m) => m.name === "Bram")!;
    expect(kira.isAnchor).toBe(true);
    expect(kira.distanceFt).toBeNull();
    expect(bram.distanceFt).toBe(6 * FT_PER_CELL);
  });

  it("re-measures from an NPC the Curator selects", () => {
    const tokens = [
      token({ id: "k", name: "Kira", owner: "p1", x: 0, y: 0 }),
      token({ id: "b", name: "Bram", owner: "p2", x: CELL * 6, y: 0 }),
      token({ id: "g", name: "Ghoul", x: CELL * 3, y: 0 }),
    ];
    const hud = buildPartyHud(input({ selfId: "gm", tokens, selectedTokenId: "g" }));
    expect(hud.anchor?.name).toBe("Ghoul");
    expect(hud.members.map((m) => m.distanceFt)).toEqual([3 * FT_PER_CELL, 3 * FT_PER_CELL]);
  });

  it("prints no distance at all when nothing anchors the measurement", () => {
    const hud = buildPartyHud(
      input({ selfId: "gm", tokens: [token({ id: "k", name: "Kira", owner: "p1", x: 400 })] })
    );
    expect(hud.anchor).toBeNull();
    expect(hud.members[0].distanceFt).toBeNull();
  });
});

describe("woundBand", () => {
  it("names the bands a colour and a screen reader can both use", () => {
    expect(woundBand(null)).toBe("unknown");
    expect(woundBand(1)).toBe("whole");
    expect(woundBand(0.75)).toBe("hurt");
    expect(woundBand(0.5)).toBe("bloodied");
    expect(woundBand(0)).toBe("down");
  });
});
