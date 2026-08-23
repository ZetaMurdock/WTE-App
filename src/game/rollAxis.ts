import { rollDiceExpr, type AttrKey, type DerivedKey, type RollMode, type RollResult, type SpecKey } from "./wte";
import { resolveCodexRollFormula, type RollFormulaPath } from "./rollFormula";

export type RollAxis = "physical" | "mental";
export type RollDirection = "check" | "save";
type RollAxisAttrKey = Extract<AttrKey, "phy" | "ap" | "dex" | "end" | "wis" | "int" | "cha">;
type RollAxisSpecKey = Extract<SpecKey, "wm" | "pre" | "bal" | "adp" | "mf" | "per" | "cun">;
type RollAxisDerivedKey = Extract<DerivedKey, "atk" | "ad" | "ev" | "rr" | "nc" | "pr" | "inf">;

export interface RollAxisStats {
  attr: Record<RollAxisAttrKey, number>;
  spec: Record<RollAxisSpecKey, number>;
  derived: Record<RollAxisDerivedKey, number>;
}

export interface RollAxisPath {
  id: "power" | "density" | "evasion" | "recovery" | "capacity" | "perception" | "influence";
  name: string;
  axis: RollAxis;
  directions: readonly RollDirection[];
  attribute: { key: RollAxisAttrKey; label: string; short: string };
  specialty: { key: RollAxisSpecKey; label: string };
  derived: { key: RollAxisDerivedKey; label: string; short: string };
}

export const ROLL_AXIS_PATHS: readonly RollAxisPath[] = [
  { id: "power", name: "Power", axis: "physical", directions: ["check"], attribute: { key: "phy", label: "Strength", short: "STR" }, specialty: { key: "wm", label: "Weapon Mastery" }, derived: { key: "atk", label: "Attack Power", short: "ATK" } },
  { id: "density", name: "Density", axis: "physical", directions: ["check"], attribute: { key: "ap", label: "Action Priority", short: "AP" }, specialty: { key: "pre", label: "Precision" }, derived: { key: "ad", label: "Action Density", short: "AD" } },
  { id: "evasion", name: "Evasion", axis: "physical", directions: ["save"], attribute: { key: "dex", label: "Dexterity", short: "DEX" }, specialty: { key: "bal", label: "Balance" }, derived: { key: "ev", label: "Evasion", short: "EV" } },
  { id: "recovery", name: "Recovery", axis: "physical", directions: ["save"], attribute: { key: "end", label: "Endurance", short: "END" }, specialty: { key: "adp", label: "Adaptation" }, derived: { key: "rr", label: "Recovery Rate", short: "RR" } },
  { id: "capacity", name: "Capacity", axis: "mental", directions: ["check"], attribute: { key: "wis", label: "Wisdom", short: "WIS" }, specialty: { key: "mf", label: "Mental Fortitude" }, derived: { key: "nc", label: "Neuronal Capacity", short: "NC" } },
  { id: "perception", name: "Perception", axis: "mental", directions: ["check", "save"], attribute: { key: "int", label: "Intelligence", short: "INT" }, specialty: { key: "per", label: "Perception" }, derived: { key: "pr", label: "Perception Range", short: "PR" } },
  { id: "influence", name: "Influence", axis: "mental", directions: ["check", "save"], attribute: { key: "cha", label: "Charisma", short: "CHA" }, specialty: { key: "cun", label: "Cunning" }, derived: { key: "inf", label: "Influence", short: "INF" } },
];

export interface RollAxisChoice {
  path: RollAxisPath;
  direction: RollDirection;
  source: "attribute" | "specialty";
  sourceLabel: string;
  sourceShort: string;
  die: number;
  sourceMod: number;
  derivedMod: number;
  totalMod: number;
  label: string;
  expr: string;
  /** Present when a pulled Codex formula, rather than the built-in sum, won. */
  codexFormula?: { id: string; name: string };
}

function suffix(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? String(value) : "";
}

export function rollAxisPaths(axis: RollAxis, direction: RollDirection): RollAxisPath[] {
  return ROLL_AXIS_PATHS.filter((path) => path.axis === axis && path.directions.includes(direction));
}

/** Build both legal source rolls for a path. Each keeps the source and derived
 * modifiers separate as data, then also exposes the combined dice expression. */
export function rollAxisChoices(path: RollAxisPath, direction: RollDirection, stats: RollAxisStats): RollAxisChoice[] {
  const derivedMod = stats.derived[path.derived.key];
  const make = (source: "attribute" | "specialty"): RollAxisChoice => {
    const attribute = source === "attribute";
    const sourceLabel = attribute ? path.attribute.label : path.specialty.label;
    const sourceShort = attribute ? path.attribute.short : path.specialty.label;
    const sourceMod = attribute ? stats.attr[path.attribute.key] : stats.spec[path.specialty.key];
    const codex = resolveCodexRollFormula(
      attribute ? "roll-axis-attribute" : "roll-axis-specialty",
      { source: sourceMod, derived: derivedMod },
      path.id as RollFormulaPath,
      direction
    );
    const die = codex?.die ?? (attribute ? 20 : 40);
    const totalMod = codex?.modifier ?? sourceMod + derivedMod;
    return {
      path,
      direction,
      source,
      sourceLabel,
      sourceShort,
      die,
      sourceMod,
      derivedMod,
      totalMod,
      label: `${path.name} ${direction === "check" ? "Check" : "Save"} · ${sourceLabel}`,
      expr: `1d${die}${suffix(totalMod)}`,
      codexFormula: codex ? { id: codex.id, name: codex.name } : undefined,
    };
  };
  return [make("attribute"), make("specialty")];
}

function signed(value: number): string {
  return value >= 0 ? `+ ${value}` : `- ${Math.abs(value)}`;
}

/** Roll one complete path pipeline while preserving an auditable formula such
 * as `1d20 + 1 DEX - 3 EV`. Negative path modifiers are never hidden. */
export function rollAxisRoll(choice: RollAxisChoice, mode: RollMode = "normal"): RollResult {
  const roll = rollDiceExpr(choice.label, choice.expr, mode);
  if (!roll) throw new Error(`Invalid Roll Axis expression: ${choice.expr}`);
  const posture = roll.formula.includes(" · ") ? roll.formula.slice(roll.formula.indexOf(" · ")) : "";
  const codexLabel = choice.codexFormula?.name.replace(/\s+/g, " ").trim().slice(0, 48);
  return {
    ...roll,
    formula: choice.codexFormula
      ? `1d${choice.die} ${signed(choice.sourceMod)} ${choice.sourceShort} ${signed(choice.derivedMod)} ${choice.path.derived.short} · Codex ${codexLabel || "Formula"} = ${signed(choice.totalMod)}${posture}`
      : `1d${choice.die} ${signed(choice.sourceMod)} ${choice.sourceShort} ${signed(choice.derivedMod)} ${choice.path.derived.short}${posture}`,
  };
}
