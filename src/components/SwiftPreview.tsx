import React from "react";
import type { PreviewRuntime, RModifier, RNode, Screen, ModalSpec } from "../utils/swift/viewBuilder";
import { numOf, truthy, type Value } from "../utils/swift/evaluator";
import {
  frameClasses,
  frameLayout,
  frameStretches,
  fullWidthClasses,
  hasFrameSizing,
  implicitMemberName as isImplicitName,
  spacerClasses,
  viewWantsFullWidth,
} from "../utils/swift/layout";
import {
  FONT_STACK,
  METRICS,
  cssColor,
  cssFontFamily,
  cssGradient,
  cssGradientStops,
  cssMaterial,
  lookupSymbol,
  resolveFont,
  type ResolvedFont,
} from "../utils/swift/design";

/* ══════════════════════════════ View environment ══════════════════════════════ */

interface ViewEnv {
  font: ResolvedFont;
  color?: string;
  tint: string;
  multiline: "leading" | "center" | "trailing";
  /** Layout axis of the parent stack — used by Divider and Spacer. */
  axis: "vertical" | "horizontal" | "none";
  buttonStyle?: string;
  toggleStyle?: string;
  pickerStyle?: string;
  listStyle?: string;
  labelStyle?: string;
  textFieldStyle?: string;
  progressStyle?: string;
  disabled: boolean;
  lineLimit?: number;
  lineSpacing?: number;
  fixedSize: boolean;
  inList: boolean;
  /** `.imageScale(.small/.medium/.large)` multiplier for SF Symbols. */
  symbolScale: number;
  /** Insets currently reserved by the app shell (0 when ignored at root). */
  safeArea: { top: number; bottom: number };
}

const BASE_ENV: ViewEnv = {
  font: resolveFont(undefined, 17),
  tint: "#007AFF",
  multiline: "leading",
  axis: "none",
  disabled: false,
  fixedSize: false,
  inList: false,
  symbolScale: 1,
  safeArea: { top: METRICS.safeAreaTop, bottom: METRICS.safeAreaBottom },
};

/* ══════════════════════════════ Modifier helpers ══════════════════════════════ */

const ENV_MODIFIERS = new Set([
  "font", "fontWeight", "bold", "italic", "underline", "strikethrough",
  "foregroundColor", "foregroundStyle", "tint", "accentColor",
  "multilineTextAlignment", "lineSpacing", "lineLimit", "keyboardType",
  "textCase", "disabled", "buttonStyle", "toggleStyle", "pickerStyle",
  "listStyle", "labelStyle", "textFieldStyle", "progressViewStyle",
  "controlSize", "symbolRenderingMode", "colorScheme", "dynamicTypeSize",
  "autocorrectionDisabled", "textInputAutocapitalization", "submitLabel",
  "headerProminence", "environment", "labelsHidden", "menuStyle",
  "navigationBarTitleDisplayMode", "navigationTitle", "navigationBarBackButtonHidden",
  "imageScale", "fixedSize",
]);

function firstPositional(mod: RModifier, index = 0): Value | undefined {
  return mod.args.filter((a) => !a.label)[index]?.value;
}

/** CSS text-align for SwiftUI's TextAlignment. */
function cssTextAlign(alignment: ViewEnv["multiline"]): React.CSSProperties["textAlign"] {
  if (alignment === "center") return "center";
  if (alignment === "trailing") return "right";
  return "left";
}

