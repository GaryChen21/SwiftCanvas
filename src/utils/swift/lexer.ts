/**
 * lexer.ts — Swift-subset scanner for the SwiftCanvas live preview runtime.
 *
 * Produces a flat token stream with source offsets and line numbers. Comments
 * and whitespace are dropped; string literals keep their raw source (including
 * escapes and \(...) interpolation) so the parser can split them.
 */

export type TokKind =
  | "ident"
  | "keyword"
  | "number"
  | "string"
  | "op"
  | "punct"
  | "attribute"
  | "eof";

export interface Tok {
  k: TokKind;
  /** Raw token text. Strings include their surrounding quotes. */
  v: string;
  start: number;
  end: number;
  line: number;
}

export interface Diagnostic {
  severity: "error" | "warn" | "info";
  message: string;
  start: number;
  end: number;
  line: number;
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  "actor", "any", "as", "associatedtype", "async", "await", "break", "case",
  "catch", "class", "continue", "convenience", "default", "defer", "deinit",
  "didSet", "do", "dynamic", "else", "enum", "extension", "fallthrough",
  "false", "fileprivate", "final", "for", "func", "get", "guard", "if",
  "import", "in", "indirect", "init", "inout", "internal", "is", "isolated",
  "lazy", "let", "mutating", "nil", "nonisolated", "open", "operator",
  "override", "postfix", "prefix", "private", "protocol", "public", "repeat",
  "required", "rethrows", "return", "self", "set", "some", "static", "struct",
  "subscript", "super", "switch", "throw", "throws", "true", "try", "typealias",
  "var", "weak", "where", "while", "willSet", "inout",
]);

/** Declaration modifiers that are skipped (they do not change preview semantics). */
export const DECL_MODIFIERS: ReadonlySet<string> = new Set([
  "private", "public", "internal", "fileprivate", "open", "static", "final",
  "mutating", "nonmutating", "lazy", "weak", "unowned", "override", "required",
  "convenience", "dynamic", "indirect", "isolated", "nonisolated",
]);

const OPERATORS = [
  "..<", "...", "->", "==", "!=", "<=", ">=", "&&", "||", "??",
  "+=", "-=", "*=", "/=", "%=", "=", "+", "-", "*", "/", "%",
  "<", ">", "!", "?", "&", "|", "^", "~", "$", "\\",
];

const PUNCT = new Set(["(", ")", "{", "}", "[", "]", ",", ":", ";", "."]);

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/** Convert Swift source into a flat token stream. */
export function tokenize(src: string): Tok[] {
  const tokens: Tok[] = [];
  let pos = 0;
  let line = 1;

  const push = (k: TokKind, start: number, end: number, startLine: number) => {
    tokens.push({ k, v: src.slice(start, end), start, end, line: startLine });
  };

  while (pos < src.length) {
    const ch = src[pos];

    if (ch === "\n") {
      line++;
      pos++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      pos++;
      continue;
    }

    if (src.startsWith("//", pos)) {
      while (pos < src.length && src[pos] !== "\n") pos++;
      continue;
    }

    if (src.startsWith("/*", pos)) {
      pos += 2;
      while (pos < src.length && !src.startsWith("*/", pos)) {
        if (src[pos] === "\n") line++;
        pos++;
      }
      pos += 2;
      continue;
    }

    // ── String literals (single or triple quoted) ──
    if (ch === '"') {
      const start = pos;
      const startLine = line;
      const triple = src.startsWith('"""', pos);
      pos += triple ? 3 : 1;
      while (pos < src.length) {
        if (src[pos] === "\\") {
          if (src[pos + 1] === "(") {
            // Interpolation can contain nested strings and parens.
            pos = skipInterpolation(src, pos + 2, () => {
              line++;
            });
            continue;
          }
          if (src[pos + 1] === "\n") line++;
          pos += 2;
          continue;
        }
        if (triple) {
          if (src.startsWith('"""', pos)) {
            pos += 3;
            break;
          }
        } else if (src[pos] === '"') {
          pos += 1;
          break;
        } else if (src[pos] === "\n") {
          break;
        }
        if (src[pos] === "\n") line++;
        pos++;
      }
      push("string", start, pos, startLine);
      continue;
    }

    // ── Attributes (@State) and macros (#Preview) ──
    if (ch === "@" || ch === "#") {
      const start = pos;
      const startLine = line;
      pos++;
      while (pos < src.length && isAlphaNum(src[pos])) pos++;
      push("attribute", start, pos, startLine);
      continue;
    }

    // ── Identifiers / keywords ──
    if (isAlpha(ch)) {
      const start = pos;
      const startLine = line;
      let end = pos + 1;
      while (end < src.length && isAlphaNum(src[end])) end++;
      const value = src.slice(start, end);
      push(KEYWORDS.has(value) ? "keyword" : "ident", start, end, startLine);
      pos = end;
      continue;
    }

    // ── Numbers (including a leading dot form: `.5`) ──
    if (isDigit(ch) || (ch === "." && isDigit(src[pos + 1] ?? ""))) {
      const start = pos;
      const startLine = line;
      if (ch === ".") pos++;
      while (pos < src.length && (isDigit(src[pos]) || src[pos] === "_")) pos++;
      if (src[pos] === "." && isDigit(src[pos + 1] ?? "")) {
        pos++;
        while (pos < src.length && (isDigit(src[pos]) || src[pos] === "_")) pos++;
      }
      if ((src[pos] === "e" || src[pos] === "E") && /[0-9+\-]/.test(src[pos + 1] ?? "")) {
        pos++;
        if (src[pos] === "+" || src[pos] === "-") pos++;
        while (pos < src.length && isDigit(src[pos])) pos++;
      }
      push("number", start, pos, startLine);
      continue;
    }

    // ── Multi-character operators first ──
    let matched = false;
    for (const op of OPERATORS) {
      if (src.startsWith(op, pos)) {
        push("op", pos, pos + op.length, line);
        pos += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (PUNCT.has(ch)) {
      push("punct", pos, pos + 1, line);
      pos++;
      continue;
    }

    // Unknown character: skip it rather than derailing the stream.
    pos++;
  }

  tokens.push({ k: "eof", v: "", start: src.length, end: src.length, line });
  return tokens;
}

/* ───────────────────────── String interpolation splitting ───────────────────────── */

/**
 * Skip a `\( ... )` interpolation starting just after the `\(`, honouring
 * nested parentheses and nested string literals. Returns the index after the
 * closing paren.
 */
function skipInterpolation(src: string, start: number, bumpLine: () => void): number {
  let i = start;
  let depth = 1;

  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "\\" && src[i + 1] === "(") {
      depth++;
      i += 2;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i++;
          break;
        }
        if (src[i] === "\n") bumpLine();
        i++;
      }
      continue;
    }
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    if (c === "\n") bumpLine();
    i++;
  }

  return i;
}

