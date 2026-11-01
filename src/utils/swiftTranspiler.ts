/**
 * swiftTranspiler.ts
 *
 * Maps a practical subset of SwiftUI into semantic HTML + Tailwind classes so
 * the live preview canvas can render without a real Swift compiler.
 *
 * Design rules:
 *  - Never throw. Partial or broken source still produces usable HTML.
 *  - Unknown views degrade to a labelled placeholder instead of vanishing.
 *  - Every unmapped construct is reported as a Diagnostic with a source offset.
 */

import {
  hasInterpolation,
  parseActionStatements,
  parseInterpolation,
  scanStateDeclarations,
  type ComponentSpec,
  type ModifierSpec,
  type NavigationDestination,
  type Statement,
  type ViewSpec,
} from "./swiftIR.ts";

/* ──────────────────────────── Public types ──────────────────────────── */

export type TranspileMode = "preview" | "debug" | "strict";

export interface TranspileOptions {
  /** Tolerance for unknown syntax. Defaults to "preview". */
  mode?: TranspileMode;
  /** Extra class applied to the preview root. */
  rootClass?: string;
}

export type ContainerType = "vstack" | "hstack" | "zstack" | "other";

export type DiagnosticSeverity = "info" | "warn" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Absolute character offset in the source. */
  offset: number;
  message: string;
  snippet?: string;
  tokenName?: string;
}

export interface TranspileResult {
  /** Inner HTML of the preview root. Never empty. */
  html: string;
  /** Interactive component IR consumed by the React preview renderer. */
  ir: ComponentSpec;
  diagnostics: Diagnostic[];
  containerType: ContainerType;
  /** True when no diagnostics were emitted. */
  clean: boolean;
}

/* ──────────────────────────── Tokenizer ──────────────────────────── */

export type TokenKind =
  | "view"
  | "modifier"
  | "string"
  | "number"
  | "identifier"
  | "keyword"
  | "punct"
  | "operator"
  | "attribute";

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

export const VIEW_NAMES: ReadonlySet<string> = new Set([
  "VStack", "HStack", "ZStack", "Spacer", "Text", "Image", "Button",
  "Circle", "Rectangle", "RoundedRectangle", "Ellipse", "Capsule",
  "Color", "Divider", "Link", "List", "ScrollView", "LazyVStack",
  "LazyHStack", "NavigationLink", "NavigationStack", "NavigationView",
  "TabView", "Picker", "Toggle", "Slider", "Stepper", "ProgressView",
  "GeometryReader", "ForEach", "Section", "Form", "Label", "Group",
  "SecureField", "TextField",
]);

export const MODIFIER_NAMES: ReadonlySet<string> = new Set([
  "padding", "background", "foregroundColor", "foregroundStyle", "font",
  "fontWeight", "frame", "offset", "opacity", "overlay", "clipShape",
  "cornerRadius", "fixedSize", "multilineTextAlignment", "lineLimit",
  "lineSpacing", "shadow", "tint", "bold", "italic", "underline",
  "disabled", "onTapGesture", "onAppear", "scaleEffect", "rotationEffect",
  "aspectRatio", "ignoresSafeArea", "buttonStyle", "listStyle",
  "presentationDetents", "resizable", "scaledToFit", "scaledToFill",
  "accentColor", "navigationTitle", "textFieldStyle", "toggleStyle",
]);

const KEYWORDS: ReadonlySet<string> = new Set([
  "struct", "var", "let", "func", "init", "return", "if", "else", "for",
  "in", "while", "switch", "case", "default", "break", "continue", "import",
  "true", "false", "nil", "self", "some", "body",
]);

const PUNCT_CHARS = "{}()[]<>,.:;?#";

