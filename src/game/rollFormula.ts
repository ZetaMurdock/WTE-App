// Safe, declarative roll formulas authored as pulled Codex pages.
//
// This deliberately is NOT JavaScript. Expressions are parsed into a tiny AST
// with a closed variable/function list, then interpreted below. A campaign page
// can change dice and arithmetic without gaining access to the browser, Tauri,
// storage, the network, or any other executable surface.
import { parseId, scopeRank, type IdScope } from "./codexId";

export const ROLL_FORMULA_TARGETS = [
  "attribute",
  "specialty",
  "roll-axis-attribute",
  "roll-axis-specialty",
] as const;
export type RollFormulaTarget = (typeof ROLL_FORMULA_TARGETS)[number];

export const ROLL_FORMULA_PATHS = [
  "power",
  "density",
  "evasion",
  "recovery",
  "capacity",
  "perception",
  "influence",
] as const;
export type RollFormulaPath = (typeof ROLL_FORMULA_PATHS)[number];
export const ROLL_FORMULA_DIRECTIONS = ["check", "save"] as const;
export type RollFormulaDirection = (typeof ROLL_FORMULA_DIRECTIONS)[number];

const PATH_DIRECTIONS: Readonly<Record<RollFormulaPath, readonly RollFormulaDirection[]>> = {
  power: ["check"],
  // Density is a CHECK — ROLL_AXIS_PATHS and the Warfare page agree; ["save"]
  // here meant a density/check formula was rejected at sync while a
  // density/save formula validated but could never resolve.
  density: ["check"],
  evasion: ["save"],
  recovery: ["save"],
  capacity: ["check"],
  perception: ["check", "save"],
  influence: ["check", "save"],
};

type UnaryOp = "+" | "-";
type BinaryOp = "+" | "-" | "*" | "/";
type FunctionName = "floor" | "ceil" | "round" | "trunc" | "abs" | "min" | "max";
type ExprNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; op: UnaryOp; value: ExprNode }
  | { type: "binary"; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { type: "call"; name: FunctionName; args: ExprNode[] };

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "symbol"; value: "+" | "-" | "*" | "/" | "(" | ")" | "," };

const MAX_EXPRESSION_CHARS = 180;
const MAX_TOKENS = 128;
const MAX_AST_NODES = 96;
const MAX_AST_DEPTH = 32;
const MAX_ABS_INPUT = 1_000_000;
// Roll Axis formulas commonly add two independently bounded inputs, so the
// output domain deliberately leaves room beyond one input while remaining far
// below Number's unsafe-integer range and the network dice grammar's limits.
const MAX_ABS_RESULT = 10_000_000;

const FUNCTIONS: Record<FunctionName, { min: number; max: number }> = {
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  trunc: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  min: { min: 2, max: 2 },
  max: { min: 2, max: 2 },
};

export interface CodexRollFormula {
  id: string;
  /** Authoritative layer supplied by the loader; page text cannot spoof it. */
  scope: IdScope;
  name: string;
  target: RollFormulaTarget;
  /** Only Roll Axis formulas may select a path; undefined means every path. */
  path?: RollFormulaPath;
  /** Only Roll Axis formulas may select check/save; undefined means both. */
  direction?: RollFormulaDirection;
  die: number;
  expression: string;
  below?: number;
  penalty?: number;
  /** Parsed, inert data. Kept private to this module's evaluator. */
  ast: ExprNode;
}

export type RollFormulaPageResult =
  | { ok: true; formula: CodexRollFormula }
  | { ok: false; errors: string[] };

export interface ResolvedRollFormula {
  id: string;
  name: string;
  die: number;
  modifier: number;
  expression: string;
}

function readField(md: string, key: string): string | undefined {
  const table = md.match(new RegExp(`^\\s*\\|\\s*${key}\\s*\\|\\s*([^|]*)\\|\\s*$`, "im"));
  if (table) return table[1].trim();
  const bold = md.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*${key}\\*\\*:?\\s*(.+)$`, "im"));
  if (bold) return bold[1].trim();
  const plain = md.match(new RegExp(`^\\s*${key}\\s*:[ \\t]+(.+)$`, "im"));
  return plain?.[1].trim();
}

function titleOf(md: string, fallback: string): string {
  const heading = md.match(/^#{1,4}\s+(.+)$/m)?.[1];
  return (heading || fallback).replace(/[*_`]/g, "").trim() || fallback;
}

