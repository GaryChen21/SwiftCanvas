/**
 * viewBuilder.ts — evaluates the parsed SwiftUI view tree against live state.
 *
 * Produces an `RNode` tree that the React renderer turns into DOM. Handles the
 * parts of SwiftUI that need real semantics rather than syntax:
 *
 *  - `if` / `else` and `switch` inside view builders
 *  - `ForEach` over arrays, ranges and `List` row closures
 *  - user-defined view structs with `@State`, `@Binding`, props and methods
 *  - `Button` / `NavigationLink` actions, a push/pop navigation stack
 *  - `.sheet` / `.alert` presentation, `.toolbar`, `.tabItem`
 */

import type { ArgExpr, ModifierExpr, Stmt, StructDecl, ViewExpr, ViewItem } from "./ast.ts";
import {
  Env,
  evalExpr,
  execStmts,
  isBinding,
  isClosure,
  isColor,
  isGradient,
  isImplicit,
  isMaterial,
  isRange,
  isShape,
  isStruct,
  numOf,
  resetWarnings,
  runStatements,
  swiftDescription,
  truthy,
  unbox,
  type BindingVal,
  type ClosureVal,
  type EvaluatedArg,
  type EvalHost,
  type Value,
} from "./evaluator.ts";
import type { Diagnostic } from "./lexer.ts";
import { parseProgram, parseViewItems, type Parser } from "./parser.ts";

/* ────────────────────────────── Rendered tree ────────────────────────────── */

export interface RModifier {
  name: string;
  args: EvaluatedArg[];
  /** Builder closure content (overlay / sheet / toolbar / tabItem / …). */
  children?: RNode[];
  /** Statement closure bound to this modifier (onTapGesture / onAppear / …). */
  action?: () => void;
  /** Two-way binding (text fields, toggles, sliders, sheets, …). */
  binding?: BindingVal;
  /** Evaluated value for `.tag(...)` and similar. */
  value?: Value;
  /** View nodes used as alert buttons inside the closure. */
  actionNodes?: RNode[];
}

export interface RNode {
  id: string;
  type: string;
  args: EvaluatedArg[];
  modifiers: RModifier[];
  children: RNode[];
  /** Resolved text for Text / Label / Button title. */
  text?: string;
  /** Bound tap/primary action. */
  action?: () => void;
  /** Instance that owns this node when it is a user-defined view. */
  instance?: Instance;
  key?: string;
  /** Named two-way bindings from the constructor arguments. */
  bindings?: { label?: string; binding: BindingVal }[];
  /** View nodes supplied as named closure arguments (Section header, …). */
  argNodes?: Record<string, RNode[]>;
  /**
   * GeometryReader measurement hook. The renderer calls this after layout so
   * `geo.size` reflects the real container instead of a placeholder.
   */
  onResize?: (width: number, height: number) => void;
}

export interface ModalSpec {
  id: string;
  kind: "sheet" | "alert";
  node?: RNode;
  title?: string;
  message?: RNode;
  actions?: RNode[];
  isFullScreen: boolean;
  detents: number[];
  dismiss: () => void;
}

export interface Screen {
  node: RNode;
  title?: string;
  titleMode: "automatic" | "inline" | "large";
  toolbar: RNode[];
  isRoot: boolean;
  modals: ModalSpec[];
}

/* ────────────────────────────── Instances ────────────────────────────── */

export class Instance {
  id: string;
  typeName: string;
  decl: StructDecl | null;
  /** Environment holding props, @State storage, methods and computed values. */
  env: Env;
  /** View items for inline screens (#Preview, inline NavigationLink targets). */
  inlineItems: ViewItem[] | null;

  constructor(
    id: string,
    typeName: string,
    decl: StructDecl | null,
    env: Env,
    inlineItems: ViewItem[] | null = null,
  ) {
    this.id = id;
    this.typeName = typeName;
    this.decl = decl;
    this.env = env;
    this.inlineItems = inlineItems;
  }
}

/* ────────────────────────────── Builtin view registry ────────────────────────────── */

const CONTAINER_VIEWS = new Set([
  "VStack", "HStack", "ZStack", "Group", "ScrollView", "LazyVStack", "LazyHStack",
  "LazyVGrid", "LazyHGrid", "Grid", "GridRow", "Section", "List", "Form",
  "NavigationStack", "NavigationView", "TabView", "GeometryReader", "ViewThatFits",
  "DisclosureGroup", "Menu", "ControlGroup", "LabeledContent",
]);

const LEAF_VIEWS = new Set([
  "Text", "Image", "Divider", "Spacer", "Color", "Circle", "Rectangle",
  "RoundedRectangle", "Capsule", "Ellipse", "ProgressView", "Gauge",
  "TextField", "SecureField", "TextEditor", "Slider", "Stepper", "Toggle",
  "Picker", "DatePicker", "ColorPicker", "Link", "Label", "Button",
  "NavigationLink", "ForEach", "ToolbarItem", "ContentUnavailableView",
  "AsyncImage", "Path", "Shape", "AnyView", "EmptyView",
  "LinearGradient", "RadialGradient", "AngularGradient",
]);

/** Views whose trailing closure holds statements (actions), not children. */
const ACTION_TRAILING_VIEWS = new Set(["Button"]);

/** Views whose first string argument is displayed as the view's label. */
const TEXT_BEARING_VIEWS = new Set([
  "Text", "Label", "Button", "Link", "NavigationLink", "TextField", "SecureField",
  "Toggle", "Picker", "Stepper", "DatePicker", "ColorPicker", "Menu",
  "DisclosureGroup", "ContentUnavailableView", "LabeledContent", "Section",
]);

/* ────────────────────────────── Runtime ────────────────────────────── */

export interface InterpretResult {
  runtime: PreviewRuntime;
  diagnostics: Diagnostic[];
}

export interface ProgramSummary {
  entryName: string;
  stateCount: number;
  functionCount: number;
  viewNames: string[];
  hasNavigation: boolean;
  hasEnvironmentDismiss: boolean;
}