/** Multi-character first so `+=` is not split into `+` and `=`. */
const OPERATOR_TOKENS = [
  "+=", "-=", "*=", "/=", "==", "!=", "&&", "||", "??", "->",
  "=", "+", "-", "*", "/", "%", "!",
];

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/** Convert Swift source into a flat token stream (comments/whitespace dropped). */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < src.length) {
    const ch = src[pos];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pos++;
      continue;
    }

    if (src.startsWith("//", pos)) {
      while (pos < src.length && src[pos] !== "\n") pos++;
      continue;
    }

    if (src.startsWith("/*", pos)) {
      pos += 2;
      while (pos < src.length && !src.startsWith("*/", pos)) pos++;
      pos += 2;
      continue;
    }

    if (ch === '"') {
      const start = pos;
      pos++;
      while (pos < src.length) {
        if (src[pos] === "\\") { pos += 2; continue; }
        if (src[pos] === '"') { pos++; break; }
        if (src[pos] === "\n") break;
        pos++;
      }
      tokens.push({ kind: "string", value: src.slice(start, pos), start, end: pos });
      continue;
    }

    if (ch === "@") {
      const start = pos;
      pos++;
      while (pos < src.length && isAlphaNum(src[pos])) pos++;
      tokens.push({ kind: "attribute", value: src.slice(start, pos), start, end: pos });
      continue;
    }

    if (isAlpha(ch)) {
      const start = pos;
      let end = pos + 1;
      while (end < src.length && isAlphaNum(src[end])) end++;
      const value = src.slice(start, end);

      let kind: TokenKind;
      if (VIEW_NAMES.has(value)) kind = "view";
      else if (MODIFIER_NAMES.has(value)) kind = "modifier";
      else if (KEYWORDS.has(value)) kind = "keyword";
      else kind = "identifier";

      tokens.push({ kind, value, start, end });
      pos = end;
      continue;
    }

    if (isDigit(ch)) {
      const start = pos;
      while (pos < src.length && (isDigit(src[pos]) || src[pos] === ".")) pos++;
      tokens.push({ kind: "number", value: src.slice(start, pos), start, end: pos });
      continue;
    }

    let matchedOperator = false;
    for (const op of OPERATOR_TOKENS) {
      if (src.startsWith(op, pos)) {
        tokens.push({ kind: "operator", value: op, start: pos, end: pos + op.length });
        pos += op.length;
        matchedOperator = true;
        break;
      }
    }
    if (matchedOperator) continue;

    if (PUNCT_CHARS.includes(ch)) {
      tokens.push({ kind: "punct", value: ch, start: pos, end: pos + 1 });
      pos++;
      continue;
    }

    pos++;
  }

  return tokens;
}

/* ──────────────────────────── Parser ──────────────────────────── */

interface ParsedModifier {
  name: string;
  rawArgs: string;
  /** Trailing closure, e.g. `.onAppear { increment() }`. */
  closure?: Token[];
}

interface AstNode {
  tag: string;
  attrs: Record<string, string>;
  children: AstNode[];
  text?: string;
}

interface ParserState {
  tokens: Token[];
  diagnostics: Diagnostic[];
  mode: TranspileMode;
  pos: number;
}

/** Parse comma-separated args inside parens; leaves st.pos after `)`. */
function parseParenArgs(st: ParserState): string[] {
  const args: string[] = [];
  if (st.pos >= st.tokens.length || st.tokens[st.pos].value !== "(") return args;

  st.pos++;
  let depth = 1;
  let current = "";

  while (st.pos < st.tokens.length && depth > 0) {
    const tok = st.tokens[st.pos];
    if (tok.value === "(") { depth++; current += tok.value; }
    else if (tok.value === ")") {
      depth--;
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        st.pos++;
        break;
      }
      current += tok.value;
    } else if (tok.value === ",") {
      if (current.trim()) args.push(current.trim());
      current = "";
    } else {
      current += tok.value;
    }
    st.pos++;
  }
  return args;
}

/** Parse `{ children }` and return the inner tokens. Leaves st.pos past `}`. */
function parseBraceBody(st: ParserState): Token[] {
  if (st.pos >= st.tokens.length || st.tokens[st.pos].value !== "{") return [];
  st.pos++;
  const bodyStart = st.pos;
  let depth = 1;
  while (st.pos < st.tokens.length && depth > 0) {
    if (st.tokens[st.pos].value === "{") depth++;
    else if (st.tokens[st.pos].value === "}") depth--;
    st.pos++;
  }
  return st.tokens.slice(bodyStart, st.pos - 1);
}

/** Walk forward over `.modifier(...)` chains, returning parsed modifiers. */
function parseModifiers(st: ParserState): ParsedModifier[] {
  const modifiers: ParsedModifier[] = [];

  while (st.pos < st.tokens.length && st.tokens[st.pos].value === ".") {
    const nameTok = st.tokens[st.pos + 1];
    if (!nameTok || nameTok.kind !== "modifier") break;

    const nextTok = st.tokens[st.pos + 2];
    if (nextTok && nextTok.value === "(") {
      st.pos += 2;
      const args = parseParenArgs(st);
      modifiers.push({ name: nameTok.value, rawArgs: args[0] ?? "" });
      // parseParenArgs left st.pos past the close paren;
      // the while loop checks for the next "."
    } else if (nextTok && nextTok.value === "{") {
      // Trailing closure modifier: .onAppear { ... } / .onTapGesture { ... }
      st.pos += 2;
      const closure = parseBraceBody(st);
      modifiers.push({ name: nameTok.value, rawArgs: "", closure });
    } else {
      modifiers.push({ name: nameTok.value, rawArgs: "" });
      st.pos += 2;
    }
  }
  return modifiers;
}

function isSelfClosingView(name: string): boolean {
  return ["Spacer", "Divider", "Circle", "Rectangle",
    "RoundedRectangle", "Ellipse", "Capsule", "Color"].includes(name);
}

