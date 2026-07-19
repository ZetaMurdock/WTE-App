import { useState } from "react";
import { Collapsible } from "../ui/Collapsible";
import { SIZE_CLASSES, WEIGHT_CATS, sizeOf, sizeIndexOf, sizeDiffMods, sizeGrapple, signedMod, type EquipmentItem, type WeightKey } from "../../game/wte";
import { listWeapons, listEquipment, getWeapon, getEquipment, weaponSlotCost } from "../../lib/codex";
import { bodySlotMap, isConsumable, ANATOMY_SLOTS, POOL_SLOTS, SLOT_LABEL } from "../../game/inventory";
import type { Weapon, Equipment } from "../../models/codex";

function newItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "eq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

// Shared Neuronal Capacity readout — the equip budget spans weapons + gear, so both tabs show it.
function NcBudget({ ncUsed, maxNC }: { ncUsed: number; maxNC: number }) {
  const over = ncUsed > maxNC;
  return (
    <div className={"nc-budget" + (over ? " over" : "")}>
      Neuronal Capacity · {ncUsed} / {maxNC}
      {over ? " · overloaded" : ""}
    </div>
  );
}

interface WeaponsProps {
  weaponLoadout: string[];
  maxNC: number;
  ncUsed: number;
  slotsUsed: number;
  slotsMax: number;
  curator: boolean;
  onWeapons: (names: string[]) => void;
}

// The "Weapons" tab — equip weapons against the 4 slots (weight cost) + NC budget.
export function WeaponsBody({ weaponLoadout, maxNC, ncUsed, slotsUsed, slotsMax, curator, onWeapons }: WeaponsProps) {
  const [wSearch, setWSearch] = useState("");
  const slotsOver = slotsUsed > slotsMax;
  const weapons = listWeapons().filter((w) => w.name.toLowerCase().includes(wSearch.toLowerCase()));

  function toggleWeapon(name: string) {
    if (weaponLoadout.includes(name)) onWeapons(weaponLoadout.filter((n) => n !== name));
    else if (slotsUsed + weaponSlotCost(getWeapon(name)?.weight) <= slotsMax) onWeapons([...weaponLoadout, name]);
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

  return (
    <>
      {!curator && <p className="lock-note">Loadout is Curator-controlled — view only.</p>}
      <NcBudget ncUsed={ncUsed} maxNC={maxNC} />
      <div className={"nc-budget alt" + (slotsOver ? " over" : "")}>Weapon slots · {slotsUsed} / {slotsMax}</div>
      <div className="browse">
        <input className="bg-select full" placeholder="Search weapons…" value={wSearch} onChange={(e) => setWSearch(e.target.value)} />
        {slotsOver ? <div className="equip-warn">Over weapon-slot limit.</div> : null}
        <div className="use-list">{weapons.map(weaponRow)}</div>
      </div>
    </>
  );
}

// One line of effect text, expandable — "how it functions".
function EffectLine({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className={"inv-effect" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)} title={open ? "" : "Click to expand"}>
      {text}
    </div>
  );
}

// A row for an EQUIPPED catalog item (weapon or gear) — slot, weight, badges, effect.
function EquippedRow({ item }: { item: { name: string; slot?: string; weight?: string; category?: string; damage?: string; mods?: string; ncCost?: number; effect?: string; consumable?: boolean; kind: "weapon" | "gear" } }) {
  return (
    <div className="inv-item">
      <div className="inv-item-head">
        <span className="inv-name">{item.name}</span>
        {item.slot && <span className="inv-slot">{SLOT_LABEL[item.slot.toUpperCase()] || item.slot}</span>}
        {item.consumable && <span className="inv-tag consumable">Consumable</span>}
        {item.kind === "weapon" && item.damage && <span className="ss-badge">{item.damage}</span>}
        {item.weight && <span className="inv-tag">{item.weight}</span>}
        {item.ncCost ? <span className="ss-badge">{item.ncCost} NC</span> : null}
      </div>
      {item.mods && <div className="inv-mods">{item.mods}</div>}
      <EffectLine text={item.effect} />
    </div>
  );
}

