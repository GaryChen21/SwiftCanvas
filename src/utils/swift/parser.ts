/**
 * parser.ts — recursive-descent parser for the Swift subset the preview
 * runtime understands.
 *
 * The parser is deliberately lenient: unsupported declarations are skipped
 * instead of aborting, and every construct that cannot be represented becomes
 * a diagnostic so the canvas can explain itself.
 */

import type {
  ArgExpr,
  EntryPoint,
  Expr,
  FuncDecl,
  MemberDecl,
  ModifierExpr,
  Param,
  Program,
  Stmt,
  StringPartAst,
  StructDecl,
  SwitchCase,
  ViewExpr,
  ViewItem,
  ViewItems,
} from "./ast.ts";
import { Block } from "./ast.ts";
import {
  DECL_MODIFIERS,
  splitStringLiteral,
  tokenize,
  type Diagnostic,
  type Tok,
} from "./lexer.ts";

const BINARY_PREC: Record<string, number> = {
  "??": 2,
  "||": 4,
  "&&": 5,
  "==": 7,
  "!=": 7,
  "<": 7,
  "<=": 7,
  ">": 7,
  ">=": 7,
  "..<": 8,
  "...": 8,
  "+": 10,
  "-": 10,
  "*": 11,
  "/": 11,
  "%": 11,
};

const VIEW_NAME_RE = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * Type names that produce *style values* rather than view types. A bare
 * `Color.black` in a view builder is a member access on a value, not a view
 * with a `.black` modifier — treating it as the latter silently renders a
 * default (white) layer, which is how full-bleed backgrounds went blank.
 */
const VALUE_TYPE_NAMES = new Set(["Color", "Material", "ShapeStyle", "Gradient"]);

/**
 * Methods that stay inside a value chain after a value type: `Color.black.opacity(0.4)`.
 * Anything else with parentheses (`.padding(20)`, `.ignoresSafeArea()`) ends the
 * value and starts the view-modifier chain.
 */
const VALUE_CHAIN_METHODS = new Set(["opacity", "gradient"]);

/** Synthetic end-of-file token, returned whenever the stream is exhausted. */
const EOF_TOKEN: Tok = { k: "eof", v: "", start: 0, end: 0, line: 1 };

/* ────────────────────────────── Parser ────────────────────────────── */

export class Parser {
  toks: Tok[];
  pos = 0;
  diags: Diagnostic[];
  /**
   * Set while parsing a condition or sequence expression: in Swift a `{`
   * there starts the statement body, never a trailing closure.
   */
  private noTrailingClosure = false;

  constructor(toks: Tok[], diags: Diagnostic[]) {
    // Block slices come from `readBraceBlock` and have no EOF terminator;
    // without one, a loop could stall on the final token.
    if (toks.length === 0) {
      this.toks = [EOF_TOKEN];
    } else if (toks[toks.length - 1].k === "eof") {
      this.toks = toks;
    } else {
      this.toks = [...toks, EOF_TOKEN];
    }
    this.diags = diags;
  }

  /* ── token helpers ── */

  peek(offset = 0): Tok {
    const index = this.pos + offset;
    if (index < 0 || index >= this.toks.length) return EOF_TOKEN;
    return this.toks[index];
  }

  next(): Tok {
    const tok = this.peek();
    if (this.pos < this.toks.length - 1) this.pos++;
    return tok;
  }

  eof(): boolean {
    return this.peek().k === "eof";
  }

  at(value: string, offset = 0): boolean {
    return this.peek(offset).v === value;
  }

  eat(value: string): boolean {
    if (this.at(value)) {
      this.next();
      return true;
    }
    return false;
  }

  expect(value: string): boolean {
    return this.eat(value);
  }

  isKeyword(...values: string[]): boolean {
    const t = this.peek();
    return t.k === "keyword" && values.includes(t.v);
  }

  /** Skip tokens until the current line ends (used for `import`). */
  skipLine(): void {
    const line = this.peek().line;
    while (!this.eof() && this.peek().line === line) this.next();
  }

  /** Read the tokens inside a `{ ... }` block starting at the current `{`. */
  readBraceBlock(): Tok[] | null {
    if (!this.at("{")) return null;
    this.next();
    const start = this.pos;
    let depth = 1;
    while (!this.eof() && depth > 0) {
      const t = this.peek();
      if (t.v === "{") depth++;
      else if (t.v === "}") {
        depth--;
        if (depth === 0) break;
      }
      this.next();
    }
    const inner = this.toks.slice(start, this.pos);
    this.expect("}");
    return inner;
  }

  makeBlock(inner: Tok[]): Block {
    const block = new Block(inner);
    const diags = this.diags;
    block.statements = () => parseStatements(inner, diags);
    block.viewItems = () => parseViewItems(inner, diags);
    return block;
  }

  parseBlock(): Block {
    const inner = this.readBraceBlock();
    return this.makeBlock(inner ?? []);
  }