/** Parse one view node at st.pos (must be a "view" token). */
function parseView(st: ParserState): AstNode | null {
  const tok = st.tokens[st.pos];
  if (!tok || tok.kind !== "view") return null;

  const viewName = tok.value;
  st.pos++;

  let modifiers: ParsedModifier[] = [];

  if (isSelfClosingView(viewName)) {
    const selfArgs = st.tokens[st.pos]?.value === "(" ? parseParenArgs(st) : [];
    modifiers = parseModifiers(st);
    return renderNode(viewName, modifiers, [], selfArgs);
  }

  // Views with args: Text("hello"), Image("pic")
  const args = st.tokens[st.pos]?.value === "(" ? parseParenArgs(st) : [];

  // Views with body: VStack { ... }
  let bodyTokens: Token[] = [];
  if (st.tokens[st.pos]?.value === "{") {
    bodyTokens = parseBraceBody(st);
  }

  // Trailing modifiers
  modifiers = parseModifiers(st);

  // Parse children from body tokens
  const childState: ParserState = {
    tokens: bodyTokens,
    diagnostics: st.diagnostics,
    mode: st.mode,
    pos: 0,
  };
  const children: AstNode[] = [];
  while (childState.pos < bodyTokens.length) {
    const child = parseView(childState);
    if (child) {
      children.push(child);
    } else {
      // Skip attributes, keywords, stray punctuation
      childState.pos++;
    }
  }

  return renderNode(viewName, modifiers, children, args);
}

/* ──────────────────────────── Render ──────────────────────────── */

export function unquoteArg(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    return t.slice(1, -1);
  }
  return t;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COLOR_MAP: Record<string, string> = {
  red: "#ff3b30",
  blue: "#0a84ff",
  green: "#30d159",
  yellow: "#ffd60a",
  orange: "#ff9500",
  purple: "#af52de",
  pink: "#ff2d55",
  black: "#000000",
  white: "#ffffff",
  gray: "#8e8e93",
  secondary: "#8e8e93",
  primary: "#0a84ff",
};

export function resolveColor(raw: string): string {
  const trimmed = raw.trim();
  const withoutDot = trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
  const key = unquoteArg(withoutDot).toLowerCase();
  return COLOR_MAP[key] ?? key;
}

/**
 * Values that depend on user code (colors, numbers) are emitted as inline
 * styles rather than arbitrary Tailwind classes, so the preview never depends
 * on a build-time safelist.
 */
export function modifierToStyles(mod: ParsedModifier): Record<string, string> {
  const n = Number(unquoteArg(mod.rawArgs));

  switch (mod.name) {
    case "foregroundColor":
    case "foregroundStyle":
      return { color: resolveColor(mod.rawArgs) };
    case "background":
      return { "background-color": resolveColor(mod.rawArgs) };
    case "tint":
    case "accentColor":
      return { color: "#0a84ff" };
    case "cornerRadius":
      return Number.isFinite(n) ? { "border-radius": `${n}px` } : {};
    case "opacity":
      return Number.isFinite(n) ? { opacity: String(Math.max(0, Math.min(1, n))) } : {};
    case "scaleEffect":
      return Number.isFinite(n) ? { transform: `scale(${n})` } : {};
    case "rotationEffect":
      return Number.isFinite(n) ? { transform: `rotate(${n}deg)` } : {};
    case "padding": {
      // Whole-number padding only; edge variants still map to Tailwind classes.
      const value = numericValue(mod.rawArgs);
      return value !== undefined ? { padding: `${value}px` } : {};
    }
    case "frame": {
      const style: Record<string, string> = {};
      const width = labeledNumber(mod.rawArgs, "width") ?? leadingNumber(mod.rawArgs);
      const height = labeledNumber(mod.rawArgs, "height");
      const maxWidth = labeledDimension(mod.rawArgs, "maxWidth");
      const maxHeight = labeledDimension(mod.rawArgs, "maxHeight");
      if (width !== undefined) style.width = `${width}px`;
      if (height !== undefined) style.height = `${height}px`;
      if (maxWidth !== undefined) style["max-width"] = maxWidth;
      if (maxHeight !== undefined) style["max-height"] = maxHeight;

      // `.infinity` means "fill the parent", not "cap at 100%": the element
      // must claim the full width/height too, which is what the `w-full` /
      // `h-full` classes emitted by modifierToClasses() express.
      if (style.width === undefined && readsInfinity(mod.rawArgs, "width")) style.width = "100%";
      if (style.height === undefined && readsInfinity(mod.rawArgs, "height")) style.height = "100%";
      if (style.width !== undefined || style.height !== undefined) style["box-sizing"] = "border-box";
      return style;
    }
    default:
      return {};
  }
}

function numericValue(raw: string): number | undefined {
  const n = Number(unquoteArg(raw));
  return Number.isFinite(n) ? n : undefined;
}

function leadingNumber(raw: string): number | undefined {
  const first = raw.split(",")[0]?.trim() ?? "";
  const n = Number(unquoteArg(first));
  return Number.isFinite(n) ? n : undefined;
}

