// The Curator's console for ONE party member: who they are at a glance, and the
// things the Curator hands them.
//
// WHAT THIS IS NOT. It is not the character sheet, and the restraint is the
// feature — the sheet is 900 lines of tabs and it already exists one click away.
// This answers the questions a Curator asks with the map open ("who is this,
// what is on them, what are they carrying") and then does the four things the
// map cannot: give information, give an item, give money, change what their body
// is doing. Anything that belongs in the sheet stays in the sheet.
//
// WHY THE VIEW IS BUILT HERE AND NOT IN THE COMPONENT: the refusal is the
// reason. `buildSynopsis` returns null for a player, so "a player cannot open
// another player's console" is a tested property of a pure function rather than
// a convention about which prop VttScreen passes. A future caller that forgets
// the branch gets nothing to render instead of a working console.
//
// INFORMATION AND ITEMS ARE SHEET PATCHES, returned rather than applied. The
// writer (VttScreen) puts them through `editCharacterSheet` and broadcasts,
// which is what makes the change reach the player and queue them a notice; a
// builder that wrote to the DB itself could not be tested without one.
//
// MONEY IS NOT A SHEET FIELD, and that asymmetry is the whole design. W.T.E's
// currency is Palladium/Credits/Shrives (game/money), and a character's purse
// lives in their TABLE LINK on their own device — `net/activeTable` says it
// outright: "this device is the ONLY place either exists; the Curator's database
// has no copy". So the Curator cannot write money into a record here. They send
// it: `NetContext.grantPurse(peerId, shrives)` publishes a grant, the player's
// device applies it to their own purse and announces the new total back. That
// needs a live PEER, not a character id, which is why `peerId` is on the view
// and why `planMoneyGift` refuses — out loud — when nobody is holding it.
import type { CharacterRecord } from "../../lib/characters";
import type { CharacterSheet } from "../../models/character";
import type { VttToken } from "../types/scene";
import { getParadigm, getSpecies, type EquipmentItem, type WeightKey } from "../../game/wte";
import { formatMoney, parseMoneyDelta } from "../../game/money";
import { giveHandout, type Handout } from "../../game/handouts";

/** One line of "what they are carrying", from whichever list it came off. */
export interface CarriedLine {
  name: string;
  /** How many, when the list stacks. Absent for a single equipped thing. */
  qty?: number;
  /** Where it lives on the sheet, so the Curator knows what they are looking at
   *  and the surface can say why an entry cannot be edited here. */
  from: "weapon" | "gear" | "item";
}

export interface SynopsisView {
  charId: string;
  name: string;
  /** Who is playing them, as the table says it. */
  ownerName: string;
  /** "Hyomen · Remnant · Rank 4" — only the parts that are actually set. */
  identity: string[];
  /** The body on this scene, when there is one. */
  tokenId: string | null;
  hp: number | null;
  hpMax: number | null;
  statuses: readonly string[];
  /** Vision radius in cells, or null when this body has never been given one —
   *  which is not the same as zero. */
  vision: number | null;
  carrying: readonly CarriedLine[];
  /** The live peer holding this character right now, from `sheetHomePeer`. Null
   *  when nobody is — and money can only be handed to a connected device. */
  peerId: string | null;
  /** Their table purse in Shrives, as that peer last announced it. Null when
   *  this table has never heard one, which is NOT the same as being broke. */
  purseShrives: number | null;
  handouts: readonly Handout[];
}

export interface SynopsisInput {
  /** This device's role. Anything but "host" gets nothing — see the note above. */
  role: "host" | "player";
  /** The Curator's copy of the character. */
  record: CharacterRecord | null | undefined;
  /** Their body on the live scene, if it is on this one. */
  token: VttToken | null | undefined;
  /** Display name for whoever is playing them. */
  ownerName: string;
  /** Which live peer owns this character's shared sheet — `sheetHomePeer`, which
   *  already answers exactly this and returns null for a peer who has left. */
  peerId?: string | null;
  /** What that peer last announced their purse to be (`NetContext.purses`). */
  purseShrives?: number | null;
}

/** What a character is carrying, in one list, in the order a Curator asks about
 *  it: what they are holding, what they are wearing, what is in the pack. */
export function carriedLines(sheet: CharacterSheet): CarriedLine[] {
  const out: CarriedLine[] = [];
  for (const name of sheet.weaponLoadout ?? []) out.push({ name, from: "weapon" });
  // Catalog gear holds ONE entry PER COPY carried (EquipmentPanel's rule), so it
  // is folded here rather than printed as three identical rows.
  const gearCounts = new Map<string, number>();
  for (const name of sheet.gearLoadout ?? []) gearCounts.set(name, (gearCounts.get(name) ?? 0) + 1);
  for (const [name, qty] of gearCounts) out.push({ name, qty, from: "gear" });
  for (const item of sheet.equipment ?? []) {
    if (!item?.name?.trim()) continue;
    out.push({ name: item.name, qty: Math.max(1, Math.trunc(item.qty ?? 1)), from: "item" });
  }
  return out;
}

