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

// The four "vitals" — Health, DHP, Movement, Synaptic Space — pulled out of the
// derived grid into prominent D&D-Beyond-style tiles. A small "+N" badge shows how
// much the currently-equipped gear/loadout contributes to each.
export function CharacterVitals({ derived, derivedBase, ssSpent }: Props) {
  const currentSS = derived.ss - ssSpent;
  const tiles = [
    { key: "hp", label: "Health", value: `${derived.hpMax}`, delta: derived.hpMax - derivedBase.hpMax, accent: "hp" },
    { key: "dhp", label: "Def. HP", value: signedMod(derived.dhp), delta: derived.dhp - derivedBase.dhp, accent: "dhp" },
    { key: "mv", label: "Movement", value: `${derived.mv}`, delta: derived.mv - derivedBase.mv, accent: "mv" },
    { key: "ss", label: "Synaptic Space", value: `${currentSS} / ${derived.ss}`, delta: derived.ss - derivedBase.ss, accent: "ss" },
  ];
  return (
    <div className="vitals-bar">
      {tiles.map((t) => (
        <div className={"vital-tile vital-" + t.accent} key={t.key}>
          <div className="vital-label">{t.label}</div>
          <div className="vital-value">{t.value}</div>
          {t.delta !== 0 && (
            <div className={"vital-gear" + (t.delta < 0 ? " neg" : "")} title="Contribution from equipped gear / loadout">
              {signedMod(t.delta)} gear
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
