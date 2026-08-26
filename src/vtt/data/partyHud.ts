// Who is in the party HUD, how hurt they are, and how far they are from the
// thing the viewer is looking at.
//
// WHY THIS IS BUILT OFF TOKENS RATHER THAN SHARED SHEETS: a player's device
// never holds another player's character record. `sync/partySheets` refuses one
// on sight ("on a player's machine, only the Curator and we ourselves may write
// anything"), and `loadPartyRoster` is called with an empty campaign id whenever
// the screen is in player view. Sheets and the roster are therefore Curator-only
// data. The scene's token list is the one thing every device at the table holds
// the same copy of, so it is the only source a HUD both roles can read.
//
// The roster is still used, on the machine that has one, for the case tokens
// cannot answer: a party member with no body on THIS scene. That member is
// listed and marked off-scene rather than silently vanishing when the Curator
// switches maps.
import { FT_PER_CELL } from "./effectMeta";
import { tokenOwnerId } from "../sync/tokenPermissions";
import type { VttToken } from "../types/scene";

/** A durable party member, as `sync/partyRoster` records them. Narrowed to the
 *  three fields the HUD reads so tests need not build a whole RosterMember. */
export interface PartyHudRosterEntry {
  charId: string;
  name: string;
  ownerName: string;
}

export interface PartyHudPeer {
  id: string;
  name: string;
}

export interface PartyHudInput {
  /** Every token on the live scene (props and NPCs included; filtered here). */
  tokens: readonly VttToken[];
  /** The Curator's durable roster. Empty on a player's device, by design. */
  roster: readonly PartyHudRosterEntry[];
  /** Peers in the room right now, for a "who is playing this body" label. */
  peers: readonly PartyHudPeer[];
  /** This device's peer id. */
  selfId: string;
  /** The room host (the Curator). Their own bodies are not party members. */
  hostId: string | null;
  /** The token the viewer has selected, if any — the preferred measuring anchor. */
  selectedTokenId: string | null;
  /** Grid scale, px per cell (`scene.data.grid.size`). */
  cellPx: number;
}

export interface PartyHudMember {
  /** Stable across re-renders and HP changes, so React never remounts a card. */
  key: string;
  charId: string | null;
  /** Null when this member has no visible body on the current scene. */
  tokenId: string | null;
  name: string;
  /** Who is playing this body, for the card's subtitle. */
  ownerName: string;
  statuses: readonly string[];
  hp: number | null;
  hpMax: number | null;
  /** How much they have TAKEN, which is what was asked for — see the note on
   *  `damage` in the component. Null when the body carries no HP track, 0 when
   *  they are untouched. */
  damage: number | null;
  /** Remaining vitality, 0..1. Null when there is no HP track to read. */
  remaining: number | null;
  /** Feet from the anchor. Null when off-scene, or when nothing anchors the
   *  measurement, or when this member IS the anchor. */
  distanceFt: number | null;
  /** This member's body is the thing everything else is measured from. */
  isAnchor: boolean;
  /** Their body is on this scene and visible. */
  onScene: boolean;
  /** This is the viewer's own character. */
  isSelf: boolean;
}

export interface PartyHudAnchor {
  tokenId: string;
  /** What to call it in the caption ("from Kira", "from you"). */
  name: string;
  /** The anchor is the viewer's own body rather than a chosen target. */
  isSelf: boolean;
  x: number;
  y: number;
}

export interface PartyHud {
  members: readonly PartyHudMember[];
  /** Null means nothing is being measured from; the strip says so rather than
   *  printing a column of distances with no stated origin. */
  anchor: PartyHudAnchor | null;
}

const NO_STATUSES: readonly string[] = Object.freeze([]);

/**
 * Distance between two world points, in feet.
 *
 * Deliberately the ruler's arithmetic, character for character: Euclidean
 * hypotenuse, divided by the grid's px-per-cell, times the one `FT_PER_CELL` in
 * the app, rounded the way `MeasurementLayer` rounds. A HUD that said 20 ft
 * where dragging the ruler said 25 ft would be worse than no HUD, because the
 * table would have to check it every time.
 */
function distanceFt(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cellPx: number
): number | null {
  if (!Number.isFinite(cellPx) || cellPx <= 0) return null;
  const cells = Math.hypot(bx - ax, by - ay) / cellPx;
  if (!Number.isFinite(cells)) return null;
  return Math.round(cells * FT_PER_CELL);
}

/** A body that belongs to a player, as opposed to scenery, a monster, or one of
 *  the Curator's own pieces. Hidden tokens are excluded on purpose: a body the
 *  Curator has hidden must not broadcast its position to the table through a
 *  distance readout. Such a member falls through to "off scene". */
function partyBody(token: VttToken, hostId: string | null, rosterIds: ReadonlySet<string>): boolean {
  if (token.prop) return false;
  if (token.visible === false) return false;
  const owner = tokenOwnerId(token);
  if (owner && owner !== hostId) return true;
  // An unowned body the Curator placed for a player who has not connected yet is
  // still that player's, and the roster is what knows it.
  return !!token.characterId && rosterIds.has(token.characterId);
}

function ownerLabel(token: VttToken, peers: readonly PartyHudPeer[], selfId: string, fallback: string): string {
  const owner = tokenOwnerId(token);
  if (!owner) return fallback;
  if (owner === selfId) return "you";
  return peers.find((p) => p.id === owner)?.name || fallback;
}

