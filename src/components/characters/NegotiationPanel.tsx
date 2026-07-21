import { useState } from "react";
import {
  ATTRIBUTES,
  SPECIALTIES,
  rankMult,
  rollMod,
  rollDieMode,
  signedMod,
  moralityMods,
  pressureComplexity,
  SPEC_PENALTY,
  SPEC_PENALTY_MIN,
  type Attributes,
  type Specialties,
  type AttrKey,
  type SpecKey,
  type RollMode,
  type RollResult,
} from "../../game/wte";
import {
  accordState,
  eminenceGap,
  negotiationAav,
  negotiationOutcome,
  applyAccord,
  NEGOTIATION_MAX,
  NEGOTIATION_DEFAULT,
} from "../../game/negotiation";

interface Row { spec: SpecKey | ""; attr: AttrKey | ""; out: string }
interface Result { aav: number; cBonus: number; diff: number; band: ReturnType<typeof negotiationOutcome>["band"] }

interface Props {
  attrs: Attributes;
  specs: Specialties;
  rank: number;
  morality?: number;
  /** The character's Influence check modifier — the social Attack Power. */
  influenceMod: number;
  /** The character's Eminence (System Alignment Index, −20…+20). */
  eminence: number;
  client: { client?: string; resistance?: number; eminenceReq?: number };
  onClient: (next: { client?: string; resistance?: number; eminenceReq?: number }) => void;
  onRoll: (roll: RollResult) => void;
}

