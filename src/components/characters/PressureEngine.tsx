import { useState } from "react";
import {
  ATTRIBUTES,
  SPECIALTIES,
  PE_MAX,
  pressureState,
  pressureTax,
  pressureComplexity,
  peBand,
  rankMult,
  rollMod,
  signedMod,
  moralityMods,
  type Attributes,
  type Specialties,
  type AttrKey,
  type SpecKey,
  type RollResult,
} from "../../game/wte";

interface Row {
  spec: SpecKey | "";
  attr: AttrKey | "";
  out: string;
}
interface Result {
  aav: number;
  cBonus: number;
  diff: number;
  band: ReturnType<typeof peBand>;
}

interface Props {
  /** Effective attributes / specialties (species + background + gear + soul). */
  attrs: Attributes;
  specs: Specialties;
  rank: number;
  morality?: number;
  pressure: number;
  onPressure: (v: number) => void;
  onRoll: (roll: RollResult) => void;
  /** True when the PE value is the party's shared Base Pressure (netplay). */
  shared?: boolean;
}

// The Pressure Engine, moved up from the legacy sheet: situation resolution,
// AAV vs PE. Pick 1–4 skills (specialty + optional attribute); each rolls
// (1d20 + specialty pts + attribute mod + Complexity) × rank mult. AAV is the
// rounded average plus the multi-skill bonus (3 → +1, 4 → +2); AAV − PE lands
// in an outcome band that suggests the pressure change.
export function PressureEngine({ attrs, specs, rank, morality, pressure, onPressure, onRoll, shared }: Props) {
  const [rows, setRows] = useState<Row[]>(Array.from({ length: 4 }, () => ({ spec: "", attr: "", out: "—" })));
  const [result, setResult] = useState<Result | null>(null);

  const state = pressureState(pressure);
  const mult = rankMult(rank);
  const tax = pressureTax(specs);
  const complexity = pressureComplexity(specs, morality);
  const soulNote = moralityMods(morality).note;

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function resolve() {
    const totals: number[] = [];
    const next = rows.map((r) => ({ ...r }));
    for (const r of next) {
      if (!r.spec) {
        r.out = "—";
        continue;
      }
      const die = 1 + Math.floor(Math.random() * 40);
      const specPts = specs[r.spec] || 0;
      const attrM = r.attr ? rollMod(attrs[r.attr] || 0) : 0;
      const tot = Math.round((die + specPts + attrM + complexity) * mult);
      totals.push(tot);
      r.out = `${tot} (d20=${die})`;
    }
    setRows(next);
    if (totals.length === 0) return;
    const cBonus = totals.length >= 4 ? 2 : totals.length === 3 ? 1 : 0;
    const aav = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) + cBonus;
    const diff = aav - pressure;
    const band = peBand(diff);
    setResult({ aav, cBonus, diff, band });
    onRoll({
      formula: `PE resolve · ${totals.length} skill${totals.length === 1 ? "" : "s"}`,
      result: aav,
      detail: { die: 40, roll: aav, modifier: complexity, label: `Pressure — ${band.name}` },
    });
  }

  function apply() {
    if (!result) return;
    onPressure(Math.max(0, Math.min(PE_MAX, pressure + result.band.change)));
    setResult(null);
  }
  function clearRows() {
    setRows(Array.from({ length: 4 }, () => ({ spec: "", attr: "", out: "—" })));
    setResult(null);
  }

  return (
    <div className="pe-wrap">
      <div className="pe-head">
        <label className="lobby-field" style={{ margin: 0 }}>
          <span>Current PE / BP{shared ? " · shared" : ""}</span>
          <input
            className="sheet-stat-num"
            style={{ width: 64 }}
            type="number"
            min={0}
            max={PE_MAX}
            value={pressure}
            onChange={(e) => onPressure(Math.max(0, Math.min(PE_MAX, parseInt(e.target.value, 10) || 0)))}
          />
        </label>
        <span className={"pe-state " + state.key}>{state.label}</span>
        <span className="pe-meta">Rank mult ×{mult.toFixed(2)}</span>
        <span className="pe-meta" title={`Inspiration − Tax Burden (tax ${tax}: every other specialty adds ⌊pts/10⌋)${soulNote ? `\nSoul: ${soulNote}` : ""}`}>
          Complexity {signedMod(complexity)}
          {(morality ?? 50) <= 30 && " · locked (Process)"}
          {(morality ?? 50) >= 70 && " · Insp ×2 (Resonance)"}
        </span>
      </div>
      <p className="identity-hint" style={{ margin: "4px 0 10px" }}>
        Per skill: (1d20 + specialty pts + attribute mod + Complexity) × rank mult. Pick 1–4 skills — 3 gives +1, 4 gives +2 to AAV.
      </p>

      {rows.map((r, i) => (
        <div className="pe-row" key={i}>
          <span className="pe-row-n">{i + 1}</span>
          <select className="bg-select" value={r.spec} onChange={(e) => setRow(i, { spec: e.target.value as SpecKey | "" })}>
            <option value="">— skill —</option>
            {SPECIALTIES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({specs[s.key] || 0})
              </option>
            ))}
          </select>
          <select className="bg-select" value={r.attr} onChange={(e) => setRow(i, { attr: e.target.value as AttrKey | "" })}>
            <option value="">no attr</option>
            {ATTRIBUTES.map((a) => (
              <option key={a.key} value={a.key}>
                {a.short} ({signedMod(rollMod(attrs[a.key] || 0))})
              </option>
            ))}
          </select>
          <span className="pe-row-out">{r.out}</span>
        </div>
      ))}

      <div className="act-actions" style={{ marginTop: 10 }}>
        <button className="primary-btn" onClick={resolve}>
          Resolve roll
        </button>
        <button className="ghost-btn" onClick={clearRows}>
          Clear skills
        </button>
      </div>

      {result && (
        <div className="pe-result">
          <div className="pe-res-cell">
            <span>AAV</span>
            <b>
              {result.aav}
              {result.cBonus ? ` (+${result.cBonus})` : ""}
            </b>
          </div>
          <div className="pe-res-cell">
            <span>AAV − PE</span>
            <b>{result.diff >= 0 ? `+${result.diff}` : result.diff}</b>
          </div>
          <div className="pe-res-cell">
            <span>Outcome</span>
            <b className={"pe-outcome " + pressureState(pressure).key}>{result.band.name}</b>
          </div>
          <div className="pe-res-cell">
            <span>Suggested change</span>
            <b>
              {result.band.change >= 0 ? `+${result.band.change}` : result.band.change} ({result.band.range})
            </b>
          </div>
          <button className="primary-btn" onClick={apply}>
            Apply → PE {Math.max(0, Math.min(PE_MAX, pressure + result.band.change))}
          </button>
        </div>
      )}
    </div>
  );
}
