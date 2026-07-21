# Derived Statistics

**Derived Statistics** determine your Inquisitor's core survivability and action capability in combat. They auto-scale based on raw Attributes and Specialties, and are reduced by competing Specialty training choices.

---

### Basic Formula
All derived stats start with a base value of **5**, plus values from contributing attributes and specialties:
$$\text{Base} = 5 + \text{Contributing Inputs}$$

For every **10 points** in this base value, a scaling factor of **+2** is added.
Finally, the value is reduced by specific [Specialties](wte://rules/Specialties) — every reduction runs at **−1 per 3 points**:
$$\text{Final Score} = \text{Base} + 2 \times \lfloor \frac{\text{Base}}{10} \rfloor - \lfloor \frac{\text{Specialty Pts}}{3} \rfloor$$

**Rank scaling:** the core pools (SS, NC, MV, DHP) are multiplied by your rank multiplier. The remaining stats convert to a check modifier that only starts compounding with rank once the raw value crosses the mastery line (see Eminence).

---

### The Ten Derived Statistics

Every reduction runs at **−1 per 3 points**. Note the dichotomy: each **attribute**
drags its natural opposite, so no attribute is pure upside — brute stats oppose
finesse/reactive ones, mind opposes body, projection opposes observation.

**1. Attack Power** — physical and ability-based offensive output.
Inputs: Strength, Weight, Weapon Mastery · Reduced by: Precision, Balance, **Intelligence** (brains vs brawn)

**2. Defensive Hit Points (DHP)** — the outer health layer, absorbed before HP. Regenerates faster than HP.
Inputs: Weight, Endurance · Reduced by: Balance, Precision, **Dexterity** (finesse vs mass — the glass cannon)
*Example: END 20 + Weight 25 → DHP 60. Adding Balance 60 drops that to 40 — Balance is not a free dump stat.*

**3. Movement** — distance covered per action during Active Time.
Inputs: Dexterity, Action Priority, Control · Reduced by: Weight, Precision, **Endurance** (mass vs speed)

**4. Synaptic Space** — psionic and Genus capacity: how much energy a character can hold and activate simultaneously.
Inputs: Mental Fortitude, Intelligence, Control · Reduced by: Precision, Weapon Mastery

**5. Evasion** — capacity to avoid incoming attacks and effects.
Inputs: Dexterity, Balance, Cunning · Reduced by: Weight, Mental Fortitude, **Strength** (force vs finesse)

**6. Neuronal Capacity** — mental throughput: limits simultaneous active abilities and cognitive load per AP window.
Inputs: Adaptation, Mental Fortitude, Wisdom, Perception · Reduced by: Control, Weapon Mastery

**7. Recovery Rate** — speed of DHP regeneration and status condition recovery.
Inputs: Endurance, Balance, Adaptation · Reduced by: Weight, Control, Cunning, **Action Priority** (twitch vs rest)

**8. Action Density** — number of sub-actions or bonus actions available per AP window.
Inputs: Action Priority, Precision, Cunning, Control · Reduced by: Weight, Mental Fortitude, **Wisdom** (deliberation vs frenzy)

**9. Influence** — social and command range: social encounters, NPC reactions, leadership mechanics.
Inputs: Charisma, Cunning, Perception, Precision · Reduced by: Adaptation, Weight

**10. Perception Range** — detection range, awareness, and identifying hidden or obscured targets.
Inputs: Wisdom, Perception, Cunning, Balance · Reduced by: Mental Fortitude, **Charisma** (projection vs observation)

---

### Compensation — what a lacking attribute pays back

The dichotomy runs both ways. An attribute **at 10 or above** does nothing but
drag its opposite. An attribute **below 10** pays its opposite back:

$$\text{Compensation} = \left\lfloor \frac{10 - \text{Attribute}}{6} \times \text{Rank Multiplier} \right\rfloor$$

Two rules make this a build decision instead of a free lunch:

*   **It accrues at half the reduction rate.** Reductions run −1 per 3 points;
    compensation runs +1 per 6 points below the pivot. Weakness never pays as
    well as strength costs.
*   **It is gated on training.** You collect nothing unless you are **trained
    (25+)** in a specialty that feeds the receiving stat. A dumped attribute
    with nothing invested opposite it is simply a dumped attribute.

| Attribute | Pays into | Requires training in |
|---|---|---|
| Strength | Evasion | Balance *or* Cunning |
| Dexterity | Defensive HP | Weight |
| Endurance | Movement | Control |
| Action Priority | Recovery Rate | Balance *or* Adaptation |
| Wisdom | Action Density | Precision, Cunning *or* Control |
| Charisma | Perception Range | Perception, Cunning *or* Balance |
| Intelligence | Attack Power | Weight *or* Weapon Mastery |

Compensation lands on the **check**, not the raw pool. A ±2 swing in a raw pool
is invisible at every rank — the conversion moves in blocks of 15 — so the only
place a shaped build can actually feel its payback is the modifier itself.

**Why the gate matters.** Pushing a contributing specialty from 24 to 25 changes
your raw pool by one point, which on its own changes your modifier by nothing at
all. With the gate open it is worth a full point of the receiving stat, at every
rank. That single point is the difference between a number on a sheet and a
number at the table.

**A wall of 20s is not a build.** High attributes keep their full drag. Seven
20s carry the heaviest reduction burden in the system and collect no
compensation anywhere — a character shaped around what they are *for* will
out-perform them on the stats they chose.
