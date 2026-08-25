// What an Incept actually DOES, as data the engine can act on.
//
// Every one of the 62 shipped Incepts stated its mechanics in prose, and none of
// it reached a roll. Worse, the prose predates Roll Axis, so it names things the
// system no longer has: "+4 to all specialties" (there are seven named specialty
// sources, not one pool), "Advantage on Action Priority" (AP is the ATTRIBUTE of
// the Density path, not a roll), "Disadvantage on Dexterity saves" (the old name
// for Physical Save — Evasion). Some carried their own arithmetic — "roll a d6,
// multiply by your Incept count as a decimal, plus your rank multiplier" — which
// nothing but a human could execute.
//
// An Incept now declares GRANTS in the same vocabulary the rest of the app
// speaks. Deliberately narrow: an Incept changes HOW you roll and WHAT resources
// move, never what your stats are. Flat stat bonuses are what made the old pool
// wonky — every lineage inflating the same numbers by different amounts — and
// they are not expressible here on purpose.
import { ROLL_AXIS_PATHS, type RollAxis, type RollDirection } from "./rollAxis";

export type InceptGrantKind = "advantage" | "disadvantage" | "damage" | "restore" | "cost";
/** Pools an Incept may move. Derived STATS are deliberately absent — an Incept
 *  spends and restores, it does not raise a number permanently. */
export type InceptResource = "ss" | "health" | "focus";

export interface InceptRollRef {
  axis: RollAxis;
  direction: RollDirection;
  path: (typeof ROLL_AXIS_PATHS)[number]["id"];
}

/** Advantage/disadvantage on one Roll Axis route. `target` says who rolls it:
 *  an Incept that hobbles an opponent is a different rule from one that helps
 *  its owner, and the old prose left that to be inferred from a sentence. */
export interface InceptRollGrant {
  kind: "advantage" | "disadvantage";
  on: InceptRollRef;
  target: "self" | "target";
  note?: string;
}

export interface InceptResourceGrant {
  kind: "damage" | "restore" | "cost";
  /** Dice or a flat amount, e.g. "3d10", "40". Validated on parse. */
  expr: string;
  /** damage only — "Entropy", "Radiant", … */
  damageType?: string;
  /** restore/cost only. */
  resource?: InceptResource;
  note?: string;
}

export type InceptGrant = InceptRollGrant | InceptResourceGrant;

export function isRollGrant(grant: InceptGrant): grant is InceptRollGrant {
  return grant.kind === "advantage" || grant.kind === "disadvantage";
}

const PATH_BY_NAME = new Map(ROLL_AXIS_PATHS.map((path) => [path.name.toLowerCase(), path]));
const RESOURCE_WORDS: Readonly<Record<string, InceptResource>> = {
  ss: "ss",
  "synaptic space": "ss",
  synaptic: "ss",
  hp: "health",
  health: "health",
  "health pool": "health",
  focus: "focus",
  "synaptic focus": "focus",
};
/** A dice expression or a flat number. Anything else is an authoring error, not
 *  a value to guess at. */
const EXPR_RE = /^\d*d\d+(?:\s*[+-]\s*\d+)?$|^\d+$/i;

/** The one resource vocabulary. Exported so the `## Actions` grammar names
 *  pools the same way `## Grants` does — two spellings of "SS" would be two
 *  rules. */
export function resourceOf(word: string): InceptResource | undefined {
  const key = word.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RESOURCE_WORDS, key) ? RESOURCE_WORDS[key] : undefined;
}

/**
 * `Physical Save — Evasion` → a checked Roll Axis route.
 *
 * Returns null for a route the system does not have. Evasion is a save and has
 * no check; Power is a check and has no save. Silently accepting either would
 * put an Incept on a roll that can never happen.
 */
export function parseRollRef(text: string): InceptRollRef | null {
  const m = text.match(/(physical|mental)\s+(check|save)\s*[—–\-:·]\s*([A-Za-z ]+)/i);
  if (!m) return null;
  const axis = m[1].toLowerCase() as RollAxis;
  const direction = m[2].toLowerCase() as RollDirection;
  const path = PATH_BY_NAME.get(m[3].trim().toLowerCase());
  if (!path || path.axis !== axis || !path.directions.includes(direction)) return null;
  return { axis, direction, path: path.id };
}

/** How a route reads back to a Curator, in the same words a page is authored in. */
export function rollRefLabel(ref: InceptRollRef): string {
  const path = ROLL_AXIS_PATHS.find((p) => p.id === ref.path);
  const axis = ref.axis === "physical" ? "Physical" : "Mental";
  const direction = ref.direction === "check" ? "Check" : "Save";
  return `${axis} ${direction} — ${path?.name ?? ref.path}`;
}

export interface GrantParse {
  grants: InceptGrant[];
  /** Lines that looked like grants but were not usable, for the page's skip
   *  report. An Incept with an unreadable grant must say so rather than quietly
   *  granting nothing. */
  errors: string[];
}

const GRANT_LINE =
  /^\s*[-*]\s*(Advantage|Disadvantage|Damage|Restore|Cost)\s*(\(target\))?\s*:\s*(.+?)\s*$/i;

/**
 * Read a `## Grants` section.
 *
 *     - Advantage: Physical Check — Power
 *     - Disadvantage (target): Physical Save — Evasion
 *     - Damage: 3d10 Entropy
 *     - Restore: 1d50 SS
 *     - Cost: 10 SS
 */
export function parseInceptGrants(section: string): GrantParse {
  const grants: InceptGrant[] = [];
  const errors: string[] = [];
  for (const raw of (section || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(GRANT_LINE);
    if (!m) {
      if (/^\s*[-*]\s/.test(line)) errors.push(`unreadable grant: ${line}`);
      continue;
    }
    const kind = m[1].toLowerCase() as InceptGrantKind;
    const targeted = !!m[2];
    const body = m[3];

    if (kind === "advantage" || kind === "disadvantage") {
      const on = parseRollRef(body);
      if (!on) {
        errors.push(`not a Roll Axis route: ${body}`);
        continue;
      }
      // Advantage on someone else's roll is disadvantage worn backwards; keeping
      // both spellings would let one rule be written two ways.
      grants.push({ kind, on, target: targeted ? "target" : "self" });
      continue;
    }

    const parts = body.split(/\s+/);
    const expr = parts.shift() ?? "";
    if (!EXPR_RE.test(expr)) {
      errors.push(`not a dice or flat amount: ${body}`);
      continue;
    }
    const rest = parts.join(" ").trim();
    if (kind === "damage") {
      grants.push({ kind, expr, damageType: rest || undefined });
      continue;
    }
    const resource = resourceOf(rest);
    if (!resource) {
      errors.push(`unknown resource: ${rest || "(none given)"}`);
      continue;
    }
    grants.push({ kind, expr, resource });
  }
  return { grants, errors };
}

/** A grant as a chip the sheet and the VTT can show. */
export function grantLabel(grant: InceptGrant): string {
  if (isRollGrant(grant)) {
    const who = grant.target === "target" ? "Target" : "You";
    const word = grant.kind === "advantage" ? "Advantage" : "Disadvantage";
    return `${who}: ${word} on ${rollRefLabel(grant.on)}`;
  }
  if (grant.kind === "damage") return `${grant.expr} ${grant.damageType ?? "damage"}`.trim();
  const resource = grant.resource === "ss" ? "SS" : grant.resource === "health" ? "Health" : "Focus";
  return `${grant.kind === "restore" ? "Restore" : "Cost"} ${grant.expr} ${resource}`;
}
