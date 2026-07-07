# W.T.E Codex — Page Format

This is how to author Codex pages so the app can read them into the **character sheet** (weapons,
equipment, ciphers, genus) and the **VTT** (creatures). Existing lore/wiki pages are unaffected — a
page is only picked up as data if it has a **`**Type:**`** field.

## How a page is structured

1. A `# Title` line (the entry's name).
2. A **field block**: one `**Field:** value` per line, before the first `##` heading.
3. Rich-text **sections** introduced by `## Heading` (Markdown allowed).

Rules:
- Field names are case-insensitive. Every field is optional **except `Type`** (that's what tags the
  page as data). Unknown fields are ignored.
- `Keywords` is a comma-separated list. Numbers (Grade, SS, HP, …) are read as numbers.
- `## Effect` and `## Overclock` (and `## Abilities` / `## Lore`) are free rich text — put unique
  aspects, conditionals, and flavor here; there's no length limit.
- In `## Overclock`, an optional first line `**Requires:** …` records the unlock condition.

---

## Weapon

Characters have **4 weapon slots**; Weight sets slot cost (Light ½ · Medium 1 · Heavy 2).

```
# Sanctioned Blade
**Type:** Weapon
**Category:** Hybrid
**Grade:** 3
**Damage:** 2d8 Kinetic
**Range:** Melee (5 ft)
**Weight:** Medium
**Size Min:** Moderate
**Keywords:** Healing, Redirect
## Effect
Each attack heals the target attacked by the user's total Influence/Cunning mod. If a creature is
healed by more than 35% of their total health, their rolls against the user take a reduction of
(Influence mod × Cunning mod ÷ their Rank mod). If they fail more than two AP rolls or misc
charisma-based rolls against the user, the next Genus used is redirected back onto them dealing
1.x × damage. If an effect chooses who it is directed towards.
## Overclock
**Requires:** Eldritch + Null Genus
Any creature who has failed a roll against the user, and/or any creature healed by the user directly
or indirectly, becomes incapacitated for 3 turns; you gain access to that target's given memories for
those 3 turns.
```

```
# Cross-Pull
**Type:** Weapon
**Category:** Kinetic
**Grade:** 2
**Damage:** 1d20 Kinetic
**Range:** 60 ft
**Weight:** Medium
**Size Min:** Moderate
**Keywords:** Ranged, Bow
## Effect
Every second arrow that misses reconverges and spins in a 10-foot radius. The next arrow shot brings
the two converged arrows to the third arrow's location, dealing 1d20 damage.
## Overclock
Double damage.
```

**Fields:** Category (Kinetic | Energy | Exotic | Hybrid) · Grade (1–4) · Damage (dice + type) ·
Range · Weight (Light | Medium | Heavy) · Size Min (min Size Class) · Keywords.

---

## Equipment

```
# Bio-Haptic Nerve Suit
**Type:** Equipment
**Slot:** Cybernetic
**Grade:** 2
**Weight:** Medium
**Mods:** DHP +3, DEX +1, Weight -1
**Keywords:** Reflex
## Effect
Threads the wearer's nervous system with haptic relays, sharpening reflex and impact tolerance.
## Overclock
**Requires:** Rank 3+
Once per encounter, negate one hit entirely and gain a free reaction.
```

**Fields:** Slot (Armor | Cybernetic | Utility | Wing | Other) · Grade (1–4) · Weight ·
**Mods** (`STAT ±N` list — same syntax as the sheet's equipment mods; feeds attributes/derived) ·
Keywords.

---

## Cipher

```
# Light Weight
**Type:** Cipher
**Paradigm:** Science
**Tier:** Offline
**SS:** 35
**Activation:** Bonus Action
**Range:** Self
**Target:** Physical object (non-biological)
**Component:** Physical object
## Effect
Drastically reduces a non-biological object's weight for the user; as a bonus action, enlarge or
shrink it by up to two size categories.
```

**Fields:** Paradigm · Tier (Offline | Online | Special) · SS · Activation · Range · Target · Component.

---

## Genus

```
# Vector Swing
**Type:** Genus
**Domain:** Kinetic
**SS:** 1
**Activation:** Active (15 sec)
**Range:** Self
**Target:** Self — next melee strike
**Limit:** Unlimited (cannot stack with Enhanced Strike)
## Effect
The next melee attack deals +1 damage die of the weapon's type and ignores 2 points of physical
damage reduction; if it triggers knock-back, distance is doubled.
```

**Fields:** Domain (Kinetic | Eldritch | Elemental | Neutral | Null) · SS · Activation · Range ·
Target · Limit.

---

## Creature (bestiary — VTT)

```
# Fracture Hound
**Type:** Creature
**Archive:** Standard
**Size:** Large
**Rank:** 3
**HP:** 45
**Attack:** 12
**Evasion:** 8
**Movement:** 35 ft
**Keywords:** Beast, Aberration
## Abilities
- **Rift Lunge** — Teleport up to 20 ft and make a melee attack with advantage.
- **Splinter Howl** — 15-ft cone; targets make a WIS check or take −2 to their next roll.
## Lore
Pack hunters that phase through the seams of collapsed CAS zones.
```

**Fields:** Archive · Size · Rank · HP · Attack · Evasion · Movement · Keywords.
**Abilities:** one `- **Name** — effect` bullet per ability.

---

## Notes

- The `**Type:**` field is the switch — pages without it stay pure lore and are ignored by the data
  layer.
- Keep field values on a single line; multi-line detail goes in the `##` sections.
- You can add extra `## Sections` (e.g. `## Notes`) freely — the app keeps `Effect`, `Overclock`,
  `Abilities`, and `Lore`, and ignores the rest for now.
