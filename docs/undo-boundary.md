# Undo at the table: what comes back, and what does not

Undo in this app is an app-wide service of inverse **pairs** (`src/lib/undoRedo.ts`),
scoped to the workspace you are looking at. The VTT registered nothing with it until
now, which meant every consequence the Actions Engine learned to apply — damage,
conditions, zone statuses — was permanent the moment it landed, on the one surface
that writes to a player's character.

The rule that decides what belongs on that stack:

> **A Curator's private act on the world can be taken back. Something the table
> watched happen cannot.**

Undo is a correction to state, not a way to edit the past everyone shared.

## Undoable

| Act | Inverse | Reaches peers |
| --- | --- | --- |
| Adjudicated HP (resolution card damage/heal) | Re-write of the previous HP through `adjudicateTokenVitals` | Yes — `token.update` |
| Adjudicated statuses / conditions | Re-write of the previous status list, plus the condition's countdown | Pip yes; clock is host-only, as always |
| Encounter-tracker HP edits | Same authorised write | Yes — `token.update` |
| The resolution card's "applied" mark | Re-armed with the write it rode in on | Ledger is host-local; nothing to send |

A condition landing on a body that already carries the tag is undoable too, and
this is the case worth stating: every stacking rule but `stack` keeps ONE pip, so
that application leaves `statuses` byte-equal and moves only the clock. It is
still a real act on the world — the duration changed — so it registers its own
entry. Treating it as a no-op did not merely lose the extension: it left the
FIRST application on top of the stack, so the next press pulled the condition off
the token entirely, under a tooltip naming the wrong act.

Only the acting token's countdowns are swapped, never the scene's whole clock
list: a condition that landed on someone else while the entry sat on the stack
has to survive the press that takes this one back.

Two properties these hold, both enforced in `src/vtt/undo/vitalsUndo.ts`:

1. **The inverse is a real write through the authorised path.** A restore that
   assigned to the token directly would skip the ownership adjudication and skip
   `onOp`, so the Curator's screen would show the HP restored while every player
   kept looking at the damage — a desync with no symptom on the machine that
   caused it. If the authorised write refuses, the undo **fails visibly** (a
   toast, and the entry is dropped) rather than pretending.
2. **A stale entry refuses instead of guessing.** HP and statuses also move
   through paths that register nothing: a recurring tick on the round advance
   calls the writer directly, and a host snapshot can replace the value outright.
   An inverse therefore fires only while the value it wrote is still the value on
   the token. Otherwise undo would silently revert whatever landed in between —
   a new way to lose a ruling.

## Not undoable, on purpose

**A roll published to the shared feed.** `commitRollToFeed` is the moment a
result stops being the Curator's and becomes the table's: players saw the dice,
the total, and who rolled. Removing it would rewrite what they witnessed, and
worse, it would do so silently on their screens. A roll made in error is
corrected the way a table corrects one — by saying so and rolling again. The feed
is history, not state.

**A validated roll result that has already settled a card.** Same reason: the
verdict came off a roll the table saw. Undo returns the *consequence* to the body;
it does not un-fail the save.

**Dice.** Nothing re-rolls on redo. Every inverse replays recorded values, never
a fresh evaluation — including a condition's `bornRound`, which is restored from
the record rather than re-planned, so a redo cannot quietly hand the target a
different duration than the one that landed.

**A player's own action.** Undo is Curator-scoped because the writes it reverses
are Curator-scoped. A player pressing Ctrl+Z has an empty VTT stack; it cannot
reach into another peer's token, and `adjudicateTokenVitals` refuses on a
player-view client anyway.

**Anything on a scene you have left.** The stack is keyed to the live scene
(`workspace:vtt2:<sceneId>`). An inverse for damage on a map the Curator is no
longer looking at would write HP back on bodies nobody can see — the invisible
edit that workspace scoping exists to prevent.

**A token that tracked no HP at all.** There is no wire value for "unset": a
patch of `{ hp: undefined }` survives locally and serialises to `{}` on the way
out. Rather than ship an inverse that only works on the Curator's screen, that
one write stays off the trail.

## Not yet undoable (a gap, not a boundary)

Placement and removal of **zones, auras and effects**, and **summoned tokens**,
register no inverse. These are ordinary Curator edits that *should* be undoable
by the rule above; they are simply not built yet.

So are **counter tracks** — `PixiVttApp.applyTokenCounter` and
`clearTokenCounter`. They commit through the same authorised writer as damage,
they are as private a Curator act as any other, and a mis-clicked `Counter:
Blight +1` currently cannot be taken back. They are listed here rather than above
because nothing about them is a boundary: they need an inverse that swaps the
scene's track record back alongside the pip, in the shape
`applyUndoableCondition` already uses for condition clocks.

Until those land, the VTT stack covers vitals and conditions only.
