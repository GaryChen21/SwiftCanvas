/**
 * evaluator.ts — value model, environment, expression evaluation and
 * statement execution for the Swift preview runtime.
 *
 * The evaluator implements the *documented* semantics of the Swift constructs
 * a SwiftUI preview depends on: value-typed arrays, integer division for
 * integral operands, short-circuit logic, string interpolation, `@State`
 * mutation through bindings, and mutating methods on model structs.
 */

import type { Block, Expr, Stmt, StringPartAst } from "./ast.ts";

/* ────────────────────────────── Values ────────────────────────────── */

export interface ClosureVal {
  t: "closure";
  params: string[];
  block?: Block;
  env: Env;
  name?: string;
  /** Native implementation for builtins and computed properties. */
  native?: (args: EvaluatedArg[], host: EvalHost) => Value;
  /** Computed property: reading the member evaluates it. */
  computed?: boolean;
  /**
   * `var name: some View { ... }` — the body builds view items, not a value.
   * The view builder expands it at parse-site instead of evaluating it.
   */
  viewProperty?: boolean;
}

export interface BindingVal {
  t: "binding";
  name: string;
  get: () => Value;
  set: (value: Value) => void;
}

export interface ImplicitVal {
  t: "implicit";
  path: string[];
  /** Present when the implicit member was invoked: `.system(size: 20)`. */
  called?: boolean;
  args?: EvaluatedArg[];
}

export interface TypeVal {
  t: "type";
  name: string;
}

export interface KeyPathVal {
  t: "keypath";
  path: string[];
}

export interface StructVal {
  t: "struct";
  typeName: string;
  env: Env;
}

export interface RangeVal {
  t: "range";
  lo: number;
  hi: number;
  closed: boolean;
}

export interface ShapeVal {
  t: "shape";
  name: string;
  args: EvaluatedArg[];
}

export interface ColorVal {
  t: "color";
  name: string;
  /** 0-255 rgb components, when known. */
  rgb?: [number, number, number];
  alpha: number;
}

export interface GradientVal {
  t: "gradient";
  kind: "linear" | "radial" | "angular";
  colors: Value[];
  startPoint: string;
  endPoint: string;
}

export interface FontVal {
  t: "font";
  style?: string;
  size?: number;
  weight?: string;
  design?: string;
  italic?: boolean;
  monospaced?: boolean;
}

export interface AngleVal {
  t: "angle";
  degrees: number;
}

export interface MaterialVal {
  t: "material";
  name: string;
}

export interface ShapeStyleVal {
  t: "shapestyle";
  mode: "fill" | "stroke" | "strokeBorder";
  shape: ShapeVal;
  color: Value;
  lineWidth: number;
}

export interface ImageVal {
  t: "image";
  systemName?: string;
  name?: string;
}

/** A Double literal or a value derived from one (Swift division semantics). */
export interface DoubleVal {
  t: "double";
  v: number;
}

export type Value =
  | number
  | string
  | boolean
  | null
  | undefined
  | Value[]
  | ClosureVal
  | BindingVal
  | ImplicitVal
  | TypeVal
  | KeyPathVal
  | StructVal
  | RangeVal
  | ShapeVal
  | ColorVal
  | GradientVal
  | FontVal
  | AngleVal
  | MaterialVal
  | ShapeStyleVal
  | ImageVal
  | DoubleVal;

export interface EvaluatedArg {
  label?: string;
  value: Value;
}

function tag(v: unknown): string | null {
  if (v && typeof v === "object" && typeof (v as { t?: unknown }).t === "string") {
    return (v as { t: string }).t;
  }
  return null;
}

export const isClosure = (v: unknown): v is ClosureVal => tag(v) === "closure";
export const isBinding = (v: unknown): v is BindingVal => tag(v) === "binding";
export const isImplicit = (v: unknown): v is ImplicitVal => tag(v) === "implicit";
export const isType = (v: unknown): v is TypeVal => tag(v) === "type";
export const isKeyPath = (v: unknown): v is KeyPathVal => tag(v) === "keypath";
export const isStruct = (v: unknown): v is StructVal => tag(v) === "struct";
export const isRange = (v: unknown): v is RangeVal => tag(v) === "range";
export const isShape = (v: unknown): v is ShapeVal => tag(v) === "shape";
export const isColor = (v: unknown): v is ColorVal => tag(v) === "color";
export const isGradient = (v: unknown): v is GradientVal => tag(v) === "gradient";
export const isFont = (v: unknown): v is FontVal => tag(v) === "font";
export const isAngle = (v: unknown): v is AngleVal => tag(v) === "angle";
export const isMaterial = (v: unknown): v is MaterialVal => tag(v) === "material";
export const isShapeStyle = (v: unknown): v is ShapeStyleVal => tag(v) === "shapestyle";
export const isImage = (v: unknown): v is ImageVal => tag(v) === "image";
export const isDoubleVal = (v: unknown): v is DoubleVal => tag(v) === "double";

/** Strip Double boxing at a boundary (view arguments, bindings, formatting). */
export function unbox(value: Value): Value {
  if (isDoubleVal(value)) return value.v;
  return value;
}

/** Numeric view of a value: plain numbers and Double boxings both count. */
export function numOf(value: Value): number | undefined {
  if (typeof value === "number") return value;
  if (isDoubleVal(value)) return value.v;
  return undefined;
}

function boxDouble(value: number): Value {
  return { t: "double", v: value };
}

export const isNil = (v: Value): boolean => v === null || v === undefined;

/* ────────────────────────────── Environment ────────────────────────────── */

export class Env {
  vars = new Map<string, Value>();
  parent?: Env;

  constructor(parent?: Env) {
    this.parent = parent;
  }

  lookup(name: string): Value | undefined {
    let env: Env | undefined = this;
    while (env) {
      const found = env.vars.get(name);
      if (found !== undefined || env.vars.has(name)) return found;
      env = env.parent;
    }
    return undefined;
  }

