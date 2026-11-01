/**
 * SwiftCanvas stress suite — five SwiftUI programs of increasing complexity
 * that exercise the parser, the evaluator and the renderer IR together.
 *
 * Run with: node scripts/stress.ts   (Node 22+ with type stripping)
 *
 * Every suite asserts on the RNode IR (the same tree the React renderer
 * consumes). A second assertion block per suite documents the parsing blind
 * spots that remain, so regressions are caught from both directions.
 */
import assert from "node:assert/strict";
import {
  frameClasses,
  frameLayout,
  frameStretches,
  hasFrameSizing,
  interpret,
  spacerClasses,
  viewWantsFullWidth,
  type RNode,
  type Screen,
} from "../src/utils/swift/index.ts";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err as Error).message}`);
  }
}

/* ────────────────────────────── helpers ────────────────────────────── */

function build(source: string) {
  const { runtime, diagnostics } = interpret(source);
  const screen = runtime.buildScreen();
  return { screen, runtime, diagnostics };
}

function flatten(node: RNode): RNode[] {
  const out: RNode[] = [node];
  for (const child of node.children) out.push(...flatten(child));
  return out;
}

function findAll(node: RNode, predicate: (node: RNode) => boolean): RNode[] {
  return flatten(node).filter(predicate);
}

function byType(node: RNode, type: string): RNode[] {
  return findAll(node, (n) => n.type === type);
}

function textOf(node: RNode, exact: string): RNode | undefined {
  return findAll(node, (n) => n.text === exact)[0];
}

function hasText(node: RNode, exact: string): boolean {
  return textOf(node, exact) !== undefined;
}

function modOf(node: RNode | undefined, name: string) {
  return node?.modifiers.find((m) => m.name === name);
}

/** Colour name for both ColorVal and unresolved `.implicit` colour values. */
function colorName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const ref = value as { t?: string; name?: string; path?: string[] };
  if (ref.t === "color") return ref.name;
  if (ref.t === "implicit") return ref.path?.[ref.path.length - 1];
  return undefined;
}

function colorAlpha(value: unknown): number {
  const ref = value as { t?: string; alpha?: number };
  return ref.t === "color" && typeof ref.alpha === "number" ? ref.alpha : 1;
}

function assertNoUnsupported(screen: Screen) {
  const unsupported = findAll(screen.node, (n) => n.type === "Unsupported");
  assert.equal(
    unsupported.length,
    0,
    `unexpected placeholders: ${unsupported.map((n) => n.text).join(", ")}`,
  );
}

/* ══════════════════════ Suite 1 — Marketplace dashboard ══════════════════════ */

console.log("suite 1 — LazyVGrid marketplace dashboard");

const MARKETPLACE = `struct Product: Identifiable {
    let id = UUID()
    let name: String
    let price: Int
    let icon: String
}

