/**
 * design.ts — SwiftUI design-system facts used by the preview renderer.
 *
 * The numbers here mirror Apple's documented Human Interface Guidelines
 * values (system colours, Dynamic Type text styles, default spacing) so the
 * canvas matches a real iOS 17 device as closely as a browser can.
 */

import type { Value } from "./evaluator.ts";
import { isAngle, isColor, isFont, isGradient, isImplicit, isMaterial } from "./evaluator.ts";

/* ────────────────────────────── Colours ────────────────────────────── */

/** iOS system colours (light appearance). */
export const SYSTEM_COLORS: Record<string, string> = {
  red: "#FF3B30",
  orange: "#FF9500",
  yellow: "#FFCC00",
  green: "#34C759",
  mint: "#00C7BE",
  teal: "#30B0C7",
  cyan: "#32ADE6",
  blue: "#007AFF",
  indigo: "#5856D6",
  purple: "#AF52DE",
  pink: "#FF2D55",
  brown: "#A2845E",
  black: "#000000",
  white: "#FFFFFF",
  gray: "#8E8E93",
  clear: "transparent",
};

export const FIXED_GRAY: Record<number, string> = {
  2: "#F2F2F7",
  3: "#E5E5EA",
  4: "#D1D1D6",
  5: "#C7C7CC",
  6: "#AEAEB2",
};

/** Semantic and UIKit colours (light appearance). */
export const SEMANTIC_COLORS: Record<string, string> = {
  primary: "#000000",
  secondary: "rgba(60,60,67,0.6)",
  tertiary: "rgba(60,60,67,0.3)",
  quaternary: "rgba(60,60,67,0.18)",
  label: "#000000",
  secondaryLabel: "rgba(60,60,67,0.6)",
  tertiaryLabel: "rgba(60,60,67,0.3)",
  placeholderText: "rgba(60,60,67,0.3)",
  separator: "rgba(60,60,67,0.29)",
  opaqueSeparator: "#C6C6C8",
  link: "#007AFF",
  systemBackground: "#FFFFFF",
  secondarySystemBackground: "#F2F2F7",
  tertiarySystemBackground: "#FFFFFF",
  systemGroupedBackground: "#F2F2F7",
  secondarySystemGroupedBackground: "#FFFFFF",
  systemFill: "rgba(120,120,128,0.2)",
  secondarySystemFill: "rgba(120,120,128,0.16)",
  systemGray: "#8E8E93",
  systemGray2: "#AEAEB2",
  systemGray3: "#C7C7CC",
  systemGray4: "#D1D1D6",
  systemGray5: "#E5E5EA",
  systemGray6: "#F2F2F7",
};

export const MATERIALS: Record<string, { background: string; filter: string }> = {
  ultraThin: { background: "rgba(255,255,255,0.44)", filter: "blur(18px) saturate(1.6)" },
  thin: { background: "rgba(255,255,255,0.6)", filter: "blur(20px) saturate(1.8)" },
  regular: { background: "rgba(255,255,255,0.72)", filter: "blur(24px) saturate(1.8)" },
  thick: { background: "rgba(255,255,255,0.82)", filter: "blur(28px) saturate(1.8)" },
  ultraThick: { background: "rgba(255,255,255,0.92)", filter: "blur(32px) saturate(1.8)" },
  bar: { background: "rgba(249,249,249,0.94)", filter: "blur(20px) saturate(1.8)" },
};