  has(name: string): boolean {
    let env: Env | undefined = this;
    while (env) {
      if (env.vars.has(name)) return true;
      env = env.parent;
    }
    return false;
  }

  /** Assign to the nearest existing declaration; returns false if none. */
  set(name: string, value: Value): boolean {
    let env: Env | undefined = this;
    while (env) {
      if (env.vars.has(name)) {
        env.vars.set(name, value);
        return true;
      }
      env = env.parent;
    }
    return false;
  }

  declare(name: string, value: Value): void {
    this.vars.set(name, value);
  }
}

/* ────────────────────────────── Host / diagnostics ────────────────────────────── */

export interface EvalHost {
  log(message: string): void;
  warn(message: string, start: number, end: number): void;
  /** Called after a state mutation so React can re-render. */
  bump(): void;
  /** Construct a user-declared struct/model value. */
  constructStruct?(name: string, args: EvaluatedArg[]): Value | undefined;
}

export class ExecLimitError extends Error {
  constructor() {
    super("Execution step limit reached");
  }
}

let budget = 0;

/** Execute a statement list with a step budget so runaway loops cannot hang. */
export function runStatements(stmts: Stmt[], env: Env, host: EvalHost): void {
  const previous = budget;
  budget = 500_000;
  try {
    execStmts(stmts, env, host);
  } catch (err) {
    if (err instanceof ExecLimitError) {
      host.warn("Execution limit reached — check for an infinite loop.", 0, 0);
    } else {
      throw err;
    }
  } finally {
    budget = previous;
  }
}

/** Evaluate an expression, mapping internal errors to undefined. */
export function safeEval(expr: Expr, env: Env, host: EvalHost): Value {
  const previous = budget;
  if (budget === 0) budget = 500_000;
  try {
    return evalExpr(expr, env, host);
  } catch (err) {
    if (err instanceof ExecLimitError) {
      host.warn("Execution limit reached — check for an infinite loop.", 0, 0);
      return undefined;
    }
    throw err;
  } finally {
    budget = previous;
  }
}

/* ────────────────────────────── Statements ────────────────────────────── */

export type Flow =
  | null
  | { type: "return"; value: Value }
  | { type: "break" }
  | { type: "continue" };

export function execStmts(stmts: Stmt[], env: Env, host: EvalHost): Flow {
  for (const stmt of stmts) {
    if (budget > 0) {
      budget -= 1;
      if (budget === 0) throw new ExecLimitError();
    }
    const flow = execStmt(stmt, env, host);
    if (flow) return flow;
  }
  return null;
}

function execStmt(stmt: Stmt, env: Env, host: EvalHost): Flow {
  switch (stmt.k) {
    case "declare": {
      const value = stmt.value ? evalExpr(stmt.value, env, host) : null;
      env.declare(stmt.name, cloneValue(value));
      return null;
    }

    case "assign": {
      const value = evalExpr(stmt.value, env, host);
      assignTo(stmt.target, stmt.op, value, env, host);
      host.bump();
      return null;
    }

    case "expr":
      evalExpr(stmt.expr, env, host);
      return null;

    case "if": {
      const cond = truthy(evalExpr(stmt.cond, env, host));
      if (cond) {
        const scope = new Env(env);
        return execStmts(stmt.then, scope, host);
      }
      if (stmt.else) {
        const scope = new Env(env);
        return execStmts(stmt.else, scope, host);
      }
      return null;
    }

    case "while": {
      const scope = new Env(env);
      for (;;) {
        if (!truthy(evalExpr(stmt.cond, scope, host))) break;
        const flow = execStmts(stmt.body, new Env(scope), host);
        if (flow) {
          if (flow.type === "break") break;
          if (flow.type === "return") return flow;
        }
      }
      return null;
    }

    case "for": {
      const seq = evalExpr(stmt.seq, env, host);
      const items = iterate(seq);
      const scope = new Env(env);
      for (const item of items) {
        bindLoopNames(stmt.names, item, scope);
        const flow = execStmts(stmt.body, new Env(scope), host);
        if (flow) {
          if (flow.type === "break") break;
          if (flow.type === "return") return flow;
        }
      }
      return null;
    }

    case "switch": {
      const subject = evalExpr(stmt.subject, env, host);
      for (const switchCase of stmt.cases) {
        const matches = switchCase.patterns.some((pattern) => {
          const value = evalExpr(pattern, env, host);
          if (isRange(value) && typeof subject === "number") {
            return value.closed
              ? subject >= value.lo && subject <= value.hi
              : subject >= value.lo && subject < value.hi;
          }
          return swiftEquals(subject, value);
        });
        if (matches) {
          return execStmts(switchCase.body, new Env(env), host);
        }
      }
      if (stmt.defaultBody) {
        return execStmts(stmt.defaultBody, new Env(env), host);
      }
      return null;
    }

    case "func": {
      env.declare(stmt.decl.name, {
        t: "closure",
        params: stmt.decl.params.map((p) => p.name),
        block: stmt.decl.body,
        env,
        name: stmt.decl.name,
      });
      return null;
    }

    case "return":
      return { type: "return", value: stmt.value ? evalExpr(stmt.value, env, host) : null };

    case "break":
      return { type: "break" };

    case "continue":
      return { type: "continue" };
  }
}

function bindLoopNames(names: string[], item: Value, env: Env): void {
  if (names.length === 0) return;
  if (names.length === 1) {
    env.declare(names[0], item);
    return;
  }
  if (Array.isArray(item)) {
    names.forEach((name, index) => env.declare(name, item[index] ?? null));
  }
}

function iterate(seq: Value): Value[] {
  if (Array.isArray(seq)) return seq.map(cloneValue);
  if (isRange(seq)) {
    const out: number[] = [];
    if (seq.closed) {
      for (let i = seq.lo; i <= seq.hi; i++) out.push(i);
    } else {
      for (let i = seq.lo; i < seq.hi; i++) out.push(i);
    }
    return out;
  }
  if (typeof seq === "string") return seq.split("");
  return [];
}

