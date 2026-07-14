import { useState } from "react";
import { ATTRIBUTES, zeroAttributes, rollMod, signedMod, type AttrKey, type Attributes } from "../../game/wte";

interface Props {
  attributes: Attributes;
  /** Replace the whole attribute block (roll/assign sets all seven at once). */
  onSet: (attrs: Attributes) => void;
}

// Roll 4d6, drop the lowest → 3..18. The familiar D&D-Beyond method, within
// W.T.E's 0..20 attribute range.
function roll4d6DropLowest(): number {
  const d = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
  return d[1] + d[2] + d[3];
}

// Roll-and-assign attribute generator: roll seven scores, then assign each to an
// attribute (each score used once). Mirrors the D&D-Beyond "Roll" flow.
export function AttributeRoller({ attributes, onSet }: Props) {
  const [pool, setPool] = useState<number[] | null>(null);
  // attribute → pool index it consumes
  const [assign, setAssign] = useState<Partial<Record<AttrKey, number>>>({});

  function roll() {
    const vals = ATTRIBUTES.map(() => roll4d6DropLowest()).sort((a, b) => b - a);
    setPool(vals);
    setAssign({});
    onSet(zeroAttributes());
  }

  function assignTo(k: AttrKey, poolIdx: number | null) {
    if (!pool) return;
    const next: Partial<Record<AttrKey, number>> = { ...assign };
    // a pool value is used at most once — free it from whoever held it
    if (poolIdx !== null) {
      for (const kk of Object.keys(next) as AttrKey[]) if (next[kk] === poolIdx) delete next[kk];
      next[k] = poolIdx;
    } else {
      delete next[k];
    }
    setAssign(next);
    const attrs = zeroAttributes();
    for (const kk of Object.keys(next) as AttrKey[]) {
      const pi = next[kk];
      if (pi !== undefined) attrs[kk] = pool[pi];
    }
    onSet(attrs);
  }

  const usedIdx = new Set(Object.values(assign));
  const remaining = pool ? pool.length - usedIdx.size : 0;

  return (
    <div className="roller">
      <div className="roller-head">
        <button className="primary-btn" onClick={roll}>
          {pool ? "Re-roll" : "Roll 7 scores"}
        </button>
        {pool && (
          <span className="roller-pool" title="Rolled scores — assign each once">
            {pool.map((v, i) => (
              <span key={i} className={"roller-chip" + (usedIdx.has(i) ? " used" : "")}>
                {v}
              </span>
            ))}
          </span>
        )}
        {pool && <span className="roller-left">{remaining} unassigned</span>}
      </div>

      {pool && (
        <div className="stat-editor">
          {ATTRIBUTES.map((a) => {
            const cur = assign[a.key];
            return (
              <div className="stat-row" key={a.key}>
                <div className="stat-info">
                  <span className="stat-short">{a.short}</span>
                  <span className="stat-desc">{a.desc}</span>
                </div>
                <span className="mod-box" title="Roll modifier">
                  {signedMod(rollMod(attributes[a.key]))}
                </span>
                <select
                  className="bg-select"
                  value={cur ?? ""}
                  onChange={(e) => assignTo(a.key, e.target.value === "" ? null : parseInt(e.target.value, 10))}
                >
                  <option value="">—</option>
                  {pool.map((v, i) =>
                    !usedIdx.has(i) || i === cur ? (
                      <option key={i} value={i}>
                        {v}
                      </option>
                    ) : null
                  )}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