/**
 * The console for one party member, or null when this device may not open one.
 *
 * Null for a player, and null when the Curator's vault has no copy of the
 * character — an unreadable record included. A corrupt row is a blank sheet
 * wearing the right name, and handing a gift into one would write the blank.
 */
export function buildSynopsis(input: SynopsisInput): SynopsisView | null {
  if (input.role !== "host") return null;
  const rec = input.record;
  if (!rec || rec.corrupt) return null;
  const sheet = rec.sheet;
  const identity: string[] = [];
  const species = getSpecies(sheet.speciesId);
  if (species) identity.push(species.name);
  if (sheet.variantName) identity.push(sheet.variantName);
  const paradigm = getParadigm(sheet.paradigmId);
  if (paradigm) identity.push(paradigm.name);
  identity.push(`Rank ${sheet.rank ?? 0}`);
  const token = input.token ?? null;
  return {
    charId: rec.id,
    name: rec.name || "Unnamed Inquisitor",
    ownerName: input.ownerName,
    identity,
    tokenId: token?.id ?? null,
    // Vitals come off the BODY, not the sheet: the token is what the table has
    // been hitting all evening, and a synopsis that quoted the sheet's untouched
    // pools would disagree with the party HUD standing three inches below it.
    hp: token?.hp ?? null,
    hpMax: token?.hpMax ?? null,
    statuses: token?.statuses ?? [],
    vision: token?.vision ?? null,
    carrying: carriedLines(sheet),
    peerId: input.peerId ?? null,
    purseShrives: input.purseShrives ?? null,
    handouts: sheet.handouts ?? [],
  };
}

// ── Gifts ─────────────────────────────────────────────────────────────────────

export interface ItemGift {
  name: string;
  qty?: number;
  weight?: WeightKey;
  notes?: string;
}

function newItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "eq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/**
 * Put an item in a character's pack.
 *
 * IT GOES TO THE SHEET, NOT TO THE TABLE INVENTORY, because there is no wire to
 * the other one. `game/tableInventory` holds what a player carries AT THE TABLE,
 * and like the purse it lives only on their device — but the `inv` protocol
 * message has ops "mine" | "unit" | "request" and no "grant", so nothing in this
 * app can push an item onto another device's list the way `purse/grant` pushes
 * money. The sheet's `equipment` is the one list the Curator can actually write
 * and broadcast, so that is where a given item lands. If an `inv/grant` op is
 * ever added, this is the call site that should move.
 *
 * NOT equipped. A thing handed to you across a table is in your hands, not
 * strapped on — and `equipped` is what feeds the encumbrance total and the mod
 * aggregator, so equipping it for them would change their carry load and
 * possibly their stats without anyone choosing that.
 *
 * An item they ALREADY carry stacks rather than appearing twice, matching how
 * sheetDiff reads equipment (by name) — otherwise the player's notice would say
 * "Gained Torch" while their inventory grew a second row of the same thing.
 */
export function giveItemPatch(sheet: CharacterSheet, gift: ItemGift): Partial<CharacterSheet> | null {
  const name = String(gift.name ?? "").trim().slice(0, 120);
  if (!name) return null;
  const qty = Math.max(1, Math.trunc(gift.qty ?? 1));
  const items = sheet.equipment ?? [];
  const at = items.findIndex((i) => i?.name?.trim().toLowerCase() === name.toLowerCase());
  if (at >= 0) {
    const was = items[at];
    const next: EquipmentItem = { ...was, qty: Math.max(1, Math.trunc(was.qty ?? 1)) + qty };
    return { equipment: items.map((item, i) => (i === at ? next : item)) };
  }
  const entry: EquipmentItem = {
    id: newItemId(),
    name,
    weight: gift.weight ?? "standard",
    equipped: false,
    mods: "",
    notes: String(gift.notes ?? "").trim(),
    qty,
  };
  return { equipment: [...items, entry] };
}

/** Hand over a piece of information. Null when there is nothing to hand over. */
export function giveHandoutPatch(
  sheet: CharacterSheet,
  gift: { title: string; text: string; by?: string; now?: number }
): Partial<CharacterSheet> | null {
  const handouts = giveHandout(sheet.handouts, {
    title: gift.title,
    text: gift.text,
    by: gift.by ?? "The Curator",
    now: gift.now,
  });
  return handouts ? { handouts } : null;
}

// ── Money, which is not a gift the sheet can carry ───────────────────────────