function resolveEnv(node: RNode, parent: ViewEnv): ViewEnv {
  let env = parent;

  for (const mod of node.modifiers) {
    if (!ENV_MODIFIERS.has(mod.name)) continue;
    switch (mod.name) {
      case "font": {
        const value = firstPositional(mod);
        const font = resolveFont(value, parent.font.size);
        // `.fontWeight`/`.bold` applied before `.font` are overridden by it.
        env = { ...env, font };
        break;
      }
      case "fontWeight": {
        const value = firstPositional(mod);
        const name = isImplicitName(value);
        const weight = name === "bold" ? 700 : name === "semibold" ? 600 : name === "medium" ? 500 : name === "light" ? 300 : name === "heavy" ? 800 : name === "black" ? 900 : name === "thin" ? 200 : name === "ultraLight" ? 100 : env.font.weight;
        const size = env.font.size;
        env = { ...env, font: { ...env.font, weight, lineHeight: Math.round(size * 1.29) } };
        break;
      }
      case "bold":
        env = { ...env, font: { ...env.font, weight: 700 } };
        break;
      case "italic":
        env = { ...env, font: { ...env.font, italic: true } };
        break;
      case "foregroundColor":
      case "foregroundStyle": {
        const color = cssColor(firstPositional(mod));
        if (color) env = { ...env, color };
        break;
      }
      case "tint":
      case "accentColor": {
        const color = cssColor(firstPositional(mod));
        if (color) env = { ...env, tint: color };
        break;
      }
      case "multilineTextAlignment": {
        const name = isImplicitName(firstPositional(mod));
        if (name === "center" || name === "leading" || name === "trailing") {
          env = { ...env, multiline: name };
        }
        break;
      }
      case "lineSpacing": {
        const value = firstPositional(mod);
        if (typeof value === "number") env = { ...env, lineSpacing: value };
        break;
      }
      case "lineLimit": {
        const value = firstPositional(mod);
        if (typeof value === "number") env = { ...env, lineLimit: value };
        break;
      }
      case "disabled":
        env = { ...env, disabled: true };
        break;
      case "fixedSize":
        env = { ...env, fixedSize: true };
        break;
      case "imageScale": {
        const name = isImplicitName(firstPositional(mod));
        const scale = name === "small" ? 0.75 : name === "large" ? 1.35 : 1;
        env = { ...env, symbolScale: scale };
        break;
      }
      case "buttonStyle":
        env = { ...env, buttonStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      case "toggleStyle":
        env = { ...env, toggleStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      case "pickerStyle":
        env = { ...env, pickerStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      case "listStyle":
        env = { ...env, listStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      case "labelStyle":
        env = { ...env, labelStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      case "textFieldStyle":
        env = { ...env, textFieldStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      case "progressViewStyle":
        env = { ...env, progressStyle: isImplicitName(firstPositional(mod)) ?? "automatic" };
        break;
      default:
        break;
    }
  }

  return env;
}

interface FrameSpec {
  width?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  height?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  align: React.CSSProperties["alignItems"];
  justify: React.CSSProperties["justifyContent"];
}

const ALIGNMENTS: Record<string, { align: FrameSpec["align"]; justify: FrameSpec["justify"] }> = {
  center: { align: "center", justify: "center" },
  leading: { align: "center", justify: "flex-start" },
  trailing: { align: "center", justify: "flex-end" },
  top: { align: "flex-start", justify: "center" },
  bottom: { align: "flex-end", justify: "center" },
  topLeading: { align: "flex-start", justify: "flex-start" },
  topTrailing: { align: "flex-start", justify: "flex-end" },
  bottomLeading: { align: "flex-end", justify: "flex-start" },
  bottomTrailing: { align: "flex-end", justify: "flex-end" },
};

/**
 * Merge a style patch into one rendered element.
 *
 * The old implementation wrapped content in `<div style={{display:"contents"}}>`
 * which silently drops every box-model property (border-radius, box-shadow,
 * transform, filter, opacity, border, z-index…). SwiftUI modifiers mutate the
 * view they are applied to, so the patch belongs on the rendered element itself.
 */
function mergeStyle(
  base: React.CSSProperties | undefined,
  patch: React.CSSProperties,
): React.CSSProperties {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // Chained transforms/filters compose instead of overwriting each other.
    if (
      typeof value === "string" &&
      (key === "transform" || key === "filter") &&
      typeof merged[key] === "string"
    ) {
      merged[key] = `${value} ${merged[key] as string}`;
      continue;
    }
    merged[key] = value;
  }
  return merged as React.CSSProperties;
}

/** True for host elements (`div`, `span`, `svg`, …) — cloneable with styles. */
function isHostElement(node: React.ReactNode): node is React.ReactElement<{ style?: React.CSSProperties }> {
  return React.isValidElement(node) && typeof node.type === "string";
}

/**
 * Apply a modifier's CSS to the node's element.
 *
 * Host elements receive the style directly. Everything else (React view
 * components like `<TextBlock/>`, fragments, arrays) would silently drop
 * cloned props, so it is wrapped in a real box — the CSS equivalent of
 * SwiftUI's ModifiedContent layer.
 */
function attachStyle(content: React.ReactNode, patch: React.CSSProperties): React.ReactNode {
  if (isHostElement(content)) {
    return React.cloneElement(content, { style: mergeStyle(content.props.style, patch) });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, ...patch }}>
      {content}
    </div>
  );
}

type InteractionHandlers = {
  onClick?: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
};

/**
 * Edges ignored by SwiftUI's safe-area modifier:
 *   .ignoresSafeArea()                            → top + bottom
 *   .ignoresSafeArea(edges: .top)                 → top
 *   .ignoresSafeArea(.container, edges: .bottom)  → bottom
 *   .ignoresSafeArea(edges: [.top, .bottom])
 * The simulator shell only has vertical safe-area bands (status bar / home
 * indicator), so horizontal edges are parsed but have no inset to cancel.
 */
function ignoredSafeAreaEdges(modifiers: RModifier[]): { top: boolean; bottom: boolean } {
  const mod = modifiers.find((m) => m.name === "ignoresSafeArea");
  if (!mod) return { top: false, bottom: false };

  const raw = mod.args.find((a) => a.label === "edges")?.value;
  const names: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = isImplicitName(entry);
      if (name) names.push(name);
    }
  } else {
    const name = isImplicitName(raw);
    if (name) names.push(name);
  }

  if (names.length === 0) return { top: true, bottom: true };
  return {
    top: names.some((n) => n === "top" || n === "vertical" || n === "all"),
    bottom: names.some((n) => n === "bottom" || n === "vertical" || n === "all"),
  };
}

/**
 * A child that consumes all offered height, like `Color`, a gradient stack
 * fill, GeometryReader or a scroll container. SwiftUI's stacks/ZStacks grow to
 * fill when such a child is present; CSS needs the container height spelled
 * out for that (a percentage against an auto-height parent stays auto, so the
 * rule is harmless in scrollable content).
 */
function isGreedyVertical(child: RNode): boolean {
  switch (child.type) {
    case "Color":
    case "Material":
    case "LinearGradient":
    case "RadialGradient":
    case "AngularGradient":
    case "GeometryReader":
    case "ScrollView":
    case "List":
    case "Form":
    case "Spacer":
      return true;
    default:
      break;
  }
  const frame = child.modifiers.find((m) => m.name === "frame");
  if (!frame) return false;
  return frameLayout([frame])?.fillY === true;
}

/**
 * CSS z-index for the nth layer of a ZStack.
 *
 * SwiftUI orders layers by (zIndex, source order); children without a
 * `.zIndex()` keep `0` and are broken by document order. Encoding the pair as
 * `(weight + 512) * 1000 + index` makes the same ordering explicit in CSS:
 * index 0 → 512000, index 1 → 512001, …, while `.zIndex(1)` lifts a layer to
 * 513xxx — above every default layer but still below `.zIndex(2)`.
 */
const ZSTACK_ORDER_OFFSET = 512;
const ZSTACK_ORDER_STRIDE = 1000;
function layerZIndex(child: RNode, index: number): number {
  const raw = child.modifiers.find((m) => m.name === "zIndex")?.args[0]?.value;
  const weight = typeof raw === "number" ? raw : 0;
  return (weight + ZSTACK_ORDER_OFFSET) * ZSTACK_ORDER_STRIDE + index;
}

/**
 * Attach click/long-press handlers (plus style) to the rendered element.
 * An element that already handles the same event keeps its handler: both run.
 */
function attachInteraction(
  content: React.ReactNode,
  handlers: InteractionHandlers,
  patch: React.CSSProperties,
): React.ReactNode {
  if (isHostElement(content)) {
    const props = content.props as {
      style?: React.CSSProperties;
      onClick?: (event: React.MouseEvent) => void;
      onContextMenu?: (event: React.MouseEvent) => void;
    };
    const next: Record<string, unknown> = { style: mergeStyle(props.style, patch) };
    if (handlers.onClick) {
      next.onClick = (event: React.MouseEvent) => {
        props.onClick?.(event);
        handlers.onClick?.(event);
      };
    }
    if (handlers.onContextMenu) {
      next.onContextMenu = (event: React.MouseEvent) => {
        props.onContextMenu?.(event);
        handlers.onContextMenu?.(event);
      };
    }
    return React.cloneElement(content as React.ReactElement<Record<string, unknown>>, next);
  }
  return (
    <div
      style={{ display: "flex", flexDirection: "column", minWidth: 0, ...patch }}
      onClick={handlers.onClick}
      onContextMenu={handlers.onContextMenu}
    >
      {content}
    </div>
  );
}

/* ══════════════════════════════ Node rendering ══════════════════════════════ */

const ViewNode: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env: parentEnv }) => {
  const env = React.useMemo(() => resolveEnv(node, parentEnv), [node, parentEnv]);

  // SwiftUI lifecycle hooks.
  const appear = React.useMemo(
    () => node.modifiers.filter((m) => m.name === "onAppear" && m.action).map((m) => m.action!),
    [node],
  );
  const disappear = React.useMemo(
    () => node.modifiers.filter((m) => m.name === "onDisappear" && m.action).map((m) => m.action!),
    [node],
  );

  React.useEffect(() => {
    for (const action of appear) action();
    return () => {
      for (const action of disappear) action();
    };
    // Mount-only per view identity, matching SwiftUI's onAppear semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const base = renderBase(node, env);
  return <>{wrapModifiers(node, base, env)}</>;
};

export const SwiftNode: React.FC<{ node: RNode; env?: Partial<ViewEnv> }> = ({ node, env }) => (
  <ViewNode node={node} env={{ ...BASE_ENV, ...env }} />
);

/* ────────────────────────── Base rendering per view type ────────────────────────── */

function renderBase(node: RNode, env: ViewEnv): React.ReactNode {
  switch (node.type) {
    case "Text":
      return <TextBlock node={node} env={env} />;
    case "Label":
      return <LabelBlock node={node} env={env} />;
    case "Image":
      return <ImageBlock node={node} env={env} />;
    case "Button":
      return <ButtonBlock node={node} env={env} />;
    case "NavigationLink":
      return <NavigationLinkBlock node={node} env={env} />;
    case "VStack":
    case "LazyVStack":
      return <StackBlock node={node} env={env} direction="column" />;
    case "HStack":
    case "LazyHStack":
      return <StackBlock node={node} env={env} direction="row" />;
    case "ZStack":
      return <ZStackBlock node={node} env={env} />;
    case "Group":
    case "EmptyView":
      return <>{renderChildren(node, env)}</>;
    case "ScrollView":
      return <ScrollViewBlock node={node} env={env} />;
    case "List":
    case "Form":
      return <ListBlock node={node} env={env} />;
    case "Section":
      return <SectionBlock node={node} env={env} inList />;
    case "NavigationStack":
    case "NavigationView":
    case "ViewThatFits":
    case "ControlGroup":
      return <StackBlock node={node} env={env} direction="column" />;
    case "GeometryReader":
      return <GeometryReaderBlock node={node} env={env} />;
    case "TabView":
      return <TabViewBlock node={node} env={env} />;
    case "Toggle":
      return <ToggleBlock node={node} env={env} />;
    case "Picker":
      return <PickerBlock node={node} env={env} />;
    case "Slider":
      return <SliderBlock node={node} env={env} />;
    case "Stepper":
      return <StepperBlock node={node} env={env} />;
    case "TextField":
      return <TextFieldBlock node={node} env={env} secure={false} />;
    case "SecureField":
      return <TextFieldBlock node={node} env={env} secure />;
    case "TextEditor":
      return <TextEditorBlock node={node} env={env} />;
    case "DatePicker":
      return <DatePickerBlock node={node} env={env} />;
    case "ColorPicker":
      return <ColorPickerBlock node={node} env={env} />;
    case "ProgressView":
      return <ProgressBlock node={node} env={env} />;
    case "Gauge":
      return <GaugeBlock node={node} env={env} />;
    case "Divider":
      return <DividerBlock env={env} />;
    case "Spacer":
      return <SpacerBlock env={env} />;
    case "Color":
      return <ColorBlock node={node} env={env} />;
    case "Material":
      return <MaterialBlock node={node} />;
    case "LinearGradient":
      return <GradientBlock node={node} kind="linear" />;
    case "RadialGradient":
      return <GradientBlock node={node} kind="radial" />;
    case "AngularGradient":
      return <GradientBlock node={node} kind="angular" />;
    case "Circle":
    case "Rectangle":
    case "RoundedRectangle":
    case "Capsule":
    case "Ellipse":
    case "Path":
    case "Shape":
      return <ShapeBlock node={node} env={env} type={node.type} />;
    case "Link":
      return <LinkBlock node={node} env={env} />;
    case "Menu":
      return <MenuBlock node={node} env={env} />;
    case "DisclosureGroup":
      return <DisclosureBlock node={node} env={env} />;
    case "LabeledContent":
      return <LabeledContentBlock node={node} env={env} />;
    case "ContentUnavailableView":
      return <ContentUnavailableBlock node={node} env={env} />;
    case "AsyncImage":
      return (
        <div className="flex items-center justify-center rounded-[10px] bg-[#E5E5EA]" style={{ minWidth: 60, minHeight: 60 }}>
          <SymbolView name="photo" size={22} color="#8E8E93" />
        </div>
      );
    case "LazyVGrid":
      return <GridBlock node={node} env={env} direction="vertical" />;
    case "LazyHGrid":
      return <GridBlock node={node} env={env} direction="horizontal" />;
    case "Grid":
      return <SwiftGridBlock node={node} env={env} />;
    case "GridRow":
      return (
        <div style={{ display: "contents" }}>{renderChildren(node, env)}</div>
      );
    case "ToolbarItem":
    case "ToolbarItemGroup":
      return <>{renderChildren(node, env)}</>;
    case "Unsupported":
      return (
        <div className="rounded-lg border border-dashed border-[#C7C7CC] bg-[#F7F7F9] px-3 py-2 text-center">
          <div style={{ fontSize: 11, color: "#8E8E93", lineHeight: 1.3 }}>
            {node.text} — not supported yet
          </div>
        </div>
      );
    default:
      return <>{renderChildren(node, env)}</>;
  }
}

function renderChildren(node: RNode, env: ViewEnv): React.ReactNode {
  return node.children.map((child, index) => (
    <ViewNode key={child.key ?? child.id ?? index} node={child} env={env} />
  ));
}

/* ────────────────────────── Structural modifier pipeline ────────────────────────── */

function wrapModifiers(node: RNode, base: React.ReactNode, env: ViewEnv): React.ReactNode {
  let content = base;

  for (const mod of node.modifiers) {
    // Environment modifiers only shape descendants; fixedSize also shrinks the
    // view itself, so it still flows through the structural pipeline.
    if (ENV_MODIFIERS.has(mod.name) && mod.name !== "fixedSize") continue;
    content = applyStructuralModifier(content, mod, env, node);
  }

  if (env.disabled) {
    content = attachStyle(content, { opacity: 0.55, pointerEvents: "none" });
  }

  return content;
}

function applyStructuralModifier(
  content: React.ReactNode,
  mod: RModifier,
  env: ViewEnv,
  node: RNode,
): React.ReactNode {
  switch (mod.name) {
    case "padding":
      return <PaddingWrapper content={content} mod={mod} />;

    case "frame":
      return <FrameWrapper content={content} mod={mod} env={env} node={node} />;

    case "background":
      return <BackgroundWrapper content={content} mod={mod} env={env} />;

    case "overlay":
      return <OverlayWrapper content={content} mod={mod} env={env} />;

    case "cornerRadius": {
      const radius = firstPositional(mod);
      if (typeof radius !== "number") return content;
      return attachStyle(content, { borderRadius: radius, overflow: "hidden" });
    }

    case "clipShape": {
      const shape = firstPositional(mod);
      const radius = shapeRadius(shape, 8);
      return attachStyle(content, { borderRadius: radius, overflow: "hidden" });
    }

    case "shadow": {
      const color = mod.args.find((a) => a.label === "color")?.value;
      const radius = mod.args.find((a) => a.label === "radius")?.value;
      const x = mod.args.find((a) => a.label === "x")?.value;
      const y = mod.args.find((a) => a.label === "y")?.value;
      const css = cssColor(color) ?? "rgba(0,0,0,0.33)";
      const r = typeof radius === "number" ? radius : 3;
      const dx = typeof x === "number" ? x : 0;
      const dy = typeof y === "number" ? y : 0;
      return attachStyle(content, { boxShadow: `${dx}px ${dy}px ${r}px ${css}` });
    }

    case "opacity": {
      const value = firstPositional(mod);
      if (typeof value !== "number") return content;
      return attachStyle(content, { opacity: Math.max(0, Math.min(1, value)) });
    }

    case "offset": {
      const x = mod.args.find((a) => a.label === "x")?.value;
      const y = mod.args.find((a) => a.label === "y")?.value;
      const dx = typeof x === "number" ? x : 0;
      const dy = typeof y === "number" ? y : 0;
      return attachStyle(content, {
        transform: `translate(${dx}px, ${dy}px)`,
        transition: "transform 300ms",
      });
    }

    case "rotationEffect": {
      const angle = angleOf(firstPositional(mod));
      return attachStyle(content, {
        transform: `rotate(${angle}deg)`,
        transition: "transform 300ms",
      });
    }

    case "scaleEffect": {
      const x = mod.args.find((a) => a.label === "x")?.value;
      const y = mod.args.find((a) => a.label === "y")?.value;
      const sx = typeof x === "number" ? x : 1;
      const sy = typeof y === "number" ? y : sx;
      return attachStyle(content, {
        transform: `scale(${sx}, ${sy})`,
        transition: "transform 300ms",
      });
    }

    case "position": {
      const x = mod.args.find((a) => a.label === "x")?.value;
      const y = mod.args.find((a) => a.label === "y")?.value;
      const px = typeof x === "number" ? x : 0;
      const py = typeof y === "number" ? y : 0;
      return attachStyle(content, {
        position: "absolute",
        left: px,
        top: py,
        transform: "translate(-50%, -50%)",
      });
    }

    case "blur": {
      const radius = mod.args.find((a) => a.label === "radius")?.value ?? firstPositional(mod);
      const r = typeof radius === "number" ? radius : 0;
      return attachStyle(content, { filter: `blur(${r}px)` });
    }

    case "brightness": {
      const value = firstPositional(mod);
      const v = typeof value === "number" ? value : 0;
      return attachStyle(content, { filter: `brightness(${1 + v})` });
    }

    case "saturation": {
      const value = firstPositional(mod);
      const v = typeof value === "number" ? value : 1;
      return attachStyle(content, { filter: `saturate(${v})` });
    }

    case "grayscale": {
      const value = firstPositional(mod);
      const v = typeof value === "number" ? value : 1;
      return attachStyle(content, { filter: `grayscale(${v})` });
    }

    case "contrast": {
      const value = firstPositional(mod);
      const v = typeof value === "number" ? value : 1;
      return attachStyle(content, { filter: `contrast(${v})` });
    }

    case "colorInvert":
      return attachStyle(content, { filter: "invert(1)" });

    case "hueRotation": {
      const angle = angleOf(firstPositional(mod));
      return attachStyle(content, { filter: `hue-rotate(${angle}deg)` });
    }

    case "border": {
      const color = cssColor(firstPositional(mod)) ?? "#000";
      const width = mod.args.find((a) => a.label === "width")?.value;
      const w = typeof width === "number" ? width : 1;
      return attachStyle(content, { border: `${w}px solid ${color}` });
    }

    case "zIndex": {
      const value = firstPositional(mod);
      const z = typeof value === "number" ? value : 0;
      return attachStyle(content, { zIndex: z, position: "relative" });
    }

    case "fixedSize":
      return attachStyle(content, { flexShrink: 0 });

    case "aspectRatio": {
      const ratio = firstPositional(mod);
      const r = typeof ratio === "number" ? ratio : 1;
      return attachStyle(content, { aspectRatio: `${r}` });
    }

    case "clipped":
      return attachStyle(content, { overflow: "hidden" });

    case "ignoresSafeArea": {
      // Root-level ignores are handled by the shell: it reserves no inset and
      // reports `safeArea: {0,0}`, so there is nothing to cancel and adding a
      // wrapper box here would break percentage sizing inside the view
      // (`.frame(...).ignoresSafeArea()` collapsed to content height).
      const edges = ignoredSafeAreaEdges([mod]);
      const cancelTop = edges.top && env.safeArea.top > 0;
      const cancelBottom = edges.bottom && env.safeArea.bottom > 0;
      if (!cancelTop && !cancelBottom) return content;

      // Nested view (usually a background layer): cancel the reserved inset
      // with a negative margin so it bleeds into the safe-area band.
      const patch: React.CSSProperties = { alignSelf: "stretch" };
      if (cancelTop) patch.marginTop = -env.safeArea.top;
      if (cancelBottom) patch.marginBottom = -env.safeArea.bottom;
      return attachStyle(content, patch);
    }

    case "animation":
    case "transition":
    case "presentationDetents":
    case "presentationDragIndicator":
    case "interactiveDismissDisabled":
    case "textSelection":
    case "symbolRenderingMode":
    case "scrollIndicators":
    case "scrollContentBackground":
    case "toolbar":
    case "tabItem":
    case "tag":
    case "navigationTitle":
    case "navigationBarTitleDisplayMode":
    case "navigationBarBackButtonHidden":
    case "navigationDestination":
    case "resizable":
    case "scaledToFit":
    case "scaledToFill":
    case "layoutPriority":
    case "help":
    case "onAppear":
    case "onDisappear":
    case "onChange":
    case "task":
    case "onSubmit":
    case "listRowInsets":
    case "listRowBackground":
    case "listRowSeparator":
    case "accentColor":
    case "environment":
      return content;

    case "sheet":
    case "fullScreenCover":
    case "alert":
    case "confirmationDialog":
      return content;

    case "onTapGesture": {
      const action = mod.action;
      if (!action) return content;
      return attachInteraction(content, { onClick: () => action() }, { cursor: "pointer" });
    }

    case "onLongPressGesture": {
      const action = mod.action;
      if (!action) return content;
      return attachInteraction(
        content,
        {
          onContextMenu: (event) => {
            event.preventDefault();
            action();
          },
        },
        {},
      );
    }

    default:
      return content;
  }
  void node;
}

function shapeRadius(shape: Value | undefined, fallback: number): number | string {
  if (!shape || typeof shape !== "object") return fallback;
  const ref = shape as { t?: string; name?: string; args?: { label?: string; value: Value }[] };
  if (ref.t !== "shape") return fallback;
  if (ref.name === "Circle" || ref.name === "Ellipse") return "50%";
  if (ref.name === "Capsule") return 9999;
  if (ref.name === "RoundedRectangle") {
    const radius = ref.args?.find((a) => a.label === "cornerRadius")?.value;
    return typeof radius === "number" ? radius : fallback;
  }
  return fallback;
}

function angleOf(value: Value | undefined): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && (value as { t?: string }).t === "angle") {
    return (value as { degrees: number }).degrees;
  }
  return 0;
}