/** Read `width:120` / `height:40` style arguments from a flattened raw arg. */
function labeledNumber(raw: string, label: string): number | undefined {
  const match = raw.match(new RegExp(`${label}\\s*:\\s*(-?[0-9.]+)`));
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Read `maxWidth:.infinity` (or `maxWidth:120`) as a CSS dimension.
 * The label is matched case-insensitively so `maxWidth`/`maxwidth` both work.
 */
function labeledDimension(raw: string, label: string): string | undefined {
  const match = raw.match(new RegExp(`${label}\\s*:\\s*([^,]+)`, "i"));
  if (!match) return undefined;
  const value = match[1].trim().replace(/^\./, "");
  if (value === "infinity") return "100%";
  const n = Number(value);
  return Number.isFinite(n) ? `${n}px` : undefined;
}

/** True when the flattened frame args ask the given axis to fill (`.infinity`). */
function readsInfinity(raw: string, axis: "width" | "height"): boolean {
  return new RegExp(`(?:max|min)?${axis}\\s*:\\s*\\.?infinity`, "i").test(raw);
}

export function modifierToClasses(mod: ParsedModifier): string[] {
  const val = unquoteArg(mod.rawArgs);

  // Note: value-dependent modifiers are handled by modifierToStyles().

  switch (mod.name) {
    case "padding":
      return ["p-4"];
    case "font":
      return ["text-base"];
    case "fontWeight":
      return val.toLowerCase().includes("bold") ? ["font-bold"] : ["font-normal"];
    case "frame": {
      // `.frame(maxWidth: .infinity)` / `.frame(maxHeight: .infinity)` are
      // SwiftUI's "fill the parent" idiom and map to Tailwind's full-size
      // utilities. Numeric parts stay inline styles (modifierToStyles) so the
      // preview never depends on a build-time safelist.
      const classes: string[] = [];
      if (readsInfinity(mod.rawArgs, "width")) classes.push("w-full", "self-stretch");
      if (readsInfinity(mod.rawArgs, "height")) classes.push("h-full", "self-stretch");
      return classes;
    }
    case "clipShape":
      return ["rounded-full", "overflow-hidden"];
    case "aspectRatio":
      return ["aspect-square"];
    case "bold":
      return ["font-bold"];
    case "italic":
      return ["italic"];
    case "underline":
      return ["underline"];
    case "disabled":
      return ["opacity-40", "cursor-not-allowed"];
    case "onTapGesture":
      return ["cursor-pointer", "active:opacity-70"];
    case "ignoresSafeArea":
      // Root-level full bleed: the web equivalents of SwiftUI's safe-area
      // opt-out are a full-width, full-viewport container.
      return ["w-full", "min-h-screen"];
    case "overlay":
      return ["relative"];
    case "fixedSize":
      return ["w-full"];
    case "multilineTextAlignment":
      return val.toLowerCase().includes("center") ? ["text-center"] : ["text-left"];
    case "lineLimit":
      return ["truncate"];
    case "lineSpacing":
      return ["leading-normal"];
    case "shadow":
      return ["shadow-lg"];
    case "resizable":
      return ["w-full", "h-auto"];
    case "scaledToFit":
      return ["object-contain"];
    case "scaledToFill":
      return ["object-cover"];
    case "listStyle":
      return ["list-none", "p-0", "m-0"];
    case "offset":
    case "onAppear":
    case "buttonStyle":
    case "presentationDetents":
    case "navigationTitle":
    case "textFieldStyle":
    case "toggleStyle":
      return [];
    default:
      return [];
  }
}

export function baseClasses(name: string): string {
  const map: Record<string, string> = {
    VStack: "flex flex-col items-center gap-2",
    HStack: "flex flex-row items-center justify-center gap-2",
    ZStack: "relative flex items-center justify-center",
    Spacer: "flex-1 min-h-[1px]",
    Circle: "w-12 h-12 rounded-full bg-blue-500",
    Rectangle: "w-20 h-12 rounded bg-gray-400",
    RoundedRectangle: "w-20 h-12 rounded-xl bg-gray-400",
    Capsule: "w-20 h-10 rounded-full bg-gray-400",
    Ellipse: "w-16 h-10 rounded-full bg-gray-400",
    Divider: "w-full h-px bg-gray-400",
    Text: "text-neutral-900 select-none",
    Image: "w-10 h-10 object-contain",
    Button: "px-4 py-2 rounded bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors",
    Color: "w-full h-full min-h-[2rem]",
    List: "list-none p-0 m-0 w-full",
    Picker: "border border-gray-400 rounded px-2 py-1 text-white bg-gray-800",
    Slider: "w-48",
    SecureField: "w-64 px-2 py-1 rounded border border-gray-400 bg-gray-800 text-white outline-none focus:border-blue-500",
    TextField: "w-64 px-2 py-1 rounded border border-gray-400 bg-gray-800 text-white outline-none focus:border-blue-500",
    TabView: "w-full h-full",
    NavigationLink: "text-blue-400 hover:underline",
    NavigationStack: "w-full h-full",
    NavigationView: "w-full h-full",
    Link: "text-blue-400 hover:underline",
    ProgressView: "w-48 h-2 bg-gray-600 rounded-full overflow-hidden",
    Section: "mb-4",
    Form: "flex flex-col gap-2 p-2",
    Label: "flex items-center gap-2",
    Toggle: "flex items-center gap-2",
    GeometryReader: "absolute inset-0",
    ForEach: "",
    ScrollView: "overflow-y-auto",
  };
  return map[name] ?? "";
}

function renderNode(
  name: string,
  modifiers: ParsedModifier[],
  children: AstNode[],
  args: string[],
): AstNode {
  // Structural + static modifier classes come from Tailwind.
  const allClasses: string[] = [];
  const base = baseClasses(name);
  if (base) allClasses.push(base);
  for (const mod of modifiers) {
    allClasses.push(...modifierToClasses(mod));
  }

  // De-duplicate, preserving order.
  const seen = new Set<string>();
  const cls = allClasses.filter((c) => c && !seen.has(c) && seen.add(c)).join(" ");

  // Value-dependent modifiers become inline styles (no safelist needed).
  const styles: Record<string, string> = {};
  for (const mod of modifiers) {
    Object.assign(styles, modifierToStyles(mod));
  }

  const attrs: Record<string, string> = {};
  if (cls) attrs.class = cls;
  const styleStr = Object.entries(styles)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  if (styleStr) attrs.style = styleStr;

  return renderSwiftNode(name, attrs, children, args);
}

/** Render a single SwiftUI view name to an HTML AST node. */
function renderSwiftNode(
  name: string,
  attrs: Record<string, string>,
  children: AstNode[],
  args: string[],
): AstNode {
  switch (name) {
    case "VStack":
    case "HStack":
    case "ZStack":
      return { tag: "div", attrs, children, text: undefined };

    case "Text":
      return { tag: "span", attrs, children: [], text: unquoteArg(args[0] ?? "") };

    case "Image": {
      const alt = unquoteArg(args[0] ?? "image");
      const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
      return { tag: "img", attrs: { ...attrs, src, alt }, children: [], text: undefined };
    }

    case "Button":
      return { tag: "button", attrs: { ...attrs, type: "button" }, children, text: unquoteArg(args[0] ?? "Button") };

    case "Color": {
      const color = args[0] ? resolveColor(args[0]) : "#ffffff";
      const existing = attrs.style ? `${attrs.style};` : "";
      return { tag: "div", attrs: { ...attrs, style: `${existing}background-color:${color}` }, children: [], text: undefined };
    }

    case "Circle":
    case "Rectangle":
    case "RoundedRectangle":
    case "Ellipse":
    case "Capsule":
      return { tag: "div", attrs, children: [], text: undefined };

    case "Spacer":
      return { tag: "div", attrs, children: [], text: undefined };

    case "Divider":
      return { tag: "hr", attrs, children: [], text: undefined };

    case "Toggle":
      return { tag: "div", attrs, children, text: undefined };

    case "Picker":
      return { tag: "select", attrs, children, text: undefined };

    case "Slider":
      return { tag: "input", attrs: { ...attrs, type: "range" }, children: [], text: undefined };

    case "SecureField":
      return { tag: "input", attrs: { ...attrs, type: "password", placeholder: unquoteArg(args[0] ?? "") }, children: [], text: undefined };

    case "TextField":
      return { tag: "input", attrs: { ...attrs, type: "text", placeholder: unquoteArg(args[0] ?? "") }, children: [], text: undefined };

    case "List":
      return { tag: "ul", attrs, children, text: undefined };

    case "ScrollView": {
      const axis = args[0]?.toLowerCase().includes("horizontal") ? "overflow-x-auto" : "overflow-y-auto";
      return { tag: "div", attrs: { ...attrs, class: `${attrs.class ?? ""} ${axis}`.trim() }, children, text: undefined };
    }

    case "TabView":
      return { tag: "div", attrs, children, text: undefined };

    case "NavigationLink":
      return { tag: "a", attrs, children, text: undefined };

    case "NavigationStack":
    case "NavigationView":
      return { tag: "nav", attrs, children, text: undefined };

    case "Link":
      return { tag: "a", attrs: { ...attrs, href: unquoteArg(args[0] ?? "#") }, children, text: undefined };

    case "ProgressView": {
      const progressVal = unquoteArg(args[0] ?? "50");
      const pct = Math.max(0, Math.min(100, Number(progressVal) || 50));
      return {
        tag: "div",
        attrs: { ...attrs, class: `${attrs.class ?? ""} bg-gray-600`.trim() },
        children: [{ tag: "div", attrs: { class: "bg-blue-500 h-full rounded-full", style: `width:${pct}%` }, children: [], text: undefined }],
        text: undefined,
      };
    }

    case "Section":
      return { tag: "section", attrs, children, text: undefined };

    case "Form":
      return { tag: "form", attrs, children, text: undefined };

    case "Label":
      return { tag: "span", attrs, children, text: undefined };

    case "GeometryReader":
      return { tag: "div", attrs, children, text: undefined };

    case "ForEach":
      return { tag: "div", attrs, children, text: undefined };

    case "Group":
      // Just render children inline
      return { tag: "div", attrs: { class: "" }, children, text: undefined };

    default:
      // Unknown SwiftUI view: graceful fallback
      return {
        tag: "div",
        attrs: { class: "text-xs text-gray-500 p-2 border border-dashed border-gray-400 rounded" },
        children: [],
        text: `${name} (not yet supported)`,
      };
  }
}

function nodeToHtml(node: AstNode): string {
  const attrsStr = Object.entries(node.attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");

  if (node.children.length === 0 && !node.text) {
    return `<${node.tag}${attrsStr} />`;
  }

  const inner = node.text !== undefined
    ? escapeHtml(node.text)
    : node.children.map(nodeToHtml).join("");

  return `<${node.tag}${attrsStr}>${inner}</${node.tag}>`;
}

/* ─────────────────────── Interactive IR builder ─────────────────────── */

function makePlaceholderSpec(message: string): ViewSpec {
  return {
    type: "Placeholder",
    args: [],
    text: message,
    modifiers: [],
    children: [],
  };
}

export function emptyComponentSpec(message: string): ComponentSpec {
  return {
    states: [],
    functions: {},
    views: {},
    body: makePlaceholderSpec(message),
    hasNavigationStack: false,
    hasEnvironmentDismiss: false,
  };
}

function toModifierSpecs(modifiers: ParsedModifier[]): ModifierSpec[] {
  return modifiers.map((modifier) => ({
    name: modifier.name,
    rawArgs: modifier.rawArgs,
  }));
}

/** Slice the tokens inside a brace block opening at `openIndex`. */
function readBraceBlock(
  tokens: Token[],
  openIndex: number,
): { inner: Token[]; closeIndex: number } {
  let depth = 0;
  let closeIndex = tokens.length - 1;

  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].value === "{") depth += 1;
    else if (tokens[i].value === "}") {
      depth -= 1;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }

  return { inner: tokens.slice(openIndex + 1, closeIndex), closeIndex };
}