function assignTo(
  target: Expr,
  op: string,
  value: Value,
  env: Env,
  host: EvalHost,
): void {
  if (target.k === "ident") {
    const name = target.name;
    let next = value;
    if (op !== "=") {
      const current = env.lookup(name);
      next = applyBinary(op.slice(0, -1), current ?? null, value);
    }
    env.set(name, cloneValue(next));
    return;
  }

  if (target.k === "member") {
    const obj = evalExpr(target.obj, env, host);
    let next = value;
    if (op !== "=" && isStruct(obj)) {
      const current = obj.env.lookup(target.name);
      next = applyBinary(op.slice(0, -1), current ?? null, value);
    }
    if (isStruct(obj)) {
      obj.env.set(target.name, cloneValue(next));
    }
    return;
  }

  if (target.k === "subscript") {
    const obj = evalExpr(target.obj, env, host);
    const index = evalExpr(target.index, env, host);
    if (Array.isArray(obj) && typeof index === "number") {
      obj[index] = cloneValue(value);
    } else if (typeof obj === "string" && typeof index === "number") {
      // Strings are immutable; ignore.
    }
  }
}

/* ────────────────────────────── Expressions ────────────────────────────── */

export function evalExpr(expr: Expr, env: Env, host: EvalHost): Value {
  switch (expr.k) {
    case "num":
      return expr.isDouble ? boxDouble(expr.v) : expr.v;
    case "bool":
      return expr.v;
    case "nil":
      return null;
    case "self":
      return env.lookup("self") ?? null;
    case "ident":
      return evalIdent(expr.name, env, host);
    case "binding": {
      const name = expr.name;
      return {
        t: "binding",
        name,
        get: () => unbox(env.lookup(name) ?? null),
        set: (value) => {
          // Preserve Double-ness so `\(value)` keeps Swift's `.0` formatting.
          const current = env.lookup(name);
          const n = numOf(value);
          const next = isDoubleVal(current) && n !== undefined ? boxDouble(n) : value;
          if (env.set(name, next)) host.bump();
        },
      };
    }
    case "implicit":
      return { t: "implicit", path: [expr.name] };
    case "keypath":
      return { t: "keypath", path: expr.path };
    case "str":
      return evalString(expr.parts, env, host);
    case "array":
      return expr.items.map((item) => cloneValue(evalExpr(item, env, host)));
    case "tuple":
      return expr.items.map((item) => evalExpr(item, env, host));
    case "range": {
      const lo = evalExpr(expr.lo, env, host);
      const hi = evalExpr(expr.hi, env, host);
      return {
        t: "range",
        lo: numOf(lo) ?? 0,
        hi: numOf(hi) ?? 0,
        closed: expr.closed,
      };
    }
    case "unary": {
      const value = evalExpr(expr.operand, env, host);
      if (expr.op === "!") return !truthy(value);
      if (expr.op === "-") {
        const n = numOf(value);
        if (n === undefined) return 0;
        return isDoubleVal(value) ? boxDouble(-n) : -n;
      }
      return value;
    }
    case "binary": {
      if (expr.op === "&&") {
        const left = evalExpr(expr.left, env, host);
        if (!truthy(left)) return false;
        return truthy(evalExpr(expr.right, env, host));
      }
      if (expr.op === "||") {
        const left = evalExpr(expr.left, env, host);
        if (truthy(left)) return true;
        return truthy(evalExpr(expr.right, env, host));
      }
      if (expr.op === "??") {
        const left = evalExpr(expr.left, env, host);
        return isNil(left) ? evalExpr(expr.right, env, host) : left;
      }
      const left = evalExpr(expr.left, env, host);
      const right = evalExpr(expr.right, env, host);
      return applyBinary(expr.op, left, right);
    }
    case "ternary":
      return truthy(evalExpr(expr.cond, env, host))
        ? evalExpr(expr.then, env, host)
        : evalExpr(expr.else, env, host);
    case "subscript": {
      const obj = evalExpr(expr.obj, env, host);
      const index = evalExpr(expr.index, env, host);
      if (Array.isArray(obj)) {
        const i = typeof index === "number" ? index : 0;
        return i >= 0 && i < obj.length ? obj[i] : null;
      }
      if (typeof obj === "string" && typeof index === "number") {
        return obj[index] ?? "";
      }
      return null;
    }
    case "member": {
      const obj = evalExpr(expr.obj, env, host);
      return evalMember(obj, expr.name, host) ?? undefined;
    }
    case "call":
      return evalCall(expr, env, host);
    case "closure":
      return { t: "closure", params: expr.params, block: expr.block, env };
  }
}

let warnedNames = new Set<string>();

function evalIdent(name: string, env: Env, host: EvalHost): Value {
  const found = env.lookup(name);
  if (found !== undefined) {
    // Computed properties evaluate on access, like Swift.
    if (isClosure(found) && found.computed) return callClosure(found, [], host);
    return found;
  }

  if (/^[A-Z]/.test(name)) return { t: "type", name };

  if (!warnedNames.has(name)) {
    warnedNames.add(name);
    host.warn(`Unknown identifier '${name}' — treated as nil.`, 0, 0);
  }
  return null;
}

export function resetWarnings(): void {
  warnedNames = new Set();
}

function evalString(parts: StringPartAst[], env: Env, host: EvalHost): string {
  let out = "";
  for (const part of parts) {
    if (part.kind === "text") out += part.value;
    else out += swiftDescription(evalExpr(part.expr, env, host));
  }
  return out;
}

/* ────────────────────────────── Member access ────────────────────────────── */

