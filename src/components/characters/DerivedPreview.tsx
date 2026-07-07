import { DERIVED, computeDerived, type Attributes, type Specialties } from "../../game/wte";

interface Props {
  attributes: Attributes;
  specialties: Specialties;
  speciesId?: string;
}

// Live grid of the 10 derived stats + max HP. Negative values (over-specialized builds)
// are highlighted as liabilities, matching the legacy sheet's "no clamp" behaviour.
export function DerivedPreview({ attributes, specialties, speciesId }: Props) {
  const d = computeDerived(attributes, specialties, speciesId);
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
