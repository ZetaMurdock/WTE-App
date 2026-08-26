import { useEffect, useState } from "react";
import { pushUndo } from "../../lib/undoRedo";
import { POOL_COMP_RATE, SPEC_MAX, SPEC_TOTAL } from "../../game/wte";
import {
  ATTR_BUDGET_MAX,
  ATTR_BUDGET_MIN,
  SPEC_TOTAL_MAX,
  SPEC_TOTAL_MIN,
  loadRules,
  saveRules,
  type CampaignRules,
} from "../../lib/campaignRules";

interface Props {
  campaignId: string;
  onClose: () => void;
}

// The Curator's table rules. Everything here is a house rule the app does NOT
// impose on its own — every default is "off". Saves on each change.
export function TableRules({ campaignId, onClose }: Props) {
  const [rules, setRules] = useState<CampaignRules>(() => loadRules(campaignId));

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  function patch(p: Partial<CampaignRules>) {
    const before = rules;
    const next = { ...rules, ...p };
    const saved = saveRules(campaignId, next);
    setRules(saved);
    pushUndo({
      label: "table rules change",
      // setRules here only updates THIS dialog if it is still open; the saved
      // value is what every consumer reads, so the inverse is complete either way.
      undo: () => setRules(saveRules(campaignId, before)),
      redo: () => setRules(saveRules(campaignId, next)),
    });
  }

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="table-rules" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>Table Rules</span>
          <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
        </div>

        <div className="rule-block">
          <div className="rule-toggle">Specialty points per character</div>
          <p className="rule-note">
            The published rules give every character {SPEC_TOTAL}. Lower it for a
            grittier table, raise it for veterans. A single specialty still caps at
            {" "}{SPEC_MAX}.
          </p>
          <div className="rule-field">
            <span className="rule-field-label">Points</span>
            <input
              className="stat-input"
              type="number"
              min={SPEC_TOTAL_MIN}
              max={SPEC_TOTAL_MAX}
              value={rules.specTotal}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                patch({ specTotal: Number.isFinite(v) ? v : rules.specTotal });
              }}
            />
            {rules.specTotal !== SPEC_TOTAL && (
              <button className="icon-btn xs" onClick={() => patch({ specTotal: SPEC_TOTAL })} title="Back to the published rules">
                Reset to {SPEC_TOTAL}
              </button>
            )}
          </div>
        </div>

        <div className="rule-block">
          <label className="rule-toggle">
            <input type="checkbox" checked={rules.attrBudget} onChange={(e) => patch({ attrBudget: e.target.checked })} />
            <span>Enforce an attribute budget at creation</span>
          </label>
          <p className="rule-note">
            Attributes are rolled — seven straight d20s, averaging 73 total. Left off,
            the creator lets a player type whatever they like and a wall of 20s is
            possible. Switched on, the total is capped, so shaping a character costs
            something.
          </p>
          {rules.attrBudget && (
            <div className="rule-field">
              <span className="rule-field-label">Total attribute points</span>
              <input
                className="stat-input"
                type="number"
                min={ATTR_BUDGET_MIN}
                max={ATTR_BUDGET_MAX}
                value={rules.attrBudgetPoints}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  patch({ attrBudgetPoints: Number.isFinite(v) ? v : rules.attrBudgetPoints });
                }}
              />
              <span className="rule-hint">70 is a slightly lean roll · 140 is seven 20s</span>
            </div>
          )}
        </div>

        <div className="rule-block">
          <label className="rule-toggle">
            <input type="checkbox" checked={rules.paradigmAffinity} onChange={(e) => patch({ paradigmAffinity: e.target.checked })} />
            <span>Paradigm Affinity dice</span>
          </label>
          <p className="rule-note">
            The published Favored-stat rule: a Roll Axis roll governed by a
            paradigm's Favored Attribute adds +1d5 per rank tier, a Favored
            Specialty adds +1d10, and a Convergence path (both Favored) adds
            both pools. On by default — turn it off for the flatter
            pre-Affinity math. Remnants pick their two extra Favored stats on
            the sheet's Roll Axis panel.
          </p>
        </div>

        <div className="rule-block">
          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={rules.autoApplyDeclared}
              onChange={(e) => patch({ autoApplyDeclared: e.target.checked })}
            />
            <span>Apply declared consequences without confirming</span>
          </label>
          <p className="rule-note">
            A resolution card normally asks twice — roll the damage, then apply
            it. Switched on, a card commits the consequences the ability's own
            page DECLARED: it rolls the declared dice, moves the target's HP and
            hangs the declared condition tag, and says so in the roll feed.
          </p>
          <p className="rule-note">
            Only what an author wrote in an <code>## Actions</code> block. Anything
            the app recovered from prose still waits for a click, because a
            reading of a sentence is a guess and a guess should not move a
            token's HP on its own — and a Curator ruling always waits, since a
            ruling is the page asking a human a question. Off by default: giving
            the app the keys is the table's decision, not the app's.
          </p>
        </div>

        <div className="rule-block">
          <label className="rule-toggle">
            <input type="checkbox" checked={rules.poolCompensation} onChange={(e) => patch({ poolCompensation: e.target.checked })} />
            <span>Proportional compensation on the core pools</span>
          </label>
          <p className="rule-note">
            When an attribute below 10 pays its dichotomy partner back, five of the
            seven routes land on a check modifier and two — Dexterity into DHP and
            Endurance into Movement — land on a pool. A flat +4 is most of a small
            Attack Power and almost nothing on a Defensive Hit Point total, so those
            two routes are effectively silent. Switch this on and the pools are paid
            a share of themselves instead ({Math.round(POOL_COMP_RATE * 100)}% per point),
            which puts them in the same band as the other five at any pool size.
          </p>
          <p className="rule-note">
            This is a straight buff to characters who dumped Dexterity or Endurance
            and trained the opposite side. Off by default, because every existing
            sheet was built under the flat version.
          </p>
        </div>

        <p className="rule-foot">
          These apply to this campaign only, and they are live: every sheet in the
          vault is measured against the current numbers, so lowering a cap flags the
          characters that no longer fit rather than quietly grandfathering them.
        </p>
      </div>
    </div>
  );
}