/**
 * Which body every distance is measured FROM.
 *
 * "How far are they from each other" has no single answer past two people, so
 * the HUD picks one origin and names it on screen. The selected token wins —
 * including an NPC's, because "how far is each of them from this ghoul" is the
 * question a Curator actually asks — and the viewer's own body is the standing
 * answer when nothing is selected. With neither, there is no anchor and the
 * cards print no distance at all rather than an unlabelled number.
 */
function pickAnchor(input: PartyHudInput): PartyHudAnchor | null {
  const visible = input.tokens.filter((t) => !t.prop && t.visible !== false);
  const selected = input.selectedTokenId
    ? visible.find((t) => t.id === input.selectedTokenId)
    : undefined;
  if (selected) {
    const mine = tokenOwnerId(selected) === input.selfId;
    return { tokenId: selected.id, name: mine ? "you" : selected.name || "the selected token", isSelf: mine, x: selected.x, y: selected.y };
  }
  const own = input.selfId ? visible.find((t) => tokenOwnerId(t) === input.selfId) : undefined;
  if (own) return { tokenId: own.id, name: "you", isSelf: true, x: own.x, y: own.y };
  return null;
}

/**
 * ORDER IS FIXED, and that is the point. A strip whose cards resort themselves
 * when someone takes a hit, moves, or is selected is a strip nobody can build
 * muscle memory for — you would have to re-read every card every time you
 * glanced at it. So: the viewer's own character first (a player's own card is
 * always leftmost), then everyone with a body on this scene by name, then the
 * off-scene members last. Nothing in that ordering changes during a fight.
 */
function order(a: PartyHudMember, b: PartyHudMember): number {
  if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
  if (a.onScene !== b.onScene) return a.onScene ? -1 : 1;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.key.localeCompare(b.key);
}

export function buildPartyHud(input: PartyHudInput): PartyHud {
  const rosterIds = new Set(input.roster.map((m) => m.charId));
  const bodies = input.tokens.filter((t) => partyBody(t, input.hostId, rosterIds));
  const anchor = pickAnchor(input);
  const claimed = new Set<string>();
  const members: PartyHudMember[] = [];

  for (const token of bodies) {
    const charId = token.characterId ?? null;
    // TWO BODIES CAN CARRY ONE characterId, and a card key must still be unique.
    // `data/tokenRegistry` exists because this app has shipped scenes holding
    // duplicate character tokens — it consolidates them on campaign load and
    // reports "Legacy duplicates must be reviewed" when it cannot — and a
    // sandbox scene never goes through that reconcile at all, because
    // `spawnCharacter` takes the `!campaign` branch straight to `spawnToken`.
    // Keyed on the character alone, the second body would collide with the first
    // and React would drop or misplace a card on the next re-render.
    const duplicateBody = !!charId && claimed.has(charId);
    if (charId) claimed.add(charId);
    const rosterName = charId ? input.roster.find((m) => m.charId === charId) : undefined;
    const hp = typeof token.hp === "number" && Number.isFinite(token.hp) ? token.hp : null;
    const hpMax = typeof token.hpMax === "number" && Number.isFinite(token.hpMax) && token.hpMax > 0 ? token.hpMax : null;
    const isAnchor = anchor?.tokenId === token.id;
    members.push({
      key: charId && !duplicateBody ? `char:${charId}` : `token:${token.id}`,
      charId,
      tokenId: token.id,
      name: token.name || rosterName?.name || "Unnamed",
      ownerName: ownerLabel(token, input.peers, input.selfId, rosterName?.ownerName || "player"),
      statuses: token.statuses && token.statuses.length > 0 ? token.statuses : NO_STATUSES,
      hp,
      hpMax,
      damage: hp != null && hpMax != null ? Math.max(0, hpMax - hp) : null,
      remaining: hp != null && hpMax != null ? Math.min(1, Math.max(0, hp / hpMax)) : null,
      distanceFt: anchor && !isAnchor ? distanceFt(anchor.x, anchor.y, token.x, token.y, input.cellPx) : null,
      isAnchor,
      onScene: true,
      isSelf: tokenOwnerId(token) === input.selfId && !!input.selfId,
    });
  }

  // A member the roster knows who has no body here. Switching to the tavern map
  // must not make half the party cease to exist; the card stays, says so, and
  // carries no vitals it cannot honestly read off a token.
  for (const entry of input.roster) {
    if (claimed.has(entry.charId)) continue;
    members.push({
      key: `char:${entry.charId}`,
      charId: entry.charId,
      tokenId: null,
      name: entry.name || "Unnamed",
      ownerName: entry.ownerName || "player",
      statuses: NO_STATUSES,
      hp: null,
      hpMax: null,
      damage: null,
      remaining: null,
      distanceFt: null,
      isAnchor: false,
      onScene: false,
      isSelf: false,
    });
  }

  members.sort(order);
  return { members, anchor };
}

/** How hurt, in one word — the band a colour is chosen from, and the word a
 *  screen reader is given instead of a bar it cannot see. */
export function woundBand(remaining: number | null): "unknown" | "whole" | "hurt" | "bloodied" | "down" {
  if (remaining == null) return "unknown";
  if (remaining <= 0) return "down";
  if (remaining >= 1) return "whole";
  return remaining <= 0.5 ? "bloodied" : "hurt";
}
