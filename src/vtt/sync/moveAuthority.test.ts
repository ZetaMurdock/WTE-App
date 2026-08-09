import { describe, expect, it } from "vitest";
import type { VttGrid, VttToken, VttWall } from "../types/scene";
import { applyAuthorizedMove, validateMoveAuthority, type MoveAuthorityIntent, type MoveAuthorityState } from "./moveAuthority";

const grid: VttGrid = { type: "square", size: 10, cols: 6, rows: 5, color: "#000", visible: true };
const at = (col: number, row: number): { x: number; y: number } => ({ x: (col + 0.5) * grid.size, y: (row + 0.5) * grid.size });
const token = (id: string, owner: string, col: number, row: number, over: Partial<VttToken> = {}): VttToken => ({
  id,
  owner,
  name: id,
  ...at(col, row),
  size: 1,
  color: "#fff",
  visible: true,
  ...over,
});
const state = (tokens: VttToken[], walls: VttWall[] = [], revision = 0): MoveAuthorityState => ({ grid, tokens, walls, revision });
const intent = (moving: VttToken, col: number, row: number, over: Partial<MoveAuthorityIntent> = {}): MoveAuthorityIntent => ({
  tokenId: moving.id,
  fromX: moving.x,
  fromY: moving.y,
  toX: at(col, row).x,
  toY: at(col, row).y,
  ...over,
});

describe("host movement authority", () => {
  it("accepts only the assigned player's current actor", () => {
    const actor = token("actor", "player-1", 0, 1);
    expect(validateMoveAuthority(state([actor]), { peerId: "player-1", role: "player" }, intent(actor, 1, 1))).toMatchObject({
      ok: true,
      tokenId: "actor",
      revision: 1,
    });
    expect(validateMoveAuthority(state([actor]), { peerId: "player-2", role: "player" }, intent(actor, 1, 1))).toMatchObject({
      ok: false,
      reason: "not-owner",
      x: actor.x,
      y: actor.y,
    });
  });

  it("rejects stale origins and stale expected revisions", () => {
    const actor = token("actor", "player-1", 0, 0);
    expect(
      validateMoveAuthority(state([actor], [], 7), { peerId: "player-1", role: "player" }, intent(actor, 1, 0, { fromX: actor.x + 1 }))
    ).toMatchObject({ ok: false, reason: "stale", revision: 7 });
    expect(
      validateMoveAuthority(state([actor], [], 7), { peerId: "player-1", role: "player" }, intent(actor, 1, 0, { expectedRevision: 6 }))
    ).toMatchObject({ ok: false, reason: "stale", revision: 7 });
  });

  it("rejects wall crossings with the authoritative old position", () => {
    const actor = token("actor", "player-1", 0, 1);
    const wall: VttWall = { id: "wall", x1: 10, y1: 0, x2: 10, y2: 30, blocksLight: false };
    expect(validateMoveAuthority(state([actor], [wall]), { peerId: "player-1", role: "player" }, intent(actor, 1, 1))).toMatchObject({
      ok: false,
      reason: "wall",
      x: actor.x,
      y: actor.y,
    });
  });

  it("reports invalid coordinates, map bounds, and occupied cells distinctly", () => {
    const actor = token("actor", "player-1", 0, 0);
    const blocker = token("blocker", "player-2", 1, 0);
    const current = state([actor, blocker]);
    expect(validateMoveAuthority(current, { peerId: "player-1", role: "player" }, intent(actor, 1, 0))).toMatchObject({
      ok: false,
      reason: "occupied",
      blockingTokenId: "blocker",
    });
    expect(validateMoveAuthority(current, { peerId: "player-1", role: "player" }, intent(actor, -1, 0))).toMatchObject({
      ok: false,
      reason: "out-of-bounds",
    });
    expect(
      validateMoveAuthority(current, { peerId: "player-1", role: "player" }, intent(actor, 2, 0, { toX: Number.NaN }))
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("reserves every cell in a large token's footprint", () => {
    const large = token("large", "player-1", 1, 1, { size: 2 });
    const edgeBlocker = token("edge", "player-2", 3, 2);
    expect(validateMoveAuthority(state([large, edgeBlocker]), { peerId: "player-1", role: "player" }, intent(large, 2, 1))).toMatchObject({
      ok: false,
      reason: "occupied",
      blockingTokenId: "edge",
    });
    expect(validateMoveAuthority(state([large]), { peerId: "player-1", role: "player" }, intent(large, 5, 4))).toMatchObject({
      ok: false,
      reason: "out-of-bounds",
    });
  });

  it("serializes two actors racing for one cell: first commits, second rejects", () => {
    const first = token("first", "player-1", 0, 2);
    const second = token("second", "player-2", 2, 2);
    const initial = state([first, second], [], 12);

    const won = applyAuthorizedMove(initial, { peerId: "player-1", role: "player" }, intent(first, 1, 2, { expectedRevision: 12 }));
    expect(won.decision).toMatchObject({ ok: true, tokenId: "first", revision: 13 });
    expect(won.state.tokens.find((candidate) => candidate.id === "first")).toMatchObject(at(1, 2));

    const lost = applyAuthorizedMove(won.state, { peerId: "player-2", role: "player" }, intent(second, 1, 2));
    expect(lost.decision).toMatchObject({ ok: false, reason: "occupied", blockingTokenId: "first", revision: 13 });
    expect(lost.state).toBe(won.state);
    expect(initial.tokens.find((candidate) => candidate.id === "first")).toMatchObject(at(0, 2));
  });
});
