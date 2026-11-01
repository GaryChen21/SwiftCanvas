/**
 * layout.ts — SwiftUI frame semantics → CSS/Tailwind layout contract.
 *
 * `.frame(maxWidth: .infinity)` is SwiftUI's idiom for "fill the parent", but
 * the AST only records the raw `.infinity` sentinel inside the modifier args.
 * This module turns that AST shape into the layout intent both engines need:
 *
 *   - which axis the view must fill (X / Y),
 *   - how that fill behaves inside a row vs a column stack,
 *   - the exact Tailwind classes that express it (`w-full`, `h-full`, …).
 *
 * The React renderer applies the classes *and* keeps inline styles authoritative
 * (the canvas must also render when the embedding page ships no Tailwind), and
 * the legacy HTML transpiler emits the same classes into its markup, so both
 * engines agree on one mapping: `.frame(maxWidth: .infinity)` ⇒ `w-full`.
 */

import { numOf, type Value } from "./evaluator.ts";
import type { RModifier, RNode } from "./viewBuilder.ts";

/* ────────────────────────────── Value reading ────────────────────────────── */

/** Last component of an implicit member path (`.infinity` → "infinity"). */
export function implicitMemberName(value: Value | undefined): string | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { t?: string }).t === "implicit") {
    const path = (value as { path: string[] }).path;
    return path[path.length - 1] ?? null;
  }
  if (typeof value === "string") return value;
  return null;
}

/** Numeric dimension, or the `.infinity` sentinel for "fill available space". */
export type Dimension = number | string | "infinity";

export function dimensionOf(value: Value | undefined): Dimension | undefined {
  if (typeof value === "number") return value;
  const numeric = numOf(value ?? null);
  if (numeric !== undefined) return numeric;
  const name = implicitMemberName(value);
  if (name === "infinity") return "infinity";
  if (name === "zero") return 0;
  return undefined;
}

/* ────────────────────────────── Frame intent ────────────────────────────── */

export interface FrameLayout {
  width?: Dimension;
  height?: Dimension;
  minWidth?: Dimension;
  minHeight?: Dimension;
  maxWidth?: Dimension;
  maxHeight?: Dimension;
  /** The view must span the parent's full width / height. */
  fillX: boolean;
  fillY: boolean;
}

/** Read the `.frame(...)` modifier of a node, if any, as a layout intent. */
export function frameLayout(modifiers: RModifier[]): FrameLayout | null {
  const frame = modifiers.find((m) => m.name === "frame");
  if (!frame) return null;

  const get = (label: string) => dimensionOf(frame.args.find((a) => a.label === label)?.value);
  const positional = frame.args.filter((a) => !a.label).map((a) => a.value);

  const width = get("width") ?? dimensionOf(positional[0]);
  const height = get("height") ?? dimensionOf(positional[1]);
  const minWidth = get("minWidth");
  const maxWidth = get("maxWidth");
  const minHeight = get("minHeight");
  const maxHeight = get("maxHeight");

  return {
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    fillX: width === "infinity" || minWidth === "infinity" || maxWidth === "infinity",
    fillY: height === "infinity" || minHeight === "infinity" || maxHeight === "infinity",
  };
}

export function hasFrameSizing(layout: FrameLayout): boolean {
  return (
    layout.width !== undefined || layout.height !== undefined ||
    layout.minWidth !== undefined || layout.maxWidth !== undefined ||
    layout.minHeight !== undefined || layout.maxHeight !== undefined
  );
}

/* ────────────────────────────── Tailwind mapping ────────────────────────────── */

export type LayoutAxis = "vertical" | "horizontal" | "none";

/**
 * Tailwind classes for the frame's intent.
 *
 * `axis` is the parent stack's axis: inside an HStack a `.frame(maxWidth:
 * .infinity)` view is a flexible row item (`flex-1 basis-0 min-w-0`, exactly
 * how a Spacer behaves), while inside a VStack it simply spans the column
 * (`w-full self-stretch`).
 */
export function frameClasses(layout: FrameLayout, axis: LayoutAxis): string[] {
  const classes: string[] = [];

  if (layout.fillX) {
    classes.push("w-full", "max-w-full", "self-stretch");
    if (axis === "horizontal") classes.push("flex-1", "basis-0", "min-w-0");
  }
  if (layout.fillY) {
    classes.push("h-full", "max-h-full", "self-stretch");
    if (axis === "vertical") classes.push("flex-1", "basis-0", "min-h-0");
  }

  return classes;
}

