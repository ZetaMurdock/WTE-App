import {
  DERIVED,
  CORE_DERIVED,
  computeDerived,
  bgBonuses,
  bgSpecBonuses,
  aggregateEquip,
  signedMod,
  type Attributes,
  type Specialties,
  type Background,
  type EquipmentItem,
  type DerivedKey,
} from "../../game/wte";

interface Props {
  attributes: Attributes;
  specialties: Specialties;
  speciesId?: string;
  rank?: number;
  background?: Background;
  equipment?: EquipmentItem[];
  sizeId?: string;
  /** Polarized Soul position — wires Process/Resonance mechanics into the preview. */
  morality?: number;
  /** Derived keys to omit (e.g. the vitals, shown separately on the sheet). */
  exclude?: DerivedKey[];
  /** Show the Max Health cell (default true). */
  showHp?: boolean;
}

// Live grid of the derived stats + max HP. Core stats (SS / NC / MV) are totals
// (raw × rank); everything else is a MODIFIER from its raw pool. Negative values
// (over-specialized builds) are highlighted as liabilities — no clamp.
export function DerivedPreview({ attributes, specialties, speciesId, rank, background, equipment, sizeId, morality, exclude, showHp = true }: Props) {
  const d = computeDerived(attributes, specialties, {
    speciesId,
    rank,
    bgBonuses: bgBonuses(background),
    bgSpec: bgSpecBonuses(background),
    equip: aggregateEquip(equipment),
    sizeId,
    morality,
  });
  const skip = new Set(exclude ?? []);
  return (
    <div className="derived-grid">
      {DERIVED.filter((stat) => !skip.has(stat.key)).map((stat) => {
        const core = CORE_DERIVED.has(stat.key);
        const v = d[stat.key];
        return (
          <div className="derived-cell" key={stat.key} title={`${stat.label} · raw ${d.raw[stat.key]}`}>
            <div className="derived-label">{stat.short}</div>
            <div className={"derived-val" + (v < 0 ? " neg" : "")}>{core ? v : signedMod(v)}</div>
            <div className="derived-full">{core ? stat.label : `${stat.label} · raw ${d.raw[stat.key]}`}</div>
          </div>
        );
      })}
      {showHp && (
        <div className="derived-cell hp" title="Max Health">
          <div className="derived-label">HP</div>
          <div className="derived-val">{d.hpMax}</div>
          <div className="derived-full">Max Health</div>
        </div>
      )}
    </div>
  );
}
