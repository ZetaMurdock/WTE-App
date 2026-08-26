// `Invoke: <name>` — one ability running another's declared steps.
//
// The corpus composes by name and always has. S4 — THE LAST WAR (Warfare) says
// "All environmental objects within 60 ft are simultaneously Weaponized.
// Maximum Hollow Shell reanimations (10 fallen units) activate immediately.
// Trixt Link extends to 500 ft" — three abilities called by name inside a
// fourth. Restating their rules on The Last War's page would be the same rule
// written twice, which is the drift `abilityLint` exists to catch; so the
// engine resolves the reference instead.
//
// WHAT THIS MODULE REFUSES TO DO, and why each refusal is load-bearing:
//
//  - It does not resolve by name when an id is available. `abilityCatalog`
//    tries the permanent id first, and every official record carries one. A
//    name-first resolver breaks the moment a Curator renames a page — which is
//    a thing Curators do, and which would silently change which rules ran.
//
//  - It does not recurse without a floor. A page may invoke a page that
//    invokes it back; two pages that name each other are an easy authoring
//    slip and an infinite loop is a hung app, not an error message. The chain
//    is tracked, a repeat is reported as a cycle, and depth is capped besides.
//
//  - It does not swallow an unresolvable name. A page naming an ability this
//    campaign has no page for has claimed a step it will never take, which is
//    a lint finding on that page — the same severity an unreadable bullet gets.
//
//  - It does not convert prose. An invoked ability with no `## Actions` block
//    contributes nothing executable, and its own words are quoted for the
//    Curator to run by hand. That is the three-states rule the whole arc rests
//    on: no flag day, no forced conversion, and a partially declared corpus
//    that keeps working.
//
//  - It does not spend the invoked ability's price. See `costs` below.
import { parseAbilityEffects, type EffectStep } from "./abilityEffects";
import type { AbilityCatalog, CatalogAbility } from "./abilityCatalog";

/**
 * How far a chain of invocations may run.
 *
 * Four is well past anything the corpus writes — The Last War is one level
 * deep — and the cap is a backstop behind cycle detection rather than the
 * primary defence. It catches the case cycle detection cannot: a long chain of
 * DISTINCT pages, machine-generated or pasted, that would expand into a step
 * list no Curator could read even though nothing repeats.
 */
export const MAX_INVOKE_DEPTH = 4;

/**
 * What became of one written reference.
 *
 * `prose` is a SUCCESS, not a failure: the ability resolved, it simply has no
 * declared block, so what it does stays prose for a human. Only `unresolved`,
 * `cycle` and `depth` are faults.
 */
export type InvokeOutcome = "expanded" | "prose" | "unresolved" | "cycle" | "depth";

export interface Invocation {
  /** The reference exactly as the page wrote it. */
  ref: string;
  outcome: InvokeOutcome;
  /** 1 for a bullet on the page itself; 2 for one on the page that page invoked. */
  depth: number;
  /** The resolved record's permanent id, when it carries one. */
  abilityId?: string;
  /** The resolved record's CURRENT name, which is not necessarily `ref` — a
   *  page may still be naming an ability by a former name. */
  name?: string;
  /** `prose` — the invoked ability's own effect text, for the card to quote. */
  prose?: string;
  /** The steps this reference contributed, already branch-adjusted. */
  steps: EffectStep[];
  /**
   * Prices the invoked page declares, which are deliberately NOT part of
   * `steps` and are never spent by anything.
   *
   * Whether invoking an ability costs its SS is a rule the corpus states BOTH
   * ways in the same paradigm: S2 — ARMY OF ONE says "All Cipher active effects
   * are available without additional SS cost", while nothing on The Last War's
   * page says either. An engine that spliced the cost in would charge a table
   * that Army of One explicitly exempts; one that dropped it silently would
   * hand out a free Weaponize wherever no page had thought to say. So the price
   * is surfaced, unspent, and the Curator rules — which is the only answer that
   * is not the engine inventing a setting rule.
   */
  costs: EffectStep[];
  /** The chain of names that reached this reference, invoker first. Carried so
   *  a cycle can be REPORTED — "A → B → A" — rather than merely refused. */
  via: string[];
}

export interface ExpandedAbility {
  /**
   * The executable step list: the page's own steps with each `Invoke:` bullet
   * replaced, in place, by what it resolved to.
   *
   * In place because bullet order is meaning here — `parseAbilityEffects` binds
   * an `At N` threshold to the nearest track declared ABOVE it, and appending
   * an invoked track to the end would rebind nothing but would leave the two
   * lists disagreeing about which steps sit where.
   */
  steps: EffectStep[];
  /** One record per `Invoke:` bullet reached, in reading order: a page's own
   *  bullets in the order it wrote them, each followed by whatever the page it
   *  named went on to invoke. */
  invocations: Invocation[];
}

/** Was anything invoked at all? Every consumer wants the cheap answer first:
 *  the entire shipped corpus declares no `Invoke:`, and must behave exactly as
 *  it did before this module existed. */
export function hasInvocations(steps: readonly EffectStep[]): boolean {
  return steps.some((step) => step.verb === "invoke" && !!step.invoke);
}

