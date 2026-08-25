import { useState } from "react";
import { rollToHit, rollGeneric, rollDiceExpr, signedMod, type UsableAbility, type RollResult } from "../../game/wte";
import { averageDamage, summarizeDamage } from "../../game/abilityDamage";
import { parseAbilityActions } from "../../game/abilityActions";
import { rollAxisChoices, rollAxisPaths, rollAxisRoll, type RollAxisStats } from "../../game/rollAxis";
import { abilitySaveDv, saveDvBreakdown, savePlainLabel } from "../../game/saveDv";
import { affinityLabel } from "../../game/paradigmAffinity";
import { isRangedWeapon, weaponDomainsMet } from "../../lib/codex";
import type { Weapon } from "../../models/codex";
import { RollButton } from "./RollButton";

type Cat = "attack" | "genus" | "cipher";
type Row =
  | { kind: "weapon"; cat: "attack"; key: string; w: Weapon }
  | { kind: "ability"; cat: "genus" | "cipher"; key: string; a: UsableAbility };

interface Props {
  weapons: Weapon[];
  genus: UsableAbility[];
  ciphers: UsableAbility[];
  atk: number;
  phyMod: number;
  dexMod: number;
  paradigmId?: string;
  onRoll: (roll: RollResult) => void;
  onSpend: (cost: number) => void;
  /** When supplied, ability rows resolve their effect text through the Roll
   *  Axis pipeline — the same routes and Codex formulas the Roll Axis panel
   *  uses — instead of offering one flat d20. */
  rollAxisStats?: RollAxisStats;
  onManage: () => void;
  /** Open the genus-vs-genus contest for one ability (genus rows only). */
  onContest?: (a: UsableAbility) => void;
}

const FILTERS: { id: "all" | Cat; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attack", label: "Attack" },
  { id: "genus", label: "Genus" },
  { id: "cipher", label: "Cipher" },
];

