/**
 * swiftIR.ts
 *
 * Intermediate representation for transpiled SwiftUI. Unlike the HTML string
 * produced by the legacy path, this IR carries enough semantic information for
 * a React renderer to mount real interactive components: state declarations,
 * closure actions, navigation destinations, and string interpolation.
 *
 * SwiftUI semantics modelled here (documented public API, not reverse-engineered):
 *  - @State creates observable storage; mutations trigger re-render.
 *  - @Binding is a writable reference to parent state.
 *  - @Environment(\.dismiss) injects a closure that pops the navigation stack.
 *  - Button(label) { closure } executes the closure on tap.
 *  - NavigationStack { root } hosts a push/pop stack.
 *  - NavigationLink("label") { Destination() } pushes Destination onto the stack.
 *  - Text("Count: \(count)") interpolates state into the label.
 */

import type { Token } from "./swiftTranspiler";

/* ──────────────────────────── Value expressions ──────────────────────────── */

export type ValueExpr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "identifier"; value: string };

export function evalValueExpr(expr: ValueExpr, state: Record<string, unknown>): unknown {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "string":
      return expr.value;
    case "bool":
      return expr.value;
    case "identifier":
      return state[expr.value] ?? 0;
  }
}

/* ──────────────────────────── Statements ──────────────────────────── */

export type Statement =
  | { kind: "assign"; target: string; op: "=" | "+=" | "-="; value: ValueExpr }
  | { kind: "call"; func: string; args: ValueExpr[] }
  | { kind: "invoke"; name: string }
  | { kind: "navigate"; destination: NavigationDestination }
  | { kind: "dismiss" };

/* ──────────────────────────── Text interpolation ──────────────────────────── */

export type TextPart =
  | { kind: "literal"; value: string }
  | { kind: "interpolation"; variable: string };

/* ──────────────────────────── Modifiers ──────────────────────────── */

export interface ModifierSpec {
  name: string;
  rawArgs: string;
}

/* ──────────────────────────── View specification ──────────────────────────── */

export interface ViewSpec {
  type: string;
  /** Human-readable name for named views (structs). */
  name?: string;
  /** Raw argument strings from the parser, for backward-compatible rendering. */
  args: string[];
  /** Static text for Text views without interpolation. */
  text?: string;
  /** Interpolated text parts when the string contains \(...). */
  textParts?: TextPart[];
  modifiers: ModifierSpec[];
  /** Optional closure attached to a modifier (onAppear, onTapGesture). */
  modifierClosures?: Record<string, Statement[]>;
  children: ViewSpec[];
  /** Closure body for Button — executed on tap. */
  action?: Statement[];
  /** Destination for NavigationLink — resolved lazily at render time. */
  navigationDestination?: NavigationDestination;
  /** True when the view declares @Environment(\.dismiss). */
  environmentDismiss?: boolean;
}

export type NavigationDestination =
  | { kind: "named"; name: string }
  | { kind: "inline"; view: ViewSpec };

/* ──────────────────────────── State declarations ──────────────────────────── */

export interface StateSpec {
  name: string;
  init: ValueExpr;
  isBinding: boolean;
}

/* ──────────────────────────── Component specification ──────────────────────────── */

export interface ComponentSpec {
  states: StateSpec[];
  /** User-defined `func` bodies, invoked from Button closures. */
  functions: Record<string, Statement[]>;
  /** All `struct ... : View` bodies, keyed by type name. */
  views: Record<string, ViewSpec>;
  body: ViewSpec;
  hasNavigationStack: boolean;
  hasEnvironmentDismiss: boolean;
}

/* ──────────────────────────── Closure / statement parser ──────────────────────────── */

/**
 * Parse a flat token list (the body of a Button closure) into Statements.
 * Handles: assign (count += 1), call (print("x"), dismiss()), and bare
 * view calls that imply navigation (DetailView()).
 */