/** Metadata examples in comments or fenced code are documentation, not active
 * mechanics. Strip them before looking for Type/Target/Modifier fields. */
function renderedMetadata(md: string): string {
  const uncommented = md.replace(/<!--[\s\S]*?-->/g, "");
  const visible: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of uncommented.split(/\r?\n/)) {
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opening && opening[1][0] === fence.marker && opening[1].length >= fence.length) fence = null;
      continue;
    }
    if (opening) {
      fence = { marker: opening[1][0] as "`" | "~", length: opening[1].length };
      continue;
    }
    visible.push(line);
  }
  return visible.join("\n");
}

function normalizeTarget(raw: string): RollFormulaTarget | null {
  const key = raw.toLowerCase().replace(/[^a-z]+/g, " ").trim().replace(/\s+/g, " ");
  if (key === "attribute" || key === "attributes" || key === "attribute check") return "attribute";
  if (key === "specialty" || key === "speciality" || key === "specialties" || key === "specialty check") return "specialty";
  if (key === "roll axis attribute" || key === "axis attribute") return "roll-axis-attribute";
  if (key === "roll axis specialty" || key === "roll axis speciality" || key === "axis specialty") return "roll-axis-specialty";
  return null;
}

function tokenize(source: string): { tokens?: Token[]; error?: string } {
  if (!source.trim()) return { error: "Modifier is required." };
  if (source.length > MAX_EXPRESSION_CHARS) return { error: `Modifier exceeds ${MAX_EXPRESSION_CHARS} characters.` };
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) {
      at += whitespace.length;
      continue;
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/)?.[0];
    if (number) {
      const value = Number(number);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_INPUT) return { error: `Number ${number} is out of range.` };
      tokens.push({ type: "number", value });
      at += number.length;
    } else {
      const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
      if (identifier) {
        tokens.push({ type: "identifier", value: identifier.toLowerCase() });
        at += identifier.length;
      } else if (/^[+\-*/(),]/.test(rest)) {
        tokens.push({ type: "symbol", value: rest[0] as Extract<Token, { type: "symbol" }>["value"] });
        at += 1;
      } else {
        return { error: `Unsupported token ${JSON.stringify(rest[0])} in Modifier.` };
      }
    }
    if (tokens.length > MAX_TOKENS) return { error: `Modifier exceeds ${MAX_TOKENS} tokens.` };
  }
  return { tokens };
}

class ExpressionParser {
  private at = 0;
  private nodes = 0;

  constructor(private readonly tokens: Token[], private readonly variables: Set<string>) {}

  parse(): { ast?: ExprNode; error?: string } {
    try {
      const ast = this.expression(0);
      if (this.at !== this.tokens.length) throw new Error("Unexpected token after the expression.");
      return { ast };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid Modifier expression." };
    }
  }

  private node<T extends ExprNode>(value: T): T {
    this.nodes += 1;
    if (this.nodes > MAX_AST_NODES) throw new Error(`Modifier exceeds ${MAX_AST_NODES} operations.`);
    return value;
  }

  private expression(depth: number): ExprNode {
    let left = this.term(depth + 1);
    while (this.symbol("+") || this.symbol("-")) {
      const op = (this.previous() as Extract<Token, { type: "symbol" }>).value as "+" | "-";
      left = this.node({ type: "binary", op, left, right: this.term(depth + 1) });
    }
    return left;
  }

  private term(depth: number): ExprNode {
    let left = this.unary(depth + 1);
    while (this.symbol("*") || this.symbol("/")) {
      const op = (this.previous() as Extract<Token, { type: "symbol" }>).value as "*" | "/";
      left = this.node({ type: "binary", op, left, right: this.unary(depth + 1) });
    }
    return left;
  }