interface RawStruct {
  name: string;
  body: Token[] | null;
}

/** Collect every `struct X: View { ... var body ... }` body token list. */
function scanStructBodies(tokens: Token[]): RawStruct[] {
  const structs: RawStruct[] = [];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value !== "struct") continue;

    const nameTok = tokens[i + 1];
    if (!nameTok || nameTok.kind !== "identifier") continue;

    let j = i + 2;
    let conformsToView = false;
    while (j < tokens.length && tokens[j].value !== "{") {
      if (tokens[j].value === "View") conformsToView = true;
      j++;
    }
    if (j >= tokens.length) break;
    if (!conformsToView) continue;

    const block = readBraceBlock(tokens, j);
    let body: Token[] | null = null;

    for (let k = 0; k < block.inner.length; k++) {
      if (block.inner[k].value !== "body") continue;
      let open = k + 1;
      while (open < block.inner.length && block.inner[open].value !== "{") open++;
      if (open < block.inner.length) {
        body = readBraceBlock(block.inner, open).inner;
      }
      break;
    }

    structs.push({ name: nameTok.value, body });
    i = block.closeIndex;
  }

  return structs;
}

/** Collect every `func name(...) { ... }` body token list. */
function scanFunctionBodies(tokens: Token[]): Record<string, Token[]> {
  const functions: Record<string, Token[]> = {};

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value !== "func") continue;

    const nameTok = tokens[i + 1];
    if (!nameTok || nameTok.kind !== "identifier") continue;

    let j = i + 2;
    while (j < tokens.length && tokens[j].value !== "{") j++;
    if (j >= tokens.length) break;

    const block = readBraceBlock(tokens, j);
    functions[nameTok.value] = block.inner;
    i = block.closeIndex;
  }

  return functions;
}

