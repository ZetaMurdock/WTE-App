// What using an ability costs the character who used it.
//
// A page names its price twice: once in the header's `SS Cost` field, and once
// as `- Cost: 5 SS` in the `## Actions` block. Two sources for one number is the
// bug this module exists to prevent, so the reconciliation happens here ONCE and
// every surface asks rather than deciding for itself.
//
// The block wins where it speaks. That is the whole point of declaring, and it
// is also the only rule here that could surprise a table: an ability whose block
// says 6 and whose header says 5 now spends 6. Where the block says nothing
// about price the header still stands — a partial block declares what it
// declares and deletes nothing else.
//
// Only SS is spent. Health and Focus are real pools with real fields, but the
// sheet has no deliberate, undoable path into them from an ability row yet, and
// a cost quietly rounded into the wrong pool is worse than a cost not taken.
// They come back as `unhandled`, carrying the sentence the row prints, because
// a price nobody paid must be visible to the human who owes it. So does every
// other price this row cannot honestly take on one click: an upkeep, a rolled
// amount, a price the page hung on a branch nobody has rolled yet, and a price
// the page put on somebody else's sheet.
import { effectStepLabel, type EffectBranch, type EffectSelector, type EffectStep } from "./abilityEffects";
import type { InceptResource } from "./inceptGrants";

export interface AbilityCost {
  /** Stable across re-renders — steps have no identity of their own. */
  key: string;
  resource: InceptResource;
  /** The flat amount the page named. Null when it wrote dice: nothing rolls a
   *  price yet, and rolling one here would invent the number the page ducked. */
  amount: number | null;
  expr: string;
  /** An upkeep rather than a one-off price. */
  perRound: boolean;
  /** The resolution branch the page hung the price on. `effectStepLabel` prints
   *  no branch prefix on a Cost, so this is the ONLY place a conditional price
   *  is visible at all. */
  branch: EffectBranch;
  /** Whose pool the page charged. Defaults to the caster, but a page may write
   *  `- Cost (target): 5 SS`, and that is not the clicker's money. */
  who: EffectSelector;
  label: string;
}

/** A price this build will not take, and the reason the row says out loud. */
export interface UnspentCost {
  key: string;
  label: string;
  note: string;
}

export interface AbilityCostPlan {
  /** Which source named the number. Provenance for the tooltip, and the thing
   *  a table asks about first when a cost is not what they expected. */
  source: "declared" | "field";
  /** What one deliberate click deducts. Zero draws no button at all — the
   *  behaviour every ability with no price has always had. */
  ss: number;
  /** Prices left untaken, each already carrying its explanation. */
  unhandled: UnspentCost[];
  /** What the row warns when the pool cannot cover `ss`, and null when it can.
   *  A WARNING and not a veto: the sheet has always let a character overspend —
   *  `currentSS < 0` paints the reservoir red on purpose — and no page in the
   *  corpus writes a rule against it. Disabling the button would be this engine
   *  ruling on a table it does not sit at. */
  shortfall: string | null;
}

/** Flat amounts only. `EXPR_RE` in the grammar already allowed dice here, and a
 *  cost of "1d4 SS" is a real thing a page may write — it just is not a number
 *  this module may invent by rolling. */
function flatAmount(expr: string | undefined): number | null {
  if (!expr || !/^\d+$/.test(expr)) return null;
  const n = Number(expr);
  return Number.isFinite(n) ? n : null;
}

/**
 * The prices a declared block names, in the order the page wrote them.
 *
 * Order matters for the same reason it matters in `effectStepsToActions`: the
 * chips a row draws read top to bottom off the page, and a set that reordered
 * them would make the block and the row disagree about what the ability says.
 */
export function declaredCosts(steps: readonly EffectStep[]): AbilityCost[] {
  const out: AbilityCost[] = [];
  steps.forEach((step, i) => {
    if (step.verb !== "cost") return;
    out.push({
      key: `cost${i}`,
      // The grammar defaults a bare `- Cost: 6` to SS, and `resourceOf` has
      // already refused anything it could not name, so a step that reached here
      // without a resource is SS rather than an unknown pool.
      resource: step.resource ?? "ss",
      amount: flatAmount(step.expr),
      expr: step.expr ?? "",
      perRound: step.perRound === true,
      branch: step.branch,
      who: step.who,
      label: effectStepLabel(step),
    });
  });
  return out;
}

const RESOURCE_WORD: Readonly<Record<InceptResource, string>> = {
  ss: "SS",
  health: "Health",
  focus: "Focus",
};

/**
 * What the Use button on an ability row should do.
 *
 * `fieldSs` is the page's `SS Cost` header, `availableSs` the character's
 * unspent pool. Nothing here writes: the plan is handed to the row, and a human
 * clicking is what spends. A cost that deducted on render — or on merely opening
 * a row to read it — would charge a player for looking at their own sheet.
 */
export function abilityCostPlan(
  costs: readonly AbilityCost[],
  fieldSs: number,
  availableSs: number
): AbilityCostPlan {
  const source: AbilityCostPlan["source"] = costs.length > 0 ? "declared" : "field";
  const unhandled: UnspentCost[] = [];
  let ss = 0;

  if (source === "field") {
    ss = Math.max(0, Math.floor(fieldSs) || 0);
  } else {
    for (const cost of costs) {
      if (cost.who !== "self") {
        // `- Cost (target): 5 SS` is a price the page put on somebody else's
        // sheet. Taking it out of the pool of whoever pressed Use would charge
        // the caster for the target's expenditure, and the button says nothing
        // about whose money it is.
        unhandled.push({
          key: cost.key,
          label: cost.label,
          note: `This price is the ${cost.who === "target" ? "target's" : `${cost.who}'`}, not the caster's — take it on their sheet.`,
        });
        continue;
      }
      if (cost.branch !== "always") {
        // A price the page hung on a branch is not owed until the roll lands,
        // and this row spends before anything is rolled. Worse, `effectStepLabel`
        // prints a Cost with no branch prefix, so a chip reading "5 SS" would be
        // the only sign of a price that may never come due.
        unhandled.push({
          key: cost.key,
          label: cost.label,
          note: `Owed only on a ${cost.branch} — the row spends before the roll, so spend this one by hand.`,
        });
        continue;
      }
      if (cost.resource !== "ss") {
        unhandled.push({
          key: cost.key,
          label: cost.label,
          note: `${RESOURCE_WORD[cost.resource]} is not a pool an ability row spends — take it by hand.`,
        });
        continue;
      }
      if (cost.perRound) {
        // Charging the first tick on use would be this engine deciding when an
        // upkeep starts, which is a rule the page did not write and no round
        // clock here could enforce afterwards.
        unhandled.push({
          key: cost.key,
          label: cost.label,
          note: "An upkeep is spent each round it is sustained — nothing here keeps that clock.",
        });
        continue;
      }
      if (cost.amount == null) {
        unhandled.push({
          key: cost.key,
          label: cost.label,
          note: `Roll ${cost.expr} and spend it by hand — a rolled price is not one to guess at.`,
        });
        continue;
      }
      ss += cost.amount;
    }
  }

  return {
    source,
    ss,
    unhandled,
    shortfall: ss > availableSs ? `Overspends — needs ${ss}, ${availableSs} left` : null,
  };
}