// The unified combat surface: equipped weapons + genus + ciphers as one filterable table.
export function ActionsTable({ weapons, genus, ciphers, atk, phyMod, dexMod, paradigmId, onRoll, onSpend, onManage, onContest, rollAxisStats }: Props) {
  const [filter, setFilter] = useState<"all" | Cat>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [ocOpen, setOcOpen] = useState(false);

  const rows: Row[] = [
    ...weapons.map((w) => ({ kind: "weapon" as const, cat: "attack" as const, key: "w:" + w.name, w })),
    ...genus.map((a) => ({ kind: "ability" as const, cat: "genus" as const, key: "g:" + a.name, a })),
    ...ciphers.map((a) => ({ kind: "ability" as const, cat: "cipher" as const, key: "c:" + a.name, a })),
  ];
  const shown = rows.filter((r) => filter === "all" || r.cat === filter);

  function hitOf(w: Weapon): number {
    return atk + (isRangedWeapon(w) ? dexMod : phyMod);
  }
  function toggle(key: string) {
    setOcOpen(false);
    setOpen((k) => (k === key ? null : key));
  }

  function weaponRow(w: Weapon, key: string) {
    const hit = hitOf(w);
    const expanded = open === key;
    const domainOk = weaponDomainsMet(w.domain, paradigmId);
    return (
      <div className={"act-row-wrap" + (expanded ? " open" : "")} key={key}>
        <button className="act-row" onClick={() => toggle(key)}>
          <span className="act-name">
            <span className="act-title">{w.name}</span>
            <span className="act-sub">{isRangedWeapon(w) ? "Ranged" : "Melee"}{w.domain ? " · " + w.domain : ""}</span>
          </span>
          <span className="act-range">{w.range || (isRangedWeapon(w) ? "Ranged" : "5 ft")}</span>
          <span className="act-hit">{signedMod(hit)}</span>
          <span className="act-dmg">{w.damage || "—"}</span>
          <span className="act-cost">—</span>
          <span className="act-notes">{w.effect || "—"}</span>
        </button>
        {expanded && (
          <div className="act-detail">
            {w.effect && <p className="act-effect">{w.effect}</p>}
            {w.ede && w.overclock ? (
              domainOk ? (
                <div className="overclock-block">
                  <button className="chip accent" onClick={() => setOcOpen((o) => !o)}>{ocOpen ? "Hide Overclock" : "Overclock"}</button>
                  {ocOpen && <p className="act-effect oc">{w.overclock.text}</p>}
                </div>
              ) : (
                <div className="oc-locked">Overclock locked — needs {w.domain}</div>
              )
            ) : null}
            <div className="act-actions">
              <RollButton className="roll-btn" make={(mode) => rollToHit(`${w.name} attack`, hit, mode)} onLocal={onRoll}>
                Roll d20 {signedMod(hit)}
              </RollButton>
            </div>
          </div>
        )}
      </div>
    );
  }

  function abilityRow(a: UsableAbility, cat: Cat, key: string) {
    const expanded = open === key;
    // The Damage column shows what the ability DEALS, read out of its effect
    // text — it used to show the SS cost, which reads as "Lark deals 5 damage".
    const dmg = summarizeDamage(a.effect, a.classification);
    // What the effect text actually calls for: Roll Axis checks the character
    // makes, damage dice the ability deals, and target-side saves with their
    // DVs. Parsed only for the open row — this runs prose regexes.
    const actions = expanded ? parseAbilityActions(a.effect) : [];
    const selfAxis = rollAxisStats ? actions.filter((x) => x.kind === "self" && x.rollAxis) : [];
    // Plain stat checks ("make an Endurance Check") still get a labelled d20 —
    // dropping them left abilities whose check could not be rolled at all.
    const selfPlain = actions.filter((x) => x.kind === "self" && (!x.rollAxis || !rollAxisStats));
    const dmgActs = actions.filter((x) => x.kind === "damage" && x.expr);
    const saves = actions.filter((x) => x.kind === "save");
    return (
      <div className={"act-row-wrap" + (expanded ? " open" : "")} key={key}>
        <button className="act-row" onClick={() => toggle(key)}>
          <span className="act-name">
            <span className="act-title">{a.name}</span>
            <span className="act-sub">
              {cat === "genus" ? "Genus" : "Cipher"}
              {a.domain ? " · " + a.domain : ""}
              {a.focus ? " · Focus " + a.focus : ""}
            </span>
          </span>
          <span className="act-range">{a.range || "Self"}</span>
          <span className="act-hit">—</span>
          <span className={"act-dmg" + (dmg.none ? " kindly" : "")} title={dmg.none ? "Deals no damage" : `Average ${averageDamage(dmg)}`}>
            {dmg.label}
          </span>
          <span className="act-cost">{a.ssNote || (a.ss ? a.ss + " SS" : "—")}</span>
          <span className="act-notes">{a.effect || "—"}</span>
        </button>
        {expanded && (
          <div className="act-detail">
            {a.effect && <p className="act-effect">{a.effect}</p>}
            <div className="act-meta">
              {a.target ? <span>Target · {a.target}</span> : null}
              {a.activation ? <span>Activation · {a.activation}</span> : null}
            </div>
            {/* Target-side resolutions are information, not buttons — the sheet
                has no target to ask. The DV shown is keyed to THIS character
                (21 + their check modifier on the ability's paired path), so it
                tracks Rank, gear and Codex overrides; the page's printed DV
                stays in the tooltip as provenance. */}
            {saves.length > 0 && (
              <div className="act-saves">
                {saves.map((sv, i) => {
                  const keyed = rollAxisStats ? abilitySaveDv(sv, actions, rollAxisStats) : null;
                  return (
                    <span
                      className="act-save-chip"
                      key={i}
                      title={keyed ? `The target makes this roll · ${saveDvBreakdown(keyed)}` : "The target makes this roll"}
                    >
                      vs {keyed ? `${savePlainLabel(sv)} · DV ${keyed.dv}` : sv.label}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="act-actions">
              {a.ss > 0 ? <button className="ghost-btn" onClick={() => onSpend(a.ss)}>Use −{a.ss} SS</button> : null}
              {cat === "genus" && onContest && (
                <button className="ghost-btn" onClick={() => onContest(a)} title="Resolve this against another genus">
                  Contest…
                </button>
              )}
              {rollAxisStats &&
                selfAxis.map((act, i) => {
                  const path = rollAxisPaths(act.rollAxis!.axis, act.rollAxis!.direction).find(
                    (candidate) => candidate.id === act.rollAxis!.path
                  );
                  if (!path) return null;
                  return (
                    <span className="act-axis-group" key={"ax" + i}>
                      <span className="act-axis-label">{act.label}</span>
                      {rollAxisChoices(path, act.rollAxis!.direction, rollAxisStats).map((choice) => (
                        <RollButton
                          key={choice.source}
                          className="roll-btn axis"
                          title={`${choice.sourceLabel} ${signedMod(choice.sourceMod)} plus ${path.derived.label} ${signedMod(choice.derivedMod)}`}
                          make={(mode) => rollAxisRoll(choice, mode)}
                          onLocal={onRoll}
                        >
                          {choice.sourceLabel} d{choice.die} {signedMod(choice.totalMod)}
                          {choice.affinity ? ` ${affinityLabel(choice.affinity)}` : ""}
                        </RollButton>
                      ))}
                    </span>
                  );
                })}
              {selfPlain.map((act, i) => (
                <RollButton
                  key={"sp" + i}
                  className="roll-btn"
                  make={(mode) => rollGeneric(`${a.name} — ${act.label}`, mode)}
                  onLocal={onRoll}
                >
                  {act.label}
                </RollButton>
              ))}
              {dmgActs.map((act, i) => (
                <RollButton
                  key={"dm" + i}
                  className="roll-btn dmg"
                  // A curator typo ("1d1", "0d6") makes rollDiceExpr null; fall
                  // back to a plain d20 rather than crashing the sheet on click.
                  make={(mode) => rollDiceExpr(`${a.name} — ${act.label}`, act.expr!, mode) ?? rollGeneric(`${a.name} — ${act.label}`, mode)}
                  onLocal={onRoll}
                >
                  {act.label}
                </RollButton>
              ))}
              {selfAxis.length === 0 && selfPlain.length === 0 && dmgActs.length === 0 && (
                <RollButton className="roll-btn" make={(mode) => rollGeneric(a.name, mode)} onLocal={onRoll}>Roll d20</RollButton>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="act-table">
      <div className="act-toolbar">
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button key={f.id} className={"chip" + (filter === f.id ? " active" : "")} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="link-btn" onClick={onManage}>Manage loadout</button>
      </div>

      {shown.length === 0 ? (
        <p className="list-empty">No actions here — equip weapons or abilities in Loadout.</p>
      ) : (
        // Rows scroll inside the rail (~5 visible) instead of growing the page.
        // The header lives INSIDE the scroll container (sticky) so its grid
        // resolves against the same width as the rows when the scrollbar shows.
        <div className="act-scroll">
          <div className="act-head">
            <span>Name</span><span>Range</span><span>Hit</span><span>Damage</span><span>Cost</span><span>Notes</span>
          </div>
          {shown.map((r) => (r.kind === "weapon" ? weaponRow(r.w, r.key) : abilityRow(r.a, r.cat, r.key)))}
        </div>
      )}
    </div>
  );
}