  private unary(depth: number): ExprNode {
    this.checkDepth(depth);
    if (this.symbol("+") || this.symbol("-")) {
      const op = (this.previous() as Extract<Token, { type: "symbol" }>).value as UnaryOp;
      return this.node({ type: "unary", op, value: this.unary(depth + 1) });
    }
    return this.primary(depth + 1);
  }

  private primary(depth: number): ExprNode {
    this.checkDepth(depth);
    const token = this.tokens[this.at];
    if (!token) throw new Error("Modifier ended before the expression was complete.");
    if (token.type === "number") {
      this.at += 1;
      return this.node({ type: "number", value: token.value });
    }
    if (token.type === "identifier") {
      this.at += 1;
      const name = token.value;
      if (this.symbol("(")) {
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) throw new Error(`Unknown function ${JSON.stringify(name)}.`);
        const args: ExprNode[] = [];
        if (!this.peekSymbol(")")) {
          do args.push(this.expression(depth + 1)); while (this.symbol(","));
        }
        if (!this.symbol(")")) throw new Error(`Function ${name} is missing a closing parenthesis.`);
        const arity = FUNCTIONS[name as FunctionName];
        if (args.length < arity.min || args.length > arity.max) {
          throw new Error(`Function ${name} requires ${arity.min} argument${arity.min === 1 ? "" : "s"}.`);
        }
        return this.node({ type: "call", name: name as FunctionName, args });
      }
      if (!this.variables.has(name)) throw new Error(`Unknown variable ${JSON.stringify(name)}.`);
      return this.node({ type: "variable", name });
    }
    if (this.symbol("(")) {
      const value = this.expression(depth + 1);
      if (!this.symbol(")")) throw new Error("Modifier is missing a closing parenthesis.");
      return value;
    }
    throw new Error("Unexpected token in Modifier.");
  }

  private symbol(value: Extract<Token, { type: "symbol" }>["value"]): boolean {
    const token = this.tokens[this.at];
    if (token?.type !== "symbol" || token.value !== value) return false;
    this.at += 1;
    return true;
  }

  private peekSymbol(value: Extract<Token, { type: "symbol" }>["value"]): boolean {
    const token = this.tokens[this.at];
    return token?.type === "symbol" && token.value === value;
  }

  private previous(): Token {
    return this.tokens[this.at - 1];
  }

  private checkDepth(depth: number): void {
    if (depth > MAX_AST_DEPTH) throw new Error(`Modifier exceeds ${MAX_AST_DEPTH} levels of nesting.`);
  }
}

function parseExpression(source: string, variables: readonly string[]): { ast?: ExprNode; error?: string } {
  const tokenized = tokenize(source);
  if (!tokenized.tokens) return { error: tokenized.error };
  return new ExpressionParser(tokenized.tokens, new Set(variables)).parse();
}

interface NumericDomain {
  min: number;
  max: number;
  /** True only when every whole-number input produces a whole number here. */
  integer: boolean;
}

type DomainResult = { domain: NumericDomain } | { error: string };

function finiteDomain(min: number, max: number, integer: boolean): DomainResult {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { error: "Modifier can overflow within the supported input range." };
  }
  return { domain: { min: Math.min(min, max), max: Math.max(min, max), integer } };
}

/** Conservative interval proof over every whole-number input in the supported
 * domain. It intentionally rejects formulas we cannot prove safe: a campaign
 * rule should fail during synchronization, never change to built-in math for
 * one unlucky character at roll time. */
