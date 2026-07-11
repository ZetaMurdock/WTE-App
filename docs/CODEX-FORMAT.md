# W.T.E Codex — Page Format

How to author Codex pages so the app can read them into the **character sheet** (weapons, equipment,
ciphers, genus) and the **VTT** (creatures). Lore/wiki pages are untouched — a page is only read as
data if it has a **Type** field.

## How a page is structured

1. A `# Title` line (the entry's name).
2. A **spec block** of `FIELD → VALUE` pairs. Author it however is convenient — the parser accepts a
   markdown table `| FIELD | VALUE |`, the wiki stat-block table, tab-separated `FIELD⇥VALUE`, or
   `**Field:** value` lines. A page becomes data only if a **Type** field is present.
3. **Labeled sections** of rich text — either `## Heading` or a `Label:` paragraph. The parser keeps
   these buckets (matched by keyword): **Base Attack Profile**, **Effect** (also matches "System
   Synergy & Combat Integration"), **Overclock** (also "Overclock Protocol"), **Abilities**, **Lore**.

Rules:
- Field names are case-insensitive; every field is optional **except Type**. Unknown fields are ignored.
- **Citation markers** like `[130]` or `[97, 130]` are stripped automatically — leave them in.
- `Keywords` = comma list. Numbers (Grade, NC Cost, HP…) read as numbers. `EDE: Yes/No` is a boolean.
- `Base Attack Profile` auto-extracts **damage** (e.g. `1d8 Slashing`) and **range**.
- In the Overclock section, a `(Req …)` / `Requires: …` note is captured as the unlock condition.
- Not every entry has an Overclock — set `EDE: No` (or omit) and skip the section.

---

## Weapon

Characters have **4 weapon slots**; Weight sets slot cost (Light ½ · Standard 1 · Heavy 2). To *use* a
weapon you must have access to every genus **Domain** it lists.

```
# Sanctioned Blade
| Specification | Value |
|---|---|
| TYPE | Weapon |
| SLOT | R_ARM |
| WEIGHT | Standard |
| MODS | Influence +3, Cunning +2 |
| NC COST | 2 |
| EDE | Yes |
| DOMAIN | Eldritch + Null |

Base Attack Profile: Melee (5 ft range). Deals Slashing 1d8 damage.

System Synergy & Combat Integration: Each attack heals the target attacked by the user's total
Influence/Cunning modifier. If healed by >35% of their total health, their rolls against the user are
reduced by (Influence Mod × Cunning Mod ÷ Target Rank). If they fail 2+ AP or Charisma rolls against
the user, their next Genus is redirected back onto them at 1.x damage.

Overclock Protocol:
Phase I — Extender Phase (Req Eldritch + Null Genus): Any creature that failed a roll against the user,
or was healed by them, is incapacitated for 3 turns; you access their memories during that time.
Phase II — Dextender Phase (Backlash): Synaptic Space cost doubles; combatants override your Action
Priority during the window.
Phase III — Equalizer Phase: Requires a Prepared Action in combat or completing a Recovery Phase.
```

**Fields:** TYPE · SLOT (body slot, e.g. R_ARM/L_ARM) · WEIGHT (slot cost) · MODS (`STAT ±N` list —
same syntax as sheet equipment mods; feeds attributes/derived) · NC COST (Neuronal Capacity to use) ·
EDE (Yes/No — has an Overclock) · DOMAIN (required genus domains). Optional: CATEGORY (Kinetic/Energy/
Exotic/Hybrid), GRADE (1–4), DAMAGE, RANGE, SIZE MIN.
**Sections:** Base Attack Profile · System Synergy & Combat Integration (→ Effect) · Overclock Protocol.

A simpler weapon with no Overclock:

```
# Service Pistol
| Specification | Value |
|---|---|
| TYPE | Weapon |
| SLOT | R_ARM |
| WEIGHT | Light |
| NC COST | 0 |
| EDE | No |

Base Attack Profile: 40 ft ranged. Deals Kinetic 1d6 damage.
System Synergy & Combat Integration: Reliable sidearm; no special effects.
```

---

## Equipment

Same spec block as weapons. **Type: Equipment**.

```
# Bio-Haptic Nerve Suit
| Specification | Value |
|---|---|
| TYPE | Equipment |
| SLOT | Cybernetic |
| GRADE | 2 |
| WEIGHT | Standard |
| MODS | DHP +3, DEX +1, Weight -1 |
| NC COST | 1 |
| EDE | Yes |

Effect: Threads the nervous system with haptic relays, sharpening reflex and impact tolerance.

Overclock Protocol:
Phase I (Req Rank 3+): Once per encounter, negate one hit entirely and gain a free reaction.
```

**Fields:** SLOT (Armor/Cybernetic/Utility/Wing/Other or a body slot) · GRADE · WEIGHT · MODS ·
NC COST · EDE · DOMAIN. **Sections:** Effect · Overclock Protocol.

---

## Cipher

```
# Light Weight
| Specification | Value |
|---|---|
| TYPE | Cipher |
| PARADIGM | Science |
| TIER | Offline |
| SS | 35 |
| ACTIVATION | Bonus Action |
| RANGE | Self |
| TARGET | Physical object (non-biological) |
| COMPONENT | Physical object |

Effect: Drastically reduces a non-biological object's weight for the user; as a bonus action, enlarge
or shrink it by up to two size categories.
```

**Fields:** PARADIGM · TIER (Offline/Online/Special) · SS · ACTIVATION · RANGE · TARGET · COMPONENT.

---

## Genus

```
# Vector Swing
| Specification | Value |
|---|---|
| TYPE | Genus |
| DOMAIN | Kinetic |
| SS | 1 |
| ACTIVATION | Active (15 sec) |
| RANGE | Self |
| TARGET | Self — next melee strike |
| LIMIT | Unlimited (cannot stack with Enhanced Strike) |

Effect: The next melee attack deals +1 damage die of the weapon's type and ignores 2 points of
physical damage reduction; if it triggers knock-back, distance is doubled.
```

**Fields:** DOMAIN (Kinetic/Eldritch/Elemental/Neutral/Null) · SS · ACTIVATION · RANGE · TARGET · LIMIT.

---

## Creature (bestiary — VTT)

Creatures span **6 Classes**, each with its own stat block and HP/DR math. You author the **raw stats**
and the app derives HP, DR, special flags, and token size. These pages feed the VTT **Summon · Bestiary**
sidebar (offline — read straight from the Codex, no wiki) where the GM drags a creature onto the map.

**Every creature page needs:** `TYPE: Creature` and either **CLASS** (1–6) or **ARCHIVE** (the class name —
CLASS is inferred from it). Optional everywhere: **KEYWORDS** (comma list) and **TRAITS** (a one-line
summary). Add **## Abilities** (`- **Name** — effect` bullets) and **## Lore**. Any numeric stat you
list becomes a **check button** on the token; stat words ("WIL check") and dice ("2d8") inside Traits/
Abilities/Lore also become roll buttons. The class-specific stats below are what drive **HP/DR**:

| Class | Archive | Stats that drive HP | HP formula | DR |
|---|---|---|---|---|
| 1 | Standard | OFF DEF SPD WIL + **RANK** | ⌊(OFF+DEF+SPD+WIL)/4⌋ × rank — Grunt 5 · Operative 10 · Elite 15 · Boss 25 | — |
| 2 | Anima | DEF + **TIER** (+ANCHOR) | DEF × (Nascent 5 · Manifested 10 · Apex 20) | Apex ⌊DEF/4⌋+2 · Manifested ⌊DEF/4⌋ · else 0 |
| 3 | Alter Anima | CON DEF + **CL** | ⌊CON/4⌋×10 + DEF×5 | — |
| 4 | Fractures | PHY END | PHY×5 + ⌊END/4⌋×15 | — (size 2) |
| 5 | Doxa | WIL INT + **HP** (facade) | HP if set, else collapse = WIL×8 + ⌊INT/4⌋×12 | — |
| 6 | Nyvilum | **CHP** | CHP (colossal pool) | — (size 6) |

Modifier = ⌊stat ÷ 4⌋. Override the default token size any time with a `SIZE` field (in grid cells).

### Class 1 — Standard  (full example)

```
# Sable Enforcer
| Field | Value |
|---|---|
| TYPE | Creature |
| CLASS | 1 |
| ARCHIVE | Standard |
| RANK | Elite |
| OFF | 14 |
| DEF | 12 |
| SPD | 10 |
| WIL | 8 |
| KEYWORDS | Syndicate, Human |
| TRAITS | Trained marksman; flanks in pairs |

## Abilities
- **Suppressing Fire** — 30 ft line; targets make a SPD check or lose their reaction.
- **Execute** — Melee; deal 2d8 to a target below half HP.

## Lore
Corporate security cleaners who work the CAS underlevels.
```
→ HP ⌊(14+12+10+8)/4⌋ × 15 = **165**, DR 0, size 1.

### Class 2 — Anima  (TIER + ANCHOR)

```
# Envy, Manifested
| Field | Value |
|---|---|
| TYPE | Creature |
| ARCHIVE | Anima |
| TIER | Apex |
| ANCHOR | A stolen crown |
| DEF | 16 |
| WIL | 20 |

## Abilities
- **Covet** — WIL save or the target's highest stat is mirrored onto Envy for 3 turns.
```
→ Apex: HP 16 × 20 = **320**, DR ⌊16/4⌋+2 = **6**. Always flagged *immune to psychic/emotional manipulation*.

### Class 3 — Alter Anima  (CL = corruption level)

```
# Hollow Envoy
| Field | Value |
|---|---|
| TYPE | Creature |
| ARCHIVE | Alter Anima |
| CL | 3 |
| CON | 12 |
| DEF | 9 |
```
→ HP ⌊12/4⌋×10 + 9×5 = **75**. At **CL 3+** it's flagged *human modifiers degraded*.

### Class 4 — Fractures  ·  Class 5 — Doxa (facade→collapse)  ·  Class 6 — Nyvilum (CHP)

```
# The Smiling Neighbor          # Sky-Devourer
| Field | Value |               | Field | Value |
|---|---|                       |---|---|
| TYPE | Creature |             | TYPE | Creature |
| ARCHIVE | Doxa |              | ARCHIVE | Nyvilum |
| HP | 40 |    (facade)         | CHP | 900 |
| WIL | 14 |
| INT | 12 |
```
Doxa → facade **40**, collapse WIL×8 + ⌊INT/4⌋×12 = **148** (flagged *facade collapses on crit / shock / Null*).
Nyvilum → **900** CHP, size 6, flagged *colossal* + *regional Tech Level −2.0*. Fractures just need PHY + END.
