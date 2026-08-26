import { useEffect, useState } from "react";
import { RANK_MAX, SPEC_MAX, rankMult, type RollResult, type UsableAbility } from "../../game/wte";
import { snrReading } from "../../game/snr";
import { GENUS_FOCUS_MAX, effectiveFocus, focusContest, type ContestSide } from "../../game/synapticFocus";

function clamp(v: string, lo: number, hi: number): number {
  const n = parseInt(v, 10);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

interface Props {
  /** MY ability — carries the Focus I invested and the domain it came from. */
  ability: UsableAbility;
  /** My Control specialty points, for the tie-break roll. */
  control: number;
  rank: number;
  /** True when this character has Mirga's Identity Theft unlocked, which lets
   *  them contest with a Focus borrowed off whoever they are wearing. */
  canBorrow: boolean;
  onRoll: (r: RollResult) => void;
  onClose: () => void;
}

// Genus versus genus. Higher Synaptic Focus wins outright — a Reflect with less
// Focus than the Elemental it meets simply fails. Equal Focus goes to a contested
// Control roll scaled by rank, and a dead tie leaves the defender holding.
//
// This is the resolver the Focus system was designed around, and until now it
// existed only in tests.
export function GenusContestPanel({ ability, control, rank, canBorrow, onRoll, onClose }: Props) {
  const myFocus = ability.focus ?? 0;
  const [oppName, setOppName] = useState("");
  const [oppFocus, setOppFocus] = useState(2);
  const [oppControl, setOppControl] = useState(25);
  const [oppRank, setOppRank] = useState(rank);
  const [borrowed, setBorrowed] = useState(0);
  // The outcome snapshots the multipliers it was resolved under, so editing the
  // opponent's rank afterwards cannot relabel a roll that already happened.
  const [out, setOut] = useState<{
    note: string;
    winner: "a" | "b";
    byFocus: boolean;
    myMult: number;
    theirMult: number;
  } | null>(null);

  // Every sibling overlay in this directory closes on Escape; match them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mine: ContestSide = {
    label: ability.name,
    focus: myFocus,
    control,
    rank,
    borrowedFocus: canBorrow && borrowed > 0 ? borrowed : undefined,
  };
  const theirs: ContestSide = { label: oppName.trim() || "their ability", focus: oppFocus, control: oppControl, rank: oppRank };
  const myEffective = effectiveFocus(mine);
  // One module answers "where does this ability sit in resolution order", and
  // it reads the DOMAIN page rather than the activation prose that also encodes
  // it. This panel used to spell the two labels out by hand, which meant a
  // second place the vocabulary could drift from the VTT's.
  const snr = snrReading(ability.id ?? ability.name) ?? snrReading(ability.name);

  function resolve() {
    const r = focusContest(mine, theirs);
    setOut({
      note: r.note,
      winner: r.winner,
      byFocus: r.byFocus,
      myMult: rankMult(rank),
      theirMult: rankMult(oppRank),
    });
    // Log the contested rolls so the table sees them, but only when dice were
    // actually thrown — a Focus win is not a roll and should not pretend to be.
    // The logged detail is the REAL d40 that produced my total, and the label
    // carries both scaled totals and the verdict so the record is complete.
    if (!r.byFocus && r.aRoll) {
      const verdict = r.winner === "a" ? "lands" : "fails";
      onRoll({
        formula: `${r.aRoll.formula} × ${rankMult(rank).toFixed(2)} (rank ${rank})`,
        result: r.aTotal ?? 0,
        detail: {
          ...r.aRoll.detail,
          label:
            `Contest · ${ability.name} ${r.aTotal} vs ${theirs.label} ${r.bTotal} — ` +
            `${ability.name} ${verdict}`,
        },
      });
    }
  }

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="contest-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>Genus contest</span>
          <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
        </div>

        <div className="contest-sides">
          <div className="contest-side mine">
            <div className="contest-side-name">{ability.name}</div>
            <div className="contest-side-meta">
              {ability.domain ?? "—"}
              {snr && snr.posture !== "none" ? <span title={snr.note}> · {snr.label}</span> : ""}
            </div>
            <div className="contest-focus">
              Focus <b>{myEffective}</b>
              {myEffective !== myFocus && <span className="contest-borrowed"> (borrowed)</span>}
            </div>
          </div>
          <div className="contest-vs">vs</div>
          <div className="contest-side">
            <input
              className="bg-select full"
              value={oppName}
              onChange={(e) => setOppName(e.target.value)}
              placeholder="Their ability"
            />
            <div className="contest-focus">
              Focus <b>{oppFocus}</b>
            </div>
          </div>
        </div>

        <label className="lobby-field mt">
          <span>Their Synaptic Focus</span>
          <div className="chip-row">
            {Array.from({ length: GENUS_FOCUS_MAX + 1 }, (_, i) => (
              <button key={i} className={"chip" + (oppFocus === i ? " active" : "")} onClick={() => setOppFocus(i)}>
                {i}
              </button>
            ))}
          </div>
        </label>

        {/* Only needed when Focus ties — shown always so the Curator can fill it
            in before resolving rather than being interrupted mid-roll. */}
        <div className="contest-grid mt">
          <label className="lobby-field">
            <span>Their Control pts</span>
            <input
              className="stat-input"
              type="number"
              min={0}
              max={SPEC_MAX}
              value={oppControl}
              onChange={(e) => setOppControl(clamp(e.target.value, 0, SPEC_MAX))}
            />
          </label>
          <label className="lobby-field">
            <span>Their rank</span>
            <input
              className="stat-input"
              type="number"
              min={0}
              max={RANK_MAX}
              value={oppRank}
              onChange={(e) => setOppRank(clamp(e.target.value, 0, RANK_MAX))}
            />
          </label>
        </div>

        {canBorrow && (
          <label className="lobby-field mt">
            <span>Identity Theft — Focus borrowed from the form you wear</span>
            <div className="chip-row">
              {Array.from({ length: GENUS_FOCUS_MAX + 1 }, (_, i) => (
                <button key={i} className={"chip" + (borrowed === i ? " active" : "")} onClick={() => setBorrowed(i)}>
                  {i || "off"}
                </button>
              ))}
            </div>
            <p className="vtt2-actor-hint" style={{ margin: "4px 0 0" }}>
              You may use their Focus instead of your own — the better of the two applies.
            </p>
          </label>
        )}

        <div className="contest-actions">
          <button className="primary-btn" onClick={resolve}>
            Resolve
          </button>
          {out && (
            <button className="icon-btn" onClick={resolve}>
              Again
            </button>
          )}
        </div>

        {out && (
          <div className={"contest-out " + (out.winner === "a" ? "won" : "lost")}>
            <div className="contest-out-verdict">
              {out.winner === "a" ? `${ability.name} lands` : `${ability.name} fails`}
              <span className="contest-out-how">{out.byFocus ? "on Focus" : "on a contested Control roll"}</span>
            </div>
            <div className="contest-out-note">{out.note}</div>
            {!out.byFocus && (
              <div className="contest-out-sub">
                Rank multiplier ×{out.myMult.toFixed(2)} vs ×{out.theirMult.toFixed(2)}
              </div>
            )}
          </div>
        )}

        <p className="vtt2-actor-hint" style={{ marginTop: 10 }}>
          Higher Focus wins outright. Equal Focus is a contested Control roll scaled by rank; a dead tie
          leaves the defender holding.
        </p>
      </div>
    </div>
  );
}
