// Layered rule resolution with provenance.
//
// From the Codex concept doc, section 5: a rule is not one number, it is a stack of
// contributions, and the sheet should not just display the answer — it should be
// able to say where the answer came from:
//
//     Base W.T.E rule                     10
//     Ashen Sun campaign override         +4
//     Voaulton species rule               +2
//     Null Storm scene effect              -1
//                                           —
//     Final                                15
//
// That is impossible if a campaign's rules are one settings blob, because an
// override destroys what it replaced. Each contribution is stored separately with
// its scope and source, so the resolver can walk them in order and hand back both
// the value and the trail that produced it.
import { ID_SCOPES, scopeRank, type IdScope } from "./codexId";

/** How a layer changes the value beneath it. */
export type LayerOp = "set" | "add" | "multiply" | "min" | "max";

export interface RuleLayer {
  id: string;
  /** The concept this modifies, as a stable Codex id (see codexId.ts). */
  targetId: string;
  scope: IdScope;
  /** Which campaign, pack, character or session effect owns this layer. */
  owner?: string;
  op: LayerOp;
  value: number;
  /** Human-readable source, shown in the breakdown ("Ashen Sun campaign override"). */
  note?: string;
  /** A disabled layer stays on record but does not contribute — so a Curator can
   *  switch a house rule off without losing it. */
  enabled?: boolean;
}

export interface Contribution {
  /** What this step did to the running value. */
  op: LayerOp;
  value: number;
  scope: IdScope;
  note: string;
  /** The running total AFTER this step, so a breakdown can show the walk. */
  runningTotal: number;
}

export interface Resolved {
  /** The final value every consumer should use. */
  value: number;
  /** The official starting point, before any layer. */
  base: number;
  /** Every contribution in application order — the breakdown. */
  trail: Contribution[];
  /** True when anything other than the official rule participated. */
  overridden: boolean;
}

function applyOp(current: number, op: LayerOp, value: number): number {
  switch (op) {
    case "set":
      return value;
    case "add":
      return current + value;
    case "multiply":
      return current * value;
    case "min":
      return Math.max(current, value); // a MINIMUM raises the value to at least `value`
    case "max":
      return Math.min(current, value); // a MAXIMUM caps it
    default:
      return current;
  }
}

/**
 * Resolve a value from its official base plus every applicable layer.
 *
 * Layers apply weakest scope first (wte < pack < campaign < character < session),
 * and within one scope in the order given, so a later contribution from the same
 * source stacks predictably rather than depending on array order across scopes.
 */
export function resolveRule(base: number, layers: RuleLayer[]): Resolved {
  const active = layers
    .filter((l) => l.enabled !== false)
    .slice()
    .sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));

  let value = base;
  const trail: Contribution[] = [];
  for (const l of active) {
    const before = value;
    value = applyOp(value, l.op, l.value);
    // A layer that changes nothing is still recorded: "this rule applied and had no
    // effect" is different from "this rule was not in play", and a Curator
    // debugging their table needs to tell them apart.
    trail.push({
      op: l.op,
      value: l.value,
      scope: l.scope,
      note: l.note ?? `${l.scope}${l.owner ? " · " + l.owner : ""}`,
      runningTotal: value,
    });
    void before;
  }

  return { value, base, trail, overridden: active.length > 0 };
}

/** Render the breakdown as lines, in the shape the concept doc asks for. Returns
 *  label/value pairs so the UI can lay them out rather than parsing a string. */
export function explain(r: Resolved, baseLabel = "Base W.T.E rule"): { label: string; value: string }[] {
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const rows = [{ label: baseLabel, value: String(r.base) }];
  for (const c of r.trail) {
    const v =
      c.op === "add"
        ? sign(c.value)
        : c.op === "set"
          ? `= ${c.value}`
          : c.op === "multiply"
            ? `x ${c.value}`
            : c.op === "min"
              ? `at least ${c.value}`
              : `at most ${c.value}`;
    rows.push({ label: c.note, value: v });
  }
  rows.push({ label: "Final", value: String(r.value) });
  return rows;
}

/** Layers relevant to one target, filtered to the campaign in play. A layer with no
 *  owner is global; one owned by another campaign must not leak in. */
export function layersFor(all: RuleLayer[], targetId: string, opts?: { campaignId?: string }): RuleLayer[] {
  return all.filter((l) => {
    if (l.targetId !== targetId) return false;
    if (l.scope === "campaign" && opts?.campaignId && l.owner && l.owner !== opts.campaignId) return false;
    return true;
  });
}

/** Every scope in application order — for a UI that lists the layer stack. */
export const LAYER_ORDER: readonly IdScope[] = ID_SCOPES;
