import { useState } from "react";
import { Collapsible } from "../ui/Collapsible";
import { usableGenus, usableCiphers, usableRacial, type UsableAbility } from "../../game/wte";

interface Props {
  paradigmId?: string;
  speciesId?: string;
  variantName?: string;
  variantOption?: string;
  genusLoadout: string[];
  cipherLoadout: string[];
  maxSS: number;
  ssSpent: number;
  onSpend: (cost: number) => void;
  onRest: () => void;
  onRoll: (label: string) => void;
}

interface Active {
  ability: UsableAbility;
  spent: number;
}

export function ActionsRail({
  paradigmId,
  speciesId,
  variantName,
  variantOption,
  genusLoadout,
  cipherLoadout,
  maxSS,
  ssSpent,
  onSpend,
  onRest,
  onRoll,
}: Props) {
  const [active, setActive] = useState<Active | null>(null);
  const [target, setTarget] = useState("");

  const currentSS = maxSS - ssSpent;
  const genus = usableGenus(paradigmId, genusLoadout);
  const ciphers = usableCiphers(paradigmId, cipherLoadout);
  const racial = usableRacial(speciesId, variantName, variantOption);

  function use(ab: UsableAbility) {
    if (ab.ss > 0) onSpend(ab.ss);
    setActive({ ability: ab, spent: ab.ss });
    setTarget("");
  }

  function row(ab: UsableAbility, i: number) {
    return (
      <button key={ab.source + ab.name + i} className="use-row" onClick={() => use(ab)}>
        <span className="use-name">{ab.name}</span>
        {ab.ss > 0 ? <span className="ss-badge">{ab.ss} SS</span> : null}
        <span className="use-go">Use</span>
      </button>
    );
  }

  const pct = maxSS > 0 ? Math.max(0, Math.min(100, (currentSS / maxSS) * 100)) : 0;

  return (
    <div className="actions-rail">
      <div className="ss-bar">
        <div className="ss-line">
          <span className="ss-lbl">Synaptic Space</span>
          <span className={"ss-val" + (currentSS < 0 ? " neg" : "")}>
            {currentSS} / {maxSS}
          </span>
        </div>
        <div className="ss-track">
          <div className={"ss-fill" + (currentSS < 0 ? " neg" : "")} style={{ width: `${pct}%` }} />
        </div>
        <button className="ghost-btn ss-rest" onClick={onRest}>
          Rest
        </button>
      </div>

      {active && (
        <div className="resolve-card">
          <div className="resolve-head">
            <span className="resolve-name">{active.ability.name}</span>
            <span className="resolve-src">{active.ability.source}</span>
          </div>
          {active.spent > 0 ? <div className="resolve-cost">−{active.spent} SS</div> : null}
          {active.ability.effect ? <p className="resolve-effect">{active.ability.effect}</p> : null}
          <div className="resolve-meta">
            {active.ability.range ? <span>Range · {active.ability.range}</span> : null}
            {active.ability.target ? <span>Target · {active.ability.target}</span> : null}
            {active.ability.activation ? <span>Activation · {active.ability.activation}</span> : null}
          </div>
          <input
            className="bg-select full"
            placeholder="Target…"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <div className="resolve-actions">
            <button
              className="roll-btn"
              onClick={() => onRoll(`${active.ability.name}${target ? " → " + target : ""}`)}
            >
              Roll d20
            </button>
            <button className="ghost-btn" onClick={() => setActive(null)}>
              Clear
            </button>
          </div>
        </div>
      )}

      <Collapsible defaultOpen title={`Genus (${genus.length})`}>
        <div className="use-list">
          {genus.length ? genus.map(row) : <p className="list-empty">None in loadout.</p>}
        </div>
      </Collapsible>
      <Collapsible defaultOpen title={`Ciphers (${ciphers.length})`}>
        <div className="use-list">
          {ciphers.length ? ciphers.map(row) : <p className="list-empty">None in loadout.</p>}
        </div>
      </Collapsible>
      <Collapsible title={`Racial (${racial.length})`}>
        <div className="use-list">
          {racial.length ? racial.map(row) : <p className="list-empty">No racial abilities.</p>}
        </div>
      </Collapsible>
    </div>
  );
}
