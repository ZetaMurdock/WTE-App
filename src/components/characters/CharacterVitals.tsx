import { signedMod, type Derived } from "../../game/wte";

type FullDerived = Derived & { hpMax: number };

interface Props {
  /** Derived stats WITH equipment / loadout applied (the authoritative values). */
  derived: FullDerived;
  /** Derived stats WITHOUT equipment, so we can show the gear contribution. */
  derivedBase: FullDerived;
  /** Synaptic Space already spent (current = max − spent). */
  ssSpent: number;
  /** Damage taken to HP (current HP = hpMax − hpDamage). */
  hpDamage?: number;
  /** Damage taken to DHP (current DHP = dhpMax − dhpDamage). */
  dhpDamage?: number;
  /** Whether the viewer can edit/curate vitals. */
  curator?: boolean;
  /** Callback to push vital changes to the sheet. */
  onUpdateVitals?: (patch: {
    hpDamage?: number;
    dhpDamage?: number;
    ssSpent?: number;
    hpMaxOverride?: number;
    dhpOverride?: number;
  }) => void;
}

const ORBS = 10; // 2 rows of 5 — a symmetrical cluster per vital

/** How many orbs are lit for a value (each orb ≈ `perOrb` points), clamped 0..ORBS. */
function litOrbs(value: number, perOrb: number): number {
  return Math.max(0, Math.min(ORBS, Math.round(value / perOrb)));
}