export type StringPart =
  | { kind: "text"; value: string }
  | { kind: "expr"; source: string };

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  '"': '"',
  "'": "'",
  "\\": "\\",
};

/** Unescape a raw Swift string body (without surrounding quotes). */
function unescape(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      if (next in ESCAPES) {
        out += ESCAPES[next];
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Split a raw string token (with quotes) into literal text and interpolation
 * expression sources. Handles nested parentheses and nested string literals
 * inside the interpolation.
 */
export function splitStringLiteral(raw: string): StringPart[] {
  let body = raw;
  if (body.startsWith('"""')) {
    body = body.slice(3);
    if (body.endsWith('"""')) body = body.slice(0, -3);
    // Strip the first newline and common leading indentation (Swift rule).
    if (body.startsWith("\n")) body = body.slice(1);
    const lines = body.split("\n");
    const indents = lines
      .filter((l) => l.trim().length > 0)
      .map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0);
    const indent = indents.length > 0 ? Math.min(...indents) : 0;
    body = lines.map((l) => l.slice(indent)).join("\n");
  } else {
    if (body.startsWith('"')) body = body.slice(1);
    if (body.endsWith('"')) body = body.slice(0, -1);
  }

  const parts: StringPart[] = [];
  let text = "";
  let i = 0;

  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "(") {
      if (text) {
        parts.push({ kind: "text", value: unescape(text) });
        text = "";
      }
      i += 2;
      let depth = 1;
      let expr = "";
      while (i < body.length && depth > 0) {
        const c = body[i];
        if (c === '"') {
          // Skip a nested string literal wholesale.
          expr += c;
          i++;
          while (i < body.length) {
            if (body[i] === "\\") {
              expr += body[i] + (body[i + 1] ?? "");
              i += 2;
              continue;
            }
            expr += body[i];
            if (body[i] === '"') {
              i++;
              break;
            }
            i++;
          }
          continue;
        }
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) break;
        }
        expr += c;
        i++;
      }
      i++; // skip closing paren
      parts.push({ kind: "expr", source: expr });
      continue;
    }
    if (ch === "\\" && body[i + 1] && body[i + 1] in ESCAPES) {
      text += ch + body[i + 1];
      i += 2;
      continue;
    }
    text += ch;
    i++;
  }

  if (text) parts.push({ kind: "text", value: unescape(text) });
  return parts;
}
