import { useState } from "react";
import { SidePanel } from "../ui/SidePanel";
import { Collapsible } from "../ui/Collapsible";
import { SIZE_CLASSES, WEIGHT_CATS, sizeOf, sizeIndexOf, type EquipmentItem, type WeightKey } from "../../game/wte";
import { listWeapons, listEquipment, getWeapon, weaponSlotCost } from "../../lib/codex";
import type { Weapon, Equipment } from "../../models/codex";

interface Props {
  open: boolean;
  onClose: () => void;
  speciesId?: string;
  paradigmId?: string;
  sizeId?: string;
  equipment?: EquipmentItem[];
  weaponLoadout: string[];
  gearLoadout: string[];
  maxNC: number;
  ncUsed: number;
  slotsUsed: number;
  slotsMax: number;
  curator: boolean;
  onSize: (sizeId: string) => void;
  onEquipment: (items: EquipmentItem[]) => void;
  onWeapons: (names: string[]) => void;
  onGear: (names: string[]) => void;
}

function newItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "eq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function EquipmentPanel(props: Props) {
  const { open, onClose, speciesId, sizeId, equipment, weaponLoadout, gearLoadout, maxNC, ncUsed, slotsUsed, slotsMax, curator, onSize, onEquipment, onWeapons, onGear } = props;
  const [wSearch, setWSearch] = useState("");
  const [gSearch, setGSearch] = useState("");
  const [gCat, setGCat] = useState("All");

  const items = equipment ?? [];
  const size = sizeOf(sizeId, speciesId);
  const sizeIdx = sizeIndexOf(sizeId, speciesId);
  const manualUsed = items.reduce((s, it) => s + (it.equipped ? WEIGHT_CATS.find((w) => w.key === it.weight)?.cost ?? 0 : 0), 0);
  const ncOver = ncUsed > maxNC;
  const slotsOver = slotsUsed > slotsMax;

  const weapons = listWeapons().filter((w) => w.name.toLowerCase().includes(wSearch.toLowerCase()));
  const gearCats = ["All", ...Array.from(new Set(listEquipment().map((g) => g.category || "Other")))];
  const gear = listEquipment().filter(
    (g) => (gCat === "All" || (g.category || "Other") === gCat) && g.name.toLowerCase().includes(gSearch.toLowerCase())
  );

  function toggleWeapon(name: string) {
    if (weaponLoadout.includes(name)) onWeapons(weaponLoadout.filter((n) => n !== name));
    else if (slotsUsed + weaponSlotCost(getWeapon(name)?.weight) <= slotsMax) onWeapons([...weaponLoadout, name]);
  }
  function toggleGear(name: string) {
    if (gearLoadout.includes(name)) onGear(gearLoadout.filter((n) => n !== name));
    else onGear([...gearLoadout, name]);
  }

  // manual custom items
  function update(id: string, patch: Partial<EquipmentItem>) {
    onEquipment(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function addItem() {
    onEquipment([...items, { id: newItemId(), name: "", weight: "standard", equipped: true, mods: "", notes: "" }]);
  }
  function removeItem(id: string) {
    onEquipment(items.filter((it) => it.id !== id));
  }

  function weaponRow(w: Weapon) {
    const equipped = weaponLoadout.includes(w.name);
    const cost = weaponSlotCost(w.weight);
    const blocked = !equipped && slotsUsed + cost > slotsMax;
    return (
      <button key={w.name} className={"use-row" + (equipped ? " selected" : "")} disabled={!curator || blocked} onClick={() => toggleWeapon(w.name)}>
        <span className="ability-check">{equipped ? "✓" : "+"}</span>
        <span className="use-name">{w.name}</span>
        {w.damage ? <span className="ss-badge">{w.damage}</span> : null}
        <span className="ss-badge">{w.ncCost ?? 0} NC</span>
        {w.domain ? <span className="ss-badge">{w.domain}</span> : null}
      </button>
    );
  }
  function gearRow(g: Equipment) {
    const equipped = gearLoadout.includes(g.name);
    return (
      <button key={g.name} className={"use-row" + (equipped ? " selected" : "")} disabled={!curator} onClick={() => toggleGear(g.name)}>
        <span className="ability-check">{equipped ? "✓" : "+"}</span>
        <span className="use-name">{g.name}</span>
        {g.mods ? <span className="use-mods">{g.mods}</span> : null}
        <span className="ss-badge">{g.ncCost ?? 0} NC</span>
      </button>
    );
  }

  return (
    <SidePanel open={open} title="Loadout & Size" onClose={onClose}>
      {!curator && <p className="lock-note">Loadout is Curator-controlled — view only.</p>}

      <div className={"nc-budget" + (ncOver ? " over" : "")}>
        Neuronal Capacity · {ncUsed} / {maxNC}
        {ncOver ? " · overloaded" : ""}
      </div>

      <Collapsible defaultOpen title={`Weapons · ${slotsUsed} / ${slotsMax} slots`}>
        <div className="browse">
          <input className="bg-select full" placeholder="Search weapons…" value={wSearch} onChange={(e) => setWSearch(e.target.value)} />
          {slotsOver ? <div className="equip-warn">Over weapon-slot limit.</div> : null}
          <div className="use-list">{weapons.map(weaponRow)}</div>
        </div>
      </Collapsible>

      <Collapsible title="Gear">
        <div className="browse">
          <div className="chip-row">
            {gearCats.map((c) => (
              <button key={c} className={"chip" + (gCat === c ? " active" : "")} onClick={() => setGCat(c)}>
                {c}
              </button>
            ))}
          </div>
          <input className="bg-select full" placeholder="Search gear…" value={gSearch} onChange={(e) => setGSearch(e.target.value)} />
          <div className="use-list">{gear.map(gearRow)}</div>
        </div>
      </Collapsible>

      <Collapsible title="Size">
        <div className="browse">
          <select className="bg-select full" value={sizeId || "auto"} disabled={!curator} onChange={(e) => onSize(e.target.value)}>
            <option value="auto">Auto · {sizeOf("auto", speciesId).label}</option>
            {SIZE_CLASSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="size-readout">
            <span>Budget {size.budget}</span>
            <span>Reach {size.reach} ft</span>
            <span>Move {size.move} ft</span>
          </div>
          <div className="size-note">{size.note}</div>
        </div>
      </Collapsible>

      <Collapsible title={`Custom items · ${manualUsed} / ${size.budget}`}>
        <div className="browse">
          {items.length === 0 ? (
            <p className="list-empty">No custom items.</p>
          ) : (
            items.map((it) => {
              const wc = WEIGHT_CATS.find((w) => w.key === it.weight);
              const tooBig = wc ? wc.minSize > sizeIdx : false;
              return (
                <div className="equip-fields" key={it.id}>
                  <input className="bg-select full" placeholder="Item name" value={it.name} disabled={!curator} onChange={(e) => update(it.id, { name: e.target.value })} />
                  <div className="equip-row2">
                    <select className="bg-select" value={it.weight} disabled={!curator} onChange={(e) => update(it.id, { weight: e.target.value as WeightKey })}>
                      {WEIGHT_CATS.map((w) => (
                        <option key={w.key} value={w.key}>
                          {w.label} · {w.cost}
                        </option>
                      ))}
                    </select>
                    <label className="equip-eq">
                      <input type="checkbox" checked={it.equipped} disabled={!curator} onChange={(e) => update(it.id, { equipped: e.target.checked })} /> Equipped
                    </label>
                  </div>
                  <input className="bg-select full" placeholder="Mods · e.g. DEX +2, DHP +3" value={it.mods} disabled={!curator} onChange={(e) => update(it.id, { mods: e.target.value })} />
                  {tooBig ? <div className="equip-warn">Too heavy for your size — needs {SIZE_CLASSES[wc!.minSize].label}+.</div> : null}
                  {curator ? <button className="icon-btn" onClick={() => removeItem(it.id)}>Remove</button> : null}
                </div>
              );
            })
          )}
          {curator ? <button className="primary-btn full mt" onClick={addItem}>Add custom item</button> : null}
        </div>
      </Collapsible>
    </SidePanel>
  );
}