/** Tailwind classes for `Spacer()` — a flexible gap along the parent axis. */
export function spacerClasses(axis: LayoutAxis): string[] {
  return axis === "horizontal"
    ? ["flex-1", "basis-0", "min-w-[1px]"]
    : ["flex-1", "basis-0", "min-h-[1px]"];
}

/**
 * Node types that must stretch to visibly fill the frame they are given.
 *
 * Text, labels, images and shapes keep their intrinsic box — SwiftUI centers
 * them inside the wider frame instead of stretching the glyphs — while controls
 * (Button, TextField, …) and containers must really span the full width, which
 * is the whole point of `.frame(maxWidth: .infinity)`.
 */
const INTRINSIC_TYPES = new Set([
  "Text", "Label", "Image", "Spacer", "Divider",
  "Circle", "Rectangle", "RoundedRectangle", "Capsule", "Ellipse",
  "Path", "Shape",
]);

export function stretchesToFrame(type: string): boolean {
  return !INTRINSIC_TYPES.has(type);
}

/**
 * Views that render their children flat: they have no box of their own, so the
 * frame's children become direct flex items of the frame wrapper.
 */
const FLAT_CONTENT_TYPES = new Set([
  "Group", "EmptyView", "GridRow", "ToolbarItem", "ToolbarItemGroup",
]);

export function rendersChildrenFlat(type: string): boolean {
  return FLAT_CONTENT_TYPES.has(type);
}

/**
 * Whether the frame's content must be stretched to fill it.
 *
 * Text-like views keep their intrinsic box (SwiftUI centers them inside the
 * wider frame), while controls and containers stretch. A flat container has no
 * box of its own — the decision belongs to the children that actually render —
 * so `Group { Text(…) }.frame(maxWidth: .infinity)` keeps the text intrinsic
 * instead of stretching every flattened child.
 */
export function frameStretches(node: RNode): boolean {
  if (rendersChildrenFlat(node.type)) {
    return node.children.some((child) => stretchesToFrame(child.type));
  }
  return stretchesToFrame(node.type);
}

/**
 * Views that consume the offered width even without a frame: a greedy `Color`
 * fill or a flexible control. `Spacer` is axis-dependent and handled in
 * `viewWantsFullWidth`.
 */
const WIDTH_CONSUMING_TYPES = new Set([
  "Color", "Material", "TextField", "SecureField", "TextEditor", "Slider",
]);

/** Views whose children are laid out along a known axis. */
const ROW_TYPES = new Set(["HStack", "LazyHStack"]);
const COLUMN_TYPES = new Set([
  "VStack", "LazyVStack", "List", "Form", "Section", "DisclosureGroup", "LabeledContent",
]);

/** The axis a view lays its children out on; unknown views inherit the parent's. */
function childAxis(node: RNode, parentAxis: LayoutAxis): LayoutAxis {
  if (ROW_TYPES.has(node.type)) return "horizontal";
  if (COLUMN_TYPES.has(node.type)) return "vertical";
  if (node.type === "ScrollView") {
    return implicitMemberName(node.args[0]?.value) === "horizontal" ? "horizontal" : "vertical";
  }
  return parentAxis;
}

/**
 * True when the node (or a descendant) asks for the full available width on the
 * given container axis — either through a `.frame(maxWidth: .infinity)` or a
 * greedy child.
 *
 * The axis matters: a Spacer only flexes along the axis of the stack it sits
 * in, so a vertical Spacer inside a `VStack` must not make an enclosing `HStack`
 * greedy, nor a Button whose label stacks vertically. A Button whose label
 * fills the width must itself fill the width, which is the idiomatic SwiftUI
 * recipe for a full-width button.
 */
export function viewWantsFullWidth(node: RNode, axis: LayoutAxis): boolean {
  if (node.type === "Spacer") return axis === "horizontal";
  if (WIDTH_CONSUMING_TYPES.has(node.type)) return true;
  if (frameLayout(node.modifiers)?.fillX) return true;
  const next = childAxis(node, axis);
  return node.children.some((child) => viewWantsFullWidth(child, next));
}

/** Tailwind classes for a view that must span the container width. */
export function fullWidthClasses(axis: LayoutAxis): string[] {
  return axis === "horizontal"
    ? ["flex-1", "basis-0", "min-w-0", "self-stretch"]
    : ["w-full", "max-w-full", "self-stretch"];
}
