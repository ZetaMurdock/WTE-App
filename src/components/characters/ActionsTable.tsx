import { useState } from "react";
import { rollToHit, rollGeneric, signedMod, type UsableAbility, type RollResult } from "../../game/wte";
import { isRangedWeapon, weaponDomainsMet } from "../../lib/codex";
import type { Weapon } from "../../models/codex";
import { RollButton } from "./RollButton";

type Cat = "attack" | "genus" | "cipher";
type Row =
  | { kind: "weapon"; cat: "attack"; key: string; w: Weapon }
  | { kind: "ability"; cat: "genus" | "cipher"; key: string; a: UsableAbility };

interface Props {
  weapons: Weapon[];
  genus: UsableAbility[];
  ciphers: UsableAbility[];
  atk: number;
  phyMod: number;
  dexMod: number;
  paradigmId?: string;
  onRoll: (roll: RollResult) => void;
  onSpend: (cost: number) => void;
  onManage: () => void;
}

const FILTERS: { id: "all" | Cat; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attack", label: "Attack" },
  { id: "genus", label: "Genus" },
  { id: "cipher", label: "Cipher" },
];

// The unified combat surface: equipped weapons + genus + ciphers as one filterable table.
export function ActionsTable({ weapons, genus, ciphers, atk, phyMod, dexMod, paradigmId, onRoll, onSpend, onManage }: Props) {
  const [filter, setFilter] = useState<"all" | Cat>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [ocOpen, setOcOpen] = useState(false);

  const rows: Row[] = [
    ...weapons.map((w) => ({ kind: "weapon" as const, cat: "attack" as const, key: "w:" + w.name, w })),
    ...genus.map((a) => ({ kind: "ability" as const, cat: "genus" as const, key: "g:" + a.name, a })),
    ...ciphers.map((a) => ({ kind: "ability" as const, cat: "cipher" as const, key: "c:" + a.name, a })),
  ];
  const shown = rows.filter((r) => filter === "all" || r.cat === filter);

  function hitOf(w: Weapon): number {
    return atk + (isRangedWeapon(w) ? dexMod : phyMod);
  }
  function toggle(key: string) {
    setOcOpen(false);
    setOpen((k) => (k === key ? null : key));
  }

  function weaponRow(w: Weapon, key: string) {
    const hit = hitOf(w);
    const expanded = open === key;
    const domainOk = weaponDomainsMet(w.domain, paradigmId);
    return (
      <div className={"act-row-wrap" + (expanded ? " open" : "")} key={key}>
        <button className="act-row" onClick={() => toggle(key)}>
          <span className="act-name">
            <span className="act-title">{w.name}</span>
            <span className="act-sub">{isRangedWeapon(w) ? "Ranged" : "Melee"}{w.domain ? " · " + w.domain : ""}</span>
          </span>
          <span className="act-range">{w.range || (isRangedWeapon(w) ? "Ranged" : "5 ft")}</span>
          <span className="act-hit">{signedMod(hit)}</span>
          <span className="act-dmg">{w.damage || "—"}</span>
          <span className="act-notes">{w.effect || "—"}</span>
        </button>
        {expanded && (
          <div className="act-detail">
            {w.effect && <p className="act-effect">{w.effect}</p>}
            {w.ede && w.overclock ? (
              domainOk ? (
                <div className="overclock-block">
                  <button className="chip accent" onClick={() => setOcOpen((o) => !o)}>{ocOpen ? "Hide Overclock" : "Overclock"}</button>
                  {ocOpen && <p className="act-effect oc">{w.overclock.text}</p>}
                </div>
              ) : (
                <div className="oc-locked">Overclock locked — needs {w.domain}</div>
              )
            ) : null}
            <div className="act-actions">
              <RollButton className="roll-btn" make={() => rollToHit(`${w.name} attack`, hit)} onLocal={onRoll}>
                Roll d20 {signedMod(hit)}
              </RollButton>
            </div>
          </div>
        )}
      </div>
    );
  }

  function abilityRow(a: UsableAbility, cat: Cat, key: string) {
    const expanded = open === key;
    return (
      <div className={"act-row-wrap" + (expanded ? " open" : "")} key={key}>
        <button className="act-row" onClick={() => toggle(key)}>
          <span className="act-name">
            <span className="act-title">{a.name}</span>
            <span className="act-sub">{cat === "genus" ? "Genus" : "Cipher"}{a.ss ? " · " + a.ss + " SS" : ""}</span>
          </span>
          <span className="act-range">{a.range || "Self"}</span>
          <span className="act-hit">—</span>
          <span className="act-dmg">{a.ss ? a.ss + " SS" : "—"}</span>
          <span className="act-notes">{a.effect || "—"}</span>
        </button>
        {expanded && (
          <div className="act-detail">
            {a.effect && <p className="act-effect">{a.effect}</p>}
            <div className="act-meta">
              {a.target ? <span>Target · {a.target}</span> : null}
              {a.activation ? <span>Activation · {a.activation}</span> : null}
            </div>
            <div className="act-actions">
              {a.ss > 0 ? <button className="ghost-btn" onClick={() => onSpend(a.ss)}>Use −{a.ss} SS</button> : null}
              <RollButton className="roll-btn" make={() => rollGeneric(a.name)} onLocal={onRoll}>Roll d20</RollButton>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="act-table">
      <div className="act-toolbar">
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button key={f.id} className={"chip" + (filter === f.id ? " active" : "")} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="link-btn" onClick={onManage}>Manage loadout</button>
      </div>

      {shown.length === 0 ? (
        <p className="list-empty">No actions here — equip weapons or abilities in Loadout.</p>
      ) : (
        <>
          <div className="act-head">
            <span>Name</span><span>Range</span><span>Hit</span><span>Damage</span><span>Notes</span>
          </div>
          {shown.map((r) => (r.kind === "weapon" ? weaponRow(r.w, r.key) : abilityRow(r.a, r.cat, r.key)))}
        </>
      )}
    </div>
  );
}
