import { signedMod, type Derived } from "../../game/wte";

type FullDerived = Derived & { hpMax: number };

interface Props {
  /** Derived stats WITH equipment / loadout applied (the authoritative values). */
  derived: FullDerived;
  /** Derived stats WITHOUT equipment, so we can show the gear contribution. */
  derivedBase: FullDerived;
  /** Synaptic Space already spent (current = max − spent). */
  ssSpent: number;
}

const ORBS = 10; // 2 rows of 5 — a symmetrical cluster per vital

/** How many orbs are lit for a value (each orb ≈ `perOrb` points), clamped 0..ORBS. */
function litOrbs(value: number, perOrb: number): number {
  return Math.max(0, Math.min(ORBS, Math.round(value / perOrb)));
}

// Compact, symmetrical vitals — Health / Def. HP / Movement / Synaptic Space —
// each shown as a small orb gauge whose lit orbs fall as the value falls, plus
// the number and a tiny gear-contribution note.
export function CharacterVitals({ derived, derivedBase, ssSpent }: Props) {
  const currentSS = derived.ss - ssSpent;
  const tiles = [
    { key: "hp", label: "Health", num: `${derived.hpMax}`, lit: litOrbs(derived.hpMax, 5), delta: derived.hpMax - derivedBase.hpMax, accent: "hp" },
    { key: "dhp", label: "Def. HP", num: `${derived.dhp}`, lit: litOrbs(derived.dhp, Math.max(1, derived.dhp / ORBS)), delta: derived.dhp - derivedBase.dhp, accent: "dhp" },
    { key: "mv", label: "Movement", num: `${derived.mv}`, lit: litOrbs(derived.mv, 2), delta: derived.mv - derivedBase.mv, accent: "mv" },
    { key: "ss", label: "Syn. Space", num: `${currentSS}/${derived.ss}`, lit: litOrbs(currentSS, Math.max(1, derived.ss / ORBS)), delta: derived.ss - derivedBase.ss, accent: "ss" },
  ];
  return (
    <div className="vitals-bar">
      {tiles.map((t) => (
        <div className={"vital-cell vital-" + t.accent} key={t.key}>
          <span className="vital-cap">{t.label}</span>
          <div className="vital-orbs" aria-label={`${t.lit} of ${ORBS}`}>
            {Array.from({ length: ORBS }).map((_, i) => (
              <span key={i} className={"vorb" + (i < t.lit ? " on" : "")} />
            ))}
          </div>
          <span className="vital-num">
            {t.num}
            {t.delta !== 0 && <em className={"vital-delta" + (t.delta < 0 ? " neg" : "")}>{signedMod(t.delta)}</em>}
          </span>
        </div>
      ))}
    </div>
  );
}