/** Resolve any SwiftUI colour-ish value into a CSS colour string. */
export function cssColor(value: Value | undefined): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    const key = value.replace(/^\./, "");
    if (key in SYSTEM_COLORS) return SYSTEM_COLORS[key];
    if (key in SEMANTIC_COLORS) return SEMANTIC_COLORS[key];
    return value.startsWith("#") || value.startsWith("rgb") || value.includes("(")
      ? value
      : null;
  }

  if (isColor(value)) {
    if (value.name in SYSTEM_COLORS) {
      const base = SYSTEM_COLORS[value.name];
      if (value.alpha >= 1 || base === "transparent") return base;
      return withAlpha(base, value.alpha);
    }
    if (value.name in SEMANTIC_COLORS) return SEMANTIC_COLORS[value.name];
    if (value.rgb) {
      const [r, g, b] = value.rgb;
      return value.alpha >= 1
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${value.alpha})`;
    }
    return null;
  }

  if (isImplicit(value)) {
    const name = value.path[value.path.length - 1] ?? "";
    const stripped = value.path.filter(
      (p) => !["Color", "ShapeStyle", "opacity"].includes(p),
    );
    for (const candidate of [name, ...stripped]) {
      if (candidate in SYSTEM_COLORS) return SYSTEM_COLORS[candidate];
      if (candidate in SEMANTIC_COLORS) return SEMANTIC_COLORS[candidate];
    }
    const grayMatch = name.match(/^systemGray([2-6])$/);
    if (grayMatch) return FIXED_GRAY[Number(grayMatch[1])] ?? "#8E8E93";
    return null;
  }

  return null;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = Number.parseInt(color.slice(1, 3), 16);
    const g = Number.parseInt(color.slice(3, 5), 16);
    const b = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
  return color;
}

/** CSS gradient for a SwiftUI gradient value. */
export function cssGradient(value: Value): string | null {
  if (!isGradient(value)) return null;
  const stops = value.colors
    .map((color, index, all) => {
      const css = cssColor(color) ?? "#000000";
      const percent = all.length > 1 ? (index / (all.length - 1)) * 100 : 0;
      return `${css} ${percent.toFixed(1)}%`;
    })
    .join(", ");

  if (value.kind === "radial") return `radial-gradient(circle at center, ${stops})`;
  if (value.kind === "angular") return `conic-gradient(from 0deg at center, ${stops})`;

  const angle = pointToAngle(value.startPoint, value.endPoint);
  return `linear-gradient(${angle}deg, ${stops})`;
}

/**
 * CSS gradient from a `LinearGradient(colors:startPoint:endPoint:)` view's
 * evaluated arguments (used when the gradient is itself a view in the tree).
 */
export function cssGradientStops(
  kind: "linear" | "radial" | "angular",
  colors: string[],
  startPoint = "top",
  endPoint = "bottom",
): string {
  const stops = colors.length > 0 ? colors : ["#000000"];
  const joined = stops
    .map((color, index, all) => {
      const percent = all.length > 1 ? (index / (all.length - 1)) * 100 : 0;
      return `${color} ${percent.toFixed(1)}%`;
    })
    .join(", ");

  if (kind === "radial") return `radial-gradient(circle at center, ${joined})`;
  if (kind === "angular") return `conic-gradient(from 0deg at center, ${joined})`;
  return `linear-gradient(${pointToAngle(startPoint, endPoint)}deg, ${joined})`;
}

function pointToAngle(start: string, end: string): number {
  const vectors: Record<string, [number, number]> = {
    top: [0, -1],
    bottom: [0, 1],
    leading: [-1, 0],
    trailing: [1, 0],
    topLeading: [-1, -1],
    topTrailing: [1, -1],
    bottomLeading: [-1, 1],
    bottomTrailing: [1, 1],
    center: [0, 0],
  };
  const a = vectors[start] ?? [0, -1];
  const b = vectors[end] ?? [0, 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Number.isFinite(deg) ? Math.round(deg) : 180;
}

export function cssMaterial(value: Value): { background: string; filter: string } | null {
  if (isMaterial(value)) {
    return MATERIALS[value.name] ?? MATERIALS.regular;
  }
  if (isImplicit(value)) {
    const name = value.path[value.path.length - 1] ?? "";
    for (const key of Object.keys(MATERIALS)) {
      if (name.toLowerCase().includes(key.toLowerCase())) return MATERIALS[key];
    }
    if (name.toLowerCase().includes("material")) return MATERIALS.regular;
  }
  return null;
}

/* ────────────────────────────── Typography ────────────────────────────── */

export interface TextStyle {
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing?: number;
}

/** iOS 17 Dynamic Type defaults for the default (Large) content size. */
export const TEXT_STYLES: Record<string, TextStyle> = {
  largeTitle: { size: 34, weight: 400, lineHeight: 41, letterSpacing: 0.4 },
  title: { size: 28, weight: 400, lineHeight: 34, letterSpacing: 0.36 },
  title2: { size: 22, weight: 400, lineHeight: 28, letterSpacing: -0.26 },
  title3: { size: 20, weight: 400, lineHeight: 25, letterSpacing: -0.45 },
  headline: { size: 17, weight: 600, lineHeight: 22, letterSpacing: -0.41 },
  body: { size: 17, weight: 400, lineHeight: 22, letterSpacing: -0.41 },
  callout: { size: 16, weight: 400, lineHeight: 21, letterSpacing: -0.32 },
  subheadline: { size: 15, weight: 400, lineHeight: 20, letterSpacing: -0.24 },
  footnote: { size: 13, weight: 400, lineHeight: 18, letterSpacing: -0.08 },
  caption: { size: 12, weight: 400, lineHeight: 16, letterSpacing: 0 },
  caption2: { size: 11, weight: 400, lineHeight: 13, letterSpacing: 0.07 },
};

export const FONT_WEIGHTS: Record<string, number> = {
  ultraLight: 100,
  thin: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,
};

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface ResolvedFont extends TextStyle {
  design?: string;
  italic?: boolean;
  monospaced?: boolean;
  /** Set when the font came from `.font(.system(...))` */
  custom?: boolean;
}

/** Resolve a `.font(...)` value to concrete metrics. */
export function resolveFont(value: Value | undefined, fallbackSize = 17): ResolvedFont {
  const fallback: ResolvedFont = { ...TEXT_STYLES.body, size: fallbackSize };

  if (value === undefined || value === null) return fallback;

  if (isFont(value)) {
    const style = value.style && TEXT_STYLES[value.style] ? TEXT_STYLES[value.style] : undefined;
    const size = value.size ?? style?.size ?? fallbackSize;
    const weight = value.weight ? FONT_WEIGHTS[value.weight] ?? 400 : style?.weight ?? 400;
    return {
      size,
      weight,
      lineHeight: Math.round(size * 1.29),
      letterSpacing: style?.letterSpacing,
      ...(value.design ? { design: value.design } : {}),
      ...(value.italic ? { italic: true } : {}),
      ...(value.monospaced ? { monospaced: true } : {}),
      custom: true,
    };
  }

  if (isImplicit(value)) {
    const parts = value.path.filter((p) => p !== "Font");
    const style = parts.find((p) => p in TEXT_STYLES);
    const base = style ? { ...TEXT_STYLES[style] } : { ...fallback };
    const weightName = parts.find((p) => p in FONT_WEIGHTS);
    const design = parts.find((p) => ["rounded", "serif", "monospaced"].includes(p));
    return {
      ...base,
      weight: weightName ? FONT_WEIGHTS[weightName] : base.weight,
      ...(design ? { design } : {}),
      ...(parts.includes("italic") ? { italic: true } : {}),
    };
  }

  if (typeof value === "string") {
    if (value in TEXT_STYLES) return { ...TEXT_STYLES[value] };
    return fallback;
  }

  return fallback;
}

export function cssFontFamily(font: ResolvedFont): string {
  if (font.monospaced || font.design === "monospaced") {
    return '"SF Mono", ui-monospace, Menlo, Consolas, "Cascadia Code", monospace';
  }
  return FONT_STACK;
}

/* ────────────────────────────── Spacing & shapes ────────────────────────────── */

export const METRICS = {
  screenWidth: 393,
  screenHeight: 852,
  safeAreaTop: 59,
  safeAreaBottom: 34,
  defaultStackSpacing: 8,
  defaultPadding: 16,
  navigationBarHeight: 44,
  tabBarHeight: 49,
  listRowHeight: 44,
};

export function shadowFromArgs(
  color: Value | undefined,
  radius: number,
  x: number,
  y: number,
): string {
  const css = cssColor(color) ?? "rgba(0,0,0,0.33)";
  return `${x}px ${y}px ${radius}px ${css}`;
}

/** `.rotationEffect(.degrees(x))` → degrees. */
export function toDegrees(value: Value | undefined, fallback = 0): number {
  if (isAngle(value)) return value.degrees;
  if (typeof value === "number") return value;
  return fallback;
}

/* ────────────────────────────── SF Symbols ────────────────────────────── */

/**
 * Hand-drawn approximations of common SF Symbols, expressed as compact
 * drawing commands:
 *   "M…"  → stroked path
 *   "F:…" → filled path
 *   "C x y r" → stroked circle
 *   "D x y r" → filled circle
 */
const ICONS: Record<string, string[]> = {
  "chevron.left": ["M15 5 8 12l7 7"],
  "chevron.right": ["M9 5l7 7-7 7"],
  "chevron.up": ["M5 15l7-7 7 7"],
  "chevron.down": ["M5 9l7 7 7-7"],
  "chevron.forward": ["M9 5l7 7-7 7"],
  "chevron.backward": ["M15 5 8 12l7 7"],
  "chevron.left.forwardslash.chevron.right": ["M9 5 4 12l5 7", "M15 5l5 7-5 7"],
  plus: ["M12 5v14M5 12h14"],
  "plus.circle": ["C 12 12 9", "M12 8.5v7M8.5 12h7"],
  minus: ["M5 12h14"],
  "minus.circle": ["C 12 12 9", "M8.5 12h7"],
  xmark: ["M6 6l12 12M18 6 6 18"],
  "xmark.circle": ["C 12 12 9", "M9 9l6 6M15 9l-6 6"],
  "xmark.circle.fill": ["D 12 12 10", "M9 9l6 6M15 9l-6 6"],
  checkmark: ["M5 13l4.5 4.5L19 6.5"],
  "checkmark.circle": ["C 12 12 9", "M8 12.5l3 3 5-6"],
  "checkmark.circle.fill": ["D 12 12 10", "M8 12.5l3 3 5-6"],
  "checkmark.seal": ["F:M12 3l2.2 2 3-.3 1 2.8 2.6 1.5-1 2.9 1 2.9-2.6 1.5-1 2.8-3-.3-2.2 2-2.2-2-3 .3-1-2.8L3.2 15l1-2.9-1-2.9 2.6-1.5 1-2.8 3 .3z", "M9 12.4l2.2 2.2 4-4.6"],
  magnifyingglass: ["C 11 11 6", "M15.4 15.4 20 20"],
  "magnifyingglass.circle": ["C 12 12 9", "C 11 11 3.6", "M13.6 13.6 17 17"],
  house: ["M4 10.7 12 4l8 6.7V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"],
  "house.fill": ["F:M4 10.7 12 4l8 6.7V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"],
  gearshape: ["C 12 12 3.2", "M12 5.6v-2M12 20.4v-2M5.6 12h-2M20.4 12h-2M7.5 7.5 6 6M18 18l-1.5-1.5M16.5 7.5 18 6M6 18l1.5-1.5"],
  gear: ["C 12 12 3.2", "M12 4.8V3M12 21v-1.8M4.8 12H3M21 12h-1.8M7 7 5.8 5.8M18.2 18.2 17 17M17 7l1.2-1.2M5.8 18.2 7 17"],
  person: ["C 12 8 3.6", "M5 20c0-3.7 3.1-5.8 7-5.8s7 2.1 7 5.8"],
  "person.fill": ["D 12 8 4", "F:M5 20c0-3.7 3.1-5.8 7-5.8s7 2.1 7 5.8z"],
  "person.circle": ["C 12 12 9", "C 12 9.4 2.6", "M7.5 16.6c1-1.6 2.6-2.4 4.5-2.4s3.5.8 4.5 2.4"],
  "person.2": ["C 9.5 8.5 3.2", "M3.5 19c0-3.1 2.7-4.9 6-4.9s6 1.8 6 4.9", "C 17 9.2 2.6", "M16 14.4c2.6.3 4.5 1.7 4.5 4.6"],
  star: ["F:M12 2.6l2.9 6 6.4.9-4.6 4.55 1.1 6.35L12 17.3l-5.8 3.1 1.1-6.35L2.7 9.5l6.4-.9z"],
  "star.fill": ["F:M12 2.6l2.9 6 6.4.9-4.6 4.55 1.1 6.35L12 17.3l-5.8 3.1 1.1-6.35L2.7 9.5l6.4-.9z"],
  heart: ["M12 20.3S3.9 15.4 3.9 10.2A4.6 4.6 0 0 1 12 7.3a4.6 4.6 0 0 1 8.1 2.9c0 5.2-8.1 10.1-8.1 10.1z"],
  "heart.fill": ["F:M12 20.3S3.9 15.4 3.9 10.2A4.6 4.6 0 0 1 12 7.3a4.6 4.6 0 0 1 8.1 2.9c0 5.2-8.1 10.1-8.1 10.1z"],
  bell: ["M6.5 17h11l-1.4-2.2v-4.1a4.1 4.1 0 1 0-8.2 0v4.1z", "M10.3 19.4a1.9 1.9 0 0 0 3.4 0"],
  "bell.fill": ["F:M6.5 17.2h11l-1.4-2.3v-4.2a4.1 4.1 0 1 0-8.2 0v4.2z", "F:M10.3 19.4a1.9 1.9 0 0 0 3.4 0z"],
  envelope: ["M3 6h18v12.5H3z", "M3.4 6.8 12 13l8.6-6.2"],
  "envelope.fill": ["F:M3 6h18v12.5H3z", "M3.4 6.9 12 13.2l8.6-6.3"],
  calendar: ["M4 6.5h16V21H4z", "M4 10.6h16M8.2 4v4.2M15.8 4v4.2"],
  clock: ["C 12 12 8.6", "M12 7.2v5.1l3.6 2.1"],
  bookmark: ["M7 4h10v16.5L12 17 7 20.5z"],
  "bookmark.fill": ["F:M7 4h10v16.5L12 17 7 20.5z"],
  trash: ["M5 7h14M9.2 7V4.6h5.6V7M6.4 7l.9 12.4h9.4L17.6 7", "M10.2 10.4v6M13.8 10.4v6"],
  pencil: ["M4 20l1-4.2L16.6 4.2l3.2 3.2L8.2 19z", "M15.2 5.6l3.2 3.2"],
  "square.and.pencil": ["M4 20h6", "M13.5 4.5 19.5 10.5 10 20H4v-6z"],
  "square.and.arrow.up": ["M12 3.5v11", "M8.2 7.3 12 3.5l3.8 3.8", "M5.5 13v7h13v-7"],
  "square.and.arrow.down": ["M12 14.5v-11", "M8.2 10.7 12 14.5l3.8-3.8", "M5.5 13v7h13v-7"],
  "arrow.right": ["M4 12h15", "M13.4 6.4 19 12l-5.6 5.6"],
  "arrow.left": ["M20 12H5", "M10.6 6.4 5 12l5.6 5.6"],
  "arrow.up": ["M12 20V5", "M6.4 10.6 12 5l5.6 5.6"],
  "arrow.down": ["M12 4v15", "M6.4 13.4 12 19l5.6-5.6"],
  "arrow.up.right": ["M6 18 18 6", "M10.5 6H18v7.5"],
  "arrow.up.right.square": ["M4.5 4.5h9v9h-9z", "M10.5 10.5 19.5 1.5M15 1.5h4.5V6"],
  "arrow.clockwise": ["M20.2 12a8.2 8.2 0 1 1-2.4-5.8", "M20.4 3.6v5.6h-5.6"],
  "arrow.triangle.2.circlepath": ["M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3", "M20 4v5h-5M4 20v-5h5"],
  "arrow.uturn.backward": ["M9 6 4 11l5 5", "M4 11h10a5.5 5.5 0 0 1 0 11h-2"],
  ellipsis: ["D 6 12 1.5", "D 12 12 1.5", "D 18 12 1.5"],
  "ellipsis.circle": ["C 12 12 9", "D 8 12 1.3", "D 12 12 1.3", "D 16 12 1.3"],
  "line.3.horizontal": ["M4 7h16M4 12h16M4 17h16"],
  "list.bullet": ["D 5.5 7 1.2", "D 5.5 12 1.2", "D 5.5 17 1.2", "M10 7h10M10 12h10M10 17h10"],
  "square.grid.2x2": ["M4.5 4.5h6v6h-6z", "M13.5 4.5h6v6h-6z", "M4.5 13.5h6v6h-6z", "M13.5 13.5h6v6h-6z"],
  "rectangle.grid.1x2": ["M4 4.5h16v6H4z", "M4 13.5h16v6H4z"],
  folder: ["M3 6.5h6.2l2 2.5H21v10H3z"],
  "folder.fill": ["F:M3 6.5h6.2l2 2.5H21v10H3z"],
  doc: ["M6.5 3h7.5l4 4v14h-11z", "M14 3v4h4"],
  "doc.text": ["M6.5 3h7.5l4 4v14h-11z", "M14 3v4h4", "M9.5 12h6M9.5 15.5h6"],
  "doc.text.fill": ["F:M6.5 3h7.5l4 4v14h-11z", "M9.5 12h6M9.5 15.5h6"],
  lock: ["M7.2 11V8.2a4.8 4.8 0 0 1 9.6 0V11", "M5.5 11h13v9.5h-13z"],
  "lock.fill": ["F:M7.2 11V8.2a4.8 4.8 0 0 1 9.6 0V11z", "F:M5.5 11h13v9.5h-13z"],
  "lock.open": ["M7.2 11V8.2a4.8 4.8 0 0 1 9.3-1.6", "M5.5 11h13v9.5h-13z"],
  eye: ["M2.8 12S6.6 6.4 12 6.4 21.2 12 21.2 12 17.4 17.6 12 17.6 2.8 12 2.8 12z", "C 12 12 2.8"],
  "eye.slash": ["M4 5l16 14", "M9.5 6.8A9.8 9.8 0 0 1 12 6.4c5.4 0 9.2 5.6 9.2 5.6a17 17 0 0 1-3.6 4", "M6.4 8.4A16.6 16.6 0 0 0 2.8 12s3.8 5.6 9.2 5.6a9.6 9.6 0 0 0 3.4-.6"],
  gearshape2: ["C 12 12 8.6", "M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"],
  wrench: ["M14.5 4.2a4.6 4.6 0 0 1 5.6 5.8l-2.4-2.4-2.6 2.6-2.4-2.4 2.6-2.6z", "M12.6 9 4.5 17.1a1.8 1.8 0 0 0 2.5 2.5L15 11.5"],
  hammer: ["M4 20.5 12 12.5", "M9.5 4.5l8.6 8.6 2.4-2.4-8.6-8.6z"],
  paintbrush: ["M5 19.5c2.6 0 4.4-1.4 4.4-3.6 0-1.6-1.2-2.6-2.6-2.6-2 0-2.4 1.4-3.6 1.4", "M9.5 14.5 19.5 4.5l2 2-10 10"],
  scissors: ["C 6.5 6.5 2.4", "C 6.5 17.5 2.4", "M8.6 8.4 19 19M8.6 15.6 19 5"],
  key: ["C 8 10 3.6", "M10.7 12.7 20.5 3M16.5 3.5l2.5 2.5M14 6l2.5 2.5"],
  shield: ["M12 3l7.5 2.8v6c0 4.6-3.1 7.9-7.5 9.2-4.4-1.3-7.5-4.6-7.5-9.2v-6z"],
  "shield.fill": ["F:M12 3l7.5 2.8v6c0 4.6-3.1 7.9-7.5 9.2-4.4-1.3-7.5-4.6-7.5-9.2v-6z"],
  "hand.thumbsup": ["M7 10.6 11.4 3a2.2 2.2 0 0 1 2.1 2.6l-.6 3.4h4.6a1.8 1.8 0 0 1 1.8 2.2l-1.2 6.2A2.2 2.2 0 0 1 15.9 19H7", "M7 10.6H4v8.4h3z"],
  "hand.thumbsdown": ["M17 13.4 12.6 21a2.2 2.2 0 0 1-2.1-2.6l.6-3.4H6.5a1.8 1.8 0 0 1-1.8-2.2l1.2-6.2A2.2 2.2 0 0 1 8.1 5H17", "M17 13.4h3V5h-3z"],
  "hand.raised": ["M8 11V5.6a1.6 1.6 0 0 1 3.2 0V11", "M11.2 10.6V4.6a1.6 1.6 0 0 1 3.2 0v6", "M14.4 10.8V6.6a1.6 1.6 0 0 1 3.2 0V13a7 7 0 0 1-7 7h-1.2A6.4 6.4 0 0 1 4 13.6v-2a1.6 1.6 0 0 1 3.2 0"],
  "face.smiling": ["C 12 12 9", "D 9 10.2 1", "D 15 10.2 1", "M8.4 14.6a4.4 4.4 0 0 0 7.2 0"],
  "figure.walk": ["D 12.4 6.4 1.7", "M9.4 21.5 12 15.6l3.4 3.4v4.5", "M12 15.6 9.4 11l5-2.8 3 3.4 3.4.8"],
  car: ["M5 12.5 6.6 7h10.8L19 12.5", "M4 12.5h16v5h-16z", "D 7.4 15.6 1", "D 16.6 15.6 1"],
  "car.fill": ["F:M5 12.5 6.6 7h10.8L19 12.5z", "F:M4 12.5h16v5H4z"],
  airplane: ["M12 3c.9 0 1.5.8 1.5 1.8v4.4l6.5 3.8v2.2l-6.5-2v3.6l2.2 1.7v1.9L12 19l-3.7 1.4v-1.9l2.2-1.7v-3.6l-6.5 2v-2.2l6.5-3.8V4.8C10.5 3.8 11.1 3 12 3z"],
  tram: ["M6 4.5h12v11H6z", "M8.5 4.5l1-2h5l1 2", "M8 15.5 6 20M16 15.5 18 20", "D 9 12.2 1", "D 15 12.2 1"],
  bus: ["M5 4.5h14v12H5z", "M5 10.5h14", "D 8 18.5 1.3", "D 16 18.5 1.3"],
  bicycle: ["C 6.5 16.5 3.6", "C 17.5 16.5 3.6", "M9 16.5 12 8.5l3.5 8M9.5 9.5h5.5M12 8.5l1.5-2.5h2"],
  gift: ["M4 9.5h16V20H4z", "M3 6.5h18v3H3z", "M12 6.5V20", "M12 6.5S10.6 2.6 8.4 3.4c-1.7.6-1 2.8 3.6 3.1M12 6.5s1.4-3.9 3.6-3.1c1.7.6 1 2.8-3.6 3.1"],
  "gift.fill": ["F:M4 9.5h16V20H4z", "F:M3 6.5h18v3H3z"],
  ticket: ["M4 7.5h16v3.4a2.1 2.1 0 0 0 0 4.2v3.4H4v-3.4a2.1 2.1 0 0 0 0-4.2z", "M13.4 7.5v11.4"],
  crown: ["M4 18.5h16l1.4-9.2-5.2 3.1L12 6l-4.2 6.4-5.2-3.1z"],
  "crown.fill": ["F:M4 18.5h16l1.4-9.2-5.2 3.1L12 6l-4.2 6.4-5.2-3.1z"],
  trophy: ["M8 4.5h8v5a4 4 0 0 1-8 0z", "M8 5.5H5.5v2A3 3 0 0 0 8 10.5M16 5.5h2.5v2A3 3 0 0 1 16 10.5", "M12 12.5v3M9 19.5h6M10 15.5h4l.6 4h-5.2z"],
  "trophy.fill": ["F:M7.5 4h9v5.5a4.5 4.5 0 0 1-9 0z", "F:M9 15.5h6l.6 4H8.4z"],
  gamecontroller: ["M7.5 7.5h9a5.5 5.5 0 0 1 5.4 6.6l-.5 2.6a2 2 0 0 1-3.4 1.1L15.6 16h-7.2L6 17.8a2 2 0 0 1-3.4-1.1l-.5-2.6A5.5 5.5 0 0 1 7.5 7.5z", "M8.5 11v3M7 12.5h3", "D 16 11.4 1.1", "D 17.8 13.4 1.1"],
  paperplane: ["M3.4 11.2 21 4l-7 17-2.6-7z", "M11.4 14 21 4"],
  "paperplane.fill": ["F:M3.4 11.2 21 4l-7 17-2.6-7z"],
  message: ["M4 5h16v11H9.5L4 20z"],
  "message.fill": ["F:M4 5h16v11H9.5L4 20z"],
  "bubble.left": ["M3.5 6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5V14A2.5 2.5 0 0 1 18 16.5H9l-5.5 4z"],
  phone: ["M7 3.2h2.8l1.7 4.2-2 1.4a11.4 11.4 0 0 0 5.7 5.7l1.4-2 4.2 1.7V17a2.4 2.4 0 0 1-2.4 2.4A15.4 15.4 0 0 1 4.6 4.9 2.4 2.4 0 0 1 7 3.2z"],
  "phone.fill": ["F:M7 3.2h2.8l1.7 4.2-2 1.4a11.4 11.4 0 0 0 5.7 5.7l1.4-2 4.2 1.7V17a2.4 2.4 0 0 1-2.4 2.4A15.4 15.4 0 0 1 4.6 4.9 2.4 2.4 0 0 1 7 3.2z"],
  video: ["M3.5 7.5h11v9h-11z", "M14.5 10.5l6-3v9l-6-3z"],
  mic: ["M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z", "M6.5 11.5V12a5.5 5.5 0 0 0 11 0v-.5M12 17.5v3M9 20.5h6"],
  headphones: ["M4.5 15.5v-3a7.5 7.5 0 0 1 15 0v3", "M4.5 13.5h2.6v6H6a1.5 1.5 0 0 1-1.5-1.5zM19.5 13.5h-2.6v6H18a1.5 1.5 0 0 0 1.5-1.5z"],
  "music.note": ["M9.5 18V5.4l9-2.2V16", "C 7.2 18 2.6", "C 16.7 16 2.6"],
  play: ["F:M7 4.5 19 12 7 19.5z"],
  "play.fill": ["F:M7 4.5 19 12 7 19.5z"],
  "play.circle": ["C 12 12 9", "F:M10 8.4 16 12l-6 3.6z"],
  pause: ["M8 5h3v14H8zM13 5h3v14h-3z"],
  "pause.fill": ["F:M8 5h3v14H8zM13 5h3v14h-3z"],
  stop: ["M6.5 6.5h11v11h-11z"],
  "stop.fill": ["F:M6.5 6.5h11v11h-11z"],
  forward: ["F:M6 5l9 7-9 7z", "M14 5h3v14h-3z"],
  backward: ["F:M18 5l-9 7 9 7z", "M7 5h3v14H7z"],
  shuffle: ["M4 7h3.5l9 10H20", "M4 17h3.5l3-3.4", "M16.6 4.4 20 7l-3.4 2.6", "M16.6 14.4 20 17l-3.4 2.6"],
  repeat: ["M6 8h9.5a3.5 3.5 0 0 1 3.5 3.5", "M8.5 5.5 6 8l2.5 2.5", "M18 16H8.5A3.5 3.5 0 0 1 5 12.5", "M15.5 18.5 18 16l-2.5-2.5"],
  photo: ["M3.5 5.5h17v13h-17z", "M3.5 15.5 9 10l4.5 5 3-2.5 4 4", "D 8.4 9 1.4"],
  "photo.fill": ["F:M3.5 5.5h17v13h-17z", "M3.5 15.5 9 10l4.5 5 3-2.5 4 4"],
  camera: ["M3.5 8h4l1.5-2.5h6L16.5 8h4v11h-17z", "C 12 14 4"],
  location: ["M12 21.2s6.4-6.8 6.4-11.4a6.4 6.4 0 1 0-12.8 0C5.6 14.4 12 21.2 12 21.2z", "C 12 9.8 2.3"],
  mappin: ["M12 21.2s6.4-6.8 6.4-11.4a6.4 6.4 0 1 0-12.8 0C5.6 14.4 12 21.2 12 21.2z", "D 12 10 2.6"],
  map: ["M3.5 6.5 9 4.5l6 2.5 5.5-2v13l-5.5 2-6-2.5-5.5 2z", "M9 4.5v13M15 7v13"],
  cart: ["M3.5 5h2.2l2.4 10.5h10l2.2-7.5H6.4", "D 9 19 1.3", "D 16 19 1.3"],
  "cart.fill": ["F:M3.5 5h2.2l2.4 10.5h10l2.2-7.5H6.4z", "D 9 19 1.4", "D 16 19 1.4"],
  bag: ["M5.5 7.5h13l1 13h-15z", "M8.8 7.5V5.6a3.2 3.2 0 0 1 6.4 0v1.9"],
  creditcard: ["M2.5 6.5h19v11h-19z", "M2.5 10.5h19M6 14.5h4"],
  dollarsign: ["M12 3.5v17", "M15.6 7.4A3.4 3.4 0 0 0 12 5.8c-2 0-3.4 1-3.4 2.6 0 1.7 1.4 2.3 3.6 2.8 2.4.5 3.8 1.2 3.8 3 0 1.8-1.6 2.9-3.8 2.9a4 4 0 0 1-3.8-1.8"],
  "dollarsign.circle": ["C 12 12 9", "M12 6.6v10.8", "M14.4 9A2.6 2.6 0 0 0 12 7.6c-1.5 0-2.5.8-2.5 2s1 1.7 2.6 2.1c1.8.4 2.8.9 2.8 2.2s-1.2 2.2-2.9 2.2A3 3 0 0 1 9.3 15"],
  wifi: ["M3 9.5a13 13 0 0 1 18 0", "M6.5 13a8 8 0 0 1 11 0", "M9.8 16.4a3.4 3.4 0 0 1 4.4 0", "D 12 19.4 1"],
  "antenna.radiowaves.left.and.right": ["M4.5 9a11 11 0 0 1 15 0", "M7.5 12a7 7 0 0 1 9 0", "D 12 17 1.6", "M2.5 12v-2M21.5 12v-2"],
  "battery.100": ["M3 8h15.5v8H3z", "M20 10.5h1.5v3H20z", "F:M4.5 9.5h9v5h-9z"],
  bolt: ["M13.4 2.5 4.5 14h6l-1.2 7.5L19.5 10h-6z"],
  "bolt.fill": ["F:M13.4 2.5 4.5 14h6l-1.2 7.5L19.5 10h-6z"],
  flame: ["M12 3.2c3.2 4 6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 2.8-6.2 6-10.2z", "M12 20a2.9 2.9 0 0 0 2.9-2.9c0-2-1.6-3-2.9-4.9-1.3 1.9-2.9 2.9-2.9 4.9A2.9 2.9 0 0 0 12 20z"],
  "flame.fill": ["F:M12 3.2c3.2 4 6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 2.8-6.2 6-10.2z"],
  leaf: ["M5 19.5c8.5 1 14-3.5 14-13.5-9 0-14.5 3-14.5 9 0 1.9.5 3.5 1.5 4.5z", "M5 19.5 12.5 12"],
  drop: ["M12 3.2s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"],
  "sun.max": ["C 12 12 4", "M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"],
  moon: ["M20.4 14.6A8.8 8.8 0 0 1 9.4 3.6 8.9 8.9 0 1 0 20.4 14.6z"],
  "moon.stars": ["M20.4 14.6A8.8 8.8 0 0 1 9.4 3.6 8.9 8.9 0 1 0 20.4 14.6z", "D 17 4 1.2", "D 20 8 1.2", "D 15.5 9 1"],
  cloud: ["M7.5 19a4.5 4.5 0 0 1-.3-9A6 6 0 0 1 18.9 12a3.5 3.5 0 0 1-.6 7z"],
  "cloud.rain": ["M7.5 15.5a4.5 4.5 0 0 1-.3-9A6 6 0 0 1 18.9 8.5a3.5 3.5 0 0 1-.6 7z", "M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"],
  snowflake: ["M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9", "M12 6.5 9.8 4.3M12 6.5l2.2-2.2M12 17.5l-2.2 2.2M12 17.5l2.2 2.2"],
  umbrella: ["M3.5 12a8.5 8.5 0 0 1 17 0z", "M12 12v6.5a2.4 2.4 0 0 0 4.4 1.3"],
  globe: ["C 12 12 9", "M3 12h18", "M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"],
  link: ["M9.5 14.5 14.5 9.5", "M11 7.5l1.8-1.8a3.7 3.7 0 0 1 5.2 5.2L16.2 12.7", "M12.8 16.3 11 18.1a3.7 3.7 0 0 1-5.2-5.2L7.6 11"],
  paperclip: ["M17.5 9.5 10 17a4.2 4.2 0 0 1-6-6l8-8a3 3 0 0 1 4.2 4.2l-7.8 7.8a1.7 1.7 0 0 1-2.4-2.4L13 6.5"],
  printer: ["M7 8.5V4h10v4.5", "M5 8.5h14v8H5z", "M7.5 14h9V20h-9z"],
  externaldrive: ["M3.5 7h17v10h-17z", "M3.5 13h17", "D 7 15.8 1", "D 10.5 15.8 1"],
  icloud: ["M7.8 18.5a4.3 4.3 0 0 1-.3-8.6A6 6 0 0 1 18.9 11.7a3.6 3.6 0 0 1-.7 6.8z"],
  tray: ["M3.5 13.5h5l1 2h5l1-2h5", "M5 5.5h14l2 8v5H3v-5z"],
  archivebox: ["M3.5 6.5h17v4h-17z", "M4.8 10.5h14.4V19H4.8z", "M10 13.5h4"],
  filter: ["M3.5 5.5h17l-6.5 8v6l-4 1.5v-7.5z"],
  "slider.horizontal.3": ["M4 8h9M17 8h3M4 16h3M11 16h9", "D 15 8 2", "D 9 16 2"],
  "chart.bar": ["M4 20h16", "M6.5 20V11h3v9zM11.5 20V4h3v16zM16.5 20v-6h3v6z"],
  "chart.pie": ["C 12 12 8.5", "M12 3.5V12l7.4 4.2", "M12 3.5a8.5 8.5 0 1 0 8.5 8.5"],
  "chart.line.uptrend.xyaxis": ["M4 4v16h16", "M7 15l4-5 3 3 5-6"],
  "graduationcap": ["M2.5 9 12 5l9.5 4-9.5 4z", "M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11", "M20.5 9.5v5"],
  lightbulb: ["M9 17a6 6 0 1 1 6 0v2.5H9z", "M10 21h4", "M10.2 15.8h3.6"],
  sparkles: ["F:M9 4l1.3 3.4L13.8 9l-3.5 1.5L9 14l-1.4-3.5L4.2 9l3.4-1.6z", "F:M17 5l.9 2.3 2.3.9-2.3 1L17 11.4l-.9-2.2-2.3-1 2.3-.9z", "F:M12.5 13.5l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"],
  "wand.and.stars": ["M4 20 15 9", "M13.4 7.4l3.2 3.2", "D 19 5 1.2", "D 20.5 9.5 1", "D 16 10.5 1"],
  flag: ["M6 3.5v17", "M6 4.5h11l-2 3.5 2 3.5H6z"],
  "flag.fill": ["F:M6.5 4h10.8l-2 3.5 2 3.5H6.5z"],
  "flag.checkered": ["M6 3.5v17", "M6 4.5h12l-3 3.5 3 3.5H6z", "F:M6 8h8v3.5H6z"],
  tag: ["M3.5 11.2V4.5h6.7l10 10-6.7 6.7z", "D 7.5 8 1.2"],
  "tag.fill": ["F:M3.5 11.2V4.5h6.7l10 10-6.7 6.7z", "D 7.5 8 1.2"],
  pin: ["M12 21s6-6.6 6-11a6 6 0 1 0-12 0c0 4.4 6 11 6 11z"],
  "pin.fill": ["F:M12 21s6-6.6 6-11a6 6 0 1 0-12 0c0 4.4 6 11 6 11z"],
  "list.number": ["M4 7h1.5v3M4 13h2l-2 3h2M4 19h2l-2 3h2", "M9 8h11M9 14h11M9 20h11"],
  "text.bubble": ["M4 5.5h16v10H9.5L4 19.5z", "M8 9h8M8 12h5"],
  "questionmark.circle": ["C 12 12 9", "M9.6 9.6a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2-2.4 3.4", "D 12 16.8 0.6"],
  "info.circle": ["C 12 12 9", "M12 11v5.5", "D 12 8.2 0.7"],
  "exclamationmark.circle": ["C 12 12 9", "M12 7.5V13", "D 12 16.4 0.7"],
  "exclamationmark.triangle": ["M12 3.5 2.8 20h18.4z", "M12 9.5V14.5", "D 12 17.4 0.7"],
  "exclamationmark.triangle.fill": ["F:M12 3.5 2.8 20h18.4z", "M11 9.5h2v5.5h-2z", "D 12 17.6 1"],
  "checkmark.shield": ["M12 3l7.5 2.8v6c0 4.6-3.1 7.9-7.5 9.2-4.4-1.3-7.5-4.6-7.5-9.2v-6z", "M9 12.4l2.2 2.2 4-4.6"],
  "nose.fill": [],
  "arrow.down.circle": ["C 12 12 9", "M12 7.6v9M8.6 13.4 12 16.8l3.4-3.4"],
  "arrow.up.circle": ["C 12 12 9", "M12 16.4v-9M8.6 10.6 12 7.2l3.4 3.4"],
  "arrow.uturn.left": ["M9 6 4 11l5 5", "M4 11h10a6 6 0 0 1 0 12h-2"],
  "text.alignleft": ["M4 6.5h16M4 12h10M4 17.5h13"],
  "text.aligncenter": ["M4 6.5h16M7 12h10M5.5 17.5h13"],
  "number": ["M6 4 4.5 20M13 4l-1.5 16", "M3.5 9.5h17M3 15h17"],
  "x.squareroot": ["M3.5 13.5 6.5 19 12 6h8.5", "M15 12l5 7M20 12l-5 7"],
  "square.and.arrow.up.on.square": ["M4.5 9.5h9v11h-9z", "M8 6.5V4h9v9h-2.5", "M12 4v5M10 6l2-2 2 2"],
  "seal": ["C 12 12 8.6", "M8.6 12.4l2.2 2.2 4.4-4.8"],
  "shield.lefthalf.filled": ["M12 3l7.5 2.8v6c0 4.6-3.1 7.9-7.5 9.2-4.4-1.3-7.5-4.6-7.5-9.2v-6z", "F:M12 3v17.2c4.4-1.3 7.5-4.6 7.5-9.2v-6z"],
  "arrow.triangle.branch": ["M6 4v10a4 4 0 0 0 4 4h8", "M6 4v16", "M15 15l3 3-3 3"],
  "square.stack.3d.up": ["M12 3 3.5 7.5 12 12l8.5-4.5z", "M4.8 12 12 15.8 19.2 12", "M6.8 16 12 18.8 17.2 16"],
  "apple.logo": ["M12.7 3.6c.5-.7 1.3-1.2 2.1-1.2.1.9-.2 1.7-.7 2.3-.5.7-1.3 1.2-2.2 1.1-.1-.8.3-1.6.8-2.2z", "M18.9 17.4c-.4 1-.9 1.9-1.5 2.7-.8 1.1-1.7 1.7-2.6 1.7-.7 0-1.5-.2-2.4-.7-.9-.5-1.6-.7-2.3-.7-.7 0-1.4.2-2.3.7-.9.5-1.6.8-2.2.8-.9 0-1.8-.7-2.7-1.8-2-2.5-3-5.3-3-8.4 0-2 .5-3.7 1.6-5.1 1.1-1.3 2.5-2 4.2-2 .8 0 1.7.2 2.7.7.8.4 1.3.6 1.6.6.2 0 .7-.2 1.6-.6 1-.5 1.9-.7 2.7-.7 1.3.1 2.4.5 3.3 1.4-1.7 1.1-2.6 2.6-2.6 4.4 0 1.5.5 2.8 1.6 3.8.5.5 1 .8 1.7 1-.2.3-.3.5-.4.8z"],
  "applelogo": ["M12.7 3.6c.5-.7 1.3-1.2 2.1-1.2.1.9-.2 1.7-.7 2.3-.5.7-1.3 1.2-2.2 1.1-.1-.8.3-1.6.8-2.2z", "M18.9 17.4c-.4 1-.9 1.9-1.5 2.7-.8 1.1-1.7 1.7-2.6 1.7-.7 0-1.5-.2-2.4-.7-.9-.5-1.6-.7-2.3-.7-.7 0-1.4.2-2.3.7-.9.5-1.6.8-2.2.8-.9 0-1.8-.7-2.7-1.8-2-2.5-3-5.3-3-8.4 0-2 .5-3.7 1.6-5.1 1.1-1.3 2.5-2 4.2-2 .8 0 1.7.2 2.7.7.8.4 1.3.6 1.6.6.2 0 .7-.2 1.6-.6 1-.5 1.9-.7 2.7-.7 1.3.1 2.4.5 3.3 1.4-1.7 1.1-2.6 2.6-2.6 4.4 0 1.5.5 2.8 1.6 3.8.5.5 1 .8 1.7 1-.2.3-.3.5-.4.8z"],
};

/** Unicode fallbacks for symbols without a hand-drawn icon. */
const GLYPHS: Record<string, string> = {
  "star.circle": "✪",
  "star.slash": "☆",
  "suit.heart": "♥",
  "suit.club": "♣",
  "suit.diamond": "♦",
  "suit.spade": "♠",
  "bell.badge": "🔔",
  "checkmark.square": "☑",
  "square": "▢",
  "circle": "○",
  "triangle": "△",
  "diamond": "◇",
  "hexagon": "⬡",
  "seal.fill": "❖",
  "asterisk": "✳",
  "at": "@",
  "number.circle": "#",
  "percent": "%",
  "plusminus": "±",
  "equal": "=",
  "chevron.left.2": "«",
  "chevron.right.2": "»",
  "arrow.up.arrow.down": "⇅",
  "arrow.left.arrow.right": "⇄",
  "arrow.2.circlepath": "⟳",
  "asterisk.circle": "✳",
  "eye.trianglebadge.exclamationmark": "👁",
  "hand.point.up": "☝",
  "hand.point.right": "☞",
  "hand.point.left": "☜",
  "hand.point.down": "☟",
  "quote.bubble": "❝",
  "text.quote": "❞",
  "sunrise": "⛅",
  "light.max": "☀",
  "camera.macro": "◎",
  "circle.lefthalf.filled": "◐",
  "circle.righthalf.filled": "◑",
  "circle.bottomhalf.filled": "◒",
  "circle.tophalf.filled": "◓",
  "square.lefthalf.filled": "◧",
  "square.righthalf.filled": "◨",
  "triangle.lefthalf.filled": "◩",
  "diamond.lefthalf.filled": "◪",
  "rectangle.portrait": "▯",
  "rectangle.fill": "▬",
  "capsule": "⬭",
  "oval": "⬮",
  "scribble": "〰",
  "waveform": "∿",
  "waveform.path": "∿",
  "metronome": "◭",
  "tuningfork": "⊤",
  "pianokeys": "▤",
  "guitars": "🎸",
  "music.mic": "🎤",
  "film": "▦",
  "theatermasks": "🎭",
  "paintpalette": "🎨",
  "eyedropper": "⌖",
  "ruler": "⧉",
  "level": "⬒",
  "move.3d": "✥",
  "scale.3d": "⚖",
  "rotate.3d": "⥁",
  "compass.drawing": "⌖",
  "pencil.and.ruler": "✎",
  "wrench.and.screwdriver": "⚒",
  "hammer.fill": "🔨",
  "cpu": "▣",
  "memorychip": "▤",
  "display": "▭",
  "laptopcomputer": "▭",
  "desktopcomputer": "▭",
  "iphone": "▯",
  "ipad": "▭",
  "applewatch": "⌚",
  "airpods": "◠",
  "keyboard": "⌨",
  "computermouse": "◖",
  "printer.fill": "⎙",
  "scanner": "▤",
  "server.rack": "▥",
  "externaldrive.fill": "▤",
  "internaldrive": "▥",
  "opticaldiscdrive": "◎",
  "memorychip.fill": "▤",
  "network": "⬡",
  "wifi.exclamationmark": "📶",
  "dot.radiowaves.left.and.right": "📡",
  "antenna.radiowaves.left.and.right.slash": "📡",
  "bolt.horizontal": "⚡",
  "bolt.circle": "⚡",
  "battery.0": "▱",
  "battery.25": "▰",
  "battery.50": "▰",
  "battery.75": "▰",
  "power": "⏻",
  "poweroff": "⏼",
  "restart": "⟳",
  "sleep": "☾",
  "moon.zzz": "☾",
  "cup.and.saucer": "☕",
  "fork.knife": "🍴",
  "wineglass": "🍷",
  "birthday.cake": "🎂",
  "carrot": "🥕",
  "fish": "🐟",
  "pawprint": "🐾",
  "tortoise": "🐢",
  "hare": "🐇",
  "dog": "🐕",
  "cat": "🐈",
  "bird": "🐦",
  "ant": "🐜",
  "ladybug": "🐞",
  "butterfly": "🦋",
  "fossil.shell": "🐚",
  "sun.max.fill": "☀",
  "moon.fill": "☾",
  "cloud.fill": "☁",
  "cloud.sun": "⛅",
  "cloud.moon": "☾",
  "smoke": "☁",
  "wind": "≋",
  "tornado": "🌪",
  "thermometer": "🌡",
  "barometer": "◎",
  "humidity": "💧",
  "aqi.medium": "◎",
  "water.waves": "≋",
  "flame.circle": "🔥",
  "sparkle": "✨",
  "star.circle.fill": "✪",
  "circle.grid.2x2": "⊞",
  "circle.grid.3x3": "⊞",
  "circle.hexagongrid": "⬡",
  "square.grid.3x3": "▦",
  "rectangle.grid.2x2": "▦",
  "rectangle.3.group": "▤",
  "square.split.2x2": "▦",
  "square.split.diagonal.2x2": "▦",
  "rectangle.split.3x1": "▥",
  "rectangle.split.2x2": "▦",
  "sidebar.left": "▤",
  "sidebar.right": "▥",
  "rectangle.portrait.rotate": "▯",
  "rotate.left": "↺",
  "rotate.right": "↻",
  "cursorarrow": "➤",
  "cursorarrow.motionlines": "➤",
  "hand.draw": "✍",
  "scribble.variable": "〰",
  "lasso": "◌",
  "pencil.tip": "✎",
  "highlighter": "▬",
  "eraser": "▱",
  "bandage": "⊞",
  "cross.case": "✚",
  "stethoscope": "◎",
  "pills": "⊂",
  "syringe": "⌇",
  "cross": "✚",
  "plus.rectangle": "⊞",
  "minus.rectangle": "⊟",
  "plus.square": "⊞",
  "minus.square": "⊟",
  "plus.app": "⊞",
  "app.badge": "⊞",
  "app.dashed": "▢",
  "questionmark.app": "▢",
  "exclamationmark.app": "▢",
  "checkmark.app": "▢",
  "arrowshape.turn.up.left": "↩",
  "arrowshape.turn.up.right": "↪",
  "arrowshape.turn.up.backward": "↩",
  "arrowshape.turn.up.forward": "↪",
  "arrow.turn.up.left": "↰",
  "arrow.turn.up.right": "↱",
  "arrow.turn.down.left": "↲",
  "arrow.turn.down.right": "↳",
  "arrow.up.left.and.arrow.down.right": "⤢",
  "arrow.down.right.and.arrow.up.left": "⤡",
  "arrow.up.and.down": "↕",
  "arrow.left.and.right": "↔",
  "arrow.up.left": "↖",
  "arrow.up.right": "↗",
  "arrow.down.left": "↙",
  "arrow.down.right": "↘",
  "arrow.left.and.right.righttriangle.left.righttriangle.right": "⇄",
  "arrow.up.and.down.and.arrow.left.and.right": "✥",
  "arrow.up.backward.and.arrow.down.forward": "⤡",
  "arrow.down.forward.and.arrow.up.backward": "⤢",
  "arrow.up.forward": "↗",
  "arrow.up.forward.app": "▢",
  "arrow.down.forward": "↘",
  "arrow.down.backward": "↙",
  "arrow.up.backward": "↖",
  "arrow.right.circle": "➡",
  "arrow.left.circle": "⬅",
  "arrow.up.circle.fill": "⬆",
  "arrow.down.circle.fill": "⬇",
  "arrow.forward": "➡",
  "arrow.backward": "⬅",
  "arrow.forward.circle": "➡",
  "chevron.compact.left": "‹",
  "chevron.compact.right": "›",
  "chevron.compact.up": "⌃",
  "chevron.compact.down": "⌄",
  "chevron.up.chevron.down": "⌃⌄",
  "chevron.left.chevron.right": "‹›",
  "arrow.up.arrow.down.circle": "⇅",
  "arrow.triangle.2.circlepath.circle": "⟳",
  "arrow.clockwise.circle": "↻",
  "arrow.counterclockwise": "↺",
  "arrow.counterclockwise.circle": "↺",
  "arrow.uturn.forward": "↪",
  "arrow.uturn.right": "↪",
  "arrow.uturn.down": "↴",
  "arrow.uturn.up": "↰",
  "arrow.uturn.left.circle": "↩",
  "arrow.uturn.backward.circle": "↩",
  "arrow.uturn.forward.circle": "↪",
  "arrow.uturn.right.circle": "↪",
  "arrow.uturn.down.circle": "↴",
  "arrow.uturn.up.circle": "↰",
  "arrow.uturn.left.square": "↩",
  "arrow.uturn.backward.square": "↩",
  "arrow.uturn.forward.square": "↪",
  "arrow.uturn.right.square": "↪",
  "arrow.uturn.down.square": "↴",
  "arrow.uturn.up.square": "↰",
  "arrow.uturn.left.app": "↩",
  "arrow.uturn.backward.app": "↩",
  "arrow.uturn.forward.app": "↪",
  "arrow.uturn.right.app": "↪",
  "arrow.uturn.down.app": "↴",
  "arrow.uturn.up.app": "↰",
  "figure.run": "🏃",
  "figure.stand": "🧍",
  "dumbbell": "🏋",
  "trophy": "🏆",
  "trophy.fill": "🏆",
  "target": "🎯",
  "gamecontroller": "🎮",
  "gamecontroller.fill": "🎮",
  "paintbrush": "🖌",
  "paintbrush.fill": "🖌",
  "headphones": "🎧",
  "speaker.wave.2": "🔊",
  "speaker.wave.2.fill": "🔊",
  "mic": "🎤",
  "mic.fill": "🎤",
  "video": "🎥",
  "video.fill": "📹",
  "movieclapper": "🎬",
  "book.closed": "📕",
  "books.vertical": "📚",
  "newspaper": "📰",
  "bubble.left.and.bubble.right": "💬",
  "rosette": "🏵",
  "medal": "🏅",
  "shield": "🛡",
  "shield.fill": "🛡",
  "hands.clap": "👏",
  "rainbow": "🌈",
  "drop": "💧",
  "drop.fill": "💧",
  "leaf": "🍃",
  "leaf.fill": "🍃",
  "tree": "🌳",
  "crown": "👑",
  "crown.fill": "👑",
  "gift": "🎁",
  "gift.fill": "🎁",
  "balloon": "🎈",
  "party.popper": "🎉",
  "ticket": "🎫",
  "creditcard": "💳",
  "banknote": "💵",
  "bag": "👜",
  "hourglass": "⏳",
  "stopwatch": "⏱",
  "alarm": "⏰",
  "bell.slash": "🔕",
  "lock.shield": "🔒",
  "key.horizontal": "🗝",
  "wand.and.rays": "✨",
};

/**
 * SF Symbol names that changed between releases (or that people habitually
 * write differently) mapped onto the canonical catalogue name.
 */
const SYMBOL_ALIASES: Record<string, string> = {
  magnifier: "magnifyingglass",
  settings: "gear",
  preferences: "gear",
  multiply: "xmark",
  "bubble.left": "message",
  "doc.plaintext": "doc.text",
  "list.bullet": "list.number",
  "arrow.clockwise": "restart",
  "arrow.triangle.2.circlepath": "restart",
  bolt: "bolt.horizontal",
  "person.crop.circle": "person",
  wrench: "wrench.and.screwdriver",
  "plus.circle": "plus",
  "minus.circle": "minus",
  apple: "apple.logo",
};

function aliasSymbolName(name: string): string {
  if (name in SYMBOL_ALIASES) return SYMBOL_ALIASES[name];
  const parts = name.split(".");
  if (parts.length > 1 && parts[0] in SYMBOL_ALIASES) {
    return [SYMBOL_ALIASES[parts[0]], ...parts.slice(1)].join(".");
  }
  return name;
}

/**
 * Optional plug-in for an external icon pack (for example lucide-react). The
 * provider is consulted only when the built-in catalogue has no match, and
 * returns the same shape so the renderer stays framework-free.
 *
 *   import { icons } from "lucide-react";
 *   registerSymbolProvider((name) => {
 *     const pascal = name.split(".").map((p) => p[0]?.toUpperCase() + p.slice(1)).join("");
 *     const entry = (icons as Record<string, [string, Record<string, string>, unknown][]>)[pascal];
 *     if (!entry) return null;
 *     const commands: string[] = [];
 *     const walk = (nodes: unknown) => {
 *       for (const node of (nodes as [string, Record<string, string>, unknown][]) ?? []) {
 *         if (node[0] === "path" && node[1]?.d) commands.push(node[1].d);
 *         if (node[2]) walk(node[2]);
 *       }
 *     };
 *     walk(entry[2]);
 *     return commands.length > 0 ? { commands } : null;
 *   });
 */
export type ExternalSymbolProvider = (name: string) => { commands: string[]; glyph?: string } | null;

let externalSymbolProvider: ExternalSymbolProvider | null = null;

/** Register (or clear with `null`) an external SF Symbol fallback provider. */
export function registerSymbolProvider(provider: ExternalSymbolProvider | null): void {
  externalSymbolProvider = provider;
}

export function lookupSymbol(name: string): { commands: string[]; glyph?: string } | null {
  const canonical = aliasSymbolName(name);

  if (canonical in ICONS) {
    const commands = ICONS[canonical];
    if (commands.length > 0) return { commands };
  }

  // Try progressively shorter names: "star.fill.circle" → "star.fill" → "star".
  const parts = canonical.split(".");
  for (let take = parts.length - 1; take >= 1; take -= 1) {
    const candidate = parts.slice(0, take).join(".");
    if (candidate in ICONS) return { commands: ICONS[candidate] };
  }

  if (canonical in GLYPHS) return { commands: [], glyph: GLYPHS[canonical] };
  for (let take = parts.length - 1; take >= 1; take -= 1) {
    const candidate = parts.slice(0, take).join(".");
    if (candidate in GLYPHS) return { commands: [], glyph: GLYPHS[candidate] };
  }

  // Last resort for variants like "star.circle.on.circle": share the trailing
  // stem of the requested name with a catalogue entry.
  const flat = canonical.split(".");
  while (flat.length > 1) {
    flat.shift();
    const candidate = flat.join(".");
    if (candidate in ICONS && ICONS[candidate].length > 0) {
      return { commands: ICONS[candidate] };
    }
    if (candidate in GLYPHS) return { commands: [], glyph: GLYPHS[candidate] };
  }

  // Optional external pack (lucide-react, heroicons, …) registered by the app.
  const external = externalSymbolProvider?.(name);
  if (external) return external;

  return null;
}

export function symbolStrokeWidth(size: number): number {
  return Math.max(1, Math.min(2.2, size * 0.075));
}
