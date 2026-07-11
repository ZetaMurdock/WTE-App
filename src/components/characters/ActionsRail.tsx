import { useState } from "react";
import { Collapsible } from "../ui/Collapsible";
import { usableGenus, usableCiphers, usableRacial, type UsableAbility } from "../../game/wte";
import { getWeapon, weaponDomainsMet } from "../../lib/codex";
import type { Weapon } from "../../models/codex";

interface Props {
  paradigmId?: string;
  speciesId?: string;
  variantName?: string;
  variantOption?: string;
  genusLoadout: string[];
  cipherLoadout: string[];
  weaponLoadout: string[];
  maxSS: number;
  ssSpent: number;
  onSpend: (cost: number) => void;
  onRest: () => void;
  onRoll: (label: string) => void;
}

type Active =
  | { kind: "ability"; ability: UsableAbility; spent: number }
  | { kind: "weapon"; weapon: Weapon };

export function ActionsRail({
  paradigmId,
  speciesId,
  variantName,
  variantOption,
  genusLoadout,
  cipherLoadout,
  weaponLoadout,
  maxSS,
  ssSpent,
  onSpend,
  onRest,
  onRoll,
}: Props) {
  const [active, setActive] = useState<Active | null>(null);
  const [target, setTarget] = useState("");
  const [ocOpen, setOcOpen] = useState(false);

  const currentSS = maxSS - ssSpent;
  const genus = usableGenus(paradigmId, genusLoadout);
  const ciphers = usableCiphers(paradigmId, cipherLoadout);
  const racial = usableRacial(speciesId, variantName, variantOption);
  const weapons = weaponLoadout.map((n) => getWeapon(n)).filter((w): w is Weapon => !!w);
  const activeWeapon = active?.kind === "weapon" ? active.weapon : null;
  const weaponDomainOk = activeWeapon ? weaponDomainsMet(activeWeapon.domain, paradigmId) : false;

  function useAbility(ab: UsableAbility) {
    if (ab.ss > 0) onSpend(ab.ss);
    setActive({ kind: "ability", ability: ab, spent: ab.ss });
    setTarget("");
    setOcOpen(false);
  }
  function useWeapon(w: Weapon) {
    setActive({ kind: "weapon", weapon: w });
    setTarget("");
    setOcOpen(false);
  }

  function abilityRow(ab: UsableAbility, i: number) {
    return (
      <button key={ab.source + ab.name + i} className="use-row" onClick={() => useAbility(ab)}>
        <span className="use-name">{ab.name}</span>
        {ab.ss > 0 ? <span className="ss-badge">{ab.ss} SS</span> : null}
        <span className="use-go">Use</span>
      </button>
    );
  }

  const pct = maxSS > 0 ? Math.max(0, Math.min(100, (currentSS / maxSS) * 100)) : 0;
  const rollLabel = (name: string) => onRoll(`${name}${target ? " → " + target : ""}`);

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

      {active?.kind === "ability" && (
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
          <input className="bg-select full" placeholder="Target…" value={target} onChange={(e) => setTarget(e.target.value)} />
          <div className="resolve-actions">
            <button className="roll-btn" onClick={() => rollLabel(active.ability.name)}>Roll d20</button>
            <button className="ghost-btn" onClick={() => setActive(null)}>Clear</button>
          </div>
        </div>
      )}

      {activeWeapon && (
        <div className="resolve-card">
          <div className="resolve-head">
            <span className="resolve-name">{activeWeapon.name}</span>
            <span className="resolve-src">weapon</span>
          </div>
          {activeWeapon.effect ? <p className="resolve-effect">{activeWeapon.effect}</p> : null}
          <div className="resolve-meta">
            {activeWeapon.damage ? <span>Damage · {activeWeapon.damage}</span> : null}
            {activeWeapon.range ? <span>Range · {activeWeapon.range}</span> : null}
          </div>
          <input className="bg-select full" placeholder="Target…" value={target} onChange={(e) => setTarget(e.target.value)} />
          {activeWeapon.ede && activeWeapon.overclock ? (
            weaponDomainOk ? (
              <div className="overclock-block">
                <button className="chip accent" onClick={() => setOcOpen((o) => !o)}>
                  {ocOpen ? "Hide Overclock" : "Overclock"}
                </button>
                {ocOpen ? <p className="resolve-effect oc">{activeWeapon.overclock.text}</p> : null}
              </div>
            ) : (
              <div className="oc-locked">Overclock locked — needs {activeWeapon.domain}</div>
            )
          ) : null}
          <div className="resolve-actions">
            <button className="roll-btn" onClick={() => rollLabel(`${activeWeapon.name} attack`)}>Roll d20</button>
            <button className="ghost-btn" onClick={() => setActive(null)}>Clear</button>
          </div>
        </div>
      )}

      {weapons.length > 0 && (
        <Collapsible defaultOpen title={`Weapons (${weapons.length})`}>
          <div className="use-list">
            {weapons.map((w) => (
              <button key={w.name} className="use-row" onClick={() => useWeapon(w)}>
                <span className="use-name">{w.name}</span>
                {w.damage ? <span className="ss-badge">{w.damage}</span> : null}
                <span className="use-go">Use</span>
              </button>
            ))}
          </div>
        </Collapsible>
      )}

      <Collapsible defaultOpen title={`Genus (${genus.length})`}>
        <div className="use-list">{genus.length ? genus.map(abilityRow) : <p className="list-empty">None in loadout.</p>}</div>
      </Collapsible>
      <Collapsible defaultOpen title={`Ciphers (${ciphers.length})`}>
        <div className="use-list">{ciphers.length ? ciphers.map(abilityRow) : <p className="list-empty">None in loadout.</p>}</div>
      </Collapsible>
      <Collapsible title={`Racial (${racial.length})`}>
        <div className="use-list">{racial.length ? racial.map(abilityRow) : <p className="list-empty">No racial abilities.</p>}</div>
      </Collapsible>
    </div>
  );
}