/* ────────────────────────── Modifier wrappers ────────────────────────── */

const PaddingWrapper: React.FC<{ content: React.ReactNode; mod: RModifier }> = ({ content, mod }) => {
  const args = mod.args;
  const positional = args.filter((a) => !a.label).map((a) => a.value);
  const amount = typeof positional[0] === "number" ? positional[0] : undefined;
  const edges = isImplicitName(positional[0]) ?? isImplicitName(positional[1]);
  const second = typeof positional[1] === "number" ? positional[1] : undefined;
  const value = amount ?? second ?? METRICS.defaultPadding;

  let padding: React.CSSProperties = { padding: value };
  if (edges === "horizontal") padding = { paddingLeft: value, paddingRight: value };
  else if (edges === "vertical") padding = { paddingTop: value, paddingBottom: value };
  else if (edges === "top") padding = { paddingTop: value };
  else if (edges === "bottom") padding = { paddingBottom: value };
  else if (edges === "leading") padding = { paddingLeft: value };
  else if (edges === "trailing") padding = { paddingRight: value };
  else if (edges === "all") padding = { padding: value };
  else if (edges === "horizontal" && second !== undefined) padding = { paddingLeft: second, paddingRight: second };

  return <>{attachStyle(content, padding)}</>;
};

/**
 * `.frame(...)` — the only modifier that must keep a real box: it can resize
 * the view and re-align the content inside it. `.infinity` cannot be mapped to
 * a blind `100%`: along a row axis it means "grow into the free space", along
 * a column axis it means "stretch across the parent".
 *
 * The frame's intent comes from the AST (`frameLayout`) and is mapped to
 * Tailwind — `.frame(maxWidth: .infinity)` ⇒ `w-full`, inside an HStack it also
 * becomes `flex-1 basis-0 min-w-0` like a Spacer — with matching inline styles,
 * because the canvas must render even where Tailwind is not built. Controls and
 * containers are additionally stretched to fill the frame, so a Button or
 * TextField no longer shrink-wraps inside a full-width frame.
 */
const FrameWrapper: React.FC<{ content: React.ReactNode; mod: RModifier; env: ViewEnv; node: RNode }> = ({ content, mod, env, node }) => {
  const layout = frameLayout([mod]);
  if (!layout || !hasFrameSizing(layout)) {
    // A frame without any sizing only re-aligns its content inside the bounds
    // the view already received; an extra box would change the parent layout.
    return <>{content}</>;
  }

  const alignment = ALIGNMENTS[isImplicitName(mod.args.find((a) => a.label === "alignment")?.value) ?? "center"] ?? ALIGNMENTS.center;

  // Text, labels and shapes keep their intrinsic box (SwiftUI centers them in
  // the wider frame); controls and containers stretch to fill it. A flat
  // container (Group, GridRow, …) has no box of its own, so the decision falls
  // to the children that actually render.
  const stretch = frameStretches(node);
  const stretchX = stretch && layout.fillX;
  const stretchY = stretch && layout.fillY;

  const style: React.CSSProperties = {
    display: "flex",
    // A column wrapper stretches its child across the cross axis: that is how a
    // Button/TextField fills the width without a style hack of its own.
    flexDirection: stretchX ? "column" : "row",
    position: "relative",
    alignItems: stretchX || stretchY ? "stretch" : alignment.align,
    justifyContent: stretchX ? alignment.align : alignment.justify,
    minWidth: 0,
    minHeight: 0,
    boxSizing: "border-box",
  };

  if (typeof layout.width === "number") {
    style.width = layout.width;
    // A fixed SwiftUI frame does not shrink when the parent runs out of room.
    style.flexShrink = 0;
  }
  if (typeof layout.height === "number") {
    style.height = layout.height;
    style.flexShrink = 0;
  }
  if (typeof layout.minWidth === "number") style.minWidth = layout.minWidth;
  if (typeof layout.maxWidth === "number") style.maxWidth = layout.maxWidth;
  if (typeof layout.minHeight === "number") style.minHeight = layout.minHeight;
  if (typeof layout.maxHeight === "number") style.maxHeight = layout.maxHeight;

  // A frame with only a vertical size keeps the offered width — a shape or
  // GeometryReader inside must not collapse to its min-content width.
  const hasVerticalOnly =
    layout.width === undefined &&
    (layout.height !== undefined || layout.minHeight !== undefined || layout.maxHeight !== undefined);
  if (hasVerticalOnly && env.axis !== "horizontal") {
    style.width = style.width ?? "100%";
  }

  if (layout.fillX) {
    if (env.axis === "horizontal") {
      // Inside an HStack this behaves like a Spacer: consume the free width.
      style.flexGrow = 1;
      style.flexBasis = 0;
      style.minWidth = 0;
    } else {
      style.width = style.width ?? "100%";
      style.alignSelf = "stretch";
      style.maxWidth = style.maxWidth ?? "100%";
    }
  }
  if (layout.fillY) {
    if (env.axis === "vertical") {
      style.flexGrow = 1;
      style.flexBasis = 0;
      style.minHeight = 0;
    } else {
      style.height = style.height ?? "100%";
      style.alignSelf = "stretch";
      style.maxHeight = style.maxHeight ?? "100%";
    }
  }

  const classes = frameClasses(layout, env.axis);
  return (
    <div className={classes.length > 0 ? classes.join(" ") : undefined} style={style}>
      {content}
    </div>
  );
};

const BackgroundWrapper: React.FC<{ content: React.ReactNode; mod: RModifier; env: ViewEnv }> = ({ content, mod, env }) => {
  const style = backgroundStyle(mod, env);
  // `.background { … }` supplies a view that sits behind the content.
  const backgroundNodes = mod.children && mod.children.length > 0 ? (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {mod.children.map((child, index) => (
        <ViewNode key={child.key ?? child.id ?? index} node={child} env={{ ...env, axis: "none" }} />
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative", display: "flex", ...style }}>
      {backgroundNodes}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {content}
      </div>
    </div>
  );
};

function backgroundStyle(mod: RModifier, env: ViewEnv): React.CSSProperties {
  const positional = mod.args.filter((a) => !a.label).map((a) => a.value);
  const first = mod.args[0]?.value;
  const style: React.CSSProperties = {};

  // A view-producing background closure: `.background { … }` (rendered by caller).
  if (mod.children && mod.children.length > 0) return style;

  const material = cssMaterial(first);
  if (material) {
    style.background = material.background;
    style.backdropFilter = material.filter;
    return style;
  }

  const gradient = first && typeof first === "object" && (first as { t?: string }).t === "gradient" ? cssGradient(first) : null;
  if (gradient) {
    style.backgroundImage = gradient;
    return style;
  }

  const shapeArg = mod.args.find((a) => a.label === "in")?.value;
  const shapeValue = shapeArg ?? (typeof first === "object" && (first as { t?: string }).t === "shape" ? first : undefined);
  if (shapeValue) {
    const shape = shapeValue as { t?: string; name?: string };
    if (shape.name === "RoundedRectangle" || shape.name === "Capsule" || shape.name === "Circle") {
      style.background = cssColor(positional[0]) ?? cssColor(first) ?? "#007AFF";
      style.borderRadius = shapeRadius(shapeValue, 8);
      return style;
    }
  }

  const color = cssColor(first) ?? cssColor(positional[0]);
  if (color) style.background = color;
  else if (isShapeLike(first)) style.background = env.tint;

  return style;
}

function isShapeLike(value: Value | undefined): boolean {
  return !!value && typeof value === "object" && (value as { t?: string }).t === "shape";
}

/** CSS gradient string for a gradient value (`.fill(LinearGradient(...))`). */
function gradientCss(value: Value | undefined): string | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { t?: string }).t !== "gradient") return null;
  return cssGradient(value);
}