interface ViewParserContext {
  functions: Record<string, Statement[]>;
  diagnostics: Diagnostic[];
  mode: TranspileMode;
}

function parseSideEffectClosures(
  modifiers: ParsedModifier[],
  ctx: ViewParserContext,
): Record<string, Statement[]> | undefined {
  let closures: Record<string, Statement[]> | undefined;

  for (const modifier of modifiers) {
    if (!modifier.closure) continue;
    closures ??= {};
    closures[modifier.name] = parseActionStatements(modifier.closure, ctx.functions);
  }

  return closures;
}

function parseNavigationDestination(
  bodyTokens: Token[],
  ctx: ViewParserContext,
): NavigationDestination | undefined {
  const first = bodyTokens.find(
    (token) => token.value !== "{" && token.value !== "}" && token.kind !== "keyword",
  );
  if (!first) return undefined;

  // DetailView() / ContentView() — resolve the struct body lazily by name.
  if (
    first.kind === "identifier" &&
    /^[A-Z]/.test(first.value) &&
    bodyTokens[bodyTokens.indexOf(first) + 1]?.value === "("
  ) {
    return { kind: "named", name: first.value };
  }

  // Inline destination such as NavigationLink("x") { VStack { ... } }
  const state: ParserState = {
    tokens: bodyTokens,
    diagnostics: ctx.diagnostics,
    mode: ctx.mode,
    pos: 0,
  };

  while (state.pos < bodyTokens.length) {
    const view = parseViewSpec(state, ctx);
    if (view) return { kind: "inline", view };
    state.pos++;
  }

  return undefined;
}