/**
 * Did this reference fail to become something the table can act on?
 *
 * `prose` is not a fault: the ability resolved and simply declares nothing, so
 * quoting its words is the right outcome. Only a name nothing answers to, a
 * loop and an over-deep chain are faults, and they are the three that have to
 * reach a human — each one leaves the invoking page contributing nothing while
 * still looking complete.
 */
export function isInvokeFault(one: Invocation): boolean {
  return one.outcome !== "expanded" && one.outcome !== "prose";
}

/**
 * The key a chain is tracked by.
 *
 * The permanent id where there is one, so two pages naming the same ability by
 * two different former names are recognised as the same ability — a cycle
 * written through an alias is still a cycle, and is exactly the kind a human
 * proof-reading the pages would miss.
 */
function chainKey(record: CatalogAbility | null, ref: string): string {
  return record?.id ?? `name:${(record?.name ?? ref).trim().toLowerCase()}`;
}

/**
 * Carry the invoking bullet's branch onto a step that declared none.
 *
 * `Fail: Invoke: Weaponize` says the invocation happens on a failure. Splicing
 * Weaponize's steps in unchanged would arm every one of them with `always`, so
 * the damage would land whether the save was made or not — the page's branch
 * silently deleted by the act of resolving it. A step that declares its OWN
 * branch keeps it: the invoked page said when that step fires, and it said so
 * about its own resolution.
 */
function underBranch(step: EffectStep, branch: EffectStep["branch"]): EffectStep {
  if (branch === "always" || step.branch !== "always") return step;
  return { ...step, branch };
}

/**
 * Resolve every `Invoke:` in a step list, one level at a time, depth-first.
 *
 * The invoked page is parsed HERE rather than handed in pre-parsed, so there is
 * exactly one reader of an `## Actions` block in the app and a page cannot mean
 * one thing when it is used and another when it is invoked.
 */
export function expandInvocations(steps: readonly EffectStep[], catalog: AbilityCatalog): ExpandedAbility {
  const invocations: Invocation[] = [];

  function walk(current: readonly EffectStep[], depth: number, chain: readonly string[], keys: readonly string[]): EffectStep[] {
    const out: EffectStep[] = [];
    for (const step of current) {
      if (step.verb !== "invoke" || !step.invoke) {
        out.push(step);
        continue;
      }
      const ref = step.invoke;
      const record = catalog.lookup(ref);
      const via = [...chain, record?.name ?? ref];
      const base: Omit<Invocation, "outcome"> = {
        ref,
        depth,
        ...(record?.id ? { abilityId: record.id } : {}),
        ...(record ? { name: record.name } : {}),
        steps: [],
        costs: [],
        via,
      };
      if (!record) {
        invocations.push({ ...base, outcome: "unresolved" });
        continue;
      }
      const key = chainKey(record, ref);
      if (keys.includes(key)) {
        invocations.push({ ...base, outcome: "cycle" });
        continue;
      }
      if (depth > MAX_INVOKE_DEPTH) {
        invocations.push({ ...base, outcome: "depth" });
        continue;
      }
      const inner = parseAbilityEffects(record.actions);
      if (!inner.steps.length) {
        // Resolved, and it declares nothing executable. Its prose is the answer,
        // and the card quotes it rather than pretending the invocation did
        // something. `record.effect` may itself be empty — a page with neither
        // block nor prose — and the caller says so rather than showing a blank.
        invocations.push({ ...base, outcome: "prose", ...(record.effect ? { prose: record.effect } : {}) });
        continue;
      }
      // Recorded BEFORE the descent, so the list reads in the order a human
      // reads the pages: the invoker's bullet, then whatever that bullet's page
      // went on to invoke. Filling it in afterwards is the only way to get that
      // order out of a depth-first walk.
      const one: Invocation = { ...base, outcome: "expanded" };
      invocations.push(one);
      const expanded = walk(inner.steps, depth + 1, via, [...keys, key]);
      one.costs = expanded.filter((inner_) => inner_.verb === "cost");
      one.steps = expanded
        .filter((inner_) => inner_.verb !== "cost")
        .map((inner_) => underBranch(inner_, step.branch));
      out.push(...one.steps);
    }
    return out;
  }

  // The page's own steps are depth 0; a bullet ON it invokes at depth 1.
  return { steps: walk(steps, 1, [], []), invocations };
}

/** One sentence per invocation, addressed to whoever is looking at the page or
 *  the card. Shared so the lint panel and the VTT chip cannot describe the same
 *  resolution two different ways. */
export function invocationNote(one: Invocation): string {
  switch (one.outcome) {
    case "expanded":
      return `Invokes ${one.name} — ${one.steps.length} declared step${one.steps.length === 1 ? "" : "s"} run as part of this ability.`;
    case "prose":
      return `Invokes ${one.name}, which declares no steps — its prose is quoted for the Curator to run by hand.`;
    case "unresolved":
      return `Invokes "${one.ref}", which no ability in this campaign answers to — until a page carries that name, this ability claims a step it never takes.`;
    case "cycle":
      return `Invokes ${one.name}, which is already running: ${one.via.join(" → ")}. The chain is refused rather than followed.`;
    case "depth":
      return `Invokes ${one.name} more than ${MAX_INVOKE_DEPTH} levels deep (${one.via.join(" → ")}) — the chain stops here.`;
  }
}