const OverlayWrapper: React.FC<{ content: React.ReactNode; mod: RModifier; env: ViewEnv }> = ({ content, mod, env }) => {
  const alignment = ALIGNMENTS[isImplicitName(mod.args.find((a) => a.label === "alignment")?.value) ?? "center"] ?? ALIGNMENTS.center;
  const overlayContent = mod.children && mod.children.length > 0 ? (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: alignment.align, justifyContent: alignment.justify, pointerEvents: "none" }}>
      {mod.children.map((child, index) => (
        <ViewNode key={child.key ?? child.id ?? index} node={child} env={{ ...env, axis: "none" }} />
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative", display: "flex" }}>
      <div style={{ display: "contents" }}>{content}</div>
      {overlayContent}
    </div>
  );
};

/* ────────────────────────── Leaf views ────────────────────────── */

const TextBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const font = env.font;
  const style: React.CSSProperties = {
    fontFamily: cssFontFamily(font),
    fontSize: font.size,
    fontWeight: font.weight,
    fontStyle: font.italic ? "italic" : undefined,
    lineHeight: `${env.lineSpacing ? font.lineHeight + env.lineSpacing : font.lineHeight}px`,
    letterSpacing: font.letterSpacing !== undefined ? `${font.letterSpacing}px` : undefined,
    color: env.color ?? "#000000",
    textAlign: cssTextAlign(env.multiline),
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
  if (env.lineLimit !== undefined) {
    style.display = "-webkit-box";
    style.WebkitLineClamp = env.lineLimit;
    style.WebkitBoxOrient = "vertical";
    style.overflow = "hidden";
  }
  const underline = node.modifiers.some((m) => m.name === "underline");
  const strike = node.modifiers.some((m) => m.name === "strikethrough");
  if (underline || strike) {
    style.textDecoration = [underline ? "underline" : null, strike ? "line-through" : null]
      .filter(Boolean)
      .join(" ");
  }
  if (env.fixedSize) style.whiteSpace = "nowrap";

  return <span style={style}>{node.text}</span>;
};

const LabelBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const systemImage = node.args.find((a) => a.label === "systemImage")?.value;
  const title = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");
  const iconOnly = env.labelStyle === "iconOnly";
  const titleOnly = env.labelStyle === "titleOnly";
  const labelNodes = node.argNodes?.label;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: env.color ?? "inherit", fontSize: env.font.size }}>
      {!titleOnly && typeof systemImage === "string" && (
        <SymbolView name={systemImage} size={env.font.size * env.symbolScale} color={env.color ?? "currentColor"} />
      )}
      {!iconOnly && (
        <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size, fontWeight: env.font.weight }}>
          {labelNodes ? renderChildren(node, env) : title}
        </span>
      )}
    </span>
  );
};

const ImageBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const systemName = node.args.find((a) => a.label === "systemName")?.value;
  const named = node.args.find((a) => a.label === "name")?.value;

  if (typeof systemName === "string") {
    const explicit = node.modifiers.some((m) => m.name === "font");
    const size = Math.round((explicit ? env.font.size : env.font.size * 1.2) * env.symbolScale);
    const color = env.color ?? "#000000";
    return <SymbolView name={systemName} size={size} color={color} />;
  }

  const name = typeof named === "string" ? named : "";
  const label = name || "image";
  return (
    <div
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 40,
        minHeight: 40,
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #E8E8ED 0%, #D8D8DE 100%)",
        borderRadius: 6,
        color: "#8E8E93",
      }}
    >
      <SymbolView name="photo" size={22} color="#8E8E93" />
    </div>
  );
};

const SymbolView: React.FC<{ name: string; size: number; color: string }> = ({ name, size, color }) => {
  const icon = lookupSymbol(name);

  if (!icon) {
    // Never an empty box: show a monogram tile naming the missing symbol so the
    // source stays readable (hover reveals the full SF Symbol name).
    const initials =
      name
        .split(".")
        .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "?";
    return (
      <span
        title={`SF Symbol "${name}" is not in the built-in catalogue`}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Math.max(3, size * 0.22),
          background: "rgba(120,120,128,0.12)",
          border: "1px dashed rgba(120,120,128,0.6)",
          color,
          fontFamily: FONT_STACK,
          fontSize: Math.max(6, size * 0.38),
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {initials}
      </span>
    );
  }

  if (icon.glyph) {
    return (
      <span
        style={{
          fontSize: size * 0.95,
          lineHeight: 1,
          color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
        }}
      >
        {icon.glyph}
      </span>
    );
  }

  const strokeWidth = Math.max(1, Math.min(2.2, size * 0.075));
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flexShrink: 0, display: "block" }}>
      {icon.commands.map((command, index) => {
        if (command.startsWith("F:")) {
          return <path key={index} d={command.slice(2)} fill={color} />;
        }
        if (command.startsWith("C ")) {
          const [cx, cy, r] = command.slice(2).split(" ").map(Number);
          return <circle key={index} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />;
        }
        if (command.startsWith("D ")) {
          const [cx, cy, r] = command.slice(2).split(" ").map(Number);
          return <circle key={index} cx={cx} cy={cy} r={r} fill={color} />;
        }
        return (
          <path
            key={index}
            d={command}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
};

/* ────────────────────────── Buttons ────────────────────────── */

const ButtonBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const role = isImplicitName(node.args.find((a) => a.label === "role")?.value);
  const style = env.buttonStyle ?? "automatic";
  const action = node.action;

  const handle = () => {
    if (action) action();
  };

  // The label fills the button box, so once `.frame(maxWidth: .infinity)`
  // stretches the button (or it sits in a greedy row), any Spacer inside the
  // label has room to grow instead of collapsing to its minimum.
  const label = node.children.length > 0 ? (
    <span style={{ display: "flex", flex: "1 1 auto", minWidth: 0, alignItems: "center", justifyContent: "center", gap: 6 }}>
      {renderChildren(node, env)}
    </span>
  ) : (
    <span>{node.text ?? "Button"}</span>
  );

  // A greedy label — `.frame(maxWidth: .infinity)` on the label's content, or a
  // horizontal Spacer inside it — makes the button greedy too. That is the
  // idiomatic SwiftUI recipe for a full-width button, so the button must claim
  // the width instead of shrinking around the label. The label span is a row,
  // so only children that flex horizontally count.
  const greedyLabel = node.children.some((child) => viewWantsFullWidth(child, "horizontal"));
  const greedyClasses = greedyLabel ? fullWidthClasses(env.axis) : [];
  const greedyStyle: React.CSSProperties = greedyLabel
    ? env.axis === "horizontal"
      ? { flexGrow: 1, flexBasis: 0, minWidth: 0, alignSelf: "stretch" }
      : { width: "100%", alignSelf: "stretch", maxWidth: "100%" }
    : {};
  const buttonClass = (extra: string) =>
    [extra, ...greedyClasses].filter(Boolean).join(" ");

  const textStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    maxWidth: "100%",
    ...greedyStyle,
    fontFamily: cssFontFamily(env.font),
    fontSize: env.font.size,
    fontWeight: env.font.weight,
    lineHeight: `${env.font.lineHeight}px`,
  };

  if (style === "borderedProminent") {
    return (
      <button
        type="button"
        onClick={handle}
        className={buttonClass("cursor-pointer active:opacity-70")}
        style={{
          ...textStyle,
          color: role === "destructive" ? "#fff" : "#fff",
          background: role === "destructive" ? "#FF3B30" : env.tint,
          borderRadius: 8,
          padding: "7px 14px",
          border: "none",
        }}
      >
        {label}
      </button>
    );
  }

  if (style === "bordered") {
    return (
      <button
        type="button"
        onClick={handle}
        className={buttonClass("cursor-pointer active:opacity-60")}
        style={{
          ...textStyle,
          color: role === "destructive" ? "#FF3B30" : env.tint,
          border: `1px solid ${role === "destructive" ? "rgba(255,59,48,0.45)" : "rgba(0,122,255,0.45)"}`,
          borderRadius: 8,
          padding: "7px 14px",
          background: "transparent",
        }}
      >
        {label}
      </button>
    );
  }

  if (style === "plain") {
    return (
      <button type="button" onClick={handle} className={buttonClass("cursor-pointer active:opacity-50")} style={{ ...textStyle, color: env.color ?? "#000000", background: "transparent", border: "none", padding: 0 }}>
        {label}
      </button>
    );
  }

  // Default (automatic) and borderless: tinted label, no chrome.
  return (
    <button
      type="button"
      onClick={handle}
      className={buttonClass("cursor-pointer active:opacity-50")}
      style={{
        ...textStyle,
        color: role === "destructive" ? "#FF3B30" : env.tint,
        background: "transparent",
        border: "none",
        padding: 0,
        fontWeight: 400,
      }}
    >
      {label}
    </button>
  );
};

const NavigationLinkBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const handle = () => {
    if (node.action) node.action();
  };

  const label = node.children.length > 0 ? (
    <span className="flex min-w-0 flex-1 items-center gap-2">{renderChildren(node, { ...env, color: env.color ?? "#000" })}</span>
  ) : (
    <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size, color: env.color ?? "#007AFF" }}>
      {node.text ?? "Link"}
    </span>
  );

  if (env.inList) {
    return (
      <button
        type="button"
        onClick={handle}
        className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left active:opacity-60"
        style={{ background: "transparent", border: "none", padding: 0, font: "inherit" }}
      >
        {label}
        <span className="ml-auto shrink-0 text-[#C7C7CC]">
          <SymbolView name="chevron.right" size={13} color="#C7C7CC" />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      className="cursor-pointer active:opacity-50"
      style={{ background: "transparent", border: "none", padding: 0, font: "inherit", color: env.tint }}
    >
      {label}
    </button>
  );
};

const LinkBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const url = typeof node.args[0]?.value === "string" ? node.args[0].value : "#";
  return (
    <a
      href={url}
      onClick={(event) => event.preventDefault()}
      style={{ color: env.tint, fontFamily: cssFontFamily(env.font), fontSize: env.font.size, textDecoration: "none" }}
    >
      {node.children.length > 0 ? renderChildren(node, env) : (node.text ?? url)}
    </a>
  );
};

/* ────────────────────────── Stacks ────────────────────────── */

