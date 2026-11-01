/**
 * index.ts — public surface of the Swift preview runtime.
 *
 * The runtime interprets a practical Swift/SwiftUI subset against live state:
 * it is not a compiler, but it implements the *semantics* the canvas needs
 * (state, bindings, actions, navigation, conditionals, loops) so a preview
 * behaves like the real thing for interactive samples.
 */

export {
  PreviewRuntime,
  interpret,
  buildScreenForSource,
  type InterpretResult,
  type ModalSpec,
  type ProgramSummary,
  type RModifier,
  type RNode,
  type Screen,
  type Instance,
} from "./viewBuilder.ts";

export { parseProgram, Parser, parseStatements, parseViewItems } from "./parser.ts";

export { tokenize, splitStringLiteral, type Diagnostic, type Tok } from "./lexer.ts";

export {
  Env,
  evalExpr,
  execStmts,
  runStatements,
  swiftDescription,
  truthy,
  type Value,
} from "./evaluator.ts";

export {
  METRICS,
  SYSTEM_COLORS,
  TEXT_STYLES,
  cssColor,
  registerSymbolProvider,
  resolveFont,
  type ExternalSymbolProvider,
} from "./design.ts";

export {
  dimensionOf,
  frameClasses,
  frameLayout,
  frameStretches,
  hasFrameSizing,
  implicitMemberName,
  rendersChildrenFlat,
  spacerClasses,
  stretchesToFrame,
  viewWantsFullWidth,
  type Dimension,
  type FrameLayout,
  type LayoutAxis,
} from "./layout.ts";

export type { Program, StructDecl, ViewItem, ViewExpr, Stmt, Expr } from "./ast.ts";
