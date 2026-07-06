# Derived Statistics

**Derived Statistics** determine your Inquisitor's core survivability and action capability in combat. They auto-scale based on raw Attributes and are subsequently reduced by your Specialty training choices.

---

### Basic Formula
All derived stats start with a base value of **5**, plus values from contributing attributes:
$$\text{Base} = 5 + \text{Contributing Attributes}$$

For every **10 points** in this base value, a scaling factor of **+2** is added.
Finally, the value is reduced by specific [Specialties](wte://rules/Specialties):
$$\text{Final Score} = \text{Base} + 2 \times \lfloor \frac{\text{Base}}{10} \rfloor - \lfloor \frac{\text{Specialty Pts}}{3} \rfloor$$

---

### The Ten Derived Statistics

1.  **Attack Power:** Combat hit potential and damage output.
2.  **Def. Hit Points (DHP):** Defensive shields/damage reduction buffer.
3.  **Movement:** Distance (in cells) a token can travel per action.
4.  **Synaptic Space (SS):** Memory capacity for holding ciphers or focus abilities.
5.  **Evasion:** Difficulty for enemies to land hits on you.
6.  **Neuronal Capacity:** Max cognitive operations active simultaneously.
7.  **Recovery Rate:** Hit points restored during a recovery window or break.
8.  **Action Density:** How many actions can be performed per turn.
9.  **Influence:** Range and strength of Charisma-based operations.
10. **Perception Range:** Dynamic visibility radius on the VTT map.