/** Parse one view (and its children/actions) into the interactive IR. */
function parseViewSpec(st: ParserState, ctx: ViewParserContext): ViewSpec | null {
  const tok = st.tokens[st.pos];
  if (!tok) return null;

  const isKnownView = tok.kind === "view";
  const isConstructor =
    tok.kind === "identifier" &&
    /^[A-Z]/.test(tok.value) &&
    st.tokens[st.pos + 1]?.value === "(";
  if (!isKnownView && !isConstructor) return null;

  const viewName = tok.value;
  st.pos++;

  const args = st.tokens[st.pos]?.value === "(" ? parseParenArgs(st) : [];

  let bodyTokens: Token[] = [];
  if (st.tokens[st.pos]?.value === "{") {
    bodyTokens = parseBraceBody(st);
  }

  const modifiers = parseModifiers(st);
  const spec: ViewSpec = {
    type: viewName,
    args,
    modifiers: toModifierSpecs(modifiers),
    children: [],
    modifierClosures: parseSideEffectClosures(modifiers, ctx),
  };

  if (viewName === "Text") {
    const raw = args[0] ?? '""';
    if (hasInterpolation(raw)) {
      spec.textParts = parseInterpolation(raw);
    } else {
      spec.text = unquoteArg(raw);
    }
  }

  if (viewName === "Button") {
    if (bodyTokens.length > 0) {
      spec.action = parseActionStatements(bodyTokens, ctx.functions);
    }
    return spec;
  }

  if (viewName === "NavigationLink") {
    spec.navigationDestination = parseNavigationDestination(bodyTokens, ctx);
    return spec;
  }

  // Containers and all other views keep parsing their brace body as children.
  const childState: ParserState = {
    tokens: bodyTokens,
    diagnostics: ctx.diagnostics,
    mode: ctx.mode,
    pos: 0,
  };

  while (childState.pos < bodyTokens.length) {
    const child = parseViewSpec(childState, ctx);
    if (child) spec.children.push(child);
    else childState.pos++;
  }

  return spec;
}

function viewContains(view: ViewSpec, type: string): boolean {
  if (view.type === type) return true;
  return view.children.some((child) => viewContains(child, type));
}

function buildComponentSpec(
  tokens: Token[],
  diagnostics: Diagnostic[],
  mode: TranspileMode,
): ComponentSpec {
  const { states, hasEnvironmentDismiss } = scanStateDeclarations(tokens);
  const rawFunctionBodies = scanFunctionBodies(tokens);

  // First pass: register every function name so calls parse as invocations.
  const stubs: Record<string, Statement[]> = {};
  for (const name of Object.keys(rawFunctionBodies)) stubs[name] = [];
  const functions: Record<string, Statement[]> = {};
  for (const [name, body] of Object.entries(rawFunctionBodies)) {
    functions[name] = parseActionStatements(body, stubs);
  }

  const ctx: ViewParserContext = { functions, diagnostics, mode };
  const views: Record<string, ViewSpec> = {};
  let entry: ViewSpec | null = null;

  for (const rawStruct of scanStructBodies(tokens)) {
    if (!rawStruct.body) continue;

    const state: ParserState = {
      tokens: rawStruct.body,
      diagnostics,
      mode,
      pos: 0,
    };

    let spec: ViewSpec | null = null;
    while (state.pos < rawStruct.body.length && !spec) {
      spec = parseViewSpec(state, ctx);
      if (!spec) state.pos++;
    }

    if (!spec) {
      spec = makePlaceholderSpec(`${rawStruct.name} has no supported SwiftUI body.`);
    }
    spec.name = rawStruct.name;
    views[rawStruct.name] = spec;

    if (!entry || rawStruct.name === "ContentView") {
      entry = spec;
    }
  }

  // Raw snippets (tests, quick experiments) may not declare a struct at all.
  if (!entry) {
    const firstViewIdx = findFirstView(tokens);
    if (firstViewIdx >= 0) {
      const state: ParserState = {
        tokens,
        diagnostics,
        mode,
        pos: firstViewIdx,
      };
      entry = parseViewSpec(state, ctx);
    }
  }

  if (!entry) {
    entry = makePlaceholderSpec("No SwiftUI view body found in this file.");
  }

  const hasNavigationStack =
    viewContains(entry, "NavigationStack") ||
    Object.values(views).some((view) => viewContains(view, "NavigationStack"));

  return {
    states,
    functions,
    views,
    body: entry,
    hasNavigationStack,
    hasEnvironmentDismiss,
  };
}

