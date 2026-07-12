import {
  DERIVED,
  CORE_DERIVED,
  computeDerived,
  bgBonuses,
  aggregateEquip,
  sizeOf,
  signedMod,
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

// Live grid of the derived stats + max HP. Core stats (SS / NC / MV) are totals
// (raw × rank); everything else is a MODIFIER from its raw pool. Negative values
// (over-specialized builds) are highlighted as liabilities — no clamp.
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
      {DERIVED.map((stat) => {
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
      <div className="derived-cell hp" title="Max Health">
        <div className="derived-label">HP</div>
        <div className="derived-val">{d.hpMax}</div>
        <div className="derived-full">Max Health</div>
      </div>
    </div>
  );
}
