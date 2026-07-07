import { SidePanel } from "../ui/SidePanel";
import { Collapsible } from "../ui/Collapsible";
import { SIZE_CLASSES, WEIGHT_CATS, sizeOf, sizeIndexOf, type EquipmentItem, type WeightKey } from "../../game/wte";

interface Props {
  open: boolean;
  onClose: () => void;
  speciesId?: string;
  sizeId?: string;
  equipment?: EquipmentItem[];
  curator: boolean;
  onSize: (sizeId: string) => void;
  onEquipment: (items: EquipmentItem[]) => void;
}

function newItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "eq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function EquipmentPanel({ open, onClose, speciesId, sizeId, equipment, curator, onSize, onEquipment }: Props) {
  const items = equipment ?? [];
  const size = sizeOf(sizeId, speciesId);
  const sizeIdx = sizeIndexOf(sizeId, speciesId);
  const used = items.reduce(
    (sum, it) => sum + (it.equipped ? WEIGHT_CATS.find((w) => w.key === it.weight)?.cost ?? 0 : 0),
    0
  );
  const over = used > size.budget;

  function update(id: string, patch: Partial<EquipmentItem>) {
    onEquipment(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function add() {
    onEquipment([...items, { id: newItemId(), name: "", weight: "standard", equipped: true, mods: "", notes: "" }]);
  }
  function remove(id: string) {
    onEquipment(items.filter((it) => it.id !== id));
  }

  return (
    <SidePanel open={open} title="Equipment & Size" onClose={onClose}>
      {!curator && <p className="lock-note">Loadout is Curator-controlled — view only.</p>}

      <div className="aside-title">Size class</div>
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

      <div className="aside-title mt">
        Loadout <span className={"load-badge" + (over ? " over" : "")}>{used} / {size.budget} slots</span>
      </div>

      {items.length === 0 ? (
        <p className="list-empty">No equipment yet.</p>
      ) : (
        items.map((it) => {
          const wc = WEIGHT_CATS.find((w) => w.key === it.weight);
          const tooBig = wc ? wc.minSize > sizeIdx : false;
          return (
            <Collapsible
              key={it.id}
              title={
                <span className="variant-head">
                  {it.name || "Unnamed item"}
                  {!it.equipped ? <span className="load-badge">off</span> : null}
                </span>
              }
            >
              <div className="equip-fields">
                <input
                  className="bg-select full"
                  placeholder="Item name"
                  value={it.name}
                  disabled={!curator}
                  onChange={(e) => update(it.id, { name: e.target.value })}
                />
                <div className="equip-row2">
                  <select
                    className="bg-select"
                    value={it.weight}
                    disabled={!curator}
                    onChange={(e) => update(it.id, { weight: e.target.value as WeightKey })}
                  >
                    {WEIGHT_CATS.map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label} · {w.cost}
                      </option>
                    ))}
                  </select>
                  <label className="equip-eq">
                    <input
                      type="checkbox"
                      checked={it.equipped}
                      disabled={!curator}
                      onChange={(e) => update(it.id, { equipped: e.target.checked })}
                    />
                    Equipped
                  </label>
                </div>
                <input
                  className="bg-select full"
                  placeholder="Mods · e.g. DEX +2, DHP +3, Weight -1"
                  value={it.mods}
                  disabled={!curator}
                  onChange={(e) => update(it.id, { mods: e.target.value })}
                />
                {tooBig ? (
                  <div className="equip-warn">Too heavy for your size — needs {SIZE_CLASSES[wc!.minSize].label}+.</div>
                ) : null}
                {curator ? (
                  <button className="icon-btn" onClick={() => remove(it.id)}>
                    Remove
                  </button>
                ) : null}
              </div>
            </Collapsible>
          );
        })
      )}

      {curator ? (
        <button className="primary-btn full mt" onClick={add}>
          Add item
        </button>
      ) : null}
    </SidePanel>
  );
}