export class PreviewRuntime implements EvalHost {
  program: ReturnType<typeof parseProgram>;
  globalEnv = new Env();
  instances = new Map<string, Instance>();
  stack: Instance[] = [];
  diagnostics: Diagnostic[] = [];
  version = 0;
  listeners = new Set<() => void>();
  logs: string[] = [];
  /** Last measured GeometryReader containers, keyed by node path. */
  geometry = new Map<string, { width: number; height: number }>();
  private logHandler: ((message: string) => void) | null = null;
  private renderStamp = 0;
  private warned = new Set<string>();
  private renderModals: ModalSpec[] = [];

  constructor(program: ReturnType<typeof parseProgram>) {
    this.program = program;
    this.diagnostics = [...program.diagnostics];
    const host = this;
    runStatements(program.globals, this.globalEnv, host);
  }

  /* ── host interface ── */

  log(message: string): void {
    this.logs.push(message);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    this.logHandler?.(message);
  }

  warn(message: string, _start: number, _end: number): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.diagnostics.push({ severity: "warn", message, start: _start, end: _end, line: 1 });
  }

  bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /**
   * Store a measured GeometryReader size. Sub-pixel jitter is ignored so the
   * ResizeObserver → rebuild loop settles instead of spinning.
   */
  setGeometry(id: string, width: number, height: number): void {
    const current = this.geometry.get(id);
    if (
      current &&
      Math.abs(current.width - width) < 0.5 &&
      Math.abs(current.height - height) < 0.5
    ) {
      return;
    }
    this.geometry.set(id, { width, height });
    this.bump();
  }

  setLogHandler(handler: ((message: string) => void) | null): void {
    this.logHandler = handler;
  }

  constructStruct(name: string, args: EvaluatedArg[]): Value | undefined {
    const decl = this.program.structs.get(name);
    if (!decl) return undefined;
    const env = new Env(this.globalEnv);
    const value = { t: "struct", typeName: name, env } as const;
    env.declare("self", value);
    for (const member of decl.members) {
      this.installMember(member, env, name);
    }
    for (const arg of args) {
      if (arg.label && env.has(arg.label)) env.set(arg.label, arg.value);
    }
    return value;
  }

  /* ── store plumbing ── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  /* ── navigation ── */

  push(instance: Instance): void {
    this.stack.push(instance);
    this.bump();
  }

  pop(): void {
    if (this.stack.length > 0) {
      this.stack.pop();
      this.bump();
    }
  }

  dismissCurrent(): void {
    const modal = this.renderModals[this.renderModals.length - 1];
    if (modal) {
      modal.dismiss();
      return;
    }
    this.pop();
  }

  currentInstance(): Instance {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : this.root();
  }

  root(): Instance {
    const existing = this.instances.get("root");
    if (existing) return existing;

    const entry = this.program.entry;
    let instance: Instance;

    if (entry.kind === "struct") {
      const decl = this.program.structs.get(entry.name) ?? null;
      const env = new Env(this.globalEnv);
      instance = new Instance("root", entry.name, decl, env);
      if (decl) this.initializeInstance(instance);
    } else if (entry.kind === "inline") {
      instance = new Instance("root", "Preview", null, new Env(this.globalEnv), entry.items);
    } else {
      instance = new Instance("root", "Empty", null, new Env(this.globalEnv), []);
    }

    this.instances.set("root", instance);
    return instance;
  }

  reset(program: ReturnType<typeof parseProgram>): void {
    this.program = program;
    this.globalEnv = new Env();
    this.instances = new Map();
    this.stack = [];
    this.geometry = new Map();
    this.diagnostics = [...program.diagnostics];
    this.warned = new Set();
    this.renderModals = [];
    resetWarnings();
    runStatements(program.globals, this.globalEnv, this);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Re-run the program from scratch, as Xcode's Run button would. */
  restart(): void {
    this.instances = new Map();
    this.stack = [];
    this.geometry = new Map();
    this.renderModals = [];
    this.logs = [];
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Describe the current program for the inspector panel. */
  summarize(): ProgramSummary {
    const instance = this.currentInstance();
    const decl = instance.decl;

    if (!decl) {
      return {
        entryName: instance.typeName,
        stateCount: 0,
        functionCount: 0,
        viewNames: [...this.program.structs.values()].filter((s) => s.isView).map((s) => s.name),
        hasNavigation: false,
        hasEnvironmentDismiss: false,
      };
    }

    const states = decl.members.filter((m) => m.k === "state");
    const functions = decl.members.filter((m) => m.k === "func");
    const hasEnvironmentDismiss = decl.members.some(
      (m) => m.k === "environment" && m.key === "dismiss",
    );
    const body = decl.members.find((m) => m.k === "body");
    const hasNavigation =
      !!body &&
      body.k === "body" &&
      JSON.stringify(body.items.map((item) => (item.k === "view" ? item.view.name : ""))).includes(
        "Navigation",
      );

    return {
      entryName: decl.name,
      stateCount: states.length,
      functionCount: functions.length,
      viewNames: [...this.program.structs.values()].filter((s) => s.isView).map((s) => s.name),
      hasNavigation,
      hasEnvironmentDismiss,
    };
  }

  /* ── instance construction ── */

  private installMember(
    member: StructDecl["members"][number],
    env: Env,
    typeName: string,
    host: PreviewRuntime = this,
  ): void {
    switch (member.k) {
      case "state":
        env.declare(
          member.name,
          member.init ? evalExpr(member.init, env, host) : null,
        );
        return;
      case "property":
        env.declare(member.name, member.init ? evalExpr(member.init, env, host) : null);
        return;
      case "func": {
        const closure: ClosureVal = {
          t: "closure",
          params: member.decl.params.map((p) => p.name),
          block: member.decl.body,
          env,
          name: member.decl.name,
        };
        env.declare(member.decl.name, closure);
        return;
      }
      case "computed": {
        const isViewProperty = member.isView === true;
        const closure: ClosureVal = {
          t: "closure",
          params: [],
          env,
          block: member.body,
          computed: true,
          ...(isViewProperty ? { viewProperty: true } : {}),
          ...(isViewProperty
            ? { native: () => null }
            : {
                native: (_args, runtimeHost) =>
                  evaluateBlockValue(member.body.asStatements(), new Env(env), runtimeHost),
              }),
        };
        env.declare(member.name, closure);
        return;
      }
      case "environment": {
        const closure: ClosureVal = {
          t: "closure",
          params: [],
          env,
          native: () => {
            this.dismissCurrent();
            return null;
          },
        };
        env.declare(member.name, closure);
        return;
      }
      case "body":
        return;
    }
    void typeName;
  }

  private initializeInstance(instance: Instance): void {
    const decl = instance.decl;
    if (!decl) return;
    const env = instance.env;
    const selfValue = { t: "struct", typeName: decl.name, env } as const;
    env.declare("self", selfValue);
    for (const member of decl.members) {
      this.installMember(member, env, decl.name);
    }
  }

  /** Create (or reuse) a child instance for a user view at a stable path. */
  private instanceAt(
    id: string,
    name: string,
    capturedEnv: Env,
  ): Instance | null {
    const decl = this.program.structs.get(name);
    if (!decl || !decl.isView) return null;

    let instance = this.instances.get(id);
    if (!instance) {
      const env = new Env(this.globalEnv);
      instance = new Instance(id, name, decl, env);
      this.initializeInstance(instance);
      this.instances.set(id, instance);
    }
    void capturedEnv;
    return instance;
  }

  private bindProps(instance: Instance, args: EvaluatedArg[]): void {
    const decl = instance.decl;
    if (!decl) return;

    const properties = decl.members.filter((m) => m.k === "property");
    let positionalIndex = 0;

    for (const arg of args) {
      if (arg.label) {
        const member = properties.find(
          (m) => m.k === "property" && m.name === arg.label,
        );
        const stateMember = decl.members.find(
          (m) => m.k === "state" && m.name === arg.label,
        );
        if (member) instance.env.set(arg.label, arg.value);
        else if (stateMember) instance.env.set(arg.label, arg.value);
        continue;
      }
      const member = properties[positionalIndex];
      if (member && member.k === "property") {
        instance.env.set(member.name, arg.value);
        positionalIndex += 1;
      }
    }
  }

  /* ── rendering ── */

  buildScreen(): Screen {
    this.renderStamp += 1;
    this.renderModals = [];
    const instance = this.currentInstance();
    const node = this.buildInstanceBody(instance);
    const nav = extractNavigation(node);
    const screen: Screen = {
      node,
      title: nav.title,
      titleMode: nav.titleMode,
      toolbar: nav.toolbar,
      isRoot: this.stack.length === 0,
      modals: [],
    };
    this.renderModals = collectModals(node);
    screen.modals = this.renderModals;
    this.pruneInstances();
    return screen;
  }

  private pruneInstances(): void {
    const keep = new Set<string>(["root", ...this.stack.map((s) => s.id)]);
    for (const [id, instance] of this.instances) {
      if (keep.has(id)) continue;
      if ((instance as Instance & { seen?: number }).seen === this.renderStamp) continue;
      this.instances.delete(id);
    }
  }

  private markSeen(instance: Instance): void {
    (instance as Instance & { seen?: number }).seen = this.renderStamp;
  }

  buildInstanceBody(instance: Instance): RNode {
    const items = instance.decl
      ? instance.decl.members.find((m) => m.k === "body")?.k === "body"
        ? (instance.decl.members.find((m) => m.k === "body") as { k: "body"; items: ViewItem[] }).items
        : []
      : instance.inlineItems ?? [];

    const env = new Env(instance.env);
    const nodes = this.buildItems(items, env, instance.id);
    const node =
      nodes.length === 1
        ? nodes[0]
        : { id: instance.id, type: "Group", args: [], modifiers: [], children: nodes };
    node.instance = instance;
    if (!node.id.startsWith(instance.id)) node.id = instance.id;
    return node;
  }

  buildItems(items: ViewItem[], env: Env, path: string): RNode[] {
    const out: RNode[] = [];
    let index = 0;

    for (const item of items) {
      const itemPath = `${path}/${index}`;
      index += 1;

      switch (item.k) {
        case "let":
          env.declare(item.name, evalExpr(item.value, env, this));
          break;

        case "ref": {
          // `some View` computed property: expand its builder body in place.
          const raw = env.lookup(item.name);
          if (isClosure(raw) && raw.viewProperty && raw.block) {
            const refPath = `${itemPath}.${item.name}`;
            const built = this.buildItems(raw.block.asViews().items, new Env(env), refPath);
            if (item.modifiers && item.modifiers.length > 0) {
              // A modifier chain on the reference applies to the whole produced
              // view, so it wraps the children in a Group node — the renderer
              // treats that as one box, like SwiftUI's ModifiedContent layer.
              out.push({
                id: refPath,
                type: "Group",
                args: [],
                modifiers: this.buildModifiers(item.modifiers, env, refPath),
                children: built,
              });
            } else {
              out.push(...built);
            }
          } else {
            this.warnOnce(
              `viewref:${item.name}`,
              `'${item.name}' is not a view property — it was skipped in the builder.`,
            );
          }
          break;
        }

        case "expr":
          evalExpr(item.expr, env, this);
          break;

        case "if": {
          const cond = truthy(evalExpr(item.cond, env, this));
          const branch = cond ? item.then : item.else;
          const branchPath = `${itemPath}${cond ? "t" : "f"}`;
          out.push(...this.buildItems(branch, new Env(env), branchPath));
          break;
        }

        case "switch": {
          const subject = evalExpr(item.subject, env, this);
          let matched = false;
          for (const switchCase of item.cases) {
            const isMatch = switchCase.patterns.some((pattern) => {
              const value = evalExpr(pattern, env, this);
              // Range patterns (`case 3..<7:`) compare numerically, exactly as
              // the statement-level switch does.
              if (isRange(value) && typeof subject === "number") {
                return value.closed
                  ? subject >= value.lo && subject <= value.hi
                  : subject >= value.lo && subject < value.hi;
              }
              if (isImplicit(value) && isImplicit(subject)) {
                return value.path.join(".") === subject.path.join(".");
              }
              return swiftDescription(value) === swiftDescription(subject);
            });
            if (isMatch) {
              out.push(...this.buildItems(switchCase.body, new Env(env), itemPath));
              matched = true;
              break;
            }
          }
          if (!matched && item.default) {
            out.push(...this.buildItems(item.default, new Env(env), itemPath));
          }
          break;
        }

        case "view":
          out.push(...this.buildView(item.view, env, itemPath));
          break;
      }
    }

    return out;
  }

  /** Build one view expression; may expand to several nodes (ForEach, List rows). */
  buildView(view: ViewExpr, env: Env, path: string): RNode[] {
    // User-defined SwiftUI view.
    const decl = this.program.structs.get(view.name);
    if (decl && decl.isView) {
      const instance = this.instanceAt(`${path}:${view.name}`, view.name, env);
      if (instance) {
        const args = this.evalArgs(view.args, env);
        this.bindProps(instance, args);
        this.markSeen(instance);
        const node = this.buildInstanceBody(instance);
        node.instance = instance;
        return [node];
      }
    }

    if (view.name === "ForEach") {
      return this.buildForEach(view, env, path);
    }

    if (view.name === "GeometryReader") {
      return [this.buildGeometryReader(view, env, path)];
    }

    if (view.name === "ValueView") {
      return [this.buildValueView(view, env, path)];
    }

    if (view.name === "List" || view.name === "Form") {
      return [this.buildListLike(view, env, path)];
    }

    if (!CONTAINER_VIEWS.has(view.name) && !LEAF_VIEWS.has(view.name)) {
      // Unknown view: graceful placeholder.
      this.warnOnce(
        view.name,
        `'${view.name}' is not supported by the canvas yet — rendered as a placeholder.`,
      );
      return [
        {
          id: path,
          type: "Unsupported",
          args: [],
          modifiers: [],
          children: [],
          text: view.name,
        },
      ];
    }

    return [this.buildBuiltin(view, env, path)];
  }

  private buildBuiltin(view: ViewExpr, env: Env, path: string): RNode {
    const args = this.evalArgs(view.args, env);
    const node: RNode = {
      id: path,
      type: view.name,
      args,
      modifiers: [],
      children: [],
    };

    const isActionTrailing = ACTION_TRAILING_VIEWS.has(view.name);

    // Button forms, all resolved through one action/label extraction:
    //   Button("Title") { action }
    //   Button { action } label: { views }
    //   Button(action: { … }) { label }
    //   Button(action: { … }, label: { views })
    //   Button("Title", action: { … })
    if (view.name === "Button") {
      const labelClosure = args.find((a) => a.label === "label" && isClosure(a.value));
      const actionClosure = args.find((a) => a.label === "action" && isClosure(a.value));
      const labelTrailing = view.labeledTrailing?.find((t) => t.label === "label");
      const actionTrailing = view.labeledTrailing?.find((t) => t.label === "action");

      // ── Action ──────────────────────────────────────────────────────────
      // `action:` trailing > `action:` argument > unlabeled trailing. The
      // unlabeled trailing is only an action when it is not the label of an
      // argument-supplied action (`Button(action: { … }) { label }`).
      const argumentAction =
        actionClosure && isClosure(actionClosure.value) ? actionClosure.value.block : undefined;
      const hasExternalLabel =
        labelTrailing !== undefined || (labelClosure !== undefined && isClosure(labelClosure.value));
      const actionBlock =
        actionTrailing?.block ??
        argumentAction ??
        (labelTrailing !== undefined || !hasExternalLabel ? view.trailing : undefined);
      if (actionBlock) {
        node.action = () => runStatements(actionBlock.asStatements(), new Env(env), this);
      }

      // ── Label ───────────────────────────────────────────────────────────
      // `label:` trailing > `label:` argument > title string > trailing (when
      // the action came from an argument, the trailing is the label).
      if (labelTrailing) {
        node.children = this.buildItems(labelTrailing.block.asViews().items, new Env(env), path);
        node.text = undefined;
      } else if (labelClosure && isClosure(labelClosure.value)) {
        node.children = this.buildItems(
          labelClosure.value.block?.asViews().items ?? [],
          new Env(env),
          path,
        );
        node.text = undefined;
      } else if (typeof args[0]?.value === "string") {
        node.text = args[0].value;
      } else if (view.trailing && (actionClosure !== undefined || actionTrailing !== undefined)) {
        node.children = this.buildItems(view.trailing.asViews().items, new Env(env), path);
        node.text = undefined;
      }

      if (!node.children.length && node.text === undefined) {
        node.text = "Button";
      }
    } else if (view.name === "NavigationLink") {
      this.buildNavigationLink(node, view, env, path);
    } else if (view.name === "Path") {
      this.buildPath(node, view, env);
    } else if (view.trailing && !isActionTrailing) {
      const views = view.trailing.asViews();
      node.children = this.buildItems(views.items, new Env(env), path);
    } else if (view.trailing && isActionTrailing) {
      const block = view.trailing;
      node.action = () => runStatements(block.asStatements(), new Env(env), this);
    }

    // Constructor arguments that are view closures (Section header, …).
    const NODE_ARG_LABELS = new Set([
      "header", "footer", "label", "content", "description", "message", "title",
    ]);
    view.args.forEach((argExpr, index) => {
      const label = argExpr.label;
      const value = args[index]?.value;
      if (!label || !NODE_ARG_LABELS.has(label)) return;
      if (!isClosure(value) || !value.block) return;
      node.argNodes = node.argNodes ?? {};
      node.argNodes[label] = this.buildItems(
        value.block.asViews().items,
        new Env(env),
        `${path}.${label}`,
      );
    });

    // Two-way bindings passed to the constructor.
    view.args.forEach((argExpr, index) => {
      const value = args[index]?.value;
      if (!isBinding(value)) return;
      node.bindings = node.bindings ?? [];
      node.bindings.push({
        ...(argExpr.label ? { label: argExpr.label } : {}),
        binding: value,
      });
    });

    node.modifiers.push(...this.buildModifiers(view.modifiers, env, path));

    // Views whose first string argument is their displayed label.
    if (node.text === undefined) {
      const first = node.args[0];
      if (first && typeof first.value === "string" && TEXT_BEARING_VIEWS.has(view.name)) {
        node.text = first.value;
      }
    }

    if (view.name === "Text") {
      const first = node.args[0];
      node.text = first === undefined ? "" : swiftDescription(first.value);
    }

    return node;
  }

  /**
   * A style value used as a view (`Color.black`, `Material.thin`, …). The
   * evaluated value becomes the node's first argument, so the existing
   * Color/Gradient/Material renderers pick it up unchanged.
   */
  private buildValueView(view: ViewExpr, env: Env, path: string): RNode {
    const arg = view.args[0];
    const value = arg ? evalExpr(arg.value, env, this) : null;
    const type = value ? valueViewType(value) : null;

    const node: RNode = type
      ? {
          id: path,
          type,
          args: arg ? [{ ...arg, value }] : [],
          modifiers: [],
          children: [],
        }
      : {
          id: path,
          type: "Unsupported",
          text: swiftDescription(value),
          args: [],
          modifiers: [],
          children: [],
        };

    if (!type) {
      this.warnOnce(
        `valueview:${swiftDescription(value)}`,
        `'${swiftDescription(value)}' is not a renderable style value — shown as a placeholder.`,
      );
    }

    node.modifiers.push(...this.buildModifiers(view.modifiers, env, path));
    return node;
  }

  /**
   * GeometryReader supplies a `GeometryProxy` (`geo`) to its builder. The size
   * comes from the last renderer measurement for this path; before the first
   * measurement it is 0×0 and the renderer reports real dimensions afterwards.
   */
  private buildGeometryReader(view: ViewExpr, env: Env, path: string): RNode {
    const args = this.evalArgs(view.args, env);
    const node: RNode = {
      id: path,
      type: "GeometryReader",
      args,
      modifiers: [],
      children: [],
    };
    node.onResize = (width, height) => this.setGeometry(path, width, height);

    const size = this.geometry.get(path) ?? { width: 0, height: 0 };
    const sizeEnv = new Env(this.globalEnv);
    sizeEnv.declare("width", size.width);
    sizeEnv.declare("height", size.height);

    const insetsEnv = new Env(this.globalEnv);
    insetsEnv.declare("top", 0);
    insetsEnv.declare("leading", 0);
    insetsEnv.declare("bottom", 0);
    insetsEnv.declare("trailing", 0);

    const proxyEnv = new Env(this.globalEnv);
    proxyEnv.declare("size", { t: "struct", typeName: "CGSize", env: sizeEnv } as const);
    proxyEnv.declare("safeAreaInsets", { t: "struct", typeName: "EdgeInsets", env: insetsEnv } as const);
    const proxy = { t: "struct", typeName: "GeometryProxy", env: proxyEnv } as const;

    if (view.trailing) {
      const views = view.trailing.asViews();
      const scope = new Env(env);
      if (views.params.length > 0) scope.declare(views.params[0], proxy);
      node.children = this.buildItems(views.items, scope, path);
    }

    node.modifiers.push(...this.buildModifiers(view.modifiers, env, path));
    return node;
  }

  /**
   * `Path { p in p.move(to: …); p.addLine(to: …) }` — records the documented
   * drawing methods into an SVG path. Unsupported methods are ignored so a
   * partially supported path still renders.
   */
  private buildPath(node: RNode, view: ViewExpr, env: Env): void {
    const trailing = view.trailing;
    if (!trailing) return;

    const commands: PathCommand[] = [];
    const builderEnv = new Env(env);
    const method = (fn: (args: EvaluatedArg[]) => void): ClosureVal => ({
      t: "closure",
      params: [],
      env: builderEnv,
      native: (args) => {
        try {
          fn(args);
        } catch {
          // Partial drawing beats a broken preview.
        }
        return null;
      },
    });

    builderEnv.declare("move", method((args) => {
      const [x, y] = pointOf(args[0]?.value ?? null);
      commands.push({ op: "M", nums: [x, y] });
    }));
    builderEnv.declare("addLine", method((args) => {
      const [x, y] = pointOf(args[0]?.value ?? null);
      commands.push({ op: "L", nums: [x, y] });
    }));
    builderEnv.declare("addQuadCurve", method((args) => {
      const [cx, cy] = pointOf(args.find((a) => a.label === "control")?.value ?? null);
      const [x, y] = pointOf(args.find((a) => a.label === "to")?.value ?? null);
      commands.push({ op: "Q", nums: [cx, cy, x, y] });
    }));
    builderEnv.declare("addCurve", method((args) => {
      const [c1x, c1y] = pointOf(args.find((a) => a.label === "control1")?.value ?? null);
      const [c2x, c2y] = pointOf(args.find((a) => a.label === "control2")?.value ?? null);
      const [x, y] = pointOf(args.find((a) => a.label === "to")?.value ?? null);
      commands.push({ op: "C", nums: [c1x, c1y, c2x, c2y, x, y] });
    }));
    builderEnv.declare("addRect", method((args) => {
      const rectArg = args.find((a) => isStruct(a.value))?.value;
      if (rectArg !== undefined) {
        commands.push({ op: "R", nums: rectOf(rectArg) });
        return;
      }
      const x = numOf(args.find((a) => a.label === "x")?.value ?? null) ?? 0;
      const y = numOf(args.find((a) => a.label === "y")?.value ?? null) ?? 0;
      const w = numOf(args.find((a) => a.label === "width")?.value ?? null) ?? 0;
      const h = numOf(args.find((a) => a.label === "height")?.value ?? null) ?? 0;
      commands.push({ op: "R", nums: [x, y, w, h] });
    }));
    builderEnv.declare("addEllipse", method((args) => {
      const rectArg = args.find((a) => isStruct(a.value))?.value;
      commands.push({ op: "E", nums: rectArg !== undefined ? rectOf(rectArg) : [0, 0, 10, 10] });
    }));
    builderEnv.declare("addRoundedRect", method((args) => {
      const rectArg = args.find((a) => isStruct(a.value))?.value;
      commands.push({ op: "R", nums: rectArg !== undefined ? rectOf(rectArg) : [0, 0, 10, 10] });
    }));
    builderEnv.declare("closeSubpath", method(() => {
      commands.push({ op: "Z", nums: [] });
    }));

    const builder = { t: "struct", typeName: "Path", env: builderEnv } as const;
    const views = trailing.asViews();
    const scope = new Env(env);
    if (views.params.length > 0) scope.declare(views.params[0], builder);
    runStatements(trailing.asStatements(), scope, this);

    const svg = pathCommandsToSvg(commands);
    if (svg) {
      node.args.push({ label: "d", value: svg.d });
      node.args.push({ label: "viewBox", value: svg.viewBox });
      node.args.push({ label: "aspect", value: svg.aspect });
    }
  }

  private buildNavigationLink(
    node: RNode,
    view: ViewExpr,
    env: Env,
    path: string,
  ): void {
    const args = this.evalArgs(view.args, env);

    // `NavigationLink(destination: X) { label }`
    const destinationArg = args.find((a) => a.label === "destination");
    const labelClosure = args.find((a) => isClosure(a.value) && a.label !== "destination");
    const labeledLabel = view.labeledTrailing?.find((t) => t.label === "label");

    // `NavigationLink { Destination() } label: { label }` — Swift 5.3+ form:
    // the unlabeled trailing is the destination, the labeled one the label.
    if (labeledLabel) {
      const destinationItems =
        (destinationArg && isClosure(destinationArg.value)
          ? destinationArg.value.block?.asViews().items
          : undefined) ?? (view.trailing ? view.trailing.asViews().items : []);
      node.children = this.buildItems(labeledLabel.block.asViews().items, new Env(env), path);
      node.text = undefined;
      node.action = this.makePushAction(destinationItems, env, path);
      return;
    }

    if (typeof args[0]?.value === "string" && view.trailing) {
      node.text = args[0].value;
      const items = view.trailing.asViews().items;
      node.action = this.makePushAction(items, env, path);
      return;
    }

    if (destinationArg && isClosure(destinationArg.value) && view.trailing) {
      // `NavigationLink { Destination() } label: { … }`
      const destinationItems = destinationArg.value.block?.asViews().items ?? [];
      node.children = this.buildItems(view.trailing.asViews().items, new Env(env), path);
      node.text = undefined;
      node.action = this.makePushAction(destinationItems, env, path);
      return;
    }

    if (labelClosure && isClosure(labelClosure.value) && view.trailing) {
      const destinationItems = view.trailing.asViews().items;
      node.children = this.buildItems(
        labelClosure.value.block?.asViews().items ?? [],
        new Env(env),
        path,
      );
      node.text = undefined;
      node.action = this.makePushAction(destinationItems, env, path);
      return;
    }

    if (view.trailing) {
      node.text = typeof args[0]?.value === "string" ? args[0].value : "Link";
      node.action = this.makePushAction(view.trailing.asViews().items, env, path);
      return;
    }

    node.text = typeof args[0]?.value === "string" ? args[0].value : "Link";
  }

  private makePushAction(
    items: ViewItem[],
    env: Env,
    path: string,
  ): () => void {
    return () => {
      const id = `stack/${this.stack.length + 1}:${path}`;
      let instance = this.instances.get(id);
      if (!instance) {
        instance = new Instance(id, "Destination", null, new Env(env), items);
        this.instances.set(id, instance);
      }
      this.push(instance);
    };
  }

  private buildForEach(view: ViewExpr, env: Env, path: string): RNode[] {
    const args = this.evalArgs(view.args, env);
    const data = args[0]?.value;
    const trailing = view.trailing?.asViews();
    if (!trailing) return [];

    const elements = expandData(data);
    const out: RNode[] = [];

    elements.forEach((element, index) => {
      const scope = new Env(env);
      const params = trailing.params;
      if (params.length >= 2) {
        scope.declare(params[0], index);
        scope.declare(params[1], element);
      } else if (params.length === 1) {
        scope.declare(params[0], element);
      } else if (Array.isArray(element)) {
        element.forEach((value, i) => scope.declare(`$${i}`, value));
      } else {
        scope.declare("$0", element);
        scope.declare("item", element);
      }

      const key = keyFor(element, index);
      const built = this.buildItems(trailing.items, scope, `${path}/${index}`);
      for (const node of built) {
        node.key = key;
        out.push(node);
      }
    });

    return out;
  }

  private buildListLike(view: ViewExpr, env: Env, path: string): RNode {
    const args = this.evalArgs(view.args, env);
    const node: RNode = {
      id: path,
      type: view.name,
      args: [],
      modifiers: [],
      children: [],
      text: undefined,
    };

    // `List(items) { item in … }` row form.
    const positionalIndex = view.args.findIndex((arg) => !arg.label);
    if (positionalIndex >= 0 && view.trailing) {
      const data = args[positionalIndex]?.value;
      const trailing = view.trailing.asViews();
      const elements = expandData(data);
      elements.forEach((element, index) => {
        const scope = new Env(env);
        if (trailing.params.length > 0) scope.declare(trailing.params[0], element);
        else scope.declare("$0", element);
        const built = this.buildItems(trailing.items, scope, `${path}/${index}`);
        for (const child of built) {
          child.key = keyFor(element, index);
          node.children.push(child);
        }
      });
    } else if (view.trailing) {
      node.children = this.buildItems(view.trailing.asViews().items, new Env(env), path);
    }

    node.modifiers.push(...this.buildModifiers(view.modifiers, env, path));
    return node;
  }

  private buildModifiers(
    modifiers: ModifierExpr[],
    env: Env,
    path: string,
  ): RModifier[] {
    return modifiers.map((modifier, index) => {
      const args = this.evalArgs(modifier.args, env);
      const result: RModifier = { name: modifier.name, args };
      const modPath = `${path}.${modifier.name}${index}`;

      // Two-way bindings anywhere in the argument list.
      const binding = args.find((a) => isBinding(a.value));
      if (binding && isBinding(binding.value)) result.binding = binding.value;

      switch (modifier.name) {
        case "onAppear":
        case "onDisappear":
        case "onTapGesture":
        case "onLongPressGesture":
        case "onChange":
        case "task":
        case "onSubmit":
        case "simultaneousGesture": {
          if (modifier.trailing) {
            const block = modifier.trailing;
            const action = () => runStatements(block.asStatements(), new Env(env), this);
            // `.onChange(of:) { }` takes a value argument; the closure receives it.
            result.action = action;
          } else if (args.length > 0 && isClosure(args[0].value) && args[0].value.block) {
            const block = args[0].value.block;
            result.action = () => runStatements(block.asStatements(), new Env(env), this);
          }
          break;
        }

        case "sheet":
        case "fullScreenCover": {
          if (modifier.trailing) {
            const items = modifier.trailing.asViews().items;
            result.children = this.buildItems(items, new Env(env), modPath);
          }
          break;
        }

        case "alert":
        case "confirmationDialog": {
          // The message is a labeled trailing closure (`.alert(…) { … } message: { … }`);
          // the `message:` argument form is kept for completeness.
          const messageTrailing = modifier.labeledTrailing?.find((t) => t.label === "message");
          const messageClosure = args.find(
            (a) => isClosure(a.value) && a.label === "message",
          );
          if (messageTrailing) {
            result.children = this.buildItems(
              messageTrailing.block.asViews().items,
              new Env(env),
              modPath,
            );
          } else if (messageClosure && isClosure(messageClosure.value)) {
            const items = messageClosure.value.block?.asViews().items ?? [];
            result.children = this.buildItems(items, new Env(env), modPath);
          }
          if (modifier.trailing) {
            const items = modifier.trailing.asViews().items;
            result.actionNodes = this.buildItems(items, new Env(env), modPath + ".actions");
          }
          break;
        }

        case "toolbar":
        case "tabItem":
        case "overlay":
        case "background":
        case "safeAreaInset": {
          if (modifier.trailing) {
            result.children = this.buildItems(
              modifier.trailing.asViews().items,
              new Env(env),
              modPath,
            );
          } else if (args.length > 0 && isClosure(args[0].value) && args[0].value.block) {
            result.children = this.buildItems(
              args[0].value.block.asViews().items,
              new Env(env),
              modPath,
            );
          }
          break;
        }

        case "tag":
          result.value = args[0]?.value;
          break;

        default:
          break;
      }

      return result;
    });
  }

  evalArgs(args: ArgExpr[], env: Env): EvaluatedArg[] {
    return args.map((arg) => ({
      ...(arg.label ? { label: arg.label } : {}),
      // Doubles are unboxed at the view boundary so layout code sees numbers.
      value: unbox(evalExpr(arg.value, env, this)),
    }));
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.diagnostics.push({ severity: "warn", message, start: 0, end: 0, line: 1 });
  }
}

/* ────────────────────────────── Helpers ────────────────────────────── */

/** One recorded `Path { p in … }` drawing command. */
type PathCommand =
  | { op: "M" | "L" | "Z"; nums: number[] }
  | { op: "Q"; nums: number[] }
  | { op: "C"; nums: number[] }
  | { op: "R" | "E"; nums: number[] };

/**
 * Translate recorded path commands into an SVG `d` attribute plus a viewBox
 * derived from their bounding box, so user-drawn paths scale to their frame.
 */
function pathCommandsToSvg(
  commands: PathCommand[],
): { d: string; viewBox: string; aspect: number } | null {
  if (commands.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const touch = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const parts: string[] = [];
  for (const command of commands) {
    switch (command.op) {
      case "M":
      case "L": {
        const [x, y] = command.nums;
        touch(x, y);
        parts.push(`${command.op}${x} ${y}`);
        break;
      }
      case "Q": {
        const [cx, cy, x, y] = command.nums;
        touch(cx, cy);
        touch(x, y);
        parts.push(`Q${cx} ${cy} ${x} ${y}`);
        break;
      }
      case "C": {
        const [c1x, c1y, c2x, c2y, x, y] = command.nums;
        touch(c1x, c1y);
        touch(c2x, c2y);
        touch(x, y);
        parts.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
        break;
      }
      case "R": {
        const [x, y, w, h] = command.nums;
        touch(x, y);
        touch(x + w, y + h);
        parts.push(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
        break;
      }
      case "E": {
        const [x, y, w, h] = command.nums;
        const rx = w / 2;
        const ry = h / 2;
        const cy = y + ry;
        touch(x, y);
        touch(x + w, y + h);
        parts.push(
          `M${x} ${cy}A${rx} ${ry} 0 1 0 ${x + w} ${cy}A${rx} ${ry} 0 1 0 ${x} ${cy}Z`,
        );
        break;
      }
      case "Z":
        parts.push("Z");
        break;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);
  const widthPx = Math.max(width, 1);
  const heightPx = Math.max(height, 1);
  return {
    d: parts.join(" "),
    viewBox: `${minX} ${minY} ${widthPx} ${heightPx}`,
    aspect: widthPx / heightPx,
  };
}

function pointOf(value: Value): [number, number] {
  if (isStruct(value)) {
    return [
      numOf(value.env.lookup("x") ?? null) ?? 0,
      numOf(value.env.lookup("y") ?? null) ?? 0,
    ];
  }
  return [0, 0];
}

function rectOf(value: Value): [number, number, number, number] {
  if (isStruct(value)) {
    return [
      numOf(value.env.lookup("x") ?? null) ?? 0,
      numOf(value.env.lookup("y") ?? null) ?? 0,
      numOf(value.env.lookup("width") ?? null) ?? 0,
      numOf(value.env.lookup("height") ?? null) ?? 0,
    ];
  }
  return [0, 0, 0, 0];
}

/**
 * View type for a style value used directly as a view
 * (`Color.black`, `Color.gray.opacity(0.4)`, `Material.regular`, …).
 * Bare members arrive as `.implicit` paths and are mapped by their head;
 * the Color/Material renderers already resolve those implicit values.
 */
function valueViewType(value: Value): string | null {
  if (isColor(value)) return "Color";
  if (isGradient(value)) {
    if (value.kind === "radial") return "RadialGradient";
    if (value.kind === "angular") return "AngularGradient";
    return "LinearGradient";
  }
  if (isMaterial(value)) return "Material";
  if (isShape(value)) return value.name;
  if (isImplicit(value)) {
    const head = value.path[0] ?? "";
    if (head === "Material") return "Material";
    if (head === "Color" || head === "ShapeStyle") return "Color";
    if (head === "Gradient") return "LinearGradient";
  }
  return null;
}

function expandData(data: Value): Value[] {
  if (Array.isArray(data)) return data;
  if (isRange(data)) {
    const out: number[] = [];
    if (data.closed) {
      for (let i = data.lo; i <= data.hi; i++) out.push(i);
    } else {
      for (let i = data.lo; i < data.hi; i++) out.push(i);
    }
    return out;
  }
  if (typeof data === "string") return data.split("");
  return [];
}

function keyFor(element: Value, index: number): string {
  if (isStruct(element)) {
    const id = element.env.lookup("id");
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  if (typeof element === "string" || typeof element === "number") return `${element}`;
  return `${index}`;
}

function evaluateBlockValue(
  statements: Stmt[],
  env: Env,
  host: EvaluatorHost,
): Value {
  if (statements.length === 0) return null;
  const last = statements[statements.length - 1];
  if (last.k === "expr") {
    const flow = execStmts(statements.slice(0, -1), env, host);
    if (flow && flow.type === "return") return flow.value;
    return evalExpr(last.expr, env, host);
  }
  const flow = execStmts(statements, env, host);
  if (flow && flow.type === "return") return flow.value;
  return null;
}

type EvaluatorHost = EvalHost;

interface NavigationInfo {
  title?: string;
  titleMode: Screen["titleMode"];
  toolbar: RNode[];
}

function extractNavigation(node: RNode): NavigationInfo {
  const info: NavigationInfo = { titleMode: "automatic", toolbar: [] };

  const visit = (current: RNode, depth: number): void => {
    for (const modifier of current.modifiers) {
      if (modifier.name === "navigationTitle" && info.title === undefined) {
        const arg = modifier.args[0];
        if (arg) info.title = swiftDescription(arg.value);
      }
      if (modifier.name === "navigationBarTitleDisplayMode") {
        const arg = modifier.args[0];
        if (isImplicit(arg?.value)) {
          const mode = arg.value.path[arg.value.path.length - 1];
          if (mode === "inline" || mode === "large") info.titleMode = mode;
        }
      }
      if (modifier.name === "toolbar" && modifier.children) {
        for (const child of modifier.children) {
          if (child.type === "ToolbarItem" || child.type === "ToolbarItemGroup") {
            info.toolbar.push(...child.children);
          } else {
            info.toolbar.push(child);
          }
        }
      }
    }
    if (depth >= 3) return;
    for (const child of current.children) visit(child, depth + 1);
  };

  visit(node, 0);
  return info;
}

function collectModals(node: RNode): ModalSpec[] {
  const out: ModalSpec[] = [];

  const visit = (current: RNode): void => {
    for (const modifier of current.modifiers) {
      const isSheet =
        modifier.name === "sheet" || modifier.name === "fullScreenCover";
      const isAlert =
        modifier.name === "alert" || modifier.name === "confirmationDialog";
      if (!isSheet && !isAlert) continue;
      if (!modifier.binding) continue;
      if (!truthy(modifier.binding.get())) continue;

      const binding = modifier.binding;
      const dismiss = () => binding.set(false);

      if (isSheet && modifier.children) {
        const content: RNode = {
          id: current.id + ".sheet",
          type: "Group",
          args: [],
          modifiers: [],
          children: modifier.children,
        };
        out.push({
          id: content.id,
          kind: "sheet",
          node: content,
          isFullScreen: modifier.name === "fullScreenCover",
          detents: sheetDetents(content),
          dismiss,
        });
      }

      if (isAlert) {
        const actions = modifier.actionNodes ?? [];
        out.push({
          id: current.id + ".alert",
          kind: "alert",
          title: swiftDescription(modifier.args[0]?.value ?? ""),
          message: modifier.children
            ? {
                id: current.id + ".alert.message",
                type: "Group",
                args: [],
                modifiers: [],
                children: modifier.children,
              }
            : undefined,
          actions,
          isFullScreen: false,
          detents: [],
          dismiss,
        });
      }
    }
    for (const child of current.children) visit(child);
  };

  visit(node);
  return out;
}

function sheetDetents(content: RNode): number[] {
  const found: number[] = [];
  const visit = (node: RNode, depth: number): void => {
    for (const modifier of node.modifiers) {
      if (modifier.name !== "presentationDetents") continue;
      for (const arg of modifier.args) {
        const list = Array.isArray(arg.value) ? arg.value : [arg.value];
        for (const entry of list) {
          if (isImplicit(entry)) {
            const name = entry.path[entry.path.length - 1];
            if (name === "medium") found.push(0.5);
            else if (name === "large") found.push(0.93);
            else if (name === "fraction") found.push(0.5);
          }
        }
      }
    }
    if (depth > 2) return;
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(content, 0);
  return found;
}

/* ────────────────────────────── Public entry ────────────────────────────── */

export function interpret(source: string): InterpretResult {
  let runtime: PreviewRuntime;

  try {
    const program = parseProgram(source);
    runtime = new PreviewRuntime(program);
  } catch (err) {
    runtime = new PreviewRuntime(parseProgram(""));
    runtime.diagnostics.push({
      severity: "error",
      message: `Preview runtime error: ${err instanceof Error ? err.message : String(err)}`,
      start: 0,
      end: 0,
      line: 1,
    });
  }

  // The runtime owns the diagnostics array: parsing problems are seeded from
  // the program and canvas-time warnings (unsupported views) append to it.
  return { runtime, diagnostics: runtime.diagnostics };
}

/** Convenience for tests: evaluate a program and render its body to a description. */
export function buildScreenForSource(source: string): {
  screen: Screen;
  diagnostics: Diagnostic[];
} {
  const { runtime, diagnostics } = interpret(source);
  const screen = runtime.buildScreen();
  return { screen, diagnostics };
}

/* Re-export a couple of primitives so tests and the renderer can use them. */
export { isBinding, truthy, parseViewItems, type Parser };