function analyzeExpression(node: ExprNode): DomainResult {
  if (node.type === "number") return finiteDomain(node.value, node.value, Number.isInteger(node.value));
  if (node.type === "variable") return finiteDomain(-MAX_ABS_INPUT, MAX_ABS_INPUT, true);
  if (node.type === "unary") {
    const value = analyzeExpression(node.value);
    if ("error" in value) return value;
    return node.op === "-"
      ? finiteDomain(-value.domain.max, -value.domain.min, value.domain.integer)
      : value;
  }
  if (node.type === "binary") {
    const left = analyzeExpression(node.left);
    if ("error" in left) return left;
    const right = analyzeExpression(node.right);
    if ("error" in right) return right;
    if (node.op === "+") {
      return finiteDomain(left.domain.min + right.domain.min, left.domain.max + right.domain.max, left.domain.integer && right.domain.integer);
    }
    if (node.op === "-") {
      return finiteDomain(left.domain.min - right.domain.max, left.domain.max - right.domain.min, left.domain.integer && right.domain.integer);
    }
    const products = [
      left.domain.min * right.domain.min,
      left.domain.min * right.domain.max,
      left.domain.max * right.domain.min,
      left.domain.max * right.domain.max,
    ];
    if (node.op === "*") {
      return finiteDomain(Math.min(...products), Math.max(...products), left.domain.integer && right.domain.integer);
    }
    if (right.domain.min <= 0 && right.domain.max >= 0) {
      return { error: "Division denominator can be zero within the supported input range." };
    }
    const quotients = [
      left.domain.min / right.domain.min,
      left.domain.min / right.domain.max,
      left.domain.max / right.domain.min,
      left.domain.max / right.domain.max,
    ];
    const exactConstantDivision =
      left.domain.min === left.domain.max &&
      right.domain.min === right.domain.max &&
      Number.isInteger(left.domain.min / right.domain.min);
    const unitDenominator = right.domain.min === right.domain.max && Math.abs(right.domain.min) === 1;
    return finiteDomain(
      Math.min(...quotients),
      Math.max(...quotients),
      exactConstantDivision || (unitDenominator && left.domain.integer)
    );
  }

  const args: NumericDomain[] = [];
  for (const arg of node.args) {
    const analyzed = analyzeExpression(arg);
    if ("error" in analyzed) return analyzed;
    args.push(analyzed.domain);
  }
  const first = args[0];
  if (node.name === "floor") return finiteDomain(Math.floor(first.min), Math.floor(first.max), true);
  if (node.name === "ceil") return finiteDomain(Math.ceil(first.min), Math.ceil(first.max), true);
  if (node.name === "round") return finiteDomain(Math.round(first.min), Math.round(first.max), true);
  if (node.name === "trunc") return finiteDomain(Math.trunc(first.min), Math.trunc(first.max), true);
  if (node.name === "abs") {
    const min = first.min <= 0 && first.max >= 0 ? 0 : Math.min(Math.abs(first.min), Math.abs(first.max));
    return finiteDomain(min, Math.max(Math.abs(first.min), Math.abs(first.max)), first.integer);
  }
  const second = args[1];
  if (node.name === "min") {
    return finiteDomain(Math.min(first.min, second.min), Math.min(first.max, second.max), first.integer && second.integer);
  }
  return finiteDomain(Math.max(first.min, second.min), Math.max(first.max, second.max), first.integer && second.integer);
}

function validateExpressionDomain(ast: ExprNode, penalty = 0): string | undefined {
  const analyzed = analyzeExpression(ast);
  if ("error" in analyzed) return analyzed.error;
  if (!analyzed.domain.integer) {
    return "Modifier must resolve to a whole number for every whole-number input; wrap division in floor, ceil, round, or trunc.";
  }
  if (analyzed.domain.min - penalty < -MAX_ABS_RESULT || analyzed.domain.max > MAX_ABS_RESULT) {
    return `Modifier can exceed the supported result range of -${MAX_ABS_RESULT} to ${MAX_ABS_RESULT}.`;
  }
  return undefined;
}

function parseFiniteField(raw: string | undefined, label: string, options: { min: number; max: number; integer?: boolean }): { value?: number; error?: string } {
  if (raw === undefined || raw.trim() === "") return {};
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return { error: `${label} must be a number.` };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < options.min || value > options.max || (options.integer && !Number.isInteger(value))) {
    return { error: `${label} must be ${options.integer ? "a whole number " : ""}from ${options.min} to ${options.max}.` };
  }
  return { value };
}

/** Parse a page only when it declares Type: Roll Formula. Invalid formula pages
 * return diagnostics; unrelated lore/mechanics return null. */