function stackAlignment(alignmentName: string | null, direction: "column" | "row"): React.CSSProperties {
  if (direction === "column") {
    switch (alignmentName) {
      case "leading": return { alignItems: "flex-start" };
      case "trailing": return { alignItems: "flex-end" };
      default: return { alignItems: "center" };
    }
  }
  switch (alignmentName) {
    case "top": return { alignItems: "flex-start" };
    case "bottom": return { alignItems: "flex-end" };
    case "firstTextBaseline":
    case "lastTextBaseline":
      return { alignItems: "baseline" };
    default: return { alignItems: "center" };
  }
}

const StackBlock: React.FC<{ node: RNode; env: ViewEnv; direction: "column" | "row" }> = ({ node, env, direction }) => {
  const alignment = isImplicitName(node.args.find((a) => a.label === "alignment")?.value);
  const spacingArg = node.args.find((a) => a.label === "spacing")?.value;
  const spacing = typeof spacingArg === "number" ? spacingArg : METRICS.defaultStackSpacing;
  const axis: ViewEnv["axis"] = direction === "column" ? "vertical" : "horizontal";
  // A row containing a Spacer, a greedy Color, a flexible-width control or a
  // child with `.frame(maxWidth: .infinity)` consumes the offered width, exactly
  // like SwiftUI's layout proposal. The same applies vertically to a column
  // that contains a greedy child.
  const greedyRow = direction === "row" && node.children.some((child) => viewWantsFullWidth(child, "horizontal"));
  const greedyColumn = direction === "column" && node.children.some(isGreedyVertical);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction,
        gap: spacing,
        justifyContent: direction === "column" ? "flex-start" : "center",
        width: greedyRow ? "100%" : undefined,
        height: greedyColumn ? "100%" : undefined,
        position: "relative",
        minWidth: 0,
        minHeight: 0,
        ...stackAlignment(alignment, direction),
      }}
    >
      {node.children.map((child, index) => (
        <ViewNode key={child.key ?? child.id ?? index} node={child} env={{ ...env, axis }} />
      ))}
    </div>
  );
};

const ZStackBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const alignment = isImplicitName(node.args.find((a) => a.label === "alignment")?.value) ?? "center";
  const map = ALIGNMENTS[alignment] ?? ALIGNMENTS.center;
  // Grid overlay: children stack in one track. The track keeps the stretch
  // sizing (applying `justifyItems` here would shrink items to max-content and
  // collapse children that ask for `width:100%`); the ZStack alignment is
  // applied inside each item wrapper instead.
  const fillWidth = env.axis !== "horizontal";
  const fillHeight = node.children.some(isGreedyVertical);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        width: fillWidth ? "100%" : undefined,
        height: fillHeight ? "100%" : undefined,
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 0,
        isolation: "isolate",
      }}
    >
      {node.children.map((child, index) => (
        <div
          key={child.key ?? child.id ?? index}
          style={{
            gridArea: "1 / 1",
            // Explicit layer order reproduces SwiftUI's ZStack painting: the
            // first child is the bottom layer, each later child sits above it,
            // and `.zIndex(n)` re-weights a layer. Positioned + numbered keeps
            // the ordering deterministic even when an inner wrapper is
            // `position:relative` or absolutely positioned.
            position: "relative",
            zIndex: layerZIndex(child, index),
            display: "flex",
            alignItems: map.align,
            justifyContent: map.justify,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <ViewNode node={child} env={{ ...env, axis: "none" }} />
        </div>
      ))}
    </div>
  );
};

/**
 * GeometryReader measures its container and reports the size back to the
 * runtime, which rebuilds `geo.size` for the next render. Sub-pixel jitter is
 * filtered in PreviewRuntime.setGeometry so the observer→rebuild loop settles.
 */
const GeometryReaderBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const element = ref.current;
    const onResize = node.onResize;
    if (!element || !onResize) return;

    const report = () => {
      const rect = element.getBoundingClientRect();
      onResize(Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [node]);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        flexGrow: 1,
        alignSelf: "stretch",
        width: "100%",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {renderChildren(node, env)}
    </div>
  );
};

const SpacerBlock: React.FC<{ env: ViewEnv }> = ({ env }) => {
  const minLength = 8;
  const className = spacerClasses(env.axis).join(" ");
  if (env.axis === "horizontal") {
    return <div className={className} style={{ flexGrow: 1, flexBasis: 0, minWidth: minLength }} />;
  }
  return <div className={className} style={{ flexGrow: 1, flexBasis: 0, minHeight: minLength }} />;
};

const DividerBlock: React.FC<{ env: ViewEnv }> = ({ env }) => {
  if (env.axis === "horizontal") {
    return <div style={{ width: 1, alignSelf: "stretch", background: "rgba(60,60,67,0.29)" }} />;
  }
  return <div style={{ height: 1, width: "100%", background: "rgba(60,60,67,0.29)" }} />;
};

const GradientBlock: React.FC<{ node: RNode; kind: "linear" | "radial" | "angular" }> = ({ node, kind }) => {
  // `Color.red.gradient` / a Gradient value used directly as a view.
  const direct = node.args[0]?.value;
  if (direct && typeof direct === "object" && (direct as { t?: string }).t === "gradient") {
    const background = cssGradient(direct) ?? "transparent";
    return (
      <div
        style={{
          background,
          width: "100%",
          height: "100%",
          minWidth: 10,
          minHeight: 10,
          flexGrow: 1,
          alignSelf: "stretch",
        }}
      />
    );
  }

  const colorsValue = node.args.find((a) => a.label === "colors")?.value;
  const colors = Array.isArray(colorsValue)
    ? colorsValue.map((color) => cssColor(color) ?? "transparent")
    : [];
  const startPoint = isImplicitName(node.args.find((a) => a.label === "startPoint")?.value) ?? "top";
  const endPoint = isImplicitName(node.args.find((a) => a.label === "endPoint")?.value) ?? "bottom";

  return (
    <div
      style={{
        background: cssGradientStops(kind, colors, startPoint, endPoint),
        width: "100%",
        height: "100%",
        minWidth: 10,
        minHeight: 10,
        flexGrow: 1,
        alignSelf: "stretch",
      }}
    />
  );
};

const ColorBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node }) => {
  const css = cssColor(node.args[0]?.value) ?? "#FFFFFF";
  return <div style={{ background: css, flexGrow: 1, alignSelf: "stretch", minWidth: 10, minHeight: 10, width: "100%" }} />;
};

/** `Material.regular` / `.thinMaterial` used directly as a view. */
const MaterialBlock: React.FC<{ node: RNode }> = ({ node }) => {
  const material = cssMaterial(node.args[0]?.value) ?? {
    background: "rgba(255,255,255,0.72)",
    filter: "blur(24px) saturate(1.8)",
  };
  return (
    <div
      style={{
        background: material.background,
        backdropFilter: material.filter,
        WebkitBackdropFilter: material.filter,
        flexGrow: 1,
        alignSelf: "stretch",
        width: "100%",
        minWidth: 10,
        minHeight: 10,
      }}
    />
  );
};

