import { useState } from "react";
import { rankMult, snrOfGenus, type RollResult, type UsableAbility } from "../../game/wte";
import {
  GENUS_FOCUS_MAX,
  contestRoll,
  effectiveFocus,
  focusContest,
  type ContestSide,
} from "../../game/synapticFocus";

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
  const [out, setOut] = useState<{ note: string; winner: "a" | "b"; byFocus: boolean } | null>(null);

  const mine: ContestSide = {
    label: ability.name,
    focus: myFocus,
    control,
    rank,
    borrowedFocus: canBorrow && borrowed > 0 ? borrowed : undefined,
  };
  const theirs: ContestSide = { label: oppName.trim() || "their ability", focus: oppFocus, control: oppControl, rank: oppRank };
  const myEffective = effectiveFocus(mine);
  const snr = snrOfGenus(ability.name);

  function resolve() {
    const r = focusContest(mine, theirs);
    setOut({ note: r.note, winner: r.winner, byFocus: r.byFocus });
    // Log the contested rolls so the table sees them, but only when dice were
    // actually thrown — a Focus win is not a roll and should not pretend to be.
    if (!r.byFocus) {
      onRoll({
        formula: `Contest · ${ability.name} vs ${theirs.label}`,
        result: r.aTotal ?? 0,
        detail: { die: 40, roll: r.aTotal ?? 0, modifier: 0, label: `${ability.name} (Control × rank)` },
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
              {snr === "applies" ? " · SNR" : snr === "anti" ? " · anti-SNR" : ""}
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
            <input className="stat-input" type="number" min={0} max={75} value={oppControl} onChange={(e) => setOppControl(parseInt(e.target.value, 10) || 0)} />
          </label>
          <label className="lobby-field">
            <span>Their rank</span>
            <input className="stat-input" type="number" min={0} max={9} value={oppRank} onChange={(e) => setOppRank(parseInt(e.target.value, 10) || 0)} />
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
            <button className="icon-btn" onClick={() => setOut(null)}>
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
                Rank multiplier ×{rankMult(rank).toFixed(2)} vs ×{rankMult(oppRank).toFixed(2)}
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

/** Re-exported so a caller can preview a side's scaled Control without resolving. */
export { contestRoll };
