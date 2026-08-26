# Ending an effect: what goes with it, and what provably cannot

`Tamper: negate` is the only verb in the Actions Engine that destroys state, and
a field on this map is not one record. It is a template, a status pip on every
body standing in it, a countdown per pip, and sometimes a currency somebody has
been accruing. This is the contract for what happens to each.

The implementation is `src/vtt/data/tamperPlan.ts` (pure: it plans) and
`src/vtt/undo/tamperUndo.ts` (it commits, undoably). Nothing else may remove an
ability's effect.

## Why the naive version is worse than doing nothing

`SimulationSystem.tick` revokes a status only while **some live effect still
claims it**:

```ts
const zoneStatuses = new Set(zones.map(statusOf));
const next = cur.filter((s) => !zoneStatuses.has(s) || inside.has(s));
```

So the moment the last zone granting `Burning` disappears from `data.effects`,
every pip reading `Burning` stops being zone-owned and becomes indistinguishable
from a tag the Curator typed by hand. Nothing will ever take it off again. A
negate that removed only the template would look like it worked and leave the
whole corridor Burning for the rest of the campaign.

## The four steps of `end` / `negate` on a placed effect

1. **The template goes.** `removeEffects`, which emits `effect.remove` so peers
   hear it.
2. **Its status comes off every body carrying it that no *surviving* effect still
   grants it to.** This is not a new rule — it is `SimulationSystem.tick`'s own
   rule, evaluated one moment before the removal makes it unevaluable. Two zones
   granting `Burning` and one ending leaves the survivor's occupancy to decide,
   exactly as the round pass would have. Every body carrying the tag is walked,
   not just the occupants, so a negate and a round tick can never disagree about
   who is Burning.
3. **The clocks watching those pips go with them.** `ConditionClockSystem.prune`'s
   rule — a clock survives while an occurrence of its tag is on its token —
   scoped to the bodies this write touches. Leaving them until the next scene
   adopt would let the next application of that condition stack against a ghost.
4. **Counter tracks stay, and the proposal says so.**

## Step 4 is a reported gap, not an oversight

`VttCounterTrack` records a token, a name and a value. **Nothing anywhere records
which ability moved a track.** There is no `sourceAbilityId` on a track and no
ledger of who spent what.

A cascade that guessed — "this zone's caster also declared a `Counter: Blight`
step, so the Blight must be his" — would delete a currency the table may have
earned somewhere else entirely, in a different fight, from a different Stygian.
So the plan lists every track on every affected body by name ("Kira's Blight
3/8") in its caveats, the prompt shows them before the click, and the toast
repeats them after it. The Curator clears one by hand if that is the ruling.

**This needs the Curator's decision, not a code change.** Giving a track
provenance is a decision about what a track *is* — whether Blight belongs to the
ability that inflicted it or to the body that carries it — and that belongs on a
page, not in a planner.

## What else is deliberately left standing

- **Summoned bodies.** A summon carries `sourceAbilityId`, so the same ability's
  minions *are* findable. They are still not removed: the corpus says minions
  "persist until dismissed, slain, or separated", so they outlive the field they
  arrived with. The count is reported, and dismissal has its own door on the
  token.
- **Pips another field still grants.** Reported as "N other bodies keep Burning".
- **A cleanse inside the field that granted it.** Ending a `Burning` countdown on
  a body still standing in the fire is legal and will not hold: a status you are
  inside of is the zone's to own, and the next round pass grants it afresh. The
  proposal warns before the click, because discovering it a round later looks
  exactly like the verb having done nothing.

## What "suspended" means (`Tamper: delay`)

Defined in `src/vtt/engine/systems/effectSuspension.ts`. While the encounter
round is below `VttEffectData.suspendedUntil`:

- **It grants no status.** The effect stays among the status *owners* — so the
  pip is revoked from whoever was standing in it — while containing nobody.
  Dropping it from the owner list would strand the tag exactly as above.
- **It proposes nothing**, and the guard runs *before* `tickedRound` is stamped,
  so a field does not wake to find its first live round already marked paid.
- **It does not age.** `TimelineSystem` will not expire it, and on waking its
  `bornRound` is pushed forward by exactly the rounds it slept. A 3-round field
  delayed 1 round still burns for 3 rounds; it just ends a round later. The
  alternative makes `delay` into `end` for anything delayed past its own
  lifetime, which is the one reading the verb cannot mean.
- **The pip comes off at the moment of the delay**, not on the next round tick —
  a Curator who delayed a fire and watched everyone in it stay Burning would
  reasonably conclude the verb did nothing.
- **The countdowns those pips carried are cleared, not paused**, and the proposal
  says so. A clock exists only while its tag is on the body, and there is nowhere
  to park one. When the field wakes, the zone pass grants the tag afresh.

Suspension is a stored **wake round**, not a boolean, because the Curator can
step the encounter round backwards: stepping back into the sleep re-suspends and
stepping forward wakes again, with no separate pass to keep in step.

A condition's delay is a different mechanism with the same meaning: a clock
stores an absolute expiry, so the only way it can hold still is to move its
start. `bornRound` is pushed forward by the delay, the pip does not change, and
the condition lasts exactly that many rounds longer.

## `reflect`

The effect turns back on its source, which is `VttEffectData.casterCharacterId`.

- An **aura stays an aura**, now riding its source. A **fixed template stays
  fixed**, now standing on the source's square. Reflecting changes who an effect
  stands on, not what it is.
- A **rect zone anchors top-left** (`addEffectAt` owns that convention), so its
  anchor is offset by half its size to put its *body* on the source rather than
  its corner.
- The effect keeps recording the same caster afterwards: that is provenance, not
  ownership. Reflecting a second time therefore moves nothing.
- **A condition clock and a counter track record no source at all.** Reflect
  against either is refused by name — "nothing records who applied Slowed" —
  rather than guessing a victim out of the room. So is an effect whose
  `casterCharacterId` is absent, and one whose caster has no token on this scene.

## `redirect` and `copy` are rulings

Both are real corpus verbs and neither can be executed truthfully with what the
engine holds, so each opens an unrolled Resolution Card that states the question.

- **Redirect** means the ability resolves against somebody else. A placed effect
  is not aimed at anybody — it is a shape on a map, and moving the shape is not
  redirecting the ability. Re-posing a resolved save at a new body means running
  the ability again, which is `Invoke`'s territory, and nothing here can re-ask a
  save the dice have already answered.
- **Copy** means the tamperer now *has* it. What a copy costs, how long it is
  held and whether it can be used again are rules that belong on the copier's own
  page, and no page can state them yet. Duplicating the template would be easy
  and would be a lie: a second field with the original caster still stamped on it
  is not a copy of anything, and it says nothing about copying a condition or a
  track.

Both are things a Curator can rule on in one sentence. Neither is something the
engine should pretend to know.
