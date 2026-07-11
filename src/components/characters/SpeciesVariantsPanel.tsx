import { Collapsible } from "../ui/Collapsible";
import { getSpecies } from "../../game/wte";

interface Props {
  speciesId?: string;
  selected?: string;
  curator: boolean;
  onSelect: (name: string | undefined) => void;
}

// Species lineage variants. Rendered inline inside the sheet's "Bio" tab.
export function SpeciesVariantsBody({ speciesId, selected, curator, onSelect }: Props) {
  const species = getSpecies(speciesId);
  const variants = species?.variants ?? [];

  if (!species) return <p className="list-empty">Choose a species first to see its lineage variants.</p>;
  if (variants.length === 0) return <p className="list-empty">{species.name} has no lineage variants.</p>;

  return (
    <div className="variant-list">
      <div className="variant-species">{species.name} lineages</div>
      {!curator && <p className="lock-note">Variant is permanent — only the Curator can change it.</p>}
      {variants.map((v) => (
        <Collapsible
          key={v.name}
          defaultOpen={v.name === selected}
          title={
            <span className="variant-head">
              {v.name}
              {v.name === selected ? <span className="variant-chosen">Selected</span> : null}
            </span>
          }
          right={
            !curator ? null : v.name === selected ? (
              <button className="icon-btn" onClick={() => onSelect(undefined)}>
                Clear
              </button>
            ) : (
              <button className="icon-btn accent" onClick={() => onSelect(v.name)}>
                Select
              </button>
            )
          }
        >
          {v.note ? <p className="variant-note">{v.note}</p> : null}
          <ul className="variant-abilities">
            {v.abilities.map((a, i) => (
              <li key={i}>
                <b>{a.name}</b> — {a.effect}
              </li>
            ))}
          </ul>
        </Collapsible>
      ))}
    </div>
  );
}