function evalMember(obj: Value, name: string, host: EvalHost): Value {
  if (isImplicit(obj)) {
    return { t: "implicit", path: [...obj.path, name] };
  }
  if (isType(obj)) {
    return { t: "implicit", path: [obj.name, name] };
  }
  if (isStruct(obj)) {
    const member = obj.env.lookup(name) ?? null;
    if (isClosure(member) && member.computed) {
      return callClosure(member, [], host);
    }
    return member;
  }
  if (Array.isArray(obj)) {
    switch (name) {
      case "count":
        return obj.length;
      case "isEmpty":
        return obj.length === 0;
      case "first":
        return obj.length > 0 ? obj[0] : null;
      case "last":
        return obj.length > 0 ? obj[obj.length - 1] : null;
      default:
        return null;
    }
  }
  if (typeof obj === "string") {
    switch (name) {
      case "count":
        return obj.length;
      case "isEmpty":
        return obj.length === 0;
      case "first":
        return obj.length > 0 ? obj[0] : "";
      case "last":
        return obj.length > 0 ? obj[obj.length - 1] : "";
      default:
        return null;
    }
  }
  if (typeof obj === "number" && name === "count") return 0;
  return null;
}

/* ────────────────────────────── Calls ────────────────────────────── */

function evalCall(
  expr: Extract<Expr, { k: "call" }>,
  env: Env,
  host: EvalHost,
): Value {
  const callee = expr.callee;

  // Detect special forms that need AST-level handling.
  if (callee.k === "ident") {
    const name = callee.name;

    if (name === "print") {
      const args = expr.args.map((a) => ({ label: a.label, value: evalExpr(a.value, env, host) }));
      host.log(args.map((a) => swiftDescription(a.value)).join(" "));
      return null;
    }

    if (name === "withAnimation") {
      if (expr.trailing) {
        const scope = new Env(env);
        execStmts(expr.trailing.asStatements(), scope, host);
      }
      return null;
    }

    // User functions / closures from the environment.
    const found = env.lookup(name);
    if (isClosure(found)) {
      const args = evalArgs(expr.args, env, host);
      return callClosure(found, args, host);
    }

    // Builtins.
    const args = evalArgs(expr.args, env, host);
    const result = callBuiltin(name, args, host);
    if (result !== undefined) return result;

    if (isType(found)) {
      return constructType(found.name, args, host);
    }

    // Unknown call: treat uppercase names as view/type constructors.
    if (/^[A-Z]/.test(name)) {
      return constructType(name, args, host);
    }

    return null;
  }

  if (callee.k === "member") {
    const obj = evalExpr(callee.obj, env, host);
    const args = evalArgs(expr.args, env, host);

    if (isImplicit(obj)) {
      // `.black.opacity(0.12)` / `Color.gray.opacity(0.4)` — the method name
      // carries the semantics, so it must extend the implicit path instead of
      // being dropped (which silently lost the alpha).
      return callImplicit([...obj.path, callee.name], args, expr, env, host);
    }
    if (isType(obj)) {
      return callTypeMember(obj.name, callee.name, args, expr, env, host);
    }
    if (isBinding(obj)) {
      const value = obj.get();
      return callMethod(value, callee.name, args, expr, env, host);
    }
    return callMethod(obj, callee.name, args, expr, env, host);
  }

  if (callee.k === "implicit") {
    const args = evalArgs(expr.args, env, host);
    return callImplicit([callee.name], args, expr, env, host);
  }

  const target = evalExpr(callee, env, host);
  if (isClosure(target)) {
    const args = evalArgs(expr.args, env, host);
    return callClosure(target, args, host);
  }

  return null;
}

function evalArgs(
  args: { label?: string; value: Expr }[],
  env: Env,
  host: EvalHost,
): EvaluatedArg[] {
  return args.map((a) => ({
    ...(a.label ? { label: a.label } : {}),
    value: evalExpr(a.value, env, host),
  }));
}

/** Marker returned when a builtin name is not actually a builtin. */
const NOT_HANDLED: undefined = undefined;

