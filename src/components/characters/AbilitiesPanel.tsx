import { Collapsible } from "../ui/Collapsible";
import {
  genusForParadigm,
  ciphersForParadigm,
  CIPHER_TIERS,
  genusSlots,
  cipherSlots,
  getParadigm,
} from "../../game/wte";

interface Props {
  paradigmId?: string;
  rank: number;
  genusLoadout: string[];
  cipherLoadout: string[];
  onGenus: (names: string[]) => void;
  onCiphers: (names: string[]) => void;
}

// Genus + Cipher selection. Rendered inline as the sheet's "Abilities" tab.
export function AbilitiesBody({ paradigmId, rank, genusLoadout, cipherLoadout, onGenus, onCiphers }: Props) {
  const paradigm = getParadigm(paradigmId);
  const genusGroups = genusForParadigm(paradigmId);
  const ciphers = ciphersForParadigm(paradigmId);
  const gCap = genusSlots(rank);
  const cCap = cipherSlots(rank);

  function toggleGenus(name: string) {
    if (genusLoadout.includes(name)) onGenus(genusLoadout.filter((n) => n !== name));
    else if (genusLoadout.length < gCap) onGenus([...genusLoadout, name]);
  }
  function toggleCipher(name: string) {
    if (cipherLoadout.includes(name)) onCiphers(cipherLoadout.filter((n) => n !== name));
    else if (cipherLoadout.length < cCap) onCiphers([...cipherLoadout, name]);
  }

  function abilityRow(name: string, ss: number | null, selected: boolean, atCap: boolean, onToggle: () => void) {
    return (
      <button
        key={name}
        className={"ability-row" + (selected ? " selected" : "")}
        disabled={!selected && atCap}
        onClick={onToggle}
      >
        <span className="ability-check">{selected ? "✓" : "+"}</span>
        <span className="ability-name">{name}</span>
        <span className="ss-badge">{ss == null ? "—" : ss} SS</span>
      </button>
    );
  }

  if (!paradigm) {
    return <p className="list-empty">Choose a paradigm first to access Genus & Ciphers.</p>;
  }

  const byTier = CIPHER_TIERS.map((t) => ({ tier: t as string, list: ciphers.filter((c) => c.tier === t) })).filter(
    (g) => g.list.length > 0
  );

  return (
    <>
      <div className="aside-title">
        Genus <span className={"load-badge" + (genusLoadout.length > gCap ? " over" : "")}>{genusLoadout.length} / {gCap}</span>
      </div>
      {genusGroups.length === 0 ? (
        <p className="list-empty">No genus available for this paradigm.</p>
      ) : (
        genusGroups.map((g) => (
          <Collapsible key={g.domain} defaultOpen title={`${g.domain} Genus`}>
            <div className="ability-list">
              {g.abilities.map((a) =>
                abilityRow(a.name, a.ss, genusLoadout.includes(a.name), genusLoadout.length >= gCap, () => toggleGenus(a.name))
              )}
            </div>
          </Collapsible>
        ))
      )}

      <div className="aside-title mt">
        Ciphers <span className={"load-badge" + (cipherLoadout.length > cCap ? " over" : "")}>{cipherLoadout.length} / {cCap}</span>
      </div>
      {byTier.length === 0 ? (
        <p className="list-empty">No ciphers available for this paradigm.</p>
      ) : (
        byTier.map((g) => (
          <Collapsible key={g.tier} defaultOpen={g.tier === "offline"} title={`${g.tier[0].toUpperCase()}${g.tier.slice(1)} · ${g.list.length}`}>
            <div className="ability-list">
              {g.list.map((c) =>
                abilityRow(c.name, c.ss, cipherLoadout.includes(c.name), cipherLoadout.length >= cCap, () => toggleCipher(c.name))
              )}
            </div>
          </Collapsible>
        ))
      )}
    </>
  );
}
