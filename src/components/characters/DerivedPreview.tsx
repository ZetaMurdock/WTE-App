import {
  DERIVED,
  computeDerived,
  bgBonuses,
  aggregateEquip,
  sizeOf,
  type Attributes,
  type Specialties,
  type Background,
  type EquipmentItem,
} from "../../game/wte";

interface Props {
  attributes: Attributes;
  specialties: Specialties;
  speciesId?: string;
  rank?: number;
  background?: Background;
  equipment?: EquipmentItem[];
  sizeId?: string;
}

// Live grid of the 10 derived stats + max HP. Negative values (over-specialized builds)
// are highlighted as liabilities, matching the legacy sheet's "no clamp" behaviour.
export function DerivedPreview({ attributes, specialties, speciesId, rank, background, equipment, sizeId }: Props) {
  const d = computeDerived(attributes, specialties, {
    speciesId,
    rank,
    bgBonuses: bgBonuses(background),
    equip: aggregateEquip(equipment),
    sizeMove: sizeOf(sizeId, speciesId).move,
  });
  return (
    <div className="derived-grid">
      {DERIVED.map((stat) => (
        <div className="derived-cell" key={stat.key} title={stat.label}>
          <div className="derived-label">{stat.short}</div>
          <div className={"derived-val" + (d[stat.key] < 0 ? " neg" : "")}>{d[stat.key]}</div>
          <div className="derived-full">{stat.label}</div>
        </div>
      ))}
      <div className="derived-cell hp" title="Max Health">
        <div className="derived-label">HP</div>
        <div className="derived-val">{d.hpMax}</div>
        <div className="derived-full">Max Health</div>
      </div>
    </div>
  );
}