const ShapeBlock: React.FC<{ node: RNode; env: ViewEnv; type: string }> = ({ node, env, type }) => {
  // `.fill(...)` / `.stroke(...)` produce an implicit value we can inspect.
  let fill: string | null = null;
  let stroke: string | null = null;
  let lineWidth = 1;
  for (const mod of node.modifiers) {
    if (mod.name === "fill") {
      const value = firstPositional(mod);
      fill = cssColor(value) ?? gradientCss(value) ?? fill;
    }
    if (mod.name === "stroke" || mod.name === "strokeBorder") {
      stroke = cssColor(firstPositional(mod)) ?? stroke;
      const width = mod.args.find((a) => a.label === "lineWidth")?.value;
      if (typeof width === "number") lineWidth = width;
    }
  }

  const background = fill ?? env.color ?? "#000000";

  // Custom `Path { … }` builds an SVG path string in the view builder.
  if (type === "Path") {
    const d = node.args.find((a) => a.label === "d")?.value;
    const viewBox = node.args.find((a) => a.label === "viewBox")?.value;
    const aspect = node.args.find((a) => a.label === "aspect")?.value;
    if (typeof d === "string" && typeof viewBox === "string") {
      return (
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          style={{
            width: "100%",
            height: "auto",
            aspectRatio: typeof aspect === "number" && aspect > 0 ? `${aspect}` : undefined,
            maxWidth: "100%",
            overflow: "visible",
          }}
        >
          <path
            d={d}
            fill={stroke ? "none" : background}
            stroke={stroke ?? undefined}
            strokeWidth={stroke ? lineWidth : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
  }

  // `.trim(from:to:)` on a stroked circle draws a partial ring. An SVG circle
  // with a pathLength-normalized dash matches trim semantics (start at 3
  // o'clock, clockwise) and `non-scaling-stroke` keeps the stroke width in
  // screen pixels while the viewBox scales to the frame.
  const trim = node.modifiers.find((m) => m.name === "trim");
  if (trim && stroke && (type === "Circle" || type === "Ellipse")) {
    const from = numOf(trim.args.find((a) => a.label === "from")?.value ?? null) ?? 0;
    const to = numOf(trim.args.find((a) => a.label === "to")?.value ?? null) ?? 1;
    const fraction = Math.max(0, Math.min(1, to - from));
    const frameMod = node.modifiers.find((m) => m.name === "frame");
    const frameWidth = numOf(frameMod?.args.find((a) => a.label === "width")?.value ?? null);
    const frameHeight = numOf(frameMod?.args.find((a) => a.label === "height")?.value ?? null);
    const basis = Math.min(frameWidth ?? 0, frameHeight ?? 0);
    const strokeUser = basis > 0 ? lineWidth * (100 / basis) : lineWidth;
    const radiusUser = Math.max(5, 50 - strokeUser / 2);
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      >
        <circle
          cx="50"
          cy="50"
          r={radiusUser}
          pathLength={100}
          fill={fill ? background : "none"}
          stroke={stroke}
          strokeWidth={lineWidth}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={`${fraction * 100} 100`}
          strokeDashoffset={-from * 100}
        />
      </svg>
    );
  }

  let radius: number | string = 0;
  if (type === "Circle" || type === "Ellipse") radius = "50%";
  if (type === "Capsule") radius = 9999;
  if (type === "RoundedRectangle") {
    const cornerRadius = node.args.find((a) => a.label === "cornerRadius")?.value;
    radius = typeof cornerRadius === "number" ? cornerRadius : 8;
  }

  const totalSize = node.modifiers.find((m) => m.name === "frame");
  const hasFrame = !!totalSize;

  return (
    <div
      style={{
        background: stroke ? "transparent" : background,
        border: stroke ? `${lineWidth}px solid ${stroke}` : undefined,
        borderRadius: radius,
        flexGrow: hasFrame ? 0 : 1,
        alignSelf: "stretch",
        width: "100%",
        height: "100%",
        minWidth: 10,
        minHeight: 10,
      }}
    />
  );
};

/* ────────────────────────── Scroll / List / Section ────────────────────────── */

const ScrollViewBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const axes = node.args[0]?.value;
  const horizontal = isImplicitName(axes) === "horizontal";
  return (
    <div
      className="min-h-0 min-w-0"
      style={{
        flexGrow: 1,
        alignSelf: "stretch",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
        overflowX: horizontal ? "auto" : "hidden",
        overflowY: horizontal ? "hidden" : "auto",
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        alignItems: horizontal ? "center" : undefined,
      }}
    >
      {node.children.map((child, index) => (
        <ViewNode key={child.key ?? child.id ?? index} node={child} env={{ ...env, axis: horizontal ? "horizontal" : "vertical" }} />
      ))}
    </div>
  );
};

const ListBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const style = env.listStyle ?? "insetGrouped";
  const inset = style === "insetGrouped" || style === "inset" || style === "sidebar";
  const grouped = style === "grouped" || style === "insetGrouped";
  const background = grouped ? "#F2F2F7" : "#FFFFFF";

  // Split children into sections and loose rows.
  const groups: { section: RNode | null; rows: RNode[] }[] = [];
  let current: { section: RNode | null; rows: RNode[] } = { section: null, rows: [] };

  for (const child of node.children) {
    if (child.type === "Section") {
      if (current.rows.length > 0 || current.section) groups.push(current);
      current = { section: child, rows: child.children };
    } else {
      current.rows.push(child);
    }
  }
  if (current.rows.length > 0 || current.section) groups.push(current);

  return (
    <div
      className="min-h-0"
      style={{ flexGrow: 1, alignSelf: "stretch", minHeight: 0, position: "relative", background, overflowY: "auto" }}
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} style={{ paddingTop: grouped ? 16 : 0, marginBottom: grouped ? 14 : 0 }}>
          {group.section && (
            <SectionHeader node={group.section} env={env} inset={inset} />
          )}
          <div
            style={{
              marginLeft: inset ? 16 : 0,
              marginRight: inset ? 16 : 0,
              borderRadius: inset ? 10 : 0,
              overflow: "hidden",
              background: "#FFFFFF",
            }}
          >
            {group.rows.map((row, rowIndex) => (
              <ListRow
                key={row.key ?? row.id ?? rowIndex}
                node={row}
                env={env}
                last={rowIndex === group.rows.length - 1}
                inset={inset}
              />
            ))}
          </div>
          {group.section && (group.section.argNodes?.footer || null) && (
            <div style={{ padding: "6px 32px 0", fontSize: 13, color: "rgba(60,60,67,0.6)" }}>
              {group.section.argNodes?.footer?.map((child, index) => (
                <ViewNode key={index} node={child} env={env} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const SectionHeader: React.FC<{ node: RNode; env: ViewEnv; inset: boolean }> = ({ node, env, inset }) => {
  const headerNodes = node.argNodes?.header;
  const headerText = typeof node.args[0]?.value === "string" && node.args[0].label === "header"
    ? node.args[0].value
    : node.args.find((a) => a.label === "header")?.value;
  const text = typeof headerText === "string" ? headerText : undefined;
  if (!headerNodes && !text) return null;
  return (
    <div
      style={{
        padding: inset ? "0 32px 6px" : "10px 16px 6px",
        fontSize: 13,
        fontWeight: 400,
        letterSpacing: 0.06,
        color: "rgba(60,60,67,0.6)",
      }}
    >
      {headerNodes
        ? headerNodes.map((child, index) => <ViewNode key={index} node={child} env={env} />)
        : text}
    </div>
  );
};

const ListRow: React.FC<{ node: RNode; env: ViewEnv; last: boolean; inset: boolean }> = ({ node, env, last, inset }) => {
  const isSection = node.type === "Section";
  if (isSection) {
    return (
      <div>
        <SectionHeader node={node} env={env} inset={inset} />
        {node.children.map((child, index) => (
          <ListRow key={child.key ?? child.id ?? index} node={child} env={env} last={index === node.children.length - 1} inset={inset} />
        ))}
      </div>
    );
  }

  const isButtonRow = node.type === "Button" || node.type === "NavigationLink";

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: METRICS.listRowHeight,
          padding: "11px 16px",
        }}
      >
        {isButtonRow ? (
          <ViewNode node={node} env={{ ...env, inList: true }} />
        ) : (
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <ViewNode node={node} env={{ ...env, inList: true }} />
          </div>
        )}
      </div>
      {!last && (
        <div style={{ position: "absolute", left: 16, right: 0, bottom: 0, height: 1, background: "rgba(60,60,67,0.29)" }} />
      )}
    </div>
  );
};

const SectionBlock: React.FC<{ node: RNode; env: ViewEnv; inList?: boolean }> = ({ node, env, inList }) => {
  return (
    <div>
      <SectionHeader node={node} env={env} inset={!!inList} />
      <div style={{ background: inList ? "#FFFFFF" : undefined }}>
        {node.children.map((child, index) => (
          <ViewNode key={child.key ?? child.id ?? index} node={child} env={env} />
        ))}
      </div>
    </div>
  );
};

/* ────────────────────────── Controls ────────────────────────── */

const ToggleBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "isOn" || b.label === undefined)?.binding;
  const isOn = !!truthy(binding?.get());
  const label = node.children.length > 0 ? renderChildren(node, env) : <span>{node.text ?? ""}</span>;
  const style = env.toggleStyle ?? "automatic";

  if (style === "button") {
    return (
      <button
        type="button"
        onClick={() => binding?.set(!isOn)}
        className="cursor-pointer"
        style={{
          padding: "6px 12px",
          borderRadius: 999,
          border: "none",
          background: isOn ? env.tint : "#E9E9EB",
          color: isOn ? "#fff" : "#000",
          fontSize: env.font.size,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <span style={{ flexGrow: 1, minWidth: 0, fontFamily: cssFontFamily(env.font), fontSize: env.font.size, color: env.color ?? "#000" }}>
        {label}
      </span>
      <button
        type="button"
        aria-pressed={isOn}
        onClick={() => binding?.set(!isOn)}
        className="cursor-pointer"
        style={{
          width: 51,
          height: 31,
          borderRadius: 999,
          background: isOn ? "#34C759" : "#E9E9EB",
          padding: 2,
          display: "flex",
          justifyContent: isOn ? "flex-end" : "flex-start",
          transition: "background 200ms ease",
          border: "none",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 27,
            height: 27,
            borderRadius: 999,
            background: "#fff",
            boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16)",
            transition: "transform 200ms ease",
          }}
        />
      </button>
    </div>
  );
};

interface PickerOption {
  label: string;
  tag: Value;
}

function pickerOptions(node: RNode): PickerOption[] {
  const options: PickerOption[] = [];
  for (const child of node.children) {
    if (child.type === "Text") {
      const tag = child.modifiers.find((m) => m.name === "tag")?.value;
      options.push({ label: child.text ?? "", tag: tag ?? child.text });
    } else if (child.type === "Label") {
      const tag = child.modifiers.find((m) => m.name === "tag")?.value;
      options.push({ label: child.text ?? "", tag: tag ?? child.text });
    } else if (child.type === "Group" || child.type === "ForEach") {
      for (const nested of child.children) {
        const tag = nested.modifiers.find((m) => m.name === "tag")?.value;
        options.push({ label: nested.text ?? "", tag: tag ?? nested.text });
      }
    }
  }
  return options;
}

const PickerBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "selection" || b.label === undefined)?.binding;
  const options = pickerOptions(node);
  const selected = binding?.get();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => valuesEqual(option.tag, selected)),
  );

  const style = env.pickerStyle ?? (env.toggleStyle ? "automatic" : "automatic");
  const labelText = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");

  if (style === "segmented") {
    return (
      <div style={{ display: "flex", background: "rgba(120,120,128,0.12)", borderRadius: 9, padding: 2, width: "100%" }}>
        {options.map((option, index) => {
          const active = index === selectedIndex;
          return (
            <button
              key={index}
              type="button"
              onClick={() => binding?.set(option.tag)}
              className="cursor-pointer"
              style={{
                flex: 1,
                padding: "6px 8px",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                borderRadius: 7,
                border: "none",
                background: active ? "#FFFFFF" : "transparent",
                boxShadow: active ? "0 3px 8px rgba(0,0,0,0.12)" : undefined,
                color: "#000",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (style === "wheel") {
    return (
      <div style={{ maxHeight: 220, overflowY: "auto", borderTop: "1px solid rgba(60,60,67,0.15)", borderBottom: "1px solid rgba(60,60,67,0.15)" }}>
        {options.map((option, index) => (
          <button
            key={index}
            type="button"
            onClick={() => binding?.set(option.tag)}
            className="flex w-full cursor-pointer items-center justify-center"
            style={{
              padding: "9px 0",
              background: index === selectedIndex ? "rgba(120,120,128,0.12)" : "transparent",
              border: "none",
              fontSize: 16,
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  // Menu style (iOS default inside forms/lists).
  return (
    <MenuSurface
      label={
        <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 8 }}>
          {labelText && (
            <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size, color: env.color ?? "#000" }}>
              {labelText}
            </span>
          )}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, color: "rgba(60,60,67,0.6)", fontSize: env.font.size }}>
            {options[selectedIndex]?.label ?? "—"}
            <SymbolView name="chevron.up.chevron.down" size={12} color="rgba(60,60,67,0.6)" />
          </span>
        </div>
      }
      options={options.map((option, index) => ({
        label: option.label,
        selected: index === selectedIndex,
        onSelect: () => binding?.set(option.tag),
      }))}
    />
  );
};

const MenuBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const label = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "Menu");
  const items = node.children.map((child) => ({
    label: child.text ?? child.type,
    selected: false,
    onSelect: () => child.action?.(),
  }));

  return (
    <MenuSurface
      label={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: env.tint, fontSize: env.font.size }}>
          {label}
          <SymbolView name="chevron.down" size={11} color={env.tint} />
        </span>
      }
      options={items}
    />
  );
};

const MenuSurface: React.FC<{
  label: React.ReactNode;
  options: { label: string; selected: boolean; onSelect: () => void }[];
}> = ({ label, options }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full cursor-pointer text-left"
        style={{ background: "transparent", border: "none", padding: 0, font: "inherit" }}
      >
        {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 200,
            background: "rgba(255,255,255,0.98)",
            borderRadius: 13,
            boxShadow: "0 10px 40px rgba(0,0,0,0.18)",
            backdropFilter: "blur(20px)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          {options.map((option, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                option.onSelect();
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center justify-between"
              style={{
                padding: "11px 16px",
                fontSize: 17,
                background: "transparent",
                border: "none",
                borderTop: index > 0 ? "1px solid rgba(60,60,67,0.15)" : undefined,
              }}
            >
              <span>{option.label}</span>
              {option.selected && <SymbolView name="checkmark" size={15} color="#007AFF" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

function valuesEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  const nameA = isImplicitName(a);
  const nameB = isImplicitName(b);
  if (nameA !== null && nameB !== null) return nameA === nameB;
  return String(a) === String(b);
}

const SliderBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "value" || b.label === undefined)?.binding;
  const range = node.args.find((a) => a.label === "in")?.value;
  const step = node.args.find((a) => a.label === "step")?.value;

  let min = 0;
  let max = 1;
  const rangeRef = range as { t?: string; lo?: number; hi?: number; closed?: boolean } | undefined;
  if (rangeRef && rangeRef.t === "range") {
    min = rangeRef.lo ?? 0;
    max = rangeRef.hi ?? 1;
  }

  const value = typeof binding?.get() === "number" ? (binding.get() as number) : min;
  const ratio = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const ref = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);

  const update = (clientX: number) => {
    const element = ref.current;
    if (!element || !binding) return;
    const rect = element.getBoundingClientRect();
    const local = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let next = min + local * (max - min);
    if (typeof step === "number" && step > 0) {
      next = Math.round(next / step) * step;
    }
    binding.set(Number(next.toFixed(4)));
  };

  return (
    <div
      ref={ref}
      style={{ position: "relative", height: 28, width: "100%", display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" }}
      onPointerDown={(event) => {
        dragging.current = true;
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        update(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) update(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <div style={{ height: 4, width: "100%", borderRadius: 2, background: "rgba(120,120,128,0.2)", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${ratio * 100}%`, borderRadius: 2, background: env.tint }} />
      </div>
      <div
        style={{
          position: "absolute",
          left: `calc(${ratio * 100}% - 14px)`,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 3px 8px rgba(0,0,0,0.2), 0 1px 1px rgba(0,0,0,0.16)",
        }}
      />
    </div>
  );
};

const StepperBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "value")?.binding;
  const range = node.args.find((a) => a.label === "in")?.value as { t?: string; lo?: number; hi?: number } | undefined;
  const step = node.args.find((a) => a.label === "step")?.value;
  const stepSize = typeof step === "number" ? step : 1;
  const label = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");

  const adjust = (delta: number) => {
    if (!binding) return;
    const current = typeof binding.get() === "number" ? (binding.get() as number) : 0;
    let next = current + delta * stepSize;
    if (range && range.t === "range") {
      next = Math.max(range.lo ?? next, Math.min(range.hi ?? next, next));
    }
    binding.set(next);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size, color: env.color ?? "#000" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", background: "rgba(120,120,128,0.12)", borderRadius: 8, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => adjust(-1)}
          className="cursor-pointer active:opacity-60"
          style={{ width: 44, height: 32, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <SymbolView name="minus" size={16} color="#000" />
        </button>
        <div style={{ width: 1, height: 32, background: "rgba(60,60,67,0.2)" }} />
        <button
          type="button"
          onClick={() => adjust(1)}
          className="cursor-pointer active:opacity-60"
          style={{ width: 44, height: 32, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <SymbolView name="plus" size={16} color="#000" />
        </button>
      </div>
    </div>
  );
};

const TextFieldBlock: React.FC<{ node: RNode; env: ViewEnv; secure: boolean }> = ({ node, env, secure }) => {
  const binding = node.bindings?.find((b) => b.label === "text")?.binding;
  const placeholder = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");
  const value = typeof binding?.get() === "string" ? (binding.get() as string) : "";
  const axis = node.args.find((a) => a.label === "axis")?.value;
  const multiline = isImplicitName(axis) === "vertical";
  const rounded = env.textFieldStyle === "roundedBorder";

  // SwiftUI's TextField is flexible-width: it fills a column and takes the
  // remaining space beside siblings in a row. `width:100%` inside a row would
  // starve those siblings (text wraps to two lines), so the row case uses a
  // zero-basis grow instead — emitted both as Tailwind classes and as inline
  // styles so the mapping is visible in the DOM and no Tailwind build is needed.
  const inRow = env.axis === "horizontal";
  const className = inRow ? "flex-1 basis-0 min-w-0" : "w-full";
  const common: React.CSSProperties = {
    ...(inRow
      ? { flexGrow: 1, flexBasis: 0 }
      : { width: "100%" }),
    // Never let a shrink-to-fit flex parent collapse the control.
    alignSelf: "stretch",
    minWidth: 0,
    fontFamily: cssFontFamily(env.font),
    fontSize: env.font.size,
    color: env.color ?? "#000",
    background: rounded ? "#FFFFFF" : "transparent",
    border: rounded ? "1px solid rgba(60,60,67,0.29)" : "none",
    borderRadius: rounded ? 8 : 0,
    padding: rounded ? "7px 10px" : 0,
    outline: "none",
    textAlign: cssTextAlign(env.multiline),
  };

  if (multiline) {
    return (
      <textarea
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(event) => binding?.set(event.target.value)}
        rows={3}
        style={{ ...common, resize: "none", border: "1px solid rgba(60,60,67,0.29)", borderRadius: 8, padding: "8px 10px" }}
      />
    );
  }

  return (
    <input
      className={className}
      type={secure ? "password" : "text"}
      value={value}
      placeholder={placeholder}
      onChange={(event) => binding?.set(event.target.value)}
      style={common}
    />
  );
};

const TextEditorBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "text")?.binding;
  const value = typeof binding?.get() === "string" ? (binding.get() as string) : "";
  const inRow = env.axis === "horizontal";
  return (
    <textarea
      className={inRow ? "flex-1 basis-0 min-w-0" : "w-full"}
      value={value}
      onChange={(event) => binding?.set(event.target.value)}
      rows={5}
      style={{
        ...(inRow ? { flexGrow: 1, flexBasis: 0 } : { width: "100%" }),
        alignSelf: "stretch",
        minWidth: 0,
        fontFamily: cssFontFamily(env.font),
        fontSize: env.font.size,
        border: "1px solid rgba(60,60,67,0.29)",
        borderRadius: 8,
        padding: "8px 10px",
        resize: "none",
        outline: "none",
      }}
    />
  );
};

const DatePickerBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "selection")?.binding;
  const label = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");
  const value = typeof binding?.get() === "string" ? (binding.get() as string) : "";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
      <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size }}>{label}</span>
      <input
        type="date"
        value={value.slice(0, 10)}
        onChange={(event) => binding?.set(event.target.value)}
        style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size, color: env.tint, border: "none", background: "transparent", outline: "none" }}
      />
    </div>
  );
};

const ColorPickerBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "selection")?.binding;
  const label = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");
  const value = cssColor(binding?.get()) ?? "#007AFF";
  void env;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
      <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size }}>{label}</span>
      <input
        type="color"
        value={value.startsWith("#") ? value : "#007AFF"}
        onChange={(event) => binding?.set(event.target.value)}
        style={{ width: 28, height: 28, border: "none", background: "transparent", padding: 0, borderRadius: 999 }}
      />
    </div>
  );
};

const ProgressBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const value = node.args.find((a) => a.label === "value")?.value;
  const total = node.args.find((a) => a.label === "total")?.value;
  const hasValue = typeof value === "number";
  const style = env.progressStyle ?? "automatic";

  if (!hasValue && style !== "linear") {
    return <Spinner />;
  }

  const max = typeof total === "number" ? total : 1;
  const ratio = hasValue ? Math.max(0, Math.min(1, (value as number) / max)) : 0;
  return (
    <div style={{ height: 4, width: "100%", minWidth: 80, background: "rgba(120,120,128,0.24)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${ratio * 100}%`, background: env.tint, borderRadius: 2, transition: "width 200ms ease" }} />
    </div>
  );
};

const GaugeBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const value = node.args.find((a) => a.label === "value")?.value;
  const range = node.args.find((a) => a.label === "in")?.value as { t?: string; lo?: number; hi?: number } | undefined;
  const lo = range?.lo ?? 0;
  const hi = range?.hi ?? 1;
  const ratio = typeof value === "number" ? Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1))) : 0;
  return (
    <div style={{ position: "relative", width: 120, height: 60, overflow: "hidden" }}>
      <div style={{ width: 120, height: 120, borderRadius: "50%", border: "10px solid rgba(120,120,128,0.2)", borderBottomColor: "transparent", borderLeftColor: "transparent", transform: "rotate(-45deg)" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: 120,
          height: 120,
          borderRadius: "50%",
          border: "10px solid",
          borderColor: `${env.tint} ${env.tint} transparent transparent`,
          transform: `rotate(${-45 + ratio * 270}deg)`,
        }}
      />
    </div>
  );
};

const Spinner: React.FC = () => (
  <div
    style={{
      width: 20,
      height: 20,
      borderRadius: "50%",
      border: "2px solid rgba(120,120,128,0.25)",
      borderTopColor: "#8E8E93",
      animation: "swiftcanvas-spin 900ms linear infinite",
    }}
  />
);

/* ────────────────────────── Grids ────────────────────────── */

const GridBlock: React.FC<{ node: RNode; env: ViewEnv; direction: "vertical" | "horizontal" }> = ({ node, env, direction }) => {
  const itemsArg = node.args.find((a) => a.label === "columns" || a.label === "rows")?.value;
  const items = Array.isArray(itemsArg) ? itemsArg : [];
  const spacingArg = node.args.find((a) => a.label === "spacing")?.value;
  const spacing = typeof spacingArg === "number" ? spacingArg : 8;

  const tracks = items.map((item) => gridTrack(item)).join(" ");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: direction === "vertical" ? (tracks || "repeat(2, minmax(0, 1fr))") : "1fr",
        gridTemplateRows: direction === "horizontal" ? (tracks || "repeat(2, auto)") : undefined,
        gridAutoFlow: direction === "vertical" ? "row" : "column",
        gap: spacing,
        width: "100%",
      }}
    >
      {node.children.map((child, index) => (
        <ViewNode key={child.key ?? child.id ?? index} node={child} env={env} />
      ))}
    </div>
  );
};

function gridTrack(item: Value): string {
  // `GridItem(.flexible())` / `.fixed(120)` / `.adaptive(minimum: 80, maximum: 160)`
  if (item && typeof item === "object" && (item as { t?: string }).t === "implicit") {
    const descriptor = item as {
      t: "implicit";
      path: string[];
      args?: { label?: string; value: Value }[];
    };
    const inner = descriptor.path[0] === "GridItem" ? descriptor.args?.[0]?.value : descriptor;
    if (inner && typeof inner === "object" && (inner as { t?: string }).t === "implicit") {
      const innerRef = inner as { path: string[]; args?: { label?: string; value: Value }[] };
      const kind = innerRef.path[innerRef.path.length - 1];
      const findArg = (...labels: string[]) =>
        innerRef.args?.find((arg) => arg.label !== undefined && labels.includes(arg.label))?.value;
      const positionals = innerRef.args?.filter((arg) => arg.label === undefined).map((arg) => arg.value) ?? [];

      if (kind === "adaptive") {
        const minimum = numOf(findArg("minimum", "minimal") ?? positionals[0] ?? null) ?? 80;
        return `repeat(auto-fit, minmax(${Math.max(1, minimum)}px, 1fr))`;
      }
      if (kind === "fixed") {
        const size = numOf(positionals[0] ?? findArg("size") ?? null);
        return size !== undefined ? `${Math.max(1, size)}px` : "minmax(0, 1fr)";
      }
      return "minmax(0, 1fr)";
    }
  }
  if (item && typeof item === "object" && (item as { t?: string }).t === "closure") {
    return "minmax(0, 1fr)";
  }
  return "minmax(0, 1fr)";
}

const SwiftGridBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => (
  <div style={{ display: "grid", gridAutoFlow: "row", width: "100%" }}>
    {node.children.map((child, index) => (
      <ViewNode key={child.key ?? child.id ?? index} node={child} env={env} />
    ))}
  </div>
);

/* ────────────────────────── TabView / Menu / Disclosure ────────────────────────── */

const TabViewBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const binding = node.bindings?.find((b) => b.label === "selection")?.binding;
  const [internal, setInternal] = React.useState(0);

  const tabs = node.children.map((child, index) => {
    const tabItem = child.modifiers.find((m) => m.name === "tabItem");
    const labelNode = tabItem?.children?.[0];
    let icon: string | undefined;
    let text: string | undefined;

    if (labelNode) {
      if (labelNode.type === "Label") {
        const systemImage = labelNode.args.find((a) => a.label === "systemImage")?.value;
        icon = typeof systemImage === "string" ? systemImage : undefined;
        text = labelNode.text ?? (typeof labelNode.args[0]?.value === "string" ? labelNode.args[0].value : undefined);
      } else if (labelNode.type === "Image") {
        const systemImage = labelNode.args.find((a) => a.label === "systemName")?.value;
        icon = typeof systemImage === "string" ? systemImage : undefined;
      } else {
        text = labelNode.text;
      }
    }

    const tag = child.modifiers.find((m) => m.name === "tag")?.value;
    return {
      key: child.key ?? child.id ?? String(index),
      content: child,
      icon: icon ?? "circle",
      text: text ?? `Tab ${index + 1}`,
      tag: tag ?? index,
    };
  });

  const selectedTag = binding?.get();
  let selectedIndex = tabs.findIndex((tab) => valuesEqual(tab.tag, selectedTag));
  if (selectedIndex < 0) selectedIndex = Math.min(internal, Math.max(0, tabs.length - 1));

  const select = (index: number) => {
    setInternal(index);
    if (binding) binding.set(tabs[index].tag);
  };

  const active = tabs[selectedIndex];

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignSelf: "stretch", minHeight: 0 }}>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {active && <ViewNode key={active.key} node={active.content} env={{ ...env, axis: "vertical" }} />}
      </div>
      <div
        style={{
          display: "flex",
          height: METRICS.tabBarHeight,
          borderTop: "1px solid rgba(60,60,67,0.29)",
          background: "rgba(249,249,249,0.94)",
          backdropFilter: "blur(20px) saturate(1.8)",
          flexShrink: 0,
        }}
      >
        {tabs.map((tab, index) => {
          const isActive = index === selectedIndex;
          const color = isActive ? env.tint : "#999999";
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => select(index)}
              className="flex cursor-pointer flex-col items-center justify-center gap-1"
              style={{ flex: 1, background: "transparent", border: "none", padding: 0 }}
            >
              <SymbolView name={tab.icon} size={25} color={color} />
              <span style={{ fontSize: 10, fontWeight: 500, color, letterSpacing: 0.1 }}>{tab.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const DisclosureBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const [open, setOpen] = React.useState(false);
  const title = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "Details");
  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between"
        style={{ background: "transparent", border: "none", padding: 0, font: "inherit", color: env.tint, fontSize: env.font.size }}
      >
        <span>{title}</span>
        <SymbolView name={open ? "chevron.down" : "chevron.right"} size={13} color={env.tint} />
      </button>
      {open && (
        <div style={{ paddingTop: 8 }}>
          {renderChildren(node, env)}
        </div>
      )}
    </div>
  );
};

const LabeledContentBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const label = node.argNodes?.label;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <span style={{ fontFamily: cssFontFamily(env.font), fontSize: env.font.size, color: env.color ?? "#000" }}>
        {label ? label.map((child, index) => <ViewNode key={index} node={child} env={env} />) : node.text}
      </span>
      <span style={{ color: "rgba(60,60,67,0.6)", display: "flex", alignItems: "center", gap: 6 }}>
        {renderChildren(node, env)}
      </span>
    </div>
  );
};

const ContentUnavailableBlock: React.FC<{ node: RNode; env: ViewEnv }> = ({ node, env }) => {
  const systemImage = node.args.find((a) => a.label === "systemImage")?.value;
  const title = node.text ?? (typeof node.args[0]?.value === "string" ? node.args[0].value : "");
  const description = typeof node.args[1]?.value === "string" ? node.args[1].value : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 32, textAlign: "center", width: "100%" }}>
      {typeof systemImage === "string" && <SymbolView name={systemImage} size={48} color="#8E8E93" />}
      <span style={{ fontSize: 22, fontWeight: 600, color: "#000" }}>{title}</span>
      {description && <span style={{ fontSize: 15, color: "rgba(60,60,67,0.6)" }}>{description}</span>}
      <span style={{ display: "none" }}>{renderChildren(node, env)}</span>
    </div>
  );
};