struct ContentView: View {
    @State private var products: [Product] = [
        Product(name: "Kopi Susu", price: 25000, icon: "cup.and.saucer"),
        Product(name: "Roti Bakar", price: 15000, icon: "fork.knife"),
        Product(name: "Es Teh", price: 8000, icon: "drop"),
        Product(name: "Nasi Goreng", price: 30000, icon: "flame.circle")
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Katalog")
                    .font(.largeTitle)
                    .bold()

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                    ForEach(products) { product in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Image(systemName: product.icon)
                                    .font(.title2)
                                    .foregroundColor(.blue)
                                Spacer()
                                Text("Rp \\(product.price)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Text(product.name)
                                .font(.headline)
                                .lineLimit(2)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white)
                        .cornerRadius(14)
                        .shadow(color: .black.opacity(0.12), radius: 8, x: 0, y: 4)
                        .overlay(alignment: .topTrailing) {
                            Text("Baru")
                                .font(.caption2)
                                .foregroundColor(.white)
                                .padding(4)
                                .background(Color.red)
                                .cornerRadius(6)
                                .offset(x: 6, y: -6)
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(Color.systemGroupedBackground)
        .navigationTitle("Toko")
    }
}`;

{
  const { screen } = build(MARKETPLACE);
  const nodes = flatten(screen.node);
  const grid = byType(screen.node, "LazyVGrid")[0];
  const cards = grid?.children ?? [];

  check("grid renders one card per product", () => {
    assert.ok(grid, "LazyVGrid node exists");
    assert.equal(cards.length, 4);
    assert.ok(hasText(screen.node, "Kopi Susu"));
    assert.ok(hasText(screen.node, "Nasi Goreng"));
  });

  check("GridItem(.adaptive(minimum: 140)) keeps its descriptor", () => {
    const columns = grid?.args.find((a) => a.label === "columns")?.value;
    assert.ok(Array.isArray(columns), "columns is an array");
    const item = columns[0] as { t?: string; path?: string[]; args?: { value: unknown }[] };
    assert.equal(item.t, "implicit");
    assert.deepEqual(item.path, ["GridItem"]);
    const inner = item.args?.[0]?.value as { t?: string; path?: string[]; args?: { label?: string; value?: unknown }[] };
    assert.equal(inner.t, "implicit");
    assert.equal(inner.path?.[inner.path.length - 1], "adaptive");
    assert.equal(inner.args?.find((a) => a.label === "minimum")?.value, 140);
  });

  check("card chain keeps padding/frame/background/cornerRadius/shadow/overlay", () => {
    const card = cards[0];
    assert.deepEqual(
      card.modifiers.map((m) => m.name),
      ["padding", "frame", "background", "cornerRadius", "shadow", "overlay"],
    );
    const frame = modOf(card, "frame");
    const maxWidth = frame?.args.find((a) => a.label === "maxWidth")?.value as { path?: string[] };
    assert.equal(maxWidth?.path?.[0], "infinity");
    const alignment = frame?.args.find((a) => a.label === "alignment")?.value as { path?: string[] };
    assert.equal(alignment?.path?.[0], "leading");
    assert.equal(modOf(card, "cornerRadius")?.args[0].value, 14);
  });

  check("shadow keeps the alpha of .black.opacity(0.12)", () => {
    const shadow = modOf(cards[0], "shadow");
    const color = shadow?.args.find((a) => a.label === "color")?.value;
    assert.equal(colorName(color), "black");
    assert.ok(Math.abs(colorAlpha(color) - 0.12) < 1e-9, `alpha was ${colorAlpha(color)}`);
  });

  check("overlay badge is built with its own offset", () => {
    const overlay = modOf(cards[0], "overlay");
    assert.ok(overlay?.children && overlay.children.length > 0, "overlay has children");
    const badge = overlay.children[0];
    assert.equal(badge.text, "Baru");
    const offset = modOf(badge, "offset");
    assert.equal(offset?.args.find((a) => a.label === "x")?.value, 6);
    assert.equal(offset?.args.find((a) => a.label === "y")?.value, -6);
  });

  check("SF Symbols resolve for product icons", () => {
    const images = byType(screen.node, "Image");
    assert.equal(images.length, 4);
    const names = images.map((n) => n.args.find((a) => a.label === "systemName")?.value);
    assert.ok(names.includes("cup.and.saucer"));
    assert.ok(names.includes("flame.circle"));
  });

  check("no placeholder views in the dashboard tree", () => {
    assertNoUnsupported(screen);
  });
}

/* ══════════════════════ Suite 2 — GeometryReader hero ══════════════════════ */

console.log("suite 2 — GeometryReader responsive hero");

const HERO = `struct ContentView: View {
    @State private var page = 0

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    LinearGradient(
                        colors: [.purple, .blue],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Promo Akhir Pekan")
                            .font(.title2)
                            .bold()
                            .foregroundColor(.white)
                        Text("Diskon hingga 70%")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.85))
                    }
                    .padding(20)
                }
                .frame(width: geo.size.width, height: geo.size.height * 0.6)
                .cornerRadius(20)
            }
            .frame(height: 260)

            HStack {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(index == page ? Color.orange : Color.gray.opacity(0.4))
                        .frame(width: 10, height: 10)
                }
            }
            .padding(.top, 12)
        }
        .padding(16)
    }
}`;

{
  const { screen, runtime, diagnostics } = build(HERO);
  const geometry = byType(screen.node, "GeometryReader")[0];

  check("GeometryReader node exposes a proxy binding", () => {
    assert.ok(geometry, "GeometryReader node exists");
    assert.equal(geometry.id, "root/0/0");
    assert.equal(typeof geometry.onResize, "function");
  });

  check("geo.size drives the hero frame after measurement", () => {
    assert.ok(geometry, "GeometryReader exists");
    const frame = modOf(geometry.children.find((c) => c.type === "ZStack"), "frame");
    assert.ok(frame, "hero frame exists");
    // Before measurement the proxy is 0×0 (renderer reports real size later).
    assert.equal(frame.args.find((a) => a.label === "width")?.value, 0);

    runtime.setGeometry(geometry.id, 361, 260);
    const remeasured = runtime.buildScreen();
    const heroAgain = byType(remeasured.node, "GeometryReader")[0];
    const frame2 = modOf(heroAgain.children.find((c) => c.type === "ZStack"), "frame");
    const width = frame2?.args.find((a) => a.label === "width")?.value as number;
    const height = frame2?.args.find((a) => a.label === "height")?.value as number;
    assert.equal(width, 361);
    assert.ok(Math.abs(height - 156) < 0.01, `height was ${height}`);
  });

  check("LinearGradient view keeps colors and points", () => {
    const gradient = byType(screen.node, "LinearGradient")[0];
    assert.ok(gradient, "gradient node exists");
    const colors = gradient.args.find((a) => a.label === "colors")?.value;
    assert.ok(Array.isArray(colors) && colors.length === 2, "two gradient stops");
    const start = gradient.args.find((a) => a.label === "startPoint")?.value as { path?: string[] };
    assert.equal(start?.path?.[0], "topLeading");
  });

  check("ZStack uses bottomLeading alignment metadata", () => {
    const stack = byType(screen.node, "ZStack")[0];
    const alignment = stack?.args.find((a) => a.label === "alignment")?.value as { path?: string[] };
    assert.equal(alignment?.path?.[0], "bottomLeading");
  });

  check("white.opacity(0.85) survives the evaluator", () => {
    const title = textOf(screen.node, "Diskon hingga 70%");
    const foreground = modOf(title, "foregroundColor");
    const color = foreground?.args[0].value;
    assert.equal(colorName(color), "white");
    assert.ok(Math.abs(colorAlpha(color) - 0.85) < 1e-9, `alpha was ${colorAlpha(color)}`);
  });

  check("ForEach ternary picks the active dot colour", () => {
    const circles = byType(screen.node, "Circle");
    assert.equal(circles.length, 3);
    const fills = circles.map((c) => modOf(c, "fill")?.args[0].value);
    assert.equal(colorName(fills[0]), "orange");
    assert.equal(colorName(fills[1]), "gray");
    assert.ok(Math.abs(colorAlpha(fills[1]) - 0.4) < 1e-9, `alpha was ${colorAlpha(fills[1])}`);
  });

  check("no diagnostics for the hero", () => {
    assert.equal(diagnostics.length, 0, diagnostics.map((d) => d.message).join("; "));
  });
}

/* ══════════════════════ Suite 3 — Dynamic ViewBuilder form ══════════════════════ */

console.log("suite 3 — dynamic ViewBuilder profile form");

const PROFILE_FORM = `struct ContentView: View {
    @State private var name = ""
    @State private var role = "Pelajar"
    @State private var level = 3
    @State private var showAdvanced = false

    @ViewBuilder
    var statusBadge: some View {
        switch level {
        case 0..<3: Text("Pemula").foregroundColor(.green)
        case 3..<7: Text("Menengah").foregroundColor(.orange)
        default: Text("Mahir").foregroundColor(.red)
        }
    }

    var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name.isEmpty ? "Tanpa Nama" : "Halo, \\(name)!")
                .font(.title3)
                .bold()
            statusBadge
        }
    }

    var body: some View {
        Form {
            Section(header: Text("Profil")) {
                TextField("Nama", text: $name)
                Picker("Peran", selection: $role) {
                    Text("Pelajar").tag("Pelajar")
                    Text("Pengajar").tag("Pengajar")
                    Text("Developer").tag("Developer")
                }
                Stepper("Level: \\(level)", value: $level, in: 0...10)
            }

            if showAdvanced {
                Section(header: Text("Lanjutan")) {
                    greeting
                }
            }

            Toggle("Mode lanjutan", isOn: $showAdvanced)
        }
    }
}`;

{
  const { screen, runtime } = build(PROFILE_FORM);

  // Flip the advanced toggle through the live binding and rebuild.
  const setAdvanced = (on: boolean): Screen => {
    const current = runtime.buildScreen();
    byType(current.node, "Toggle")[0]
      ?.bindings?.find((b) => b.label === "isOn")
      ?.binding?.set(on);
    return runtime.buildScreen();
  };

  check("computed some-View properties expand in place", () => {
    const advanced = setAdvanced(true);
    assert.ok(hasText(advanced.node, "Tanpa Nama"), "greeting text missing");
    assert.ok(hasText(advanced.node, "Menengah"), "statusBadge switch failed");
    assert.equal(hasText(advanced.node, "Pemula"), false);
    assert.equal(hasText(advanced.node, "Mahir"), false);
  });

  check("range switch patterns match numerically in view builders", () => {
    const advanced = setAdvanced(true);
    const badge = textOf(advanced.node, "Menengah");
    const color = modOf(badge, "foregroundColor")?.args[0].value;
    assert.equal(colorName(color), "orange");
  });

  check("conditional section appears when the toggle flips", () => {
    assert.equal(hasText(setAdvanced(false).node, "Lanjutan"), false);
    assert.ok(hasText(setAdvanced(true).node, "Lanjutan"), "advanced section should appear");
    assert.ok(hasText(runtime.buildScreen().node, "Tanpa Nama"), "greeting should render inside it");
  });

  check("TextField binding feeds the greeting ternary", () => {
    setAdvanced(true);
    const field = byType(runtime.buildScreen().node, "TextField")[0];
    const textBinding = field?.bindings?.find((b) => b.label === "text")?.binding;
    textBinding?.set("Rani");
    const after = runtime.buildScreen();
    assert.ok(hasText(after.node, "Halo, Rani!"), "interpolated greeting missing");
  });

  check("Picker keeps selection binding and tagged options", () => {
    const picker = byType(screen.node, "Picker")[0];
    const selection = picker?.bindings?.find((b) => b.label === "selection")?.binding;
    assert.ok(selection, "selection binding exists");
    assert.equal(selection?.get(), "Pelajar");
    const tags = picker?.children.map((c) => modOf(c, "tag")?.value);
    assert.deepEqual(tags, ["Pelajar", "Pengajar", "Developer"]);
  });

  check("Stepper label interpolates state", () => {
    const stepper = byType(screen.node, "Stepper")[0];
    assert.equal(stepper?.text, "Level: 3");
    const stepBinding = stepper?.bindings?.find((b) => b.label === "value")?.binding;
    stepBinding?.set(6);
    const after = runtime.buildScreen();
    assert.ok(hasText(after.node, "Level: 6"));
  });
}

/* ══════════════════════ Suite 4 — Navigation, list, modal ══════════════════════ */

console.log("suite 4 — store navigation with toolbar, sheet and alert");

const STORE = `struct ContentView: View {
    @State private var showSheet = false
    @State private var showAlert = false
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                Section(header: Text("Menu")) {
                    NavigationLink("Detail Item") { DetailView(title: "Item 3") }
                    Button("Tampilkan Sheet") { showSheet = true }
                    Button("Tampilkan Alert") { showAlert = true }
                }
                Section(header: Text("Cari")) {
                    TextField("Kata kunci", text: $query)
                    Text("Hasil untuk: \\(query)")
                }
            }
            .navigationTitle("Toko")
            .toolbar {
                ToolbarItem {
                    Button("Reset") { query = "" }
                }
            }
            .sheet(isPresented: $showSheet) {
                VStack {
                    Text("Sheet aktif")
                    Button("Tutup") { showSheet = false }
                }
            }
            .alert("Hapus?", isPresented: $showAlert) {
                Button("Batal", role: .cancel) { }
                Button("Hapus", role: .destructive) { print("deleted") }
            } message: {
                Text("Tindakan tidak bisa dibatalkan")
            }
        }
    }
}