  /* ────────────────────────────── Expressions ────────────────────────────── */

  parseExpr(minPrec = 0): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();

      if (t.k === "op" && t.v === "?" && minPrec <= 1) {
        this.next();
        const thenExpr = this.parseExpr();
        this.expect(":");
        const elseExpr = this.parseExpr(1);
        left = { k: "ternary", cond: left, then: thenExpr, else: elseExpr };
        continue;
      }

      if (t.k === "keyword" && (t.v === "is" || t.v === "as")) break;
      const prec = t.k === "op" ? BINARY_PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) break;

      this.next();
      const rightAssoc = t.v === "??";
      const right = this.parseExpr(rightAssoc ? prec : prec + 1);

      if (t.v === "..<" || t.v === "...") {
        left = { k: "range", lo: left, hi: right, closed: t.v === "..." };
      } else {
        left = { k: "binary", op: t.v, left, right };
      }
    }

    return left;
  }

  /** Parse an expression where `{` starts a body rather than a trailing closure. */
  private parseCondition(minPrec = 0): Expr {
    const previous = this.noTrailingClosure;
    this.noTrailingClosure = true;
    try {
      return this.parseExpr(minPrec);
    } finally {
      this.noTrailingClosure = previous;
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();

    if (t.k === "op" && (t.v === "!" || t.v === "-" || t.v === "+")) {
      this.next();
      return { k: "unary", op: t.v as "!" | "-" | "+", operand: this.parseUnary() };
    }
    if (t.k === "keyword" && (t.v === "try" || t.v === "await" || t.v === "inout")) {
      this.next();
      return this.parseUnary();
    }
    if (t.k === "op" && t.v === "&") {
      this.next();
      return this.parseUnary();
    }

    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    for (;;) {
      const t = this.peek();

      if (t.k === "punct" && t.v === ".") {
        this.next();
        const nameTok = this.next();
        if (nameTok.k !== "ident" && nameTok.k !== "keyword") break;

        let node: Expr = { k: "member", obj: expr, name: nameTok.v };
        if (this.at("(")) {
          const args = this.parseCallArgs();
          node = { k: "call", callee: node, args };
        }
        if (this.at("{")) {
          const trailing = this.parseBlock();
          node = { k: "call", callee: node, args: [], trailing };
        }
        expr = node;
        continue;
      }

      if (t.k === "punct" && t.v === "(") {
        const args = this.parseCallArgs();
        if (this.at("{")) {
          const trailing = this.parseBlock();
          expr = { k: "call", callee: expr, args, trailing };
        } else {
          expr = { k: "call", callee: expr, args };
        }
        continue;
      }

      if (t.k === "punct" && t.v === "[") {
        this.next();
        const index = this.parseExpr();
        this.expect("]");
        expr = { k: "subscript", obj: expr, index };
        continue;
      }

      if (
        !this.noTrailingClosure &&
        t.k === "punct" &&
        t.v === "{" &&
        (expr.k === "ident" || expr.k === "member" || expr.k === "call")
      ) {
        const trailing = this.parseBlock();
        if (expr.k === "call" && !expr.trailing) {
          expr = { ...expr, trailing };
        } else {
          expr = { k: "call", callee: expr, args: [], trailing };
        }
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.k === "number") {
      this.next();
      const raw = t.v.replace(/_/g, "");
      const isDouble = raw.includes(".") || /[eE]/.test(raw);
      return { k: "num", v: Number(raw), isDouble };
    }

    if (t.k === "string") {
      this.next();
      const parts: StringPartAst[] = splitStringLiteral(t.v).map((part) =>
        part.kind === "text"
          ? { kind: "text", value: part.value }
          : { kind: "expr", expr: parseExpressionSource(part.source, this.diags) },
      );
      return { k: "str", parts };
    }

    if (t.k === "keyword") {
      if (t.v === "true" || t.v === "false") {
        this.next();
        return { k: "bool", v: t.v === "true" };
      }
      if (t.v === "nil") {
        this.next();
        return { k: "nil" };
      }
      if (t.v === "self") {
        this.next();
        return { k: "self" };
      }
    }

    if (t.k === "op" && t.v === "$") {
      this.next();
      const nameTok = this.next();
      if (nameTok.k === "number") return { k: "ident", name: `$${nameTok.v}` };
      if (nameTok.k === "ident") return { k: "binding", name: nameTok.v };
      return { k: "nil" };
    }

    if (t.k === "op" && t.v === "\\") {
      this.next();
      const path: string[] = [];
      while (this.at(".")) {
        this.next();
        const nameTok = this.next();
        if (nameTok.k === "ident" || nameTok.k === "keyword") path.push(nameTok.v);
        else break;
      }
      return { k: "keypath", path };
    }

    if (t.k === "ident") {
      this.next();
      return { k: "ident", name: t.v };
    }

    if (t.k === "punct" && t.v === ".") {
      this.next();
      const nameTok = this.next();
      if (nameTok.k === "ident" || nameTok.k === "keyword") {
        return { k: "implicit", name: nameTok.v };
      }
      if (nameTok.k === "number") return { k: "num", v: Number(nameTok.v) };
      return { k: "nil" };
    }

    if (t.k === "punct" && t.v === "(") {
      this.next();
      const items: Expr[] = [];
      while (!this.at(")") && !this.eof()) {
        // Drop tuple element labels.
        if (this.peek().k === "ident" && this.at(":", 1)) {
          this.next();
          this.next();
        }
        items.push(this.parseExpr());
        if (!this.eat(",")) break;
      }
      this.expect(")");
      if (items.length === 1) return items[0];
      return { k: "tuple", items };
    }

    if (t.k === "punct" && t.v === "[") {
      // Type initializer such as `[String]()` or `[Int]()`.
      if (this.peek(1).k === "ident" && this.at("]", 2) && this.at("(", 3)) {
        this.next();
        this.next();
        this.next();
        return { k: "array", items: [] };
      }
      this.next();
      const items: Expr[] = [];
      while (!this.at("]") && !this.eof()) {
        items.push(this.parseExpr());
        if (!this.eat(",")) break;
      }
      this.expect("]");
      return { k: "array", items };
    }

    if (t.k === "punct" && t.v === "{") {
      return this.parseClosureLiteral();
    }

    return { k: "nil" };
  }

  private parseClosureLiteral(): Expr {
    if (!this.at("{")) return { k: "nil" };
    const inner = this.readBraceBlock() ?? [];

    const params: string[] = [];
    let bodyStart = 0;
    if (inner.length >= 2 && inner[0].k === "ident" && inner[1].v === "in") {
      params.push(inner[0].v);
      bodyStart = 2;
    } else if (
      inner.length >= 4 &&
      inner[0].k === "ident" &&
      inner[1].v === "," &&
      inner[2].k === "ident" &&
      inner[3].v === "in"
    ) {
      params.push(inner[0].v, inner[2].v);
      bodyStart = 4;
    } else if (inner.length >= 2 && inner[0].v === "(") {
      let i = 1;
      while (i < inner.length && inner[i].v !== ")") {
        if (inner[i].k === "ident") params.push(inner[i].v);
        i++;
      }
      if (i + 1 < inner.length && inner[i + 1].v === "in") bodyStart = i + 2;
    }

    return { k: "closure", params, block: this.makeBlock(inner.slice(bodyStart)) };
  }

  private parseCallArgs(): ArgExpr[] {
    const args: ArgExpr[] = [];
    if (!this.at("(")) return args;
    this.next();

    while (!this.at(")") && !this.eof()) {
      if (this.at("{")) {
        args.push({ value: this.parseClosureLiteral() });
      } else if (this.peek().k === "ident" && this.at(":", 1)) {
        const label = this.next().v;
        this.next();
        args.push({ label, value: this.parseExpr() });
      } else if (this.isKeyword("in") && this.at(":", 1)) {
        this.next();
        this.next();
        args.push({ label: "in", value: this.parseExpr() });
      } else {
        args.push({ value: this.parseExpr() });
      }
      if (!this.eat(",")) break;
    }

    this.expect(")");
    return args;
  }

  /* ────────────────────────────── Statements ────────────────────────────── */

  parseStatement(): Stmt | null {
    const t = this.peek();

    if (t.k === "keyword") {
      switch (t.v) {
        case "let":
        case "var":
          return this.parseDeclare();
        case "if":
          return this.parseIf();
        case "guard":
          return this.parseGuard();
        case "while":
          return this.parseWhile();
        case "for":
          return this.parseFor();
        case "switch":
          return this.parseSwitch();
        case "func":
          return { k: "func", decl: this.parseFunc(false) };
        case "return": {
          this.next();
          if (this.at("}") || this.eof()) return { k: "return" };
          const value = this.parseExpr();
          return { k: "return", value };
        }
        case "break":
          this.next();
          return { k: "break" };
        case "continue":
          this.next();
          return { k: "continue" };
        case "do": {
          this.next();
          const inner = this.readBraceBlock();
          if (!inner) return null;
          const nested = parseStatements(inner, this.diags);
          return { k: "if", cond: { k: "bool", v: true }, then: nested };
        }
        case "defer":
        case "repeat":
        case "enum":
        case "struct":
        case "class":
        case "extension":
        case "protocol":
        case "typealias":
        case "import":
          this.next();
          return null;
        case "throw":
          this.next();
          this.parseExpr();
          return null;
        default:
          break;
      }
    }

    if (t.k === "attribute") {
      this.next();
      return null;
    }
    if (t.k === "keyword" && DECL_MODIFIERS.has(t.v)) {
      this.next();
      return null;
    }

    const startPos = this.pos;
    const left = this.parseExpr();
    if (this.pos === startPos) {
      this.next();
      return null;
    }

    const opTok = this.peek();
    if (opTok.k === "op" && ["=", "+=", "-=", "*=", "/=", "%="].includes(opTok.v)) {
      this.next();
      const value = this.parseExpr();
      return { k: "assign", target: left, op: opTok.v, value };
    }

    return { k: "expr", expr: left };
  }

  private parseDeclare(): Stmt {
    const mutable = this.peek().v === "var";
    this.next();
    const nameTok = this.next();
    const name = nameTok.k === "ident" ? nameTok.v : "_";

    if (this.at(":")) {
      this.next();
      this.skipTypeAnnotation();
    }

    let value: Expr | undefined;
    if (this.eat("=")) value = this.parseExpr();

    return { k: "declare", name, mutable, value };
  }

  /** Skip a type annotation up to `=`, `{`, or `,` at depth zero. */
  private skipTypeAnnotation(): void {
    let depth = 0;
    while (!this.eof()) {
      const t = this.peek();
      if (depth === 0 && (t.v === "=" || t.v === "{" || t.v === "," || t.v === "}")) return;
      // The next member starts: stop before its attribute or modifier keyword.
      if (depth === 0 && t.k === "attribute") return;
      if (t.v === "[" || t.v === "<" || t.v === "(") {
        depth++;
      } else if (t.v === "]" || t.v === ">" || t.v === ")") {
        if (depth === 0) return;
        depth--;
      } else if (t.k === "keyword" && depth === 0) {
        if (t.v === "some" || t.v === "any" || t.v === "inout") {
          this.next();
          continue;
        }
        return;
      }
      this.next();
    }
  }

  private parseIf(): Stmt {
    this.next();

    let cond: Expr;
    let binding: Stmt | null = null;
    if (this.isKeyword("let", "var")) {
      this.next();
      const nameTok = this.next();
      const name = nameTok.v;
      if (this.at(":")) {
        this.next();
        this.skipTypeAnnotation();
      }
      if (this.eat("=")) {
        const valueExpr = this.parseCondition();
        cond = { k: "binary", op: "!=", left: valueExpr, right: { k: "nil" } };
        binding = { k: "declare", name, mutable: false, value: valueExpr };
      } else {
        cond = { k: "bool", v: true };
      }
      while (this.eat(",")) this.parseCondition();
    } else {
      cond = this.parseCondition();
    }

    const thenInner = this.readBraceBlock() ?? [];
    const thenStmts = parseStatements(thenInner, this.diags);
    if (binding) thenStmts.unshift(binding);

    let elseStmts: Stmt[] | undefined;
    if (this.isKeyword("else")) {
      this.next();
      if (this.isKeyword("if")) {
        elseStmts = [this.parseIf()];
      } else {
        const inner = this.readBraceBlock() ?? [];
        elseStmts = parseStatements(inner, this.diags);
      }
    }

    return {
      k: "if",
      cond,
      then: thenStmts,
      ...(elseStmts ? { else: elseStmts } : {}),
    };
  }

    private parseGuard(): Stmt {
      this.next();
      const cond = this.parseCondition();
      this.expect("else");
    const inner = this.readBraceBlock() ?? [];
    const elseStmts = parseStatements(inner, this.diags);
    return {
      k: "if",
      cond: { k: "unary", op: "!", operand: cond },
      then: elseStmts,
    };
  }

    private parseWhile(): Stmt {
      this.next();
      const cond = this.parseCondition();
      const inner = this.readBraceBlock() ?? [];
      return { k: "while", cond, body: parseStatements(inner, this.diags) };
    }

  private parseFor(): Stmt {
    this.next();
    const names: string[] = [];
    if (this.at("(")) {
      this.next();
      while (!this.at(")") && !this.eof()) {
        const t = this.next();
        if (t.k === "ident") names.push(t.v);
      }
      this.expect(")");
    } else {
      const t = this.next();
      if (t.k === "ident") names.push(t.v);
    }
      this.expect("in");
      const seq = this.parseCondition();
      const inner = this.readBraceBlock() ?? [];
      return { k: "for", names, seq, body: parseStatements(inner, this.diags) };
  }

    private parseSwitch(): Stmt {
      this.next();
      const subject = this.parseCondition();
      this.expect("{");

    const cases: SwitchCase[] = [];
    let defaultBody: Stmt[] | undefined;

    while (!this.at("}") && !this.eof()) {
      if (this.isKeyword("case")) {
        this.next();
        const patterns: Expr[] = [];
        do {
          patterns.push(this.parseExpr());
        } while (this.eat(","));
        this.expect(":");
        cases.push({ patterns, body: this.parseCaseBody() });
        continue;
      }
      if (this.isKeyword("default")) {
        this.next();
        this.expect(":");
        defaultBody = this.parseCaseBody();
        continue;
      }
      this.next();
    }
    this.expect("}");

    return { k: "switch", subject, cases, ...(defaultBody ? { defaultBody } : {}) };
  }

  /** Statements until the next `case`/`default`/`}` at depth zero. */
  private parseCaseBody(): Stmt[] {
    const start = this.pos;
    let depth = 0;
    while (!this.eof()) {
      const t = this.peek();
      if (
        depth === 0 &&
        (t.v === "}" || (t.k === "keyword" && (t.v === "case" || t.v === "default")))
      ) {
        break;
      }
      if (t.v === "{" || t.v === "(" || t.v === "[") depth++;
      else if (t.v === "}" || t.v === ")" || t.v === "]") depth--;
      this.next();
    }
    return parseStatements(this.toks.slice(start, this.pos), this.diags);
  }

  /* ────────────────────────────── Functions ────────────────────────────── */

  parseFunc(isMutating: boolean): FuncDecl {
    this.expect("func");
    const nameTok = this.next();
    const name =
      nameTok.k === "ident" || nameTok.k === "keyword" ? nameTok.v : "unknown";

    const params: Param[] = [];
    if (this.at("(")) {
      this.next();
      while (!this.at(")") && !this.eof()) {
        const param = this.parseParam();
        if (param) params.push(param);
        if (!this.eat(",")) break;
      }
      this.expect(")");
    }

    // Skip generic clauses and the return type.
    while (!this.eof() && !this.at("{")) this.next();
    const body = this.parseBlock();
    return { name, params, body, isMutating };
  }

  private parseParam(): Param | null {
    const first = this.peek();
    if (first.k !== "ident" && first.v !== "_") return null;
    this.next();

    let label: string;
    let name: string;

    if (first.v === "_") {
      label = "_";
      // A following type annotation may follow directly: `_ count: Int`
      const nameTok = this.peek();
      if (nameTok.k === "ident") {
        name = this.next().v;
      } else {
        name = "_";
      }
    } else if (this.peek().k === "ident" && !this.at(":")) {
      label = first.v;
      name = this.next().v;
    } else {
      label = first.v;
      name = first.v;
    }

    let typeName: string | undefined;
    if (this.eat(":")) {
      const start = this.pos;
      while (!this.eof() && !this.at(",") && !this.at(")") && !this.at("=")) {
        this.next();
      }
      typeName = this.toks
        .slice(start, this.pos)
        .map((tok) => tok.v)
        .join("");
    }

    let defaultExpr: Expr | undefined;
    if (this.eat("=")) defaultExpr = this.parseExpr();

    return { label, name, typeName, ...(defaultExpr ? { defaultExpr } : {}) };
  }

  /* ────────────────────────────── View builder ────────────────────────────── */

  parseViewItem(): ViewItem | null {
    const t = this.peek();

    if (t.k === "keyword" && t.v === "let") {
      this.next();
      const nameTok = this.next();
      const name = nameTok.k === "ident" ? nameTok.v : "_";
      if (this.at(":")) {
        this.next();
        this.skipTypeAnnotation();
      }
      let value: Expr = { k: "nil" };
      if (this.eat("=")) value = this.parseExpr();
      return { k: "let", name, value };
    }

    if (t.k === "keyword" && t.v === "if") {
      return this.parseViewIf();
    }

    if (t.k === "keyword" && t.v === "switch") {
      return this.parseViewSwitch();
    }

    if (t.k === "attribute") {
      this.next();
      return null;
    }

    // `header` / `self.header` — a `some View` computed property reference,
    // optionally followed by a modifier chain (`header.padding().background()`)
    // A following `(` is a call (e.g. `print(...)`) and `=` an assignment; both
    // stay outside this reference form.
    if (
      t.k === "ident" &&
      !/^[A-Z]/.test(t.v) &&
      !this.at("(", 1) &&
      !this.at("=", 1)
    ) {
      this.next();
      const modifiers = this.parseModifierChain();
      return { k: "ref", name: t.v, ...(modifiers.length > 0 ? { modifiers } : {}) };
    }

    if (t.k === "keyword" && t.v === "self" && this.peek(1).k === "ident" && !this.at("(", 2)) {
      this.next();
      const nameTok = this.next();
      const modifiers = this.parseModifierChain();
      return { k: "ref", name: nameTok.v, ...(modifiers.length > 0 ? { modifiers } : {}) };
    }

    const view = this.parseViewExpr();
    if (view) return { k: "view", view };

    return null;
  }

  private parseViewIf(): ViewItem {
    this.expect("if");

    let cond: Expr;
    let binding: ViewItem | null = null;
    if (this.isKeyword("let")) {
      this.next();
      const name = this.next().v;
      if (this.at(":")) {
        this.next();
        this.skipTypeAnnotation();
      }
      if (this.eat("=")) {
        const valueExpr = this.parseCondition();
        cond = { k: "binary", op: "!=", left: valueExpr, right: { k: "nil" } };
        binding = { k: "let", name, value: valueExpr };
      } else {
        cond = { k: "bool", v: true };
      }
      while (this.eat(",")) this.parseCondition();
    } else {
      cond = this.parseCondition();
    }

    const thenInner = this.readBraceBlock() ?? [];
    const thenItems = parseViewItems(thenInner, this.diags).items;
    if (binding) thenItems.unshift(binding);

    let elseItems: ViewItem[] = [];
    if (this.isKeyword("else")) {
      this.next();
      if (this.isKeyword("if")) {
        elseItems = [this.parseViewIf()];
      } else {
        const inner = this.readBraceBlock() ?? [];
        elseItems = parseViewItems(inner, this.diags).items;
      }
    }

    return { k: "if", cond, then: thenItems, else: elseItems };
  }

    private parseViewSwitch(): ViewItem {
      this.expect("switch");
      const subject = this.parseCondition();
      this.expect("{");

    const cases: { patterns: Expr[]; body: ViewItem[] }[] = [];
    let defaultItems: ViewItem[] | undefined;

    while (!this.at("}") && !this.eof()) {
      if (this.isKeyword("case")) {
        this.next();
        const patterns: Expr[] = [];
        do {
          patterns.push(this.parseExpr());
        } while (this.eat(","));
        this.expect(":");
        cases.push({ patterns, body: this.collectViewCaseBody() });
        continue;
      }
      if (this.isKeyword("default")) {
        this.next();
        this.expect(":");
        defaultItems = this.collectViewCaseBody();
        continue;
      }
      this.next();
    }
    this.expect("}");

    return {
      k: "switch",
      subject,
      cases,
      ...(defaultItems ? { default: defaultItems } : {}),
    };
  }

  private collectViewCaseBody(): ViewItem[] {
    const start = this.pos;
    let depth = 0;
    while (!this.eof()) {
      const t = this.peek();
      if (
        depth === 0 &&
        (t.v === "}" || (t.k === "keyword" && (t.v === "case" || t.v === "default")))
      ) {
        break;
      }
      if (t.v === "{" || t.v === "(" || t.v === "[") depth++;
      else if (t.v === "}" || t.v === ")" || t.v === "]") depth--;
      this.next();
    }
    return parseViewItems(this.toks.slice(start, this.pos), this.diags).items;
  }

  /** `.name(args) { trailing }` chains shared by view calls and refs. */
  private parseModifierChain(): ModifierExpr[] {
    const modifiers: ModifierExpr[] = [];
    while (this.at(".") && (this.peek(1).k === "ident" || this.peek(1).k === "keyword")) {
      this.next();
      const modTok = this.next();
      const modArgs = this.at("(") ? this.parseCallArgs() : [];
      const modTrailing = this.at("{") ? this.parseBlock() : undefined;
      const modLabeled = this.parseLabeledTrailingClosures();
      modifiers.push({
        name: modTok.v,
        args: modArgs,
        ...(modTrailing ? { trailing: modTrailing } : {}),
        ...(modLabeled.length > 0 ? { labeledTrailing: modLabeled } : {}),
      });
    }
    return modifiers;
  }

  /**
   * `Color.black` / `Color.gray.opacity(0.4)` — a value chain starting at a
   * value-type name. Returns null (and restores the position) when the name is
   * not followed by a member access, so `Color(red:…)` call forms still parse
   * as ordinary view expressions.
   */
  private parseValueChain(): Expr | null {
    const start = this.pos;
    const first = this.next();
    let expr: Expr = { k: "ident", name: first.v };
    let advanced = false;

    while (this.at(".") && (this.peek(1).k === "ident" || this.peek(1).k === "keyword")) {
      const memberName = this.peek(1).v;
      const hasCall = this.at("(", 2);
      if (hasCall && !VALUE_CHAIN_METHODS.has(memberName)) break;
      this.next(); // .
      this.next(); // member name
      expr = { k: "member", obj: expr, name: memberName };
      advanced = true;
      if (hasCall) {
        expr = { k: "call", callee: expr, args: this.parseCallArgs() };
      }
    }

    if (!advanced) {
      this.pos = start;
      return null;
    }
    return expr;
  }

  /**
   * Labeled trailing closures after a view call — the Swift 5.3+ form
   * `Button { action } label: { views }`. Consumes `ident: { … }` pairs that
   * directly follow the view expression.
   */
  private parseLabeledTrailingClosures(): { label: string; block: Block }[] {
    const closures: { label: string; block: Block }[] = [];
    while (
      (this.peek().k === "ident" || this.peek().k === "keyword") &&
      this.at(":", 1) &&
      this.at("{", 2)
    ) {
      const label = this.next().v;
      this.next(); // ':'
      const block = this.parseBlock();
      if (block) closures.push({ label, block });
    }
    return closures;
  }

  private parseViewExpr(): ViewExpr | null {
    const t = this.peek();
    if (t.k !== "ident" || !VIEW_NAME_RE.test(t.v)) return null;

    // `Color.black` / `Material.regular` used directly as a view (background
    // layers). The `.member` chain is a value access; a trailing chain with
    // real view modifiers is parsed after the value.
    if (VALUE_TYPE_NAMES.has(t.v) && this.peek(1).v === ".") {
      const valueExpr = this.parseValueChain();
      if (valueExpr) {
        const modifiers = this.parseModifierChain();
        return { name: "ValueView", args: [{ value: valueExpr }], modifiers };
      }
    }

    this.next();

    const name = t.v;
    const args = this.at("(") ? this.parseCallArgs() : [];
    const trailing = this.at("{") ? this.parseBlock() : undefined;
    const labeledTrailing = this.parseLabeledTrailingClosures();
    const modifiers = this.parseModifierChain();

    return {
      name,
      args,
      ...(trailing ? { trailing } : {}),
      ...(labeledTrailing.length > 0 ? { labeledTrailing } : {}),
      modifiers,
    };
  }

  /* ────────────────────────────── Declarations ────────────────────────────── */

  parseStructDecl(): StructDecl {
    this.next(); // struct / class
    const nameTok = this.next();
    const name = nameTok.k === "ident" ? nameTok.v : "Unknown";

    const conformances: string[] = [];
    while (!this.eof() && !this.at("{")) {
      const t = this.next();
      if (t.k === "ident") conformances.push(t.v);
    }

    const inner = this.readBraceBlock() ?? [];
    const members = parseMembers(inner, this.diags);
    const isView = conformances.includes("View") || members.some((m) => m.k === "body");
    const isApp = conformances.includes("App");

    return { name, conformances, members, isView, isApp };
  }

  parseMember(): MemberDecl | null {
    const attributes: string[] = [];
    let environmentKey: string | undefined;

    while (this.peek().k === "attribute") {
      const attr = this.next().v;
      attributes.push(attr);
      if (attr === "@Environment") {
        // `@Environment(\.dismiss) private var dismiss`
        if (this.at("(")) {
          this.next();
          while (!this.at(")") && !this.eof()) {
            const token = this.next();
            if (token.k === "ident") environmentKey = token.v;
          }
          this.expect(")");
        }
      } else if (this.at("(")) {
        let depth = 0;
        do {
          const token = this.next();
          if (token.v === "(") depth++;
          if (token.v === ")") depth--;
        } while (!this.eof() && depth > 0);
      }
    }

    let isMutating = false;
    while (
      this.isKeyword(
        "mutating",
        "static",
        "private",
        "public",
        "internal",
        "fileprivate",
        "final",
        "nonisolated",
      )
    ) {
      if (this.peek().v === "mutating") isMutating = true;
      this.next();
      while (this.peek().k === "attribute") this.next();
    }

    if (this.isKeyword("func")) {
      return { k: "func", decl: this.parseFunc(isMutating) };
    }

    if (this.isKeyword("init", "deinit", "subscript")) {
      while (!this.eof() && !this.at("{")) this.next();
      this.readBraceBlock();
      return null;
    }

    if (this.isKeyword("var", "let")) {
      const mutable = this.peek().v === "var";
      this.next();
      const nameTok = this.next();
      const name = nameTok.k === "ident" ? nameTok.v : "_";

      let typeName: string | undefined;
      if (this.eat(":")) {
        const start = this.pos;
        this.skipTypeAnnotation();
        typeName = this.toks
          .slice(start, this.pos)
          .map((tok) => tok.v)
          .join("");
      }

      const isState = attributes.some((a) =>
        ["@State", "@StateObject", "@AppStorage", "@FocusState", "@Published"].includes(a),
      );
      const isBinding = attributes.some((a) => a === "@Binding");

      if (this.at("{")) {
        const inner = this.readBraceBlock() ?? [];
        if (name === "body") {
          return { k: "body", items: parseViewItems(inner, this.diags).items };
        }
        // `var header: some View { ... }` builds view items, not a value.
        const isViewType =
          typeName !== undefined &&
          (typeName === "someView" || typeName.endsWith("View") || typeName.includes("View<"));
        return { k: "computed", name, body: this.makeBlock(inner), ...(isViewType ? { isView: true } : {}) };
      }

      let init: Expr | undefined;
      if (this.eat("=")) init = this.parseExpr();

      if (this.at("{")) this.readBraceBlock();

      if (isState || isBinding) {
        return { k: "state", name, isBinding, init, typeName };
      }
      if (environmentKey) {
        return { k: "environment", name, key: environmentKey };
      }
      return { k: "property", name, mutable, init, typeName };
    }

    return null;
  }
}

/* ────────────────────────────── Module-level entry points ────────────────────────────── */

export function parseExpressionSource(source: string, diags: Diagnostic[]): Expr {
  const p = new Parser(tokenize(source), diags);
  return p.parseExpr();
}

export function parseStatements(tokens: Tok[], diags: Diagnostic[]): Stmt[] {
  const p = new Parser(tokens, diags);
  const stmts: Stmt[] = [];
  while (!p.eof()) {
    const before = p.pos;
    const stmt = p.parseStatement();
    if (stmt) stmts.push(stmt);
    if (p.pos === before) p.next();
  }
  return stmts;
}

export function parseViewItems(tokens: Tok[], diags: Diagnostic[]): ViewItems {
  const p = new Parser(tokens, diags);

  const params: string[] = [];
  if (tokens.length >= 2 && tokens[0].k === "ident" && tokens[1].v === "in") {
    params.push(tokens[0].v);
    p.pos = 2;
  } else if (
    tokens.length >= 4 &&
    tokens[0].k === "ident" &&
    tokens[1].v === "," &&
    tokens[2].k === "ident" &&
    tokens[3].v === "in"
  ) {
    params.push(tokens[0].v, tokens[2].v);
    p.pos = 4;
  }

  const items: ViewItem[] = [];
  while (!p.eof()) {
    const before = p.pos;
    const item = p.parseViewItem();
    if (item) items.push(item);
    if (p.pos === before) p.next();
  }

  return { params, items };
}

function parseMembers(tokens: Tok[], diags: Diagnostic[]): MemberDecl[] {
  const p = new Parser(tokens, diags);
  const members: MemberDecl[] = [];
  while (!p.eof()) {
    const before = p.pos;
    const member = p.parseMember();
    if (member) members.push(member);
    if (p.pos === before) p.next();
  }
  return members;
}

export function parseProgram(source: string): Program {
  const diagnostics: Diagnostic[] = [];
  const toks = tokenize(source);
  const p = new Parser(toks, diagnostics);

  const structs = new Map<string, StructDecl>();
  const globals: Stmt[] = [];
  let previewItems: ViewItem[] | null = null;

  while (!p.eof()) {
    const before = p.pos;
    const t = p.peek();

    if (t.k === "keyword" && t.v === "import") {
      p.next();
      p.skipLine();
      continue;
    }

    if (t.k === "attribute" && t.v === "#Preview") {
      p.next();
      if (p.at("(")) {
        let depth = 0;
        do {
          const tok = p.next();
          if (tok.v === "(") depth++;
          if (tok.v === ")") depth--;
        } while (!p.eof() && depth > 0);
      }
      const inner = p.readBraceBlock() ?? [];
      previewItems = parseViewItems(inner, diagnostics).items;
      continue;
    }

    if (t.k === "attribute") {
      p.next();
      continue;
    }

    if (t.k === "keyword" && (t.v === "struct" || t.v === "class")) {
      const decl = p.parseStructDecl();
      structs.set(decl.name, decl);
      continue;
    }

    if (t.k === "keyword" && t.v === "extension") {
      p.next();
      const nameTok = p.next();
      const name = nameTok.k === "ident" ? nameTok.v : "";
      while (!p.eof() && !p.at("{")) p.next();
      const inner = p.readBraceBlock() ?? [];
      const target = structs.get(name);
      if (target) target.members.push(...parseMembers(inner, diagnostics));
      continue;
    }

    if (t.k === "keyword" && (t.v === "enum" || t.v === "protocol" || t.v === "actor")) {
      p.next();
      while (!p.eof() && !p.at("{")) p.next();
      p.readBraceBlock();
      continue;
    }

    if (t.k === "keyword" && (t.v === "let" || t.v === "var")) {
      const stmt = p.parseStatement();
      if (stmt) globals.push(stmt);
      continue;
    }

    if (t.k === "keyword" && t.v === "func") {
      globals.push({ k: "func", decl: p.parseFunc(false) });
      continue;
    }

    if (t.k === "keyword" && (t.v === "typealias" || t.v === "operator")) {
      p.next();
      p.skipLine();
      continue;
    }

    p.next();
    if (p.pos === before) p.next();
  }

  // Choose the entry point the same way Xcode's canvas does.
  let entry: EntryPoint = { kind: "none" };
  if (previewItems && previewItems.length > 0) {
    entry = { kind: "inline", items: previewItems };
  } else {
    const contentView = structs.get("ContentView");
    if (contentView && contentView.isView) {
      entry = { kind: "struct", name: "ContentView" };
    } else {
      const candidates = [...structs.values()].filter((s) => s.isView);
      if (candidates.length > 0) {
        entry = { kind: "struct", name: candidates[0].name };
      } else {
        for (const decl of structs.values()) {
          if (!decl.isApp) continue;
          const items = extractAppRoot(decl);
          if (items) {
            entry = { kind: "inline", items };
            break;
          }
        }
      }
    }
  }

  return { structs, globals, entry, diagnostics };
}

/** Pull the view items out of `WindowGroup { ContentView() }`. */
function extractAppRoot(decl: StructDecl): ViewItem[] | null {
  const body = decl.members.find((m) => m.k === "body");
  if (!body || body.k !== "body") return null;
  for (const item of body.items) {
    if (item.k !== "view") continue;
    if (item.view.name !== "WindowGroup" && item.view.name !== "Window") continue;
    const inner = item.view.trailing?.asViews();
    if (inner && inner.items.length > 0) return inner.items;
  }
  return null;
}
