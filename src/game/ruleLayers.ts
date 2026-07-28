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
  /** Stable id of the campaign, pack, character or session effect that owns this
   *  layer — never a display name, since those change. */
  owner?: string;
  op: LayerOp;
  value: number;
  /** Human-readable source, shown in the breakdown ("Ashen Sun campaign override"). */
  note?: string;
  /** A disabled layer stays on record but does not contribute — so a Curator can
   *  switch a house rule off without losing it. */
  enabled?: boolean;
  /** Explicit ordering WITHIN a scope. `set`, `multiply` and `add` are not
   *  commutative, so two campaign layers can produce different answers depending
   *  on which applies first. Without this the row order the database happened to
   *  return would decide the mechanics. Lower runs first; ties fall back to the
   *  order given, which keeps existing behaviour for layers that never set it. */
  order?: number;
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
  // Scope first, then the explicit order within a scope, then the order given.
  // A stable sort on the index keeps layers that declare no order exactly where
  // the caller put them.
  const active = layers
    .filter((l) => l.enabled !== false)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const s = scopeRank(a.l.scope) - scopeRank(b.l.scope);
      if (s !== 0) return s;
      const o = (a.l.order ?? 0) - (b.l.order ?? 0);
      if (o !== 0) return o;
      return a.i - b.i;
    })
    .map((x) => x.l);

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

/** The context a layer stack is resolved against. Every owned scope needs its own
 *  id, all of them stable ids rather than display names. */
export interface LayerContext {
  campaignId?: string;
  /** Stable ids of the content packs enabled for this table. */
  packIds?: string[];
  characterId?: string;
  sessionId?: string;
}

/**
 * Layers relevant to one target, filtered to the context in play.
 *
 * Every OWNED scope is checked, not just campaign. The previous version only kept
 * another campaign's layers out, which was fine while campaign was the only scope
 * with real data — but a character exception or a temporary session effect would
 * have leaked into every other character and every later session the moment those
 * scopes gained consumers. Better to close it before that happens than to debug a
 * table where one player's exception is silently applying to everyone.
 *
 * An owned layer with NO owner set is treated as not-in-context rather than global:
 * a character exception that forgot to say whose it is should apply to nobody, not
 * to everybody. Only `wte` (official) is unconditionally in play.
 */
export function layersFor(all: RuleLayer[], targetId: string, ctx: LayerContext = {}): RuleLayer[] {
  return all.filter((l) => {
    if (l.targetId !== targetId) return false;
    switch (l.scope) {
      case "wte":
        return true;
      case "pack":
        return !!l.owner && (ctx.packIds ?? []).includes(l.owner);
      case "campaign":
        return !!l.owner && l.owner === ctx.campaignId;
      case "character":
        return !!l.owner && l.owner === ctx.characterId;
      case "session":
        return !!l.owner && l.owner === ctx.sessionId;
      default:
        return false;
    }
  });
}

/** Every scope in application order — for a UI that lists the layer stack. */
export const LAYER_ORDER: readonly IdScope[] = ID_SCOPES;