struct DetailView: View {
    let title: String
    @Environment(\\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text(title).font(.title).bold()
            Button("Kembali") { dismiss() }
        }
        .navigationTitle(title)
    }
}`;

{
  const { screen, runtime } = build(STORE);

  check("screen title and toolbar come from the navigation modifiers", () => {
    assert.equal(screen.title, "Toko");
    assert.equal(screen.toolbar.length, 1);
    assert.equal(screen.toolbar[0].text, "Reset");
  });

  check("sections split rows and NavigationLink pushes the detail screen", () => {
    const sections = byType(screen.node, "Section");
    assert.equal(sections.length, 2);
    assert.ok(hasText(screen.node, "Hasil untuk: "));

    textOf(screen.node, "Detail Item")?.action?.();
    const pushed = runtime.buildScreen();
    assert.equal(pushed.isRoot, false);
    assert.equal(pushed.title, "Item 3");
    assert.ok(hasText(pushed.node, "Item 3"));

    textOf(pushed.node, "Kembali")?.action?.();
    assert.equal(runtime.buildScreen().isRoot, true);
  });

  check("toolbar Reset button writes through the text binding", () => {
    const field = byType(screen.node, "TextField")[0];
    field?.bindings?.find((b) => b.label === "text")?.binding?.set("kopi");
    assert.ok(hasText(runtime.buildScreen().node, "Hasil untuk: kopi"));
    screen.toolbar[0].action?.();
    assert.ok(hasText(runtime.buildScreen().node, "Hasil untuk: "));
  });

  check("sheet presents, contains content and dismisses", () => {
    textOf(screen.node, "Tampilkan Sheet")?.action?.();
    const presented = runtime.buildScreen();
    assert.equal(presented.modals.length, 1);
    assert.equal(presented.modals[0].kind, "sheet");
    assert.ok(hasText(presented.modals[0].node!, "Sheet aktif"));
    textOf(presented.modals[0].node!, "Tutup")?.action?.();
    assert.equal(runtime.buildScreen().modals.length, 0);
  });

  check("alert collects both buttons and runs the destructive action", () => {
    textOf(screen.node, "Tampilkan Alert")?.action?.();
    const presented = runtime.buildScreen();
    const alert = presented.modals.find((m) => m.kind === "alert");
    assert.ok(alert, "alert modal exists");
    assert.equal(alert?.title, "Hapus?");
    assert.deepEqual(alert?.actions?.map((a) => a.text), ["Batal", "Hapus"]);
    alert?.actions?.[1].action?.();
    assert.deepEqual(runtime.logs, ["deleted"]);
  });
}

/* ══════════════════════ Suite 5 — Custom shapes and Path ══════════════════════ */

console.log("suite 5 — custom shapes, Path and ring progress");

const SHAPES = `struct ContentView: View {
    @State private var progress = 0.65

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.25), lineWidth: 12)
                    .frame(width: 120, height: 120)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color.blue, lineWidth: 12)
                    .rotationEffect(.degrees(-90))
                    .frame(width: 120, height: 120)

                Text("\\(Int(progress * 100))%")
                    .font(.title2)
                    .bold()
            }

            Path { path in
                path.move(to: CGPoint(x: 10, y: 60))
                path.addLine(to: CGPoint(x: 50, y: 20))
                path.addLine(to: CGPoint(x: 90, y: 45))
                path.addLine(to: CGPoint(x: 130, y: 10))
            }
            .stroke(Color.green, lineWidth: 3)
            .frame(height: 70)
            .background(Color.yellow.opacity(0.15))
            .cornerRadius(8)

            RoundedRectangle(cornerRadius: 12)
                .fill(Color.orange)
                .frame(width: 160, height: 44)
                .overlay {
                    Text("Klaim")
                        .foregroundColor(.white)
                        .bold()
                }
                .rotationEffect(.degrees(-3))

            ProgressView(value: progress)
        }
        .padding()
    }
}`;

{
  const { screen } = build(SHAPES);

  check("progress ring keeps stroke, trim and rotation metadata", () => {
    const circles = byType(screen.node, "Circle");
    assert.equal(circles.length, 2);
    const ring = circles[1];
    assert.equal(modOf(ring, "stroke")?.args[0].label, undefined);
    assert.equal(modOf(ring, "rotationEffect")?.args[0].value !== undefined, true);
    const trim = modOf(ring, "trim");
    assert.ok(trim, "trim is parsed and drives the SVG ring render");
    assert.equal(trim?.args.find((a) => a.label === "from")?.value, 0);
    assert.ok(Math.abs((trim?.args.find((a) => a.label === "to")?.value as number) - 0.65) < 1e-9);
    const angle = modOf(ring, "rotationEffect")?.args[0].value as { t?: string; degrees?: number };
    assert.equal(angle.t, "angle");
    assert.equal(angle.degrees, -90);
  });

  check("Int(progress * 100) formats through interpolation", () => {
    assert.ok(hasText(screen.node, "65%"), "progress label missing");
  });

  check("Path builder records commands into an SVG path", () => {
    const path = byType(screen.node, "Path")[0];
    assert.ok(path, "Path node exists");
    const d = path.args.find((a) => a.label === "d")?.value as string;
    const viewBox = path.args.find((a) => a.label === "viewBox")?.value as string;
    assert.ok(d.includes("M10 60"), `d was ${d}`);
    assert.ok(d.includes("L130 10"), `d was ${d}`);
    assert.equal(viewBox, "10 10 120 50");
  });

  check("path keeps stroke styling and background chain", () => {
    const path = byType(screen.node, "Path")[0];
    assert.equal(modOf(path, "stroke")?.args[0].value !== undefined, true);
    assert.equal(modOf(path, "frame")?.args.find((a) => a.label === "height")?.value, 70);
    assert.equal(modOf(path, "cornerRadius")?.args[0].value, 8);
  });

  check("RoundedRectangle keeps radius, fill and overlay label", () => {
    const rect = byType(screen.node, "RoundedRectangle")[0];
    assert.equal(rect.args.find((a) => a.label === "cornerRadius")?.value, 12);
    const fill = modOf(rect, "fill")?.args[0].value;
    assert.equal(colorName(fill), "orange");
    assert.equal(modOf(rect, "frame")?.args.find((a) => a.label === "width")?.value, 160);
    const overlay = modOf(rect, "overlay");
    assert.equal(overlay?.children?.[0].text, "Klaim");
    const rotate = modOf(rect, "rotationEffect")?.args[0].value as { degrees?: number };
    assert.equal(rotate.degrees, -3);
  });

  check("ProgressView receives its numeric value", () => {
    const progress = byType(screen.node, "ProgressView")[0];
    assert.ok(Math.abs((progress.args.find((a) => a.label === "value")?.value as number) - 0.65) < 1e-9);
  });

  check("no placeholder views in the shapes tree", () => {
    assertNoUnsupported(screen);
  });
}

/* ══════════════════════ Suite 6 — view reference with modifier chain ══════════════════════ */

console.log("suite 6 — some-View reference with modifier chain");

const REF_CHAIN = `struct ContentView: View {
    @State private var tapped = 0

    var pill: some View {
        Text("Pill")
            .bold()
    }

    var body: some View {
        VStack {
            pill
                .padding(10)
                .background(Color.blue)
                .cornerRadius(8)
            HStack {
                pill
            }
            Text("taps: \\(tapped)")
        }
    }
}`;

{
  const { screen } = build(REF_CHAIN);

  check("chained reference wraps its body in a Group node", () => {
    const groups = byType(screen.node, "Group");
    assert.equal(groups.length, 1, "one wrapped reference");
    const group = groups[0];
    assert.deepEqual(
      group.modifiers.map((m) => m.name),
      ["padding", "background", "cornerRadius"],
    );
    assert.equal(modOf(group, "padding")?.args[0].value, 10);
    const inner = group.children[0];
    assert.equal(inner.type, "Text");
    assert.equal(inner.text, "Pill");
    assert.deepEqual(inner.modifiers.map((m) => m.name), ["bold"]);
  });

  check("bare reference still expands without a wrapper", () => {
    const pills = findAll(screen.node, (n) => n.text === "Pill");
    assert.equal(pills.length, 2, "chained + bare usages both render");
    assert.equal(byType(screen.node, "Group").length, 1, "only the chained usage is wrapped");
    assert.ok(hasText(screen.node, "taps: 0"));
  });
}

/* ══════════════════════ Suite 7 — full-bleed background layers ══════════════════════ */

console.log("suite 7 — value views and full-bleed safe area");

const FULL_BLEED = `struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black
            Color.gray.opacity(0.4)
            Material.thin
            VStack {
                Text("FULL BLEED")
                    .bold()
                    .foregroundColor(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
    }
}`;

{
  const { screen } = build(FULL_BLEED);
  const stack = byType(screen.node, "ZStack")[0];

  check("bare Color/Material values become real layers, not bogus modifiers", () => {
    assert.ok(stack, "ZStack exists");
    assert.equal(stack.children.length, 4);

    const black = stack.children[0];
    assert.equal(black.type, "Color");
    assert.equal(colorName(black.args[0]?.value), "black");
    assert.equal(
      black.modifiers.some((m) => m.name === "black"),
      false,
      "'.black' must not be treated as a view modifier",
    );

    const gray = stack.children[1];
    assert.equal(gray.type, "Color");
    assert.equal(colorName(gray.args[0]?.value), "gray");
    assert.ok(Math.abs(colorAlpha(gray.args[0]?.value) - 0.4) < 1e-9);

    assert.equal(stack.children[2].type, "Material");
  });

  check("root keeps the infinity frame and the safe-area opt-out", () => {
    const names = screen.node.modifiers.map((m) => m.name);
    assert.ok(names.includes("frame"), `modifiers were ${names.join(",")}`);
    assert.ok(names.includes("ignoresSafeArea"));

    const frame = modOf(screen.node, "frame");
    const maxWidth = frame?.args.find((a) => a.label === "maxWidth")?.value as { path?: string[] };
    const maxHeight = frame?.args.find((a) => a.label === "maxHeight")?.value as { path?: string[] };
    assert.equal(maxWidth?.path?.[0], "infinity");
    assert.equal(maxHeight?.path?.[0], "infinity");
  });

  check("ignoresSafeArea(edges:) keeps its edge argument", () => {
    const { screen: edgeScreen } = build(`struct ContentView: View {
      var body: some View {
        Text("x")
          .frame(maxWidth: .infinity)
          .ignoresSafeArea(edges: .bottom)
      }
    }`);
    const mod = modOf(edgeScreen.node, "ignoresSafeArea");
    const edges = mod?.args.find((a) => a.label === "edges")?.value as { path?: string[] };
    assert.equal(edges?.path?.[0], "bottom");
  });
}

/* ══════════════════════ Suite 8 — Button closure forms & flexible controls ══════════════════════ */

console.log("suite 8 — Button closure forms, alert message, flexible controls");

const BUTTON_FORMS = `struct ContentView: View {
    @State private var name = ""

    var body: some View {
        VStack(spacing: 10) {
            Button(action: { name = "ArgAction" }) { Text("Arg Action") }
            Button { name = "MultiTrail" } label: { Text("Multi Trail") }
            Button("Plain") { name = "Plain" }
            Button(action: { name = "BothArgs" }, label: { Text("Both Args") })
            Text("name: \\(name)")
            TextField("Nama", text: $name)
        }
        .padding()
    }
}`;

{
  const { screen, runtime } = build(BUTTON_FORMS);
  const buttons = byType(screen.node, "Button");

  check("all four Button closure forms build their labels", () => {
    assert.equal(buttons.length, 4);
    assert.equal(buttons[0].children[0]?.text, "Arg Action");
    assert.equal(buttons[1].children[0]?.text, "Multi Trail");
    assert.equal(buttons[2].text, "Plain");
    assert.equal(buttons[3].children[0]?.text, "Both Args");
    assert.equal(
      buttons.some((b) => b.text === "Button"),
      false,
      "no Button may fall back to the raw 'Button' label",
    );
  });

  check("each Button contract wires its action", () => {
    buttons[0].action?.();
    assert.ok(hasText(runtime.buildScreen().node, "name: ArgAction"));
    buttons[1].action?.();
    assert.ok(hasText(runtime.buildScreen().node, "name: MultiTrail"));
    buttons[2].action?.();
    assert.ok(hasText(runtime.buildScreen().node, "name: Plain"));
  });

  check("TextField keeps its binding and renders as a field node", () => {
    const field = byType(screen.node, "TextField")[0];
    assert.ok(field, "TextField node exists");
    assert.ok(field.bindings?.find((b) => b.label === "text")?.binding, "text binding exists");
  });
}

const NAV_LABELED = `struct ContentView: View {
    var body: some View {
        NavigationStack {
            NavigationLink { Text("Tujuan") } label: { Text("Buka") }
        }
    }
}`;

{
  const { screen, runtime } = build(NAV_LABELED);

  check("NavigationLink { } label: { } pushes its destination", () => {
    const link = byType(screen.node, "NavigationLink")[0];
    assert.ok(link, "NavigationLink node exists");
    assert.ok(hasText(screen.node, "Buka"), "label missing");
    assert.equal(hasText(screen.node, "Tujuan"), false, "destination must not render inline");
    link.action?.();
    assert.ok(hasText(runtime.buildScreen().node, "Tujuan"), "destination screen missing");
  });
}

const ALERT_MESSAGE = `struct ContentView: View {
    @State private var show = false

    var body: some View {
        Button("Warn") { show = true }
            .alert("Hati-hati", isPresented: $show) {
                Button("OK") { }
            } message: {
                Text("Pesan detail")
            }
    }
}`;

{
  const { screen, runtime } = build(ALERT_MESSAGE);
  textOf(screen.node, "Warn")?.action?.();
  const presented = runtime.buildScreen();
  const modal = presented.modals[0];

  check("alert message: labeled trailing becomes the modal message", () => {
    assert.ok(modal, "alert presented");
    assert.equal(modal.kind, "alert");
    assert.ok(modal.message, "modal exposes a message node");
    assert.ok(hasText(modal.message!, "Pesan detail"), "message text missing");
    assert.equal(
      hasText(presented.node, "Pesan detail"),
      false,
      "message must not leak into the page tree",
    );
  });
}

/* ══════════════════════ Suite 9 — frame infinity → w-full mapping ══════════════════════ */

console.log("suite 9 — frame infinity maps to w-full");

const FORM_LAYOUT = `struct ContentView: View {
    @State private var name = ""

    var body: some View {
        VStack(spacing: 12) {
            TextField("Nama", text: $name)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: .infinity)

            Button("Simpan") { }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)

            HStack {
                TextField("Cari", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: .infinity)
                Button("Go") { }
            }

            Button { } label: {
                HStack {
                    Text("Kirim")
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding()
    }
}`;

{
  const { screen } = build(FORM_LAYOUT);
  const field = byType(screen.node, "TextField")[0];
  const button = byType(screen.node, "Button")[0];
  const row = byType(screen.node, "HStack")[0];
  const rowField = byType(row, "TextField")[0];

  check("frame(maxWidth: .infinity) records the fill-x intent", () => {
    const layout = frameLayout(field?.modifiers ?? []);
    assert.ok(layout, "frame layout exists");
    assert.equal(layout.fillX, true);
    assert.equal(layout.fillY, false);
    assert.equal(hasFrameSizing(layout), true);
  });

  check("frame(maxWidth: .infinity) maps to w-full in a column", () => {
    const layout = frameLayout(button?.modifiers ?? [])!;
    const classes = frameClasses(layout, "vertical");
    assert.ok(classes.includes("w-full"), `classes were ${classes.join(" ")}`);
    assert.ok(classes.includes("self-stretch"));
    assert.equal(classes.includes("h-full"), false);
  });

  check("frame(maxWidth: .infinity) flexes like a Spacer in a row", () => {
    const layout = frameLayout(rowField?.modifiers ?? [])!;
    const classes = frameClasses(layout, "horizontal");
    assert.ok(classes.includes("w-full"));
    assert.ok(classes.includes("flex-1"));
    assert.ok(classes.includes("basis-0"));
    assert.ok(classes.includes("min-w-0"));
  });

  check("frame without sizing stays a pure alignment frame", () => {
    const { screen: noSizing } = build(`struct ContentView: View {
      var body: some View { Text("x").frame(alignment: .leading) }
    }`);
    const layout = frameLayout(noSizing.node.modifiers)!;
    assert.equal(hasFrameSizing(layout), false);
    assert.deepEqual(frameClasses(layout, "none"), []);
  });

  check("Spacer keeps a flexible mapping on both axes", () => {
    assert.ok(spacerClasses("horizontal").includes("flex-1"));
    assert.ok(spacerClasses("horizontal").includes("basis-0"));
    assert.ok(spacerClasses("vertical").includes("min-h-[1px]"));
  });

  check("Spacer inside a Button label survives as a spacer node", () => {
    const labelSpacer = findAll(screen.node, (n) => n.type === "Spacer");
    assert.ok(labelSpacer.length >= 1, "spacer node exists in the label");
  });

  check("a horizontal Spacer makes its row and button greedy", () => {
    const { screen: rowScreen } = build(`struct ContentView: View {
      var body: some View {
        HStack { Text("A"); Spacer() }
      }
    }`);
    const rowSpacer = findAll(rowScreen.node, (n) => n.type === "Spacer")[0];
    assert.equal(viewWantsFullWidth(rowSpacer, "horizontal"), true);

    const { screen: buttonScreen } = build(`struct ContentView: View {
      var body: some View {
        Button { } label: {
          HStack { Text("Kirim"); Spacer() }
        }
      }
    }`);
    const button = byType(buttonScreen.node, "Button")[0];
    assert.equal(
      button.children.some((child) => viewWantsFullWidth(child, "horizontal")),
      true,
      "a row label with a Spacer makes the button greedy",
    );
  });

  check("a vertical Spacer does not make a row or button greedy", () => {
    const { screen: rowScreen } = build(`struct ContentView: View {
      var body: some View {
        HStack { VStack { Text("A"); Spacer() } }
      }
    }`);
    const nested = byType(rowScreen.node, "VStack")[0];
    assert.equal(viewWantsFullWidth(nested, "horizontal"), false);

    const { screen: buttonScreen } = build(`struct ContentView: View {
      var body: some View {
        Button { } label: {
          VStack { Text("Entri"); Spacer() }
        }
      }
    }`);
    const button = byType(buttonScreen.node, "Button")[0];
    assert.equal(
      button.children.some((child) => viewWantsFullWidth(child, "horizontal")),
      false,
      "a stacked label must keep the button content-sized",
    );
  });

  check("flat containers decide stretching per rendered child", () => {
    const { screen: textGroup } = build(`struct ContentView: View {
      var body: some View { Group { Text("x") }.frame(maxWidth: .infinity) }
    }`);
    assert.equal(frameStretches(textGroup.node), false, "a Text keeps its intrinsic box");

    const { screen: fieldGroup } = build(`struct ContentView: View {
      @State private var name = ""
      var body: some View {
        Group { TextField("Nama", text: $name) }.frame(maxWidth: .infinity)
      }
    }`);
    assert.equal(frameStretches(fieldGroup.node), true, "a TextField fills the frame");

    const { screen: vstack } = build(`struct ContentView: View {
      var body: some View { VStack { Text("x") }.frame(maxWidth: .infinity) }
    }`);
    assert.equal(frameStretches(vstack.node), true, "containers fill the frame");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