export function parseRollFormulaPage(md: string, stem: string): RollFormulaPageResult | null {
  const metadata = renderedMetadata(md);
  const type = (readField(metadata, "Type") || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (type !== "roll formula" && type !== "formula") return null;

  const errors: string[] = [];
  const targetRaw = readField(metadata, "Target") || "";
  const target = normalizeTarget(targetRaw);
  if (!target) errors.push(`Target ${JSON.stringify(targetRaw)} is not allowed.`);

  const dieField = parseFiniteField(readField(metadata, "Die"), "Die", { min: 2, max: 1_000, integer: true });
  if (dieField.error) errors.push(dieField.error);
  else if (dieField.value === undefined) errors.push("Die is required.");

  const expression = readField(metadata, "Modifier") || "";
  let ast: ExprNode | undefined;
  if (target) {
    const variables = target.startsWith("roll-axis-") ? ["source", "derived"] : ["score"];
    const parsed = parseExpression(expression, variables);
    if (parsed.error) errors.push(parsed.error);
    else ast = parsed.ast;
  }

  const rawPath = (readField(metadata, "Path") || "").toLowerCase().trim();
  let path: RollFormulaPath | undefined;
  if (target?.startsWith("roll-axis-")) {
    const normalized = rawPath.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    if (normalized && normalized !== "all") {
      if (ROLL_FORMULA_PATHS.includes(normalized as RollFormulaPath)) path = normalized as RollFormulaPath;
      else errors.push(`Path ${JSON.stringify(rawPath)} is not allowed.`);
    }
  } else if (rawPath && rawPath !== "all") {
    errors.push("Path is only allowed for Roll Axis formulas.");
  }

  const rawDirection = (readField(metadata, "Direction") || "").toLowerCase().trim();
  let direction: RollFormulaDirection | undefined;
  if (target?.startsWith("roll-axis-")) {
    if (rawDirection && rawDirection !== "all") {
      if (ROLL_FORMULA_DIRECTIONS.includes(rawDirection as RollFormulaDirection)) direction = rawDirection as RollFormulaDirection;
      else errors.push(`Direction ${JSON.stringify(rawDirection)} is not allowed.`);
    }
  } else if (rawDirection && rawDirection !== "all") {
    errors.push("Direction is only allowed for Roll Axis formulas.");
  }

  if (path && direction && !PATH_DIRECTIONS[path].includes(direction)) {
    errors.push(`Path ${path} does not support ${direction} rolls.`);
  }

  const belowField = parseFiniteField(readField(metadata, "Below"), "Below", { min: -10_000, max: 10_000, integer: true });
  const penaltyField = parseFiniteField(readField(metadata, "Penalty"), "Penalty", { min: 0, max: 10_000, integer: true });
  if (belowField.error) errors.push(belowField.error);
  if (penaltyField.error) errors.push(penaltyField.error);
  const hasThreshold = belowField.value !== undefined || penaltyField.value !== undefined;
  if (hasThreshold && target?.startsWith("roll-axis-")) errors.push("Below and Penalty are only allowed for score formulas.");
  if ((belowField.value === undefined) !== (penaltyField.value === undefined)) errors.push("Below and Penalty must be supplied together.");
  if (ast) {
    const domainError = validateExpressionDomain(ast, belowField.value !== undefined ? penaltyField.value ?? 0 : 0);
    if (domainError) errors.push(domainError);
  }

  if (errors.length || !target || !ast || dieField.value === undefined) return { ok: false, errors };
  const id = (readField(metadata, "ID") || `formula:${stem}`).trim().slice(0, 240);
  const parsedId = parseId(id);
  return {
    ok: true,
    formula: {
      id,
      scope: parsedId?.scope ?? "wte",
      name: titleOf(metadata, stem).slice(0, 120),
      target,
      path,
      direction,
      die: dieField.value,
      expression: expression.trim(),
      below: belowField.value,
      penalty: penaltyField.value,
      ast,
    },
  };
}

function evaluate(node: ExprNode, variables: Readonly<Record<string, number>>): number {
  switch (node.type) {
    case "number": return node.value;
    case "variable": return variables[node.name];
    case "unary": {
      const value = evaluate(node.value, variables);
      return node.op === "-" ? -value : value;
    }
    case "binary": {
      const left = evaluate(node.left, variables);
      const right = evaluate(node.right, variables);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      return left / right;
    }
    case "call": {
      const args = node.args.map((arg) => evaluate(arg, variables));
      if (node.name === "floor") return Math.floor(args[0]);
      if (node.name === "ceil") return Math.ceil(args[0]);
      if (node.name === "round") return Math.round(args[0]);
      if (node.name === "trunc") return Math.trunc(args[0]);
      if (node.name === "abs") return Math.abs(args[0]);
      if (node.name === "min") return Math.min(args[0], args[1]);
      if (node.name === "max") return Math.max(args[0], args[1]);
      return Number.NaN;
    }
  }
}

interface RegisteredFormula {
  formula: CodexRollFormula;
  order: number;
}

export class RollFormulaEvaluationError extends Error {
  constructor(readonly formulaId: string, reason: string) {
    super(`Codex Roll Formula ${formulaId} cannot be resolved: ${reason}`);
    this.name = "RollFormulaEvaluationError";
  }
}

let formulas = new Map<string, RegisteredFormula>();

function formulaKey(target: RollFormulaTarget, path?: RollFormulaPath, direction?: RollFormulaDirection): string {
  return `${target}:${path || "all"}:${direction || "all"}`;
}

/** Replace the runtime registry atomically. Definitions later in the list win,
 * so the loader can put campaign definitions after official ones. */
export function setCodexRollFormulas(next: readonly CodexRollFormula[]): void {
  const replacement = new Map<string, RegisteredFormula>();
  next.forEach((formula, order) => replacement.set(formulaKey(formula.target, formula.path, formula.direction), { formula, order }));
  formulas = replacement;
}

export function resolveCodexRollFormula(
  target: RollFormulaTarget,
  variables: Readonly<Record<string, number>>,
  path?: RollFormulaPath,
  direction?: RollFormulaDirection
): ResolvedRollFormula | null {
  const candidates = [...formulas.values()].filter(({ formula }) =>
    formula.target === target &&
    (!formula.path || formula.path === path) &&
    (!formula.direction || formula.direction === direction)
  );
  // Scope wins before specificity: a campaign-wide formula beats an official
  // path+direction baseline. Within one scope, the most exact match wins; ties
  // use registry order, which gameData makes deterministic from stable ids.
  candidates.sort((a, b) => {
    const layer = scopeRank(a.formula.scope) - scopeRank(b.formula.scope);
    if (layer) return layer;
    const aSpecificity = Number(!!a.formula.path) + Number(!!a.formula.direction);
    const bSpecificity = Number(!!b.formula.path) + Number(!!b.formula.direction);
    return aSpecificity - bSpecificity || a.order - b.order;
  });
  const registered = candidates[candidates.length - 1];
  if (!registered) return null;
  const formula = registered.formula;
  const expected = target.startsWith("roll-axis-") ? ["source", "derived"] : ["score"];
  for (const key of expected) {
    const value = variables[key];
    if (!Number.isFinite(value) || !Number.isInteger(value) || Math.abs(value) > MAX_ABS_INPUT) {
      throw new RollFormulaEvaluationError(formula.id, `${key} must be a whole number from -${MAX_ABS_INPUT} to ${MAX_ABS_INPUT}`);
    }
  }
  let modifier = evaluate(formula.ast, variables);
  if (formula.below !== undefined && variables.score < formula.below) modifier -= formula.penalty || 0;
  // Dice expressions and every existing modifier pipeline are integer-valued.
  // Reject a fractional runtime result instead of arming a VTT expression its
  // strict dice parser cannot understand while the sheet accepts it.
  if (!Number.isFinite(modifier) || !Number.isInteger(modifier) || Math.abs(modifier) > MAX_ABS_RESULT) {
    throw new RollFormulaEvaluationError(formula.id, `result must be a whole number from -${MAX_ABS_RESULT} to ${MAX_ABS_RESULT}`);
  }
  return {
    id: formula.id,
    name: formula.name,
    die: formula.die,
    modifier,
    expression: formula.expression,
  };
}

/** Test/diagnostic seam: immutable list of active declarative definitions. */
export function activeCodexRollFormulas(): CodexRollFormula[] {
  return [...formulas.values()].sort((a, b) => a.order - b.order).map((entry) => entry.formula);
}