/* ══════════════════════════════ Screen chrome ══════════════════════════════ */

const NavBar: React.FC<{ screen: Screen; env: ViewEnv; onBack: () => void }> = ({ screen, env, onBack }) => {
  const showBar = !!screen.title || !screen.isRoot || screen.toolbar.length > 0;
  if (!showBar) return null;
  const large = screen.titleMode === "large" || (screen.titleMode === "automatic" && screen.isRoot);

  return (
    <div style={{ position: "relative", zIndex: 20, flexShrink: 0, background: "rgba(249,249,249,0.94)", backdropFilter: "blur(20px) saturate(1.8)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "76px 1fr 76px",
          alignItems: "center",
          height: METRICS.navigationBarHeight,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {!screen.isRoot ? (
          <button
            type="button"
            onClick={onBack}
            className="flex cursor-pointer items-center gap-0.5 active:opacity-50"
            style={{ background: "transparent", border: "none", color: env.tint, fontSize: 17, padding: 0 }}
          >
            <SymbolView name="chevron.left" size={19} color={env.tint} />
            Back
          </button>
        ) : (
          <span />
        )}

        {large ? (
          <span />
        ) : (
          <span
            style={{
              textAlign: "center",
              fontSize: 17,
              fontWeight: 600,
              color: "#000",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {screen.title ?? ""}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
          {screen.toolbar.map((item, index) => (
            <ViewNode key={item.key ?? item.id ?? index} node={item} env={env} />
          ))}
        </div>
      </div>

      {large && screen.title && (
        <div style={{ padding: "1px 16px 8px" }}>
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.37, color: "#000" }}>{screen.title}</span>
        </div>
      )}

      <div style={{ height: 0.5, background: "rgba(60,60,67,0.29)" }} />
    </div>
  );
};

/* ────────────────────────── Modals ────────────────────────── */

const ModalLayer: React.FC<{ modals: ModalSpec[]; env: ViewEnv }> = ({ modals, env }) => (
  <>
    {modals.map((modal) =>
      modal.kind === "alert" ? (
        <AlertView key={modal.id} modal={modal} env={env} />
      ) : (
        <SheetView key={modal.id} modal={modal} env={env} />
      ),
    )}
  </>
);

const SheetView: React.FC<{ modal: ModalSpec; env: ViewEnv }> = ({ modal, env }) => {
  const detent = modal.detents.length > 0 ? Math.max(...modal.detents) : 0.55;
  if (modal.isFullScreen) {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 60, background: "#fff", display: "flex", flexDirection: "column" }}>
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto" }}>{modal.node && <ViewNode node={modal.node} env={env} />}</div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} onClick={modal.dismiss} />
      <div
        style={{
          position: "relative",
          height: `${Math.round(detent * 100)}%`,
          background: "#fff",
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          boxShadow: "0 -8px 40px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          animation: "swiftcanvas-sheet 280ms cubic-bezier(0.32, 0.72, 0, 1)",
          overflow: "hidden",
        }}
      >
        <div style={{ height: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <div style={{ width: 36, height: 5, borderRadius: 999, background: "rgba(60,60,67,0.3)" }} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto" }}>{modal.node && <ViewNode node={modal.node} env={env} />}</div>
      </div>
    </div>
  );
};

const AlertView: React.FC<{ modal: ModalSpec; env: ViewEnv }> = ({ modal, env }) => {
  const actions = modal.actions ?? [];
  return (
  <div style={{ position: "absolute", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.25)" }}>
    <div
      style={{
        width: 270,
        borderRadius: 14,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(24px) saturate(1.8)",
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        animation: "swiftcanvas-alert 180ms ease-out",
      }}
    >
      <div style={{ padding: "19px 16px 15px", textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: "#000" }}>{modal.title}</div>
        {modal.message && (
          <div style={{ marginTop: 4, fontSize: 13, color: "#000", opacity: 0.9 }}>
            <ViewNode node={modal.message} env={{ ...env, font: resolveFont("body", 13), multiline: "center" }} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid rgba(60,60,67,0.2)" }}>
        {actions.map((action, index) => (
          <button
            key={action.key ?? action.id ?? index}
            type="button"
            onClick={() => {
              action.action?.();
              modal.dismiss();
            }}
            className="cursor-pointer active:bg-black/5"
            style={{
              padding: "11px 16px",
              fontSize: 17,
              color: "#007AFF",
              background: "transparent",
              border: "none",
              borderTop: index > 0 ? "1px solid rgba(60,60,67,0.2)" : undefined,
            }}
          >
            {action.text ?? "OK"}
          </button>
        ))}
        {actions.length === 0 && (
          <button
            type="button"
            onClick={modal.dismiss}
            className="cursor-pointer active:bg-black/5"
            style={{ padding: "11px 16px", fontSize: 17, fontWeight: 600, color: "#007AFF", background: "transparent", border: "none" }}
          >
            OK
          </button>
        )}
      </div>
    </div>
  </div>
  );
};

/* ══════════════════════════════ Root component ══════════════════════════════ */

export interface SwiftPreviewProps {
  runtime: PreviewRuntime;
  onLog?: (message: string) => void;
  isRunning?: boolean;
}

const SwiftPreview: React.FC<SwiftPreviewProps> = ({ runtime, onLog, isRunning = true }) => {
  const version = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);

  React.useEffect(() => {
    runtime.setLogHandler(onLog ?? null);
    return () => runtime.setLogHandler(null);
  }, [runtime, onLog]);

  const screen = React.useMemo(() => runtime.buildScreen(), [runtime, version]);

  if (!isRunning) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white"
        style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", alignItems: "center", justifyContent: "center", gap: 4, background: "#fff" }}
      >
        <span className="text-[13px] font-medium text-neutral-500">Preview stopped</span>
        <span className="text-[11px] text-neutral-400">Press Run to restart the app.</span>
      </div>
    );
  }

  const rootEdges = ignoredSafeAreaEdges(screen.node.modifiers);
  const topInset = rootEdges.top ? 0 : METRICS.safeAreaTop;
  const bottomInset = rootEdges.bottom ? 0 : METRICS.safeAreaBottom;
  const env: ViewEnv = { ...BASE_ENV, safeArea: { top: topInset, bottom: bottomInset } };
  const showBar = !!screen.title || !screen.isRoot || screen.toolbar.length > 0;

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-white"
      style={{
        // Critical sizing is inline so the preview still fills its host when
        // the embedding page does not ship Tailwind (exports, standalone).
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: "#fff",
        fontFamily: FONT_STACK,
        color: "#000",
        WebkitFontSmoothing: "antialiased",
        userSelect: "none",
      }}
    >
      <style>{`
        @keyframes swiftcanvas-spin { to { transform: rotate(360deg); } }
        @keyframes swiftcanvas-sheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes swiftcanvas-alert { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      {/*
        The safe-area inset lives on the scroll container (not the outer shell)
        so a nested `.ignoresSafeArea()` layer can pull itself into the band
        with a negative margin without being clipped: overflow clips at the
        padding box, and the band is part of it. The navigation bar reserves
        the top inset itself when it is visible.
      */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        {showBar && (
          <div style={{ flexShrink: 0, paddingTop: topInset }}>
            <NavBar screen={screen} env={env} onBack={() => runtime.pop()} />
          </div>
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{
            flex: "1 1 0%",
            minHeight: 0,
            overflowY: "auto",
            paddingTop: showBar ? 0 : topInset,
            paddingBottom: bottomInset,
          }}
        >
          <ViewNode node={screen.node} env={env} />
        </div>
      </div>

      <ModalLayer modals={screen.modals} env={env} />
    </div>
  );
};

export default SwiftPreview;
