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
| A counter track moving (`Counter: Blight +1`) | The opposite move back through `applyTokenCounter` | Pip yes; the track record is host-only |
| Encounter-tracker HP edits | Same authorised write | Yes — `token.update` |
| The resolution card's "applied" mark | Re-armed with the write it rode in on | Ledger is host-local; nothing to send |
| A confirmed `Tamper:` — a negated field, a cleansed condition, a wiped track, a reflect, a delay | The whole cascade replayed backwards: the effect re-added, the pips re-written, the countdowns and track records put back | Effect and pip yes — `effect.add` / `token.update`; clocks and tracks are host-only, as always |

Tamper is the one verb that takes state AWAY, and it takes four kinds at once: a
template, the status pips that template granted, the countdowns watching those
pips, and — for the cleanse path — a counter track's record. All four ride ONE
entry (`src/vtt/undo/tamperUndo.ts`), because a Curator who mis-clicked a negate
means to take back the act, not three quarters of it.

Two things it does that the vitals half never had to:

- **A partial write is rolled back rather than left standing.** One tamper can
  write pips to a dozen bodies and `adjudicateTokenVitals` refuses a player-owned
  token. Stopping halfway would leave the field gone and half the corridor still
  Burning, so the pips are written first and the first refusal puts back the ones
  already written before anything touches an effect.
- **The staleness check is deep, not by id.** The writes it inverts change an
  effect's position and delete keys from its data, so an entry that only asked
  "is `fx-3` still here?" would happily undo a reflect the Curator had since
  moved by hand.

What a tamper provably could NOT reach is reported on the proposal and repeated
in the toast — see `docs/tamper-cascade.md`. That is not an undo boundary; it is
state the cascade has no link to, and it stays exactly where it is in both
directions.

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
register no inverse *when they come from the ordinary placement paths*. These are
ordinary Curator edits that *should* be undoable by the rule above; they are
simply not built yet. Removal **through the `Tamper:` verb** is the exception and
is covered above — `PixiVttApp.putEffects` / `removeEffects` are the authorised
pair an inverse needs, so the remaining work for the placement paths is to route
through them rather than to invent anything.

So is **clearing** a counter track — `PixiVttApp.clearTokenCounter`, the
Curator's eraser. Nothing about it is a boundary either; it simply has no caller
that registers an inverse yet.

Until those land, the VTT stack covers vitals, conditions and counter moves.

## Counter tracks: why the inverse is a MOVE

`applyTokenCounter` writes two things that have to agree — the pip on the token,
through `adjudicateTokenVitals`, and the scene's authoritative track record,
through `commitTokenCounter`. An inverse that restored the recorded `statuses`
the way `adjudicateUndoableVitals` does would fix the pip and leave the record
reading the new number: the next `Counter: Blight +1` would resume from the value
undo had just erased and stamp a pip nobody could explain.

So `src/vtt/undo/counterUndo.ts` re-enters through `applyTokenCounter` with the
opposite delta. That moves both halves through the writer that already keeps them
in step, and inherits its ownership adjudication and its `onOp` broadcast.

Three consequences worth stating:

- **The recorded move is the CLAMPED one.** A `+5` into a cap of 8 from 6 lands
  on 8, having moved 2. An inverse built from the delta the page wrote would
  drive the track to 3 and take off five points that were never applied.
- **A move the ceiling refused entirely registers nothing.** `+1` on a track
  already at its cap leaves the pip byte-identical; an entry there would spend
  the Curator's next press on an act that changed nothing while the real mistake
  sat one press deeper.
- **The inverse carries no thresholds.** Downward, `crossedThresholds` reports
  none anyway. Upward — a redo — it would report the same arrival a second time,
  and the Resolution Card that arrival produced is the one the caller's `restore`
  hands back; re-deriving it would put two cards on screen for one arrival at 8.

That card is the part undo must not forget. Putting Blight back to 7 while
"Blight reached 8" still stood would leave the Curator holding a 1d100 armed by
an arrival that no longer happened, so `VttScreen` dismisses the crossing card on
undo and re-pushes the recorded one on redo — recorded, not rebuilt, so a redo
cannot restamp its timestamp or its TTL.