/** Returns `undefined` when `name` is not a builtin. */
function callBuiltin(name: string, args: EvaluatedArg[], host: EvalHost): Value | undefined {
  const num = (index: number): number => numOf(args[index]?.value ?? null) ?? 0;
  const first = (): Value => args[0]?.value ?? null;

  switch (name) {
    case "abs":
      return Math.abs(num(0));
    case "min":
      if (Array.isArray(first())) return Math.min(...(first() as number[]));
      return Math.min(num(0), num(1));
    case "max":
      if (Array.isArray(first())) return Math.max(...(first() as number[]));
      return Math.max(num(0), num(1));
    case "round":
      return Math.round(num(0));
    case "floor":
      return Math.floor(num(0));
    case "ceil":
      return Math.ceil(num(0));
    case "sqrt":
      return Math.sqrt(num(0));
    case "pow":
      return Math.pow(num(0), num(1));
    case "Int": {
      const v = first();
      const n = numOf(v);
      if (n !== undefined) return Math.trunc(n);
      if (typeof v === "string") return Number.parseInt(v, 10) || 0;
      if (typeof v === "boolean") return v ? 1 : 0;
      return 0;
    }
    case "Double":
    case "Float": {
      const v = first();
      const n = numOf(v);
      if (n !== undefined) return boxDouble(n);
      if (typeof v === "string") return boxDouble(Number.parseFloat(v) || 0);
      return boxDouble(0);
    }
    case "String": {
      const v = first();
      if (args.some((a) => a.label === "repeating")) {
        const repeated = typeof v === "string" ? v : swiftDescription(v);
        const count = Number(args.find((a) => a.label === "count")?.value ?? 0);
        return repeated.repeat(Math.max(0, count));
      }
      return swiftDescription(v);
    }
    case "Bool":
      return truthy(first());
    case "UUID": {
      const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
      return `${rnd()}${rnd()}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
    }
    case "stride": {
      const from = num(0);
      const to = num(1);
      const step = num(2) || 1;
      const out: number[] = [];
      for (let i = from; step > 0 ? i < to : i > to; i += step) out.push(i);
      return out;
    }
    case "Array": {
      const v = first();
      if (Array.isArray(v)) return [...v];
      if (isRange(v)) return iterate(v);
      if (typeof v === "string") return v.split("");
      return [];
    }
    case "Set":
      return Array.isArray(first()) ? [...new Set(first() as Value[])] : [];
    case "print":
      host.log(args.map((a) => swiftDescription(a.value)).join(" "));
      return null;
    case "assert":
    case "precondition":
    case "debugPrint":
      return null;
    default:
      return NOT_HANDLED;
  }
}

function constructType(
  name: string,
  args: EvaluatedArg[],
  host: EvalHost,
): Value {
  // Model structs are constructed by the view builder; here only value types.
  switch (name) {
    case "Color":
      return colorFromArgs(args);
    case "LinearGradient":
      return gradientFromArgs("linear", args);
    case "RadialGradient":
      return gradientFromArgs("radial", args);
    case "AngularGradient":
      return gradientFromArgs("angular", args);
    case "Image":
      return imageFromArgs(args);
    case "Font":
      return { t: "font", ...implicitFontFromPath(["body"]) } as FontVal;
    case "Text":
      return swiftDescription(args[0]?.value ?? null);
    case "RoundedRectangle":
      return shapeFromArgs("RoundedRectangle", args);
    case "Rectangle":
    case "Circle":
    case "Capsule":
    case "Ellipse":
      return shapeFromArgs(name, args);
    case "GridItem":
      // Keep the descriptor shape (`.flexible`, `.fixed(120)`, `.adaptive(minimum:)`)
      // so layout code can translate each GridItem into a CSS grid track.
      return { t: "implicit", path: ["GridItem"], called: true, args };
    case "CGPoint": {
      const env = new Env();
      env.declare("x", numOf(args.find((a) => a.label === "x")?.value ?? null) ?? 0);
      env.declare("y", numOf(args.find((a) => a.label === "y")?.value ?? null) ?? 0);
      return { t: "struct", typeName: "CGPoint", env };
    }
    case "CGSize": {
      const env = new Env();
      env.declare("width", numOf(args.find((a) => a.label === "width")?.value ?? null) ?? 0);
      env.declare("height", numOf(args.find((a) => a.label === "height")?.value ?? null) ?? 0);
      return { t: "struct", typeName: "CGSize", env };
    }
    default:
      break;
  }

  // User-declared model structs are constructed by the runtime.
  const custom = host.constructStruct?.(name, args);
  if (custom !== undefined) return custom;

  // Unknown constructor: evaluate to an empty struct value so member access
  // does not crash the preview.
  if (/^[A-Z]/.test(name)) {
    return { t: "struct", typeName: name, env: new Env() };
  }
  return null;
}

function shapeFromArgs(name: string, args: EvaluatedArg[]): ShapeVal {
  return { t: "shape", name, args };
}

function imageFromArgs(args: EvaluatedArg[]): ImageVal {
  const system = args.find((a) => a.label === "systemName")?.value;
  const named = args.find((a) => a.label === "name" || a.label === undefined)?.value;
  if (typeof system === "string") return { t: "image", systemName: system };
  if (typeof named === "string") return { t: "image", name: named };
  return { t: "image", name: "photo" };
}

function colorFromArgs(args: EvaluatedArg[]): ColorVal {
  const get = (label: string) => {
    const v = args.find((a) => a.label === label)?.value;
    return numOf(v ?? null) ?? 0;
  };
  if (args.some((a) => a.label === "white")) {
    const w = Math.round(get("white") * 255);
    return { t: "color", name: "custom", rgb: [w, w, w], alpha: args.some((a) => a.label === "opacity") ? get("opacity") : 1 };
  }
  if (args.some((a) => a.label === "red")) {
    return {
      t: "color",
      name: "custom",
      rgb: [Math.round(get("red") * 255), Math.round(get("green") * 255), Math.round(get("blue") * 255)],
      alpha: args.some((a) => a.label === "opacity") ? get("opacity") : 1,
    };
  }
  if (args.some((a) => a.label === "hue")) {
    const [r, g, b] = hsvToRgb(get("hue"), get("saturation"), get("brightness"));
    return { t: "color", name: "custom", rgb: [r, g, b], alpha: 1 };
  }
  const first = args[0]?.value;
  if (typeof first === "string") return { t: "color", name: first, alpha: 1 };
  return { t: "color", name: "clear", alpha: 0 };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function gradientFromArgs(kind: "linear" | "radial" | "angular", args: EvaluatedArg[]): GradientVal {
  const colors = args.find((a) => a.label === "colors")?.value;
  const start = args.find((a) => a.label === "startPoint")?.value;
  const end = args.find((a) => a.label === "endPoint")?.value;
  return {
    t: "gradient",
    kind,
    colors: Array.isArray(colors) ? colors : [],
    startPoint: implicitName(start) ?? "top",
    endPoint: implicitName(end) ?? "bottom",
  };
}

function implicitName(value: Value | undefined): string | null {
  if (isImplicit(value)) return value.path[value.path.length - 1] ?? null;
  if (typeof value === "string") return value;
  return null;
}

/** Method calls on ordinary values (arrays, strings, numbers, models). */
function callMethod(
  obj: Value,
  name: string,
  args: EvaluatedArg[],
  expr: Extract<Expr, { k: "call" }>,
  env: Env,
  host: EvalHost,
): Value {
  const trailing = expr.trailing;
  const closureArg = (): ClosureVal | null => {
    const direct = args.find((a) => isClosure(a.value))?.value;
    if (isClosure(direct)) return direct;
    if (trailing) return { t: "closure", params: [], block: trailing, env };
    return null;
  };

  if (Array.isArray(obj)) {
    const arr = obj;
    switch (name) {
      case "append":
        if (args.length > 0) arr.push(cloneValue(args[0].value));
        host.bump();
        return null;
      case "insert": {
        const element = args[0]?.value ?? null;
        const at = args.find((a) => a.label === "at")?.value;
        const index = typeof at === "number" ? at : arr.length;
        arr.splice(Math.max(0, index), 0, cloneValue(element));
        host.bump();
        return null;
      }
      case "removeLast":
        arr.pop();
        host.bump();
        return null;
      case "removeFirst":
        arr.shift();
        host.bump();
        return null;
      case "remove": {
        const at = args.find((a) => a.label === "at")?.value ?? args[0]?.value;
        if (typeof at === "number") {
          arr.splice(at, 1);
          host.bump();
        }
        return null;
      }
      case "removeAll":
        arr.length = 0;
        host.bump();
        return null;
      case "removeAllWhere":
        return null;
      case "contains": {
        const target = args[0]?.value;
        const filter = closureArg();
        if (filter) return arr.some((item) => truthy(callClosure(filter, [{ value: item }], host)));
        return arr.some((item) => swiftEquals(item, target));
      }
      case "firstIndex": {
        const of = args.find((a) => a.label === "of")?.value;
        const index = arr.findIndex((item) => swiftEquals(item, of));
        return index >= 0 ? index : null;
      }
      case "map": {
        const fn = closureArg();
        if (!fn) return [...arr];
        return arr.map((item, index) => callClosure(fn, [{ value: item }, { value: index }], host));
      }
      case "compactMap": {
        const fn = closureArg();
        if (!fn) return [...arr];
        return arr
          .map((item, index) => callClosure(fn, [{ value: item }, { value: index }], host))
          .filter((v) => !isNil(v));
      }
      case "filter": {
        const fn = closureArg();
        if (!fn) return [...arr];
        return arr.filter((item, index) => truthy(callClosure(fn, [{ value: item }, { value: index }], host)));
      }
      case "forEach": {
        const fn = closureArg();
        if (fn) arr.forEach((item, index) => callClosure(fn, [{ value: item }, { value: index }], host));
        return null;
      }
      case "reduce": {
        let acc: Value = args[0]?.value ?? null;
        const fn = closureArg();
        if (fn) {
          for (const item of arr) {
            acc = callClosure(fn, [{ value: acc }, { value: item }], host);
          }
        }
        return acc;
      }
      case "sorted": {
        const fn = closureArg();
        const copy = [...arr];
        if (fn) {
          copy.sort((a, b) =>
            truthy(callClosure(fn, [{ value: a }, { value: b }], host)) ? -1 : 1,
          );
        } else {
          copy.sort((a, b) => compareValues(a, b));
        }
        return copy;
      }
      case "reversed":
        return [...arr].reverse();
      case "shuffled":
        return [...arr].sort(() => Math.random() - 0.5);
      case "enumerated":
        return arr.map((item, index) => [index, item]);
      case "joined": {
        const separator = args.find((a) => a.label === "separator")?.value;
        const sep = typeof separator === "string" ? separator : "";
        return arr.map((item) => swiftDescription(item)).join(sep);
      }
      case "allSatisfy": {
        const fn = closureArg();
        return fn ? arr.every((item) => truthy(callClosure(fn, [{ value: item }], host))) : true;
      }
      case "first": {
        const fn = closureArg();
        if (fn) return arr.find((item) => truthy(callClosure(fn, [{ value: item }], host))) ?? null;
        return arr[0] ?? null;
      }
      default:
        return null;
    }
  }

  if (typeof obj === "string") {
    switch (name) {
      case "uppercased":
        return obj.toUpperCase();
      case "lowercased":
        return obj.toLowerCase();
      case "capitalized":
        return obj.replace(/\b\w/g, (c) => c.toUpperCase());
      case "hasPrefix":
        return obj.startsWith(String(args[0]?.value ?? ""));
      case "hasSuffix":
        return obj.endsWith(String(args[0]?.value ?? ""));
      case "contains":
        return obj.includes(String(args[0]?.value ?? ""));
      case "replacingOccurrences": {
        const of = String(args.find((a) => a.label === "of")?.value ?? "");
        const withValue = String(args.find((a) => a.label === "with")?.value ?? "");
        return obj.split(of).join(withValue);
      }
      case "prefix": {
        const n = args[0]?.value;
        return typeof n === "number" ? obj.slice(0, n) : obj;
      }
      case "suffix": {
        const n = args[0]?.value;
        return typeof n === "number" ? obj.slice(-n) : obj;
      }
      case "dropFirst":
        return obj.slice(typeof args[0]?.value === "number" ? (args[0].value as number) : 1);
      case "dropLast":
        return obj.slice(0, typeof args[0]?.value === "number" ? -(args[0].value as number) : -1);
      case "trimmingCharacters":
        return obj.trim();
      case "split": {
        const separator = String(args.find((a) => a.label === "separator")?.value ?? " ");
        return obj.split(separator).filter((s) => s.length > 0);
      }
      case "components":
        return obj.split(String(args.find((a) => a.label === "separatedBy")?.value ?? " "));
      case "padding": {
        const to = typeof args[0]?.value === "number" ? (args[0].value as number) : 0;
        const pad = String(args.find((a) => a.label === "with")?.value ?? " ");
        return obj.padStart(obj.length + to, pad);
      }
      default:
        return null;
    }
  }

  if (typeof obj === "number" || isDoubleVal(obj)) {
    const n = numOf(obj) ?? 0;
    switch (name) {
      case "rounded": {
        const digits = args.find((a) => a.label === "toPlaces")?.value;
        const places = numOf(digits ?? null);
        if (places !== undefined) {
          const factor = Math.pow(10, places);
          return boxDouble(Math.round(n * factor) / factor);
        }
        return Math.round(n);
      }
      case "formatted":
      case "description":
        return swiftDescription(obj);
      case "isNaN":
        return Number.isNaN(n);
      case "isFinite":
        return Number.isFinite(n);
      case "distance":
        return null;
      default:
        return null;
    }
  }

  if (isStruct(obj)) {
    const member = obj.env.lookup(name);
    if (isClosure(member)) {
      return callClosure(member, args, host, obj);
    }
    return null;
  }

  if (isShape(obj)) {
    if (name === "fill") return { t: "shapestyle", mode: "fill", shape: obj, color: args[0]?.value ?? null, lineWidth: 0 };
    if (name === "stroke" || name === "strokeBorder") {
      const width = args.find((a) => a.label === "lineWidth")?.value;
      return {
        t: "shapestyle",
        mode: name,
        shape: obj,
        color: args[0]?.value ?? null,
        lineWidth: typeof width === "number" ? width : 1,
      };
    }
    return obj;
  }

  if (isColor(obj)) {
    if (name === "opacity") {
      const alpha = typeof args[0]?.value === "number" ? (args[0].value as number) : 1;
      return { ...obj, alpha: obj.alpha * alpha };
    }
    return obj;
  }

  if (isImage(obj)) {
    return obj;
  }

  if (isRange(obj)) {
    if (name === "contains" && typeof args[0]?.value === "number") {
      const n = args[0].value as number;
      return obj.closed ? n >= obj.lo && n <= obj.hi : n >= obj.lo && n < obj.hi;
    }
    return null;
  }

  if (isType(obj)) {
    return callTypeMember(obj.name, name, args, expr, env, host);
  }

  return null;
}

/** Static members such as `Int.random(in: 1...6)`. */
function callTypeMember(
  typeName: string,
  name: string,
  args: EvaluatedArg[],
  expr: Extract<Expr, { k: "call" }>,
  env: Env,
  host: EvalHost,
): Value {
  if (typeName === "Int" || typeName === "Double" || typeName === "Float") {
    if (name === "random") {
      const range = args.find((a) => a.label === "in")?.value;
      if (isRange(range)) {
        const lo = range.lo;
        const hi = range.closed ? range.hi : range.hi - 1;
        const value = lo + Math.random() * (hi - lo + 1);
        return typeName === "Int" ? Math.floor(value) : value;
      }
      return Math.random();
    }
  }
  if (typeName === "Color") {
    if (name === "clear") return { t: "color", name: "clear", alpha: 0 };
    const implicit = callImplicit([typeName, name], args, expr, env, host);
    return implicit;
  }
  if (typeName === "ShapeStyle") {
    return callImplicit(["ShapeStyle", name], args, expr, env, host);
  }
  return null;
}

/* ────────────────────────────── Implicit members ────────────────────────────── */

const COLOR_NAMES: Record<string, [number, number, number]> = {
  red: [255, 59, 48],
  orange: [255, 149, 0],
  yellow: [255, 204, 0],
  green: [52, 199, 89],
  mint: [0, 199, 190],
  teal: [48, 176, 199],
  cyan: [50, 173, 230],
  blue: [0, 122, 255],
  indigo: [88, 86, 214],
  purple: [175, 82, 222],
  pink: [255, 45, 85],
  brown: [162, 132, 94],
  black: [0, 0, 0],
  white: [255, 255, 255],
  gray: [142, 142, 147],
  clear: [0, 0, 0],
};

export function implicitToColor(path: string[]): ColorVal | null {
  const name = path[path.length - 1]?.toLowerCase() ?? "";
  if (name in COLOR_NAMES) {
    return {
      t: "color",
      name,
      rgb: COLOR_NAMES[name],
      alpha: name === "clear" ? 0 : 1,
    };
  }
  return null;
}

const TEXT_STYLE_NAMES = new Set([
  "largeTitle", "title", "title2", "title3", "headline", "body",
  "callout", "subheadline", "footnote", "caption", "caption2",
]);

function implicitFontFromPath(path: string[]): Partial<FontVal> {
  const style = path.find((p) => TEXT_STYLE_NAMES.has(p));
  const weight = path.find((p) =>
    ["ultraLight", "thin", "light", "regular", "medium", "semibold", "bold", "heavy", "black"].includes(p),
  );
  const design = path.find((p) => ["rounded", "serif", "monospaced"].includes(p));
  return {
    ...(style ? { style } : {}),
    ...(weight ? { weight } : {}),
    ...(design ? { design } : {}),
  };
}

function callImplicit(
  path: string[],
  args: EvaluatedArg[],
  expr: Extract<Expr, { k: "call" }>,
  env: Env,
  host: EvalHost,
): Value {
  const last = path[path.length - 1];
  const head = path[0];

  // `.black.opacity(0.5)` / `Color.gray.opacity(0.4)` — colour with alpha.
  if (last === "opacity" && path.length >= 2) {
    const base = implicitToColor([path[0]]) ?? implicitToColor(path.slice(0, -1));
    if (base) {
      const alpha = numOf(args[0]?.value ?? null) ?? 1;
      return { ...base, alpha: base.alpha * alpha };
    }
  }

  if (head === "system" || path.includes("system")) {
    const size = args.find((a) => a.label === "size")?.value;
    const weight = implicitName(args.find((a) => a.label === "weight")?.value);
    const design = implicitName(args.find((a) => a.label === "design")?.value);
    return {
      t: "font",
      ...(typeof size === "number" ? { size } : { size: 17 }),
      ...(weight ? { weight } : {}),
      ...(design ? { design } : {}),
    } as FontVal;
  }

  if (last === "degrees") {
    return { t: "angle", degrees: typeof args[0]?.value === "number" ? (args[0].value as number) : 0 } as AngleVal;
  }
  if (last === "radians") {
    const radians = typeof args[0]?.value === "number" ? (args[0].value as number) : 0;
    return { t: "angle", degrees: (radians * 180) / Math.PI } as AngleVal;
  }

  // DispatchQueue.main.async { } / .asyncAfter(deadline: .now() + s) { }
  if (path.includes("DispatchQueue")) {
    const delay = args.find((a) => a.label === "deadline")?.value;
    const seconds = typeof delay === "number" ? delay : 0;
    const block = expr.trailing;
    if (block) {
      globalThis.setTimeout(() => {
        runStatements(block.asStatements(), new Env(env), host);
        host.bump();
      }, Math.max(0, seconds * 1000));
    }
    return null;
  }

  if (last === "withAnimation" || path.includes("Animation")) {
    if (expr.trailing) execStmts(expr.trailing.asStatements(), new Env(env), host);
    return null;
  }

  if (last === "task" || last === "onAppear") {
    return null;
  }

  const color = implicitToColor(path);
  if (color) return color;

  const shape = path.find((p) => ["rect", "circle", "capsule", "ellipse"].includes(p));
  if (shape) {
    const radius = args.find((a) => a.label === "cornerRadius")?.value;
    return {
      t: "shape",
      name: shape === "rect" ? "RoundedRectangle" : shape.charAt(0).toUpperCase() + shape.slice(1),
      args: typeof radius === "number" ? [{ label: "cornerRadius", value: radius }] : [],
    } as ShapeVal;
  }

  return { t: "implicit", path, called: true, args };
}

/* ────────────────────────────── Closures ────────────────────────────── */

export function callClosure(
  fn: ClosureVal,
  args: EvaluatedArg[],
  host: EvalHost,
  selfValue?: StructVal,
): Value {
  if (fn.native) return fn.native(args, host);
  if (!fn.block) return null;

  const scope = new Env(fn.env);
  if (selfValue) scope.declare("self", selfValue);

  fn.params.forEach((param, index) => {
    const byLabel = args.find((a) => a.label === param);
    scope.declare(param, cloneValue(byLabel ? byLabel.value : (args[index]?.value ?? null)));
  });

  // Closure shorthand `$0`, `$1`, ...
  args.forEach((arg, index) => {
    if (!fn.params.includes(`$${index}`)) scope.declare(`$${index}`, arg.value);
  });

  const flow = execStmts(fn.block.asStatements(), scope, host);
  if (flow && flow.type === "return") return flow.value;
  return null;
}

/* ────────────────────────────── Operators ────────────────────────────── */

export function truthy(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  const n = numOf(value);
  if (n !== undefined) return n !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function applyBinary(op: string, left: Value, right: Value): Value {
  const ln = numOf(left);
  const rn = numOf(right);
  const bothNumbers = ln !== undefined && rn !== undefined;
  const floating = isDoubleVal(left) || isDoubleVal(right);

  switch (op) {
    case "+": {
      if (bothNumbers) {
        const sum = (ln as number) + (rn as number);
        return floating ? boxDouble(sum) : sum;
      }
      if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
      if (typeof left === "string" || typeof right === "string") {
        return swiftDescription(left) + swiftDescription(right);
      }
      if (isImplicit(left) && left.path[0] === "now" && bothNumbers) return right;
      if (isImplicit(right) && right.path[0] === "now" && bothNumbers) return left;
      return swiftDescription(left) + swiftDescription(right);
    }
    case "-": {
      if (!bothNumbers) return 0;
      const result = (ln as number) - (rn as number);
      return floating ? boxDouble(result) : result;
    }
    case "*": {
      if (!bothNumbers) return 0;
      const result = (ln as number) * (rn as number);
      return floating ? boxDouble(result) : result;
    }
    case "/": {
      if (!bothNumbers) return 0;
      const a = ln as number;
      const b = rn as number;
      if (b === 0) return a === 0 ? Number.NaN : Infinity;
      // Swift: Int / Int truncates, Double / Double keeps the fraction.
      if (floating || !Number.isInteger(a) || !Number.isInteger(b)) {
        return boxDouble(a / b);
      }
      return Math.trunc(a / b);
    }
    case "%": {
      if (!bothNumbers || rn === 0) return 0;
      return (ln as number) % (rn as number);
    }
    case "==":
      return swiftEquals(left, right);
    case "!=":
      return !swiftEquals(left, right);
    case "<":
      return compareValues(left, right) < 0;
    case "<=":
      return compareValues(left, right) <= 0;
    case ">":
      return compareValues(left, right) > 0;
    case ">=":
      return compareValues(left, right) >= 0;
    default:
      return null;
  }
}

function compareValues(left: Value, right: Value): number {
  const ln = numOf(left);
  const rn = numOf(right);
  if (ln !== undefined && rn !== undefined) {
    return ln === rn ? 0 : ln < rn ? -1 : 1;
  }
  const a = swiftDescription(left);
  const b = swiftDescription(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

export function swiftEquals(left: Value, right: Value): boolean {
  if (left === right) return true;
  if (isNil(left) && isNil(right)) return true;
  if (isImplicit(left) && isImplicit(right)) {
    return left.path.join(".") === right.path.join(".");
  }
  if (isColor(left) && isColor(right)) {
    return left.name === right.name && left.alpha === right.alpha;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((v, i) => swiftEquals(v, right[i]));
  }
  const ln = numOf(left);
  const rn = numOf(right);
  if (ln !== undefined && rn !== undefined) {
    return Math.abs(ln - rn) < 1e-12;
  }
  return false;
}

/* ────────────────────────────── Value helpers ────────────────────────────── */

/** Swift arrays and strings have value semantics: copy on assignment. */
export function cloneValue(value: Value): Value {
  if (Array.isArray(value)) return value.map(cloneValue);
  return value;
}

/** Number formatting close to Swift's `description`. */
function formatNumber(value: number, forceDecimal = false): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1e6) / 1e6;
  if (Number.isInteger(rounded)) {
    return forceDecimal ? `${rounded}.0` : String(rounded);
  }
  return String(rounded);
}

export function swiftDescription(value: Value): string {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  if (isDoubleVal(value)) return formatNumber(value.v, true);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(swiftDescription).join(", ")}]`;
  if (isRange(value)) {
    return `${value.lo}${value.closed ? "..." : "..<"}${value.hi}`;
  }
  if (isStruct(value)) return `${value.typeName}(…)`;
  if (isColor(value)) return value.name;
  if (isImplicit(value)) return value.path.join(".");
  if (isImage(value)) return value.systemName ?? value.name ?? "image";
  if (isShape(value)) return value.name;
  if (isClosure(value)) return "<closure>";
  if (isBinding(value)) return swiftDescription(value.get());
  return "";
}