/* ──────────────────────────── Main entry ──────────────────────────── */

/**
 * Find the first view token in the stream — this is where parsing starts.
 * If there are none, the caller falls back to plain-text rendering.
 */
function findFirstView(tokens: Token[]): number {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === "view") return i;
  }
  return -1;
}

function detectContainer(node: AstNode): ContainerType {
  const cls = node.attrs["class"] || "";
  if (cls.includes("flex-col")) return "vstack";
  if (cls.includes("flex-row")) return "hstack";
  if (cls.includes("relative") && node.tag === "div") return "zstack";

  // Check children
  for (const child of node.children) {
    const ct = detectContainer(child);
    if (ct !== "other") return ct;
  }
  return "other";
}

/**
 * Transpile Swift/SwiftUI source into HTML for the preview canvas.
 *
 * @param source    The raw Swift source code from the editor.
 * @param options   { mode?, rootClass? }
 * @returns         { html, diagnostics, containerType, clean }
 */
export function transpileSwift(
  source: string,
  options: TranspileOptions = {},
): TranspileResult {
  const mode: TranspileMode = options.mode ?? "preview";
  const diagnostics: Diagnostic[] = [];

  try {
    if (!source.trim()) {
      return {
        html: '<div class="text-xs text-gray-500 p-4">Canvas kosong — ketik kode SwiftUI di samping.</div>',
        ir: emptyComponentSpec("Canvas kosong — ketik kode SwiftUI di samping."),
        diagnostics: [],
        containerType: "other",
        clean: true,
      };
    }

    const tokens = tokenize(source);
    const firstViewIdx = findFirstView(tokens);

    if (firstViewIdx === -1) {
      diagnostics.push({
        severity: "warn",
        offset: 0,
        message: "Tidak ditemukan view SwiftUI. Menampilkan sebagai teks mentah.",
        snippet: source.slice(0, 120),
      });
      return {
        html: escapeHtml(source),
        ir: emptyComponentSpec("Tidak ada view SwiftUI pada file ini."),
        diagnostics,
        containerType: "other",
        clean: false,
      };
    }

    const st: ParserState = {
      tokens,
      diagnostics,
      mode,
      pos: firstViewIdx,
    };

    const ast = parseView(st);

    if (!ast) {
      diagnostics.push({
        severity: "error",
        offset: firstViewIdx,
        message: "Gagal memparsing view SwiftUI.",
        tokenName: tokens[firstViewIdx]?.value,
      });
      return {
        html: '<div class="text-red-400 p-4">Parse error</div>',
        ir: emptyComponentSpec("Gagal memparsing view SwiftUI."),
        diagnostics,
        containerType: "other",
        clean: false,
      };
    }

    const html = nodeToHtml(ast);
    const containerType = detectContainer(ast);
    const ir = buildComponentSpec(tokens, diagnostics, mode);

    return {
      html,
      ir,
      diagnostics,
      containerType,
      clean: diagnostics.length === 0,
    };
  } catch (err) {
    // Last-resort safety net: never crash the preview.
    diagnostics.push({
      severity: "error",
      offset: 0,
      message: `Transpiler error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      html: '<div class="text-red-400 p-4">Transpiler error — lihat console</div>',
      ir: emptyComponentSpec("Transpiler error — lihat console."),
      diagnostics,
      containerType: "other",
      clean: false,
    };
  }
}

/* ──────────────────────────── Sample ──────────────────────────── */

export const DEFAULT_SWIFT_CODE = `import SwiftUI

struct ContentView: View {
    @State private var count: Int = 0

    var body: some View {
        NavigationStack {
            VStack {
                Text("Hello, SwiftCanvas!")
                    .font(.title)
                    .foregroundColor(.blue)
                    .padding()

                Text("Count: \\(count)")
                    .font(.title2)
                    .onTapGesture {
                        count += 1
                    }

                HStack {
                    Button("Increment") {
                        increment()
                    }

                    Button("Reset") {
                        print("Counter reset")
                        count = 0
                    }
                }

                NavigationLink("Open Detail") {
                    DetailView()
                }

                Spacer()
            }
            .padding()
            .navigationTitle("ContentView")
            .onAppear {
                print("ContentView appeared")
            }
        }
    }

    func increment() {
        count += 1
    }
}

struct DetailView: View {
    @Environment(\\.dismiss) private var dismiss

    var body: some View {
        VStack {
            Text("Detail Screen")
                .font(.title)
                .foregroundColor(.blue)

            Text("Pushed with NavigationLink")

            Button("Go Back") {
                dismiss()
            }
        }
        .padding()
        .navigationTitle("Detail")
    }
}
`;

