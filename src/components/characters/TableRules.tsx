import { useEffect, useState } from "react";
import { SPEC_MAX, SPEC_TOTAL } from "../../game/wte";
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
    const next = { ...rules, ...p };
    setRules(saveRules(campaignId, next));
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

        <p className="rule-foot">
          These apply to this campaign only, and they are live: every sheet in the
          vault is measured against the current numbers, so lowering a cap flags the
          characters that no longer fit rather than quietly grandfathering them.
        </p>
      </div>
    </div>
  );
}
