/**
 * layout.ts — SwiftUI frame semantics → CSS/Tailwind layout contract.
 *
 * `.frame(maxWidth: .infinity)` is SwiftUI's idiom for "fill the parent", but
 * the AST only records the raw `.infinity` sentinel inside the modifier args.
 * This module turns that AST shape into the layout intent both engines need:
 *
 *   - which axis the view must fill (X / Y),
 *   - whether the view must flex-grow along the parent stack's main axis,
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
  /** The view grows along a row's / column's main axis (like a Spacer). */
  growX: boolean;
  growY: boolean;
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
    growX: minWidth === "infinity" || maxWidth === "infinity",
    growY: minHeight === "infinity" || maxHeight === "infinity",
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
 * Views that consume the offered width even without a frame: a Spacer, a
 * greedy `Color` fill or a flexible control. Shared with the stack renderer so
 * "this subtree wants the full width" has one definition.
 */
export const FLEXIBLE_WIDTH_TYPES = new Set([
  "Spacer", "Color", "Material", "TextField", "SecureField", "TextEditor", "Slider",
]);

/**
 * True when the node (or any descendant) asks for the full available width —
 * either through a `.frame(maxWidth: .infinity)` or a greedy child. A Button
 * whose label fills the width must itself fill the width, which is the
 * idiomatic SwiftUI recipe for a full-width button.
 */
export function viewWantsFullWidth(node: RNode): boolean {
  if (FLEXIBLE_WIDTH_TYPES.has(node.type)) return true;
  if (frameLayout(node.modifiers)?.fillX) return true;
  return node.children.some(viewWantsFullWidth);
}

/** Tailwind classes for a view that must span the container width. */
export function fullWidthClasses(axis: LayoutAxis): string[] {
  return axis === "horizontal"
    ? ["flex-1", "basis-0", "min-w-0", "self-stretch"]
    : ["w-full", "max-w-full", "self-stretch"];
}