// The Negotiation Engine: the Pressure Engine's chassis aimed at a person.
// Pick the skills you're actually leaning on (Cunning for leverage, Control for
// composure, Perception to read them, Inspiration for a novel offer), roll, and
// the outcome band moves the client's Resistance toward Accord — or hardens it.
// Influence adds straight to the AAV; falling short of the client's Eminence
// requirement subtracts before a die is even read.
export function NegotiationPanel({ attrs, specs, rank, morality, influenceMod, eminence, client, onClient, onRoll }: Props) {
  const [rows, setRows] = useState<Row[]>(Array.from({ length: 4 }, () => ({ spec: "", attr: "", out: "—" })));
  const [result, setResult] = useState<Result | null>(null);

  const resistance = client.resistance ?? NEGOTIATION_DEFAULT;
  const req = client.eminenceReq ?? 0;
  const gap = eminenceGap(eminence, req);
  const state = accordState(resistance);
  const mult = rankMult(rank);
  const complexity = pressureComplexity(specs, morality);
  const soulNote = moralityMods(morality).note;

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function resolve(mode: RollMode = "normal") {
    const totals: number[] = [];
    const next = rows.map((r) => ({ ...r }));
    for (const r of next) {
      if (!r.spec) { r.out = "—"; continue; }
      const { roll: die, rolls } = rollDieMode(40, mode);
      const specPts = specs[r.spec] || 0;
      const attrM = r.attr ? rollMod(attrs[r.attr] || 0) : 0;
      const penalty = specPts < SPEC_PENALTY_MIN ? SPEC_PENALTY : 0;
      const tot = Math.round((die + specPts + attrM + complexity - penalty) * mult);
      totals.push(tot);
      const dieTxt = mode === "normal" ? `d40=${die}` : `d40=${die} of ${rolls.join("/")}`;
      r.out = penalty ? `${tot} (${dieTxt} −${SPEC_PENALTY})` : `${tot} (${dieTxt})`;
    }
    setRows(next);
    if (totals.length === 0) return;
    const { aav, cBonus } = negotiationAav(totals, influenceMod, gap);
    const { diff, band } = negotiationOutcome(aav, resistance);
    setResult({ aav, cBonus, diff, band });
    const modeTxt = mode === "normal" ? "" : mode === "adv" ? " · Advantage" : " · Disadvantage";
    onRoll({
      formula: `Negotiation · ${totals.length} approach${totals.length === 1 ? "" : "es"}${modeTxt}`,
      result: aav,
      detail: { die: 40, roll: aav, modifier: influenceMod - gap, label: `${client.client || "Client"} — ${band.name}`, mode },
    });
  }

  function apply() {
    if (!result) return;
    onClient({ ...client, resistance: applyAccord(resistance, result.band.change) });
    setResult(null);
  }

  return (
    <div className="pe-wrap">
      <div className="pe-head">
        <label className="lobby-field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
          <span>Client / counterpart</span>
          <input
            className="bg-select full"
            placeholder="e.g. Directorate Envoy Kael"
            value={client.client ?? ""}
            onChange={(e) => onClient({ ...client, client: e.target.value })}
          />
        </label>
        <label className="lobby-field" style={{ margin: 0 }}>
          <span>Resistance</span>
          <input
            className="sheet-stat-num"
            style={{ width: 64 }}
            type="number"
            min={0}
            max={NEGOTIATION_MAX}
            value={resistance}
            onChange={(e) => onClient({ ...client, resistance: Math.max(0, Math.min(NEGOTIATION_MAX, parseInt(e.target.value, 10) || 0)) })}
          />
        </label>
        <label className="lobby-field" style={{ margin: 0 }} title="Minimum Eminence this client expects before they take you seriously">
          <span>Standing req.</span>
          <input
            className="sheet-stat-num"
            style={{ width: 58 }}
            type="number"
            min={-20}
            max={20}
            value={req}
            onChange={(e) => onClient({ ...client, eminenceReq: Math.max(-20, Math.min(20, parseInt(e.target.value, 10) || 0)) })}
          />
        </label>
        <span className={"pe-state " + state.key}>{state.label}</span>
      </div>

      <div className="pe-head" style={{ marginTop: 2 }}>
        <span className="pe-meta" title="Your Influence modifier — the social Attack Power, added to every exchange">
          Influence {signedMod(influenceMod)}
          {influenceMod === 0 && (morality ?? 50) <= 30 && " · Hollow (Process)"}
        </span>
        <span className="pe-meta" title="Your Eminence vs this client's requirement">
          Eminence {signedMod(eminence)} vs {signedMod(req)}
          {gap > 0 ? ` · −${gap} standing gap` : " · clears the room"}
        </span>
        <span className="pe-meta">Rank mult ×{mult.toFixed(2)}</span>
        <span className="pe-meta" title={soulNote ?? undefined}>Complexity {signedMod(complexity)}</span>
      </div>

      <p className="identity-hint" style={{ margin: "4px 0 10px" }}>
        Pick the approaches you're actually leaning on — Cunning for leverage, Control to hold composure, Perception to read them,
        Inspiration for a novel offer. Each rolls (1d40 + specialty + attribute mod + Complexity) × rank mult; the average
        (+1 for 3 skills, +2 for 4) plus Influence, minus any standing gap, is your AAV against their Resistance.
      </p>

      {rows.map((r, i) => (
        <div className="pe-row" key={i}>
          <span className="pe-row-n">{i + 1}</span>
          <select className="bg-select" value={r.spec} onChange={(e) => setRow(i, { spec: e.target.value as SpecKey | "" })}>
            <option value="">— approach —</option>
            {SPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.label} ({specs[s.key] || 0})</option>)}
          </select>
          <select className="bg-select" value={r.attr} onChange={(e) => setRow(i, { attr: e.target.value as AttrKey | "" })}>
            <option value="">no attr</option>
            {ATTRIBUTES.map((a) => <option key={a.key} value={a.key}>{a.short} ({signedMod(rollMod(attrs[a.key] || 0))})</option>)}
          </select>
          <span className="pe-row-out">{r.out}</span>
        </div>
      ))}

      <div className="act-actions" style={{ marginTop: 10 }}>
        <button
          className="primary-btn"
          onClick={(e) => resolve(e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal")}
          onContextMenu={(e) => { e.preventDefault(); resolve("dis"); }}
          title="Shift-click: Advantage · Right-click (or Ctrl-click): Disadvantage"
        >
          Resolve exchange
        </button>
        <button className="ghost-btn" onClick={() => { setRows(Array.from({ length: 4 }, () => ({ spec: "", attr: "", out: "—" }))); setResult(null); }}>
          Clear approaches
        </button>
      </div>

      {result && (
        <div className="pe-result">
          <div className="pe-res-cell">
            <span className="pe-res-label">AAV</span>
            <span className="pe-res-val">{result.aav}</span>
          </div>
          <div className="pe-res-cell">
            <span className="pe-res-label">vs Resistance</span>
            <span className="pe-res-val">{signedMod(result.diff)}</span>
          </div>
          <div className="pe-res-cell">
            <span className="pe-res-label">Outcome</span>
            <span className="pe-res-val">{result.band.name}</span>
          </div>
          <div className="pe-res-cell">
            <span className="pe-res-label">Resistance shift</span>
            <span className="pe-res-val">{signedMod(result.band.change)}</span>
          </div>
          <button className="primary-btn" onClick={apply}>
            Apply → {applyAccord(resistance, result.band.change)}
          </button>
        </div>
      )}

      {resistance <= 0 && (
        <p className="identity-hint" style={{ marginTop: 8 }}>
          <b>Accord reached.</b> The client is yours — bank the deal, and consider an Eminence gain for the standing you just earned.
        </p>
      )}
      {resistance >= NEGOTIATION_MAX && (
        <p className="identity-hint" style={{ marginTop: 8 }}>
          <b>Talks sealed.</b> This counterpart is done listening — you'll need a new angle, a new envoy, or leverage from elsewhere.
        </p>
      )}
    </div>
  );
}