interface InventoryProps {
  speciesId?: string;
  sizeId?: string;
  equipment?: EquipmentItem[];
  weaponLoadout: string[];
  gearLoadout: string[];
  maxNC: number;
  ncUsed: number;
  curator: boolean;
  onSize: (sizeId: string) => void;
  onEquipment: (items: EquipmentItem[]) => void;
  onGear: (names: string[]) => void;
}

// The "Inventory" tab — a dedicated dashboard: body-slot map, everything you have
// equipped, consumables + how they function, the gear catalog, size, and custom
// carried items with quantities.
export function InventoryBody({ speciesId, sizeId, equipment, weaponLoadout, gearLoadout, maxNC, ncUsed, curator, onSize, onEquipment, onGear }: InventoryProps) {
  const [gSearch, setGSearch] = useState("");
  const [gCat, setGCat] = useState("All");

  const items = equipment ?? [];
  const size = sizeOf(sizeId, speciesId);
  const sizeIdx = sizeIndexOf(sizeId, speciesId);
  const manualUsed = items.reduce((s, it) => s + (it.equipped ? (WEIGHT_CATS.find((w) => w.key === it.weight)?.cost ?? 0) * (it.qty ?? 1) : 0), 0);

  const slots = bodySlotMap(weaponLoadout, gearLoadout);
  const equippedWeapons = weaponLoadout.map((n) => getWeapon(n)).filter((w): w is Weapon => !!w);
  const equippedGear = gearLoadout.map((n) => getEquipment(n)).filter((g): g is Equipment => !!g);
  const catalogConsumables = listEquipment().filter((g) => isConsumable(g.category));

  const gearCats = ["All", ...Array.from(new Set(listEquipment().map((g) => g.category || "Other")))];
  const gear = listEquipment().filter(
    (g) => (gCat === "All" || (g.category || "Other") === gCat) && g.name.toLowerCase().includes(gSearch.toLowerCase())
  );

  /** Catalog gear stacks: the loadout holds one entry PER COPY carried. */
  function gearCount(name: string): number {
    return gearLoadout.filter((n) => n === name).length;
  }
  function addGearOne(name: string) {
    onGear([...gearLoadout, name]);
  }
  function removeGearOne(name: string) {
    const i = gearLoadout.indexOf(name);
    if (i >= 0) onGear([...gearLoadout.slice(0, i), ...gearLoadout.slice(i + 1)]);
  }
  function update(id: string, patch: Partial<EquipmentItem>) {
    onEquipment(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function addItem() {
    onEquipment([...items, { id: newItemId(), name: "", weight: "standard", equipped: true, mods: "", notes: "", qty: 1 }]);
  }
  function removeItem(id: string) {
    onEquipment(items.filter((it) => it.id !== id));
  }
  function useItem(it: EquipmentItem) {
    const q = it.qty ?? 1;
    if (q > 1) update(it.id, { qty: q - 1 });
    else removeItem(it.id);
  }
  function gearRow(g: Equipment) {
    const count = gearCount(g.name);
    return (
      <div key={g.name} className={"use-row gear-stack-row" + (count > 0 ? " selected" : "")}>
        <button className="gear-stack-main" disabled={!curator} onClick={() => (count > 0 ? removeGearOne(g.name) : addGearOne(g.name))} title={count > 0 ? "Remove one" : "Equip one"}>
          <span className="ability-check">{count > 0 ? "✓" : "+"}</span>
          <span className="use-name">
            {g.name}
            {count > 1 && <span className="inv-tag consumable"> ×{count}</span>}
          </span>
          {g.slot ? <span className="ss-badge">{SLOT_LABEL[g.slot.toUpperCase()] || g.slot}</span> : null}
          {g.mods ? <span className="use-mods">{g.mods}</span> : null}
          <span className="ss-badge">{(g.ncCost ?? 0) * Math.max(1, count)} NC</span>
        </button>
        {curator && count > 0 && (
          <span className="gear-stack-btns">
            <button className="icon-btn sm" onClick={() => removeGearOne(g.name)} title="Carry one less">−</button>
            <button className="icon-btn sm" onClick={() => addGearOne(g.name)} title="Carry another copy">+</button>
          </span>
        )}
      </div>
    );
  }

  const consumableItems = items.filter((it) => it.consumable);

  return (
    <>
      {!curator && <p className="lock-note">Loadout is Curator-controlled — view only.</p>}
      <NcBudget ncUsed={ncUsed} maxNC={maxNC} />

      <Collapsible defaultOpen title="Body slots">
        <div className="inv-slots">
          {ANATOMY_SLOTS.map((s) => {
            const occ = slots.anatomy[s];
            const conflict = slots.conflicts.includes(s);
            return (
              <div key={s} className={"inv-slot-cell" + (occ.length ? " filled" : "") + (conflict ? " conflict" : "")}>
                <span className="inv-slot-label">{SLOT_LABEL[s]}</span>
                <span className="inv-slot-occ">{occ.length ? occ.map((o) => o.name).join(", ") : "—"}</span>
                {conflict && <span className="inv-slot-warn">2+ items</span>}
              </div>
            );
          })}
        </div>
        <div className="inv-pools">
          {POOL_SLOTS.map((p) => (
            <span key={p} className="inv-pool">
              {SLOT_LABEL[p]} · {slots.pools[p].length}
              {slots.pools[p].length > 0 && <span className="inv-pool-names"> ({slots.pools[p].map((o) => o.name).join(", ")})</span>}
            </span>
          ))}
        </div>
        {slots.unassigned.length > 0 && (
          <div className="inv-unassigned">Carried (no slot): {slots.unassigned.map((o) => o.name).join(", ")}</div>
        )}
      </Collapsible>

      <Collapsible defaultOpen title={`Equipped · ${equippedWeapons.length + equippedGear.length}`}>
        {equippedWeapons.length + equippedGear.length === 0 ? (
          <p className="list-empty">Nothing equipped yet — equip weapons on the Loadout tab and gear below.</p>
        ) : (
          <div className="inv-list">
            {equippedWeapons.map((w) => (
              <EquippedRow key={"w:" + w.name} item={{ name: w.name, slot: w.slot, weight: w.weight, damage: w.damage, mods: w.mods, ncCost: w.ncCost, effect: w.effect, kind: "weapon" }} />
            ))}
            {equippedGear.map((g, i) => (
              <EquippedRow key={"g:" + g.name + ":" + i} item={{ name: g.name, slot: g.slot, weight: g.weight, category: g.category, mods: g.mods, ncCost: g.ncCost, effect: g.effect, consumable: isConsumable(g.category), kind: "gear" }} />
            ))}
          </div>
        )}
      </Collapsible>

      <Collapsible title="Consumables">
        <div className="browse">
          {consumableItems.length > 0 && (
            <div className="inv-list">
              {consumableItems.map((it) => (
                <div className="inv-item" key={it.id}>
                  <div className="inv-item-head">
                    <span className="inv-name">{it.name || "Item"}</span>
                    <span className="inv-tag consumable">×{it.qty ?? 1}</span>
                    {curator || (it.qty ?? 1) > 0 ? (
                      <button className="chip" onClick={() => useItem(it)} title="Use one">Use</button>
                    ) : null}
                  </div>
                  {it.mods && <div className="inv-mods">{it.mods}</div>}
                </div>
              ))}
            </div>
          )}
          <p className="inv-sub">From the catalog — how they function:</p>
          <div className="inv-list">
            {catalogConsumables.map((g) => {
              const count = gearCount(g.name);
              return (
                <div className="inv-item" key={g.name}>
                  <div className="inv-item-head">
                    <span className="inv-name">{g.name}</span>
                    {count > 0 && <span className="inv-tag consumable">×{count}</span>}
                    {count > 0 && (
                      <button className="chip" onClick={() => removeGearOne(g.name)} title="Use one — removes a copy from your loadout">
                        Use
                      </button>
                    )}
                    {curator && (
                      <button className="chip" onClick={() => addGearOne(g.name)} title="Carry another copy">
                        +1
                      </button>
                    )}
                  </div>
                  <EffectLine text={g.effect} />
                </div>
              );
            })}
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Gear catalog">
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
          <div className="size-scale">
            {size.height} · {size.weight}
            {size.footprint > 0 ? ` · ${size.footprint}×${size.footprint} ft footprint` : " · single cell"}
          </div>
          <div className="size-readout">
            <span>Slots {size.budget}</span>
            <span>Reach {size.reach === 0 ? "adjacent" : `${size.reach} ft`}</span>
            <span>Move {size.move} ft</span>
            <span>Start HP {size.startHp}</span>
          </div>
          <div className="size-readout">
            <span title="Added into the DHP pool">DHP {signedMod(size.dhpMod)}</span>
            <span title="Applies to every Action Priority check">AP {signedMod(size.apMod)}</span>
            <span title="Applies to Evasion checks">EV {signedMod(size.evMod)}</span>
          </div>
          <ul className="size-rules">
            {size.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      </Collapsible>

      <Collapsible title="Size vs. size — combat">
        <div className="browse">
          <p className="inv-sub">
            How this character fares against each class. Attack/damage riders and the reactions a target loses.
          </p>
          <table className="size-matrix">
            <thead>
              <tr><th>Target</th><th>Attack</th><th>Damage</th><th>Grapple</th></tr>
            </thead>
            <tbody>
              {SIZE_CLASSES.map((other, i) => {
                const m = sizeDiffMods(sizeIdx, i);
                const g = sizeGrapple(sizeIdx, i);
                const post = m.posture === "advantage" ? " · Adv" : m.posture === "disadvantage" ? " · Disadv" : "";
                return (
                  <tr key={other.key} className={i === sizeIdx ? "self" : undefined}>
                    <td>{other.label}</td>
                    <td>{m.attack === 0 ? "—" : signedMod(m.attack)}{post}</td>
                    <td>
                      {m.damage}
                      {m.limit ? <span className="size-limit"> · {m.limit}</span> : null}
                    </td>
                    <td title={g.note}>{g.automatic ? "Auto" : g.posture === "advantage" ? "Adv" : g.posture === "disadvantage" ? "Disadv" : g.mod ? signedMod(g.mod) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible title="Equipment weight classes">
        <div className="browse">
          <table className="size-matrix">
            <thead>
              <tr><th>Class</th><th>Weight</th><th>Usable by</th><th>Examples</th></tr>
            </thead>
            <tbody>
              {WEIGHT_CATS.map((w) => (
                <tr key={w.key} className={w.minSize > sizeIdx ? "too-big" : undefined}>
                  <td>{w.label}</td>
                  <td>{w.weight}</td>
                  <td>{SIZE_CLASSES[w.minSize].label}+</td>
                  <td className="wcat-ex">{w.examples}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="inv-sub">Greyed rows are too heavy for this size class.</p>
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
                    <label className="equip-qty" title="Quantity carried">
                      ×
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={it.qty ?? 1}
                        disabled={!curator}
                        onChange={(e) => update(it.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      />
                    </label>
                    <label className="equip-eq">
                      <input type="checkbox" checked={it.equipped} disabled={!curator} onChange={(e) => update(it.id, { equipped: e.target.checked })} /> Equipped
                    </label>
                    <label className="equip-eq">
                      <input type="checkbox" checked={!!it.consumable} disabled={!curator} onChange={(e) => update(it.id, { consumable: e.target.checked })} /> Consumable
                    </label>
                  </div>
                  <input className="bg-select full" placeholder="Mods · e.g. DEX +2, DHP +3" value={it.mods} disabled={!curator} onChange={(e) => update(it.id, { mods: e.target.value })} />
                  {tooBig ? <div className="equip-warn">Too heavy for your size — needs {SIZE_CLASSES[wc!.minSize].label}+.</div> : null}
                  <div className="equip-row2">
                    {it.consumable ? <button className="chip" onClick={() => useItem(it)} title="Use one">Use ({it.qty ?? 1})</button> : <span />}
                    {curator ? <button className="icon-btn" onClick={() => removeItem(it.id)}>Remove</button> : null}
                  </div>
                </div>
              );
            })
          )}
          {curator ? <button className="primary-btn full mt" onClick={addItem}>Add custom item</button> : null}
        </div>
      </Collapsible>
    </>
  );
}