export function parseActionStatements(
  tokens: Token[],
  userFunctions: Record<string, Statement[]> = {},
): Statement[] {
  const statements: Statement[] = [];
  const known = new Set(Object.keys(userFunctions));
  let pos = 0;

  while (pos < tokens.length) {
    const tok = tokens[pos];
    if (!tok) break;

    // Skip keywords we don't model (self, etc.) and stray punctuation.
    if (tok.kind === "keyword" || tok.value === "{" || tok.value === "}" || tok.value === ";") {
      pos++;
      continue;
    }

    if (tok.kind === "identifier" || tok.kind === "view") {
      const name = tok.value;
      const next = tokens[pos + 1];

      // Assignment: count += 1, count -= 1, count = 5
      if (next && (next.value === "+=" || next.value === "-=" || next.value === "=")) {
        const op = next.value as "=" | "+=" | "-=";
        const valueTok = tokens[pos + 2];
        if (valueTok) {
          // Handle optional leading sign: count = -1
          let sign = 1;
          let exprTok = valueTok;
          if (valueTok.kind === "operator" && (valueTok.value === "-" || valueTok.value === "+")) {
            sign = valueTok.value === "-" ? -1 : 1;
            exprTok = tokens[pos + 3] ?? valueTok;
          }
          const expr = tokenToValueExpr(exprTok);
          if (sign === -1 && expr.kind === "number") expr.value = -expr.value;
          statements.push({ kind: "assign", target: name, op, value: expr });
          pos += sign === -1 ? 4 : 3;
          continue;
        }
      }

      // Call: print("x"), dismiss(), DetailView(), increment()
      if (next && next.value === "(") {
        const args: ValueExpr[] = [];
        pos += 2; // skip name and (
        while (pos < tokens.length && tokens[pos].value !== ")") {
          const argTok = tokens[pos];
          if (argTok.value !== "," && argTok.value !== "(") {
            args.push(tokenToValueExpr(argTok));
          }
          pos++;
        }
        pos++; // skip )

        if (name === "dismiss") {
          statements.push({ kind: "dismiss" });
        } else if (name === "print") {
          statements.push({ kind: "call", func: "print", args });
        } else if (known.has(name)) {
          statements.push({ kind: "invoke", name });
        } else {
          // A bare view constructor inside a NavigationLink closure is
          // handled separately by the view parser, not as a statement.
        }
        continue;
      }

      // Bare identifier — skip
      pos++;
      continue;
    }

    pos++;
  }

  return statements;
}

function tokenToValueExpr(tok: Token): ValueExpr {
  if (tok.kind === "number") {
    return { kind: "number", value: Number(tok.value) };
  }
  if (tok.kind === "string") {
    return { kind: "string", value: tok.value.slice(1, -1) };
  }
  if (tok.kind === "keyword" && (tok.value === "true" || tok.value === "false")) {
    return { kind: "bool", value: tok.value === "true" };
  }
  if (tok.kind === "identifier") {
    return { kind: "identifier", value: tok.value };
  }
  return { kind: "string", value: tok.value };
}

/**
 * Split a Swift string literal (with surrounding quotes) into text parts,
 * detecting \(variable) interpolation segments.
 */
export function parseInterpolation(rawString: string): TextPart[] {
  // Strip surrounding quotes
  let s = rawString.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1);
  }

  const parts: TextPart[] = [];
  let current = "";
  let i = 0;

  while (i < s.length) {
    if (s[i] === "\\" && s[i + 1] === "(") {
      if (current) {
        parts.push({ kind: "literal", value: current });
        current = "";
      }
      i += 2; // skip \(
      let varName = "";
      while (i < s.length && s[i] !== ")") {
        varName += s[i];
        i++;
      }
      i++; // skip )
      parts.push({ kind: "interpolation", variable: varName.trim() });
    } else {
      current += s[i];
      i++;
    }
  }

  if (current) {
    parts.push({ kind: "literal", value: current });
  }

  return parts.length > 0 ? parts : [{ kind: "literal", value: s }];
}

/** True when the raw string literal contains \(...) interpolation. */
export function hasInterpolation(rawString: string): boolean {
  return rawString.includes("\\(");
}

/* ──────────────────────────── State declaration scanner ──────────────────────────── */

/**
 * Scan the full token stream for @State / @Binding declarations and
 * @Environment(\.dismiss) injections. Returns parsed state specs.
 */
export function scanStateDeclarations(tokens: Token[]): {
  states: StateSpec[];
  hasEnvironmentDismiss: boolean;
} {
  const states: StateSpec[] = [];
  let hasEnvironmentDismiss = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // @State private var count: Int = 0
    // @Binding var count: Int
    if (tok.kind === "attribute" && (tok.value === "@State" || tok.value === "@Binding")) {
      const isBinding = tok.value === "@Binding";
      // Find "var" keyword
      let j = i + 1;
      while (j < tokens.length && tokens[j].value !== "var") j++;
      if (j >= tokens.length) continue;

      const nameTok = tokens[j + 1];
      if (!nameTok || nameTok.kind !== "identifier") continue;

      const name = nameTok.value;

      // Find "=" for initial value (skips type annotation)
      let k = j + 2;
      while (k < tokens.length && tokens[k].value !== "=" && tokens[k].value !== "{" && tokens[k].value !== "}") {
        k++;
      }

      if (k < tokens.length && tokens[k].value === "=") {
        const valueTok = tokens[k + 1];
        if (valueTok) {
          states.push({
            name,
            init: tokenToValueExpr(valueTok),
            isBinding,
          });
        }
      } else if (isBinding) {
        // Bindings without initial value default to 0
        states.push({ name, init: { kind: "number", value: 0 }, isBinding });
      }
      i = k;
      continue;
    }

    // @Environment(\.dismiss) var dismiss
    if (tok.kind === "attribute" && tok.value === "@Environment") {
      // Look ahead for \.dismiss pattern
      let j = i + 1;
      let foundDismiss = false;
      while (j < tokens.length && j < i + 8) {
        if (tokens[j].value === "dismiss") {
          foundDismiss = true;
          break;
        }
        j++;
      }
      if (foundDismiss) {
        hasEnvironmentDismiss = true;
      }
    }
  }

  return { states, hasEnvironmentDismiss };
}