export type MoneyGift =
  /** Send `shrives` to `peerId` through `NetContext.grantPurse`. Negative takes
   *  it back. `said` is what to tell the Curator once it is away. */
  | { ok: true; peerId: string; shrives: number; said: string }
  /** Nothing was sent, and `reason` is why — shown to the Curator rather than
   *  swallowed. A refused gift must never look like a completed one. */
  | { ok: false; reason: string };

/** Said in the UI before the Curator even types, and again if they try anyway. */
export function offlineMoneyReason(view: SynopsisView): string {
  return `${view.name}'s purse lives on ${view.ownerName === "you" ? "their own" : `${view.ownerName}'s`} device and nobody is holding it at this table right now. There is nothing here to pay into — this app keeps no copy of a player's money.`;
}

/**
 * Decide what a typed amount means, before any of it is sent.
 *
 * Every refusal is a SENTENCE, not a silent return, because the two ways this
 * can fail both look identical from the outside — a mistyped amount and an
 * absent player would each have left the Curator watching a button do nothing
 * while believing the money had moved.
 */
export function planMoneyGift(view: SynopsisView, typed: string): MoneyGift {
  const shrives = parseMoneyDelta(typed);
  if (shrives === null || shrives === 0) {
    return { ok: false, reason: "Type an amount first — “2 Credits”, “500 Shrives”, or “−1 Cr” to take it back." };
  }
  // Checked AFTER the amount so a Curator typing into an offline member's form
  // is told the real obstacle rather than being sent to fix their spelling.
  if (!view.peerId) return { ok: false, reason: offlineMoneyReason(view) };
  return { ok: true, peerId: view.peerId, shrives, said: moneySaid(view, shrives) };
}

/**
 * What the Curator is TOLD, which is not always the number they typed.
 *
 * The delta goes out in full and the payee's own device clamps it — `money.ts`
 * floors a purse at zero, because a debt is a story and not a negative balance.
 * So a Curator confiscating 5 Credits from a player holding 1 moved ONE Credit
 * and was told "5 Cr was taken from Kira": a gift that was silently a fraction
 * of itself, wearing the sentence of a completed one. That is the same lie this
 * module already refuses to tell about a gift that never left, so where the
 * announced total is known the sentence quotes what can actually move.
 *
 * WORDING ONLY, NEVER A REFUSAL. `purseShrives` is what that device last
 * announced and can be stale in either direction; blocking a take-back on it
 * would strand a Curator behind a number nobody can refresh from here, and the
 * payee's own clamp is the authority regardless.
 *
 * Only the FLOOR is worded, not the ceiling: `MAX_SHRIVES` is ~900,000
 * Palladium, which no table reaches, whereas an empty pocket is Tuesday.
 */
function moneySaid(view: SynopsisView, shrives: number): string {
  if (shrives > 0) return `${view.name} received ${formatMoney(shrives)}.`;
  const asked = -shrives;
  const held = view.purseShrives;
  if (held == null || held >= asked) return `${formatMoney(asked)} was taken from ${view.name}.`;
  if (held <= 0) return `${view.name}'s purse was already empty — nothing was taken.`;
  return `${view.name} only had ${formatMoney(held)}, so that is all that was taken.`;
}

/**
 * Which live device may be paid for this character.
 *
 * Money is the one gift that needs a PEER rather than a character id, and this
 * is the question `buildSynopsis` cannot answer for itself because both of its
 * inputs come from stores. It lives here, pure and tested, for the reason the
 * header gives: paying the wrong device is not a rendering bug a Curator can
 * see, it is money arriving in a stranger's purse.
 *
 * `homePeer` (`sheetHomePeer`) is the primary answer — the peer who shared this
 * sheet, already checked against the living and already null for the Curator's
 * own device. It is not the only answer, because `partySheets` is emptied on
 * disconnect and a reconnected player has not necessarily re-pushed their sheet
 * yet; the Curator would be told the purse was unreachable while the player sat
 * there looking at their own token.
 *
 * So their BODY answers second, and the live peer list is what makes that safe:
 * a token's owner is stored in the SCENE FILE and peer ids are minted fresh each
 * session, so an id saved last week belongs to somebody else tonight or to
 * nobody at all. A stale id must never be paid. Never self, either — the
 * Curator's own device is not a party member's purse.
 */
export function payablePeer(input: {
  homePeer: string | null | undefined;
  tokenOwner: string | null | undefined;
  selfId: string;
  livingPeerIds: ReadonlySet<string>;
}): string | null {
  if (input.homePeer) return input.homePeer;
  const body = input.tokenOwner;
  if (!body || body === input.selfId) return null;
  return input.livingPeerIds.has(body) ? body : null;
}
