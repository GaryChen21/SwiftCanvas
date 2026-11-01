/**
 * ast.ts — syntax tree for the Swift-subset interpreter.
 *
 * Blocks keep their raw tokens and lazily parse into either statements or
 * view-builder items, because the same `{ ... }` syntax means different things
 * depending on context (`Button` action vs `VStack` content vs `ForEach` body).
 */

import type { Diagnostic, Tok } from "./lexer.ts";

/* ────────────────────────────── Blocks ────────────────────────────── */

export interface ViewItems {
  params: string[];
  items: ViewItem[];
}

export class Block {
  tokens: Tok[];
  /** Cache of the statement parse. */
  private stmtCache?: Stmt[];
  /** Cache of the view-builder parse, keyed by "param1,param2". */
  private viewCache = new Map<string, ViewItems>();

  statements?: () => Stmt[];
  viewItems?: () => ViewItems;

  constructor(tokens: Tok[]) {
    this.tokens = tokens;
  }

  get isEmpty(): boolean {
    return this.tokens.length === 0;
  }

  asStatements(): Stmt[] {
    if (!this.stmtCache) this.stmtCache = this.statements ? this.statements() : [];
    return this.stmtCache;
  }

  asViews(): ViewItems {
    const key = "*";
    let cached = this.viewCache.get(key);
    if (!cached) {
      cached = this.viewItems ? this.viewItems() : { params: [], items: [] };
      this.viewCache.set(key, cached);
    }
    return cached;
  }
}

/* ────────────────────────────── Expressions ────────────────────────────── */

export interface ArgExpr {
  label?: string;
  value: Expr;
}

export type Expr =
  | { k: "num"; v: number; isDouble?: boolean }
  | { k: "str"; parts: StringPartAst[] }
  | { k: "bool"; v: boolean }
  | { k: "nil" }
  | { k: "self" }
  | { k: "ident"; name: string }
  | { k: "binding"; name: string }
  | { k: "implicit"; name: string }
  | { k: "keypath"; path: string[] }
  | { k: "member"; obj: Expr; name: string }
  | { k: "call"; callee: Expr; args: ArgExpr[]; trailing?: Block }
  | { k: "subscript"; obj: Expr; index: Expr }
  | { k: "unary"; op: "!" | "-" | "+"; operand: Expr }
  | { k: "binary"; op: string; left: Expr; right: Expr }
  | { k: "ternary"; cond: Expr; then: Expr; else: Expr }
  | { k: "array"; items: Expr[] }
  | { k: "range"; lo: Expr; hi: Expr; closed: boolean }
  | { k: "closure"; params: string[]; block: Block }
  | { k: "tuple"; items: Expr[] };

export type StringPartAst =
  | { kind: "text"; value: string }
  | { kind: "expr"; expr: Expr };

/* ────────────────────────────── Statements ────────────────────────────── */

export type Stmt =
  | { k: "declare"; name: string; mutable: boolean; value?: Expr }
  | { k: "assign"; target: Expr; op: string; value: Expr }
  | { k: "if"; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: "while"; cond: Expr; body: Stmt[] }
  | { k: "for"; names: string[]; seq: Expr; body: Stmt[] }
  | { k: "switch"; subject: Expr; cases: SwitchCase[]; defaultBody?: Stmt[] }
  | { k: "func"; decl: FuncDecl }
  | { k: "return"; value?: Expr }
  | { k: "break" }
  | { k: "continue" }
  | { k: "expr"; expr: Expr };

export interface SwitchCase {
  /** Patterns; a range pattern is stored as a range Expr. */
  patterns: Expr[];
  body: Stmt[];
}

export interface Param {
  /** External label (`_` means unlabeled). */
  label: string;
  /** Internal name. */
  name: string;
  typeName?: string;
  defaultExpr?: Expr;
}

export interface FuncDecl {
  name: string;
  params: Param[];
  body: Block;
  isMutating: boolean;
}

/* ────────────────────────────── View builder ────────────────────────────── */

export type ViewItem =
  | { k: "view"; view: ViewExpr }
  | { k: "ref"; name: string; modifiers?: ModifierExpr[] }
  | { k: "if"; cond: Expr; then: ViewItem[]; else: ViewItem[] }
  | { k: "switch"; subject: Expr; cases: { patterns: Expr[]; body: ViewItem[] }[]; default?: ViewItem[] }
  | { k: "let"; name: string; value: Expr }
  | { k: "expr"; expr: Expr };

export interface ViewExpr {
  name: string;
  args: ArgExpr[];
  trailing?: Block;
  modifiers: ModifierExpr[];
}

export interface ModifierExpr {
  name: string;
  args: ArgExpr[];
  trailing?: Block;
}

/* ────────────────────────────── Declarations ────────────────────────────── */

export type MemberDecl =
  | { k: "state"; name: string; isBinding: boolean; init?: Expr; typeName?: string }
  | { k: "environment"; name: string; key: string }
  | { k: "property"; name: string; mutable: boolean; init?: Expr; typeName?: string }
  | { k: "computed"; name: string; body: Block; isView?: boolean }
  | { k: "func"; decl: FuncDecl }
  | { k: "body"; items: ViewItem[] };

export interface StructDecl {
  name: string;
  conformances: string[];
  members: MemberDecl[];
  isView: boolean;
  isApp: boolean;
}

export type EntryPoint =
  | { kind: "struct"; name: string }
  | { kind: "inline"; items: ViewItem[] }
  | { kind: "none" };

export interface Program {
  structs: Map<string, StructDecl>;
  globals: Stmt[];
  entry: EntryPoint;
  diagnostics: Diagnostic[];
}