// Compact, symmetrical vitals — Health / Def. HP / Movement / Synaptic Space —
// each shown as an orb gauge whose lit orbs fall as the value falls, plus
// direct reduction/restore controls for Curators & players.
export function CharacterVitals({
  derived,
  derivedBase,
  ssSpent,
  hpDamage = 0,
  dhpDamage = 0,
  curator = false,
  onUpdateVitals,
}: Props) {
  const maxHP = derived.hpMax;
  const currentHP = Math.max(0, maxHP - hpDamage);

  const maxDHP = derived.dhp;
  const currentDHP = Math.max(0, maxDHP - dhpDamage);

  const maxSS = derived.ss;
  const currentSS = Math.max(0, maxSS - ssSpent);

  function promptSetCurrentHP() {
    if (!onUpdateVitals) return;
    const input = prompt(`Set Current HP (0..${maxHP}):`, String(currentHP));
    if (input === null) return;
    const val = parseInt(input.trim(), 10);
    if (!Number.isFinite(val)) return;
    const clamped = Math.max(0, Math.min(maxHP, val));
    onUpdateVitals({ hpDamage: maxHP - clamped });
  }

  function promptSetTotalHP() {
    if (!onUpdateVitals) return;
    const input = prompt(`Set Total HP (Max):`, String(maxHP));
    if (input === null) return;
    const val = parseInt(input.trim(), 10);
    if (!Number.isFinite(val) || val < 0) return;
    onUpdateVitals({ hpMaxOverride: val });
  }

  function promptSetDHP() {
    if (!onUpdateVitals) return;
    const input = prompt(`Set Current DHP (0..${maxDHP}):`, String(currentDHP));
    if (input === null) return;
    const val = parseInt(input.trim(), 10);
    if (!Number.isFinite(val)) return;
    const clamped = Math.max(0, Math.min(maxDHP, val));
    onUpdateVitals({ dhpDamage: maxDHP - clamped });
  }

  function promptSetSS() {
    if (!onUpdateVitals) return;
    const input = prompt(`Set Current Synaptic Space (0..${maxSS}):`, String(currentSS));
    if (input === null) return;
    const val = parseInt(input.trim(), 10);
    if (!Number.isFinite(val)) return;
    const clamped = Math.max(0, Math.min(maxSS, val));
    onUpdateVitals({ ssSpent: maxSS - clamped });
  }

  const tiles = [
    {
      key: "hp",
      label: "Health",
      num: `${currentHP}/${maxHP}`,
      lit: litOrbs(currentHP, Math.max(1, maxHP / ORBS)),
      delta: derived.hpMax - derivedBase.hpMax,
      accent: "hp",
      onLower: () => onUpdateVitals?.({ hpDamage: hpDamage + 1 }),
      onRaise: () => onUpdateVitals?.({ hpDamage: Math.max(0, hpDamage - 1) }),
      onEditVal: promptSetCurrentHP,
      onEditMax: promptSetTotalHP,
      lowerTitle: "Reduce Health (take 1 damage)",
      raiseTitle: "Restore 1 Health",
    },
    {
      key: "dhp",
      label: "Def. HP",
      num: `${currentDHP}/${maxDHP}`,
      lit: litOrbs(currentDHP, Math.max(1, maxDHP / ORBS)),
      delta: derived.dhp - derivedBase.dhp,
      accent: "dhp",
      onLower: () => onUpdateVitals?.({ dhpDamage: dhpDamage + 1 }),
      onRaise: () => onUpdateVitals?.({ dhpDamage: Math.max(0, dhpDamage - 1) }),
      onEditVal: promptSetDHP,
      onEditMax: undefined,
      lowerTitle: "Reduce Def. HP by 1",
      raiseTitle: "Restore 1 Def. HP",
    },
    {
      key: "mv",
      label: "Movement",
      num: `${derived.mv}`,
      lit: litOrbs(derived.mv, 2),
      delta: derived.mv - derivedBase.mv,
      accent: "mv",
      onLower: undefined,
      onRaise: undefined,
      onEditVal: undefined,
      onEditMax: undefined,
      lowerTitle: "",
      raiseTitle: "",
    },
    {
      key: "ss",
      label: "Syn. Space",
      num: `${currentSS}/${maxSS}`,
      lit: litOrbs(currentSS, Math.max(1, maxSS / ORBS)),
      delta: derived.ss - derivedBase.ss,
      accent: "ss",
      onLower: () => onUpdateVitals?.({ ssSpent: ssSpent + 1 }),
      onRaise: () => onUpdateVitals?.({ ssSpent: Math.max(0, ssSpent - 1) }),
      onEditVal: promptSetSS,
      onEditMax: undefined,
      lowerTitle: "Spend / Reduce Synaptic Space by 1",
      raiseTitle: "Restore 1 Synaptic Space",
    },
  ];

  return (
    <div className="vitals-bar">
      {tiles.map((t) => (
        <div className={"vital-cell vital-" + t.accent} key={t.key}>
          <span className="vital-cap">{t.label}</span>
          <div className="vital-orbs" aria-label={`${t.lit} of ${ORBS}`}>
            {Array.from({ length: ORBS }).map((_, i) => (
              <span key={i} className={"vorb" + (i < t.lit ? " on" : "")} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span className="vital-num">
              {t.onEditVal && onUpdateVitals ? (
                <button
                  className="vital-num-btn"
                  onClick={t.onEditVal}
                  title="Click to set current value manually"
                >
                  {t.num}
                </button>
              ) : (
                t.num
              )}
              {t.delta !== 0 && (
                <em className={"vital-delta" + (t.delta < 0 ? " neg" : "")}>
                  {signedMod(t.delta)}
                </em>
              )}
            </span>
          </div>
          {onUpdateVitals && t.onLower && t.onRaise && (
            <div className="vital-ctrls">
              <button
                className="vital-btn neg"
                onClick={t.onLower}
                title={t.lowerTitle}
              >
                −
              </button>
              <button
                className="vital-btn pos"
                onClick={t.onRaise}
                title={t.raiseTitle}
              >
                +
              </button>
              {t.key === "hp" && t.onEditMax && (
                <button
                  className="vital-btn"
                  onClick={t.onEditMax}
                  title="Set Total HP (Max HP) override"
                  style={{ width: "auto", padding: "0 5px", fontSize: "9px" }}
                >
                  Max
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
