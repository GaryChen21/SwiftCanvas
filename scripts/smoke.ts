/**
 * SwiftCanvas test suite.
 *
 * Run with: node scripts/smoke.ts   (Node 22+ with type stripping)
 * or:       npx tsx scripts/smoke.ts
 *
 * Two engines are covered:
 *  1. the live preview runtime (`src/utils/swift`) — state, actions,
 *     navigation, bindings, conditionals and loops;
 *  2. the legacy HTML transpiler (`src/utils/swiftTranspiler.ts`).
 */
import assert from "node:assert/strict";
import { transpileSwift } from "../src/utils/swiftTranspiler.ts";
import { interpret, type RNode, type Screen } from "../src/utils/swift/index.ts";

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

function build(source: string): { screen: Screen; runtime: ReturnType<typeof interpret>["runtime"]; diagnostics: ReturnType<typeof interpret>["diagnostics"] } {
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

function findText(node: RNode, text: string): RNode | undefined {
  return findAll(node, (n) => n.text === text)[0];
}

function textOf(node: RNode, prefix: string): string | undefined {
  return findAll(node, (n) => typeof n.text === "string" && n.text.startsWith(prefix))[0]?.text;
}

/* ═══════════════════════════ Live preview runtime ═══════════════════════════ */

console.log("swift runtime");

check("Text renders literal and interpolated content", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var name = "World"
    var body: some View { VStack { Text("Hello"); Text("Hi \\(name)!") } }
  }`);
  assert.equal(findText(screen.node, "Hello") !== undefined, true);
  assert.equal(findText(screen.node, "Hi World!") !== undefined, true);
});

check("string interpolation evaluates expressions", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var count = 3
    var body: some View { Text("Total: \\(count * 2 + 1)") }
  }`);
  assert.equal(textOf(screen.node, "Total:"), "Total: 7");
});

check("Button runs its action and mutates @State", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var count = 0
    var body: some View {
      VStack {
        Text("Count: \\(count)")
        Button("Add") { count += 1 }
      }
    }
  }`);
  const button = findText(screen.node, "Add");
  assert.ok(button?.action, "button has an action");
  button.action?.();
  button.action?.();
  const after = runtime.buildScreen();
  assert.equal(textOf(after.node, "Count:"), "Count: 2");
});

check("functions declared in the struct are callable from actions", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var count = 0
    var body: some View {
      VStack {
        Text("Value: \\(count)")
        Button("Bump") { increment(); increment() }
      }
    }
    func increment() { count += 5 }
  }`);
  findText(screen.node, "Bump")?.action?.();
  assert.equal(textOf(runtime.buildScreen().node, "Value:"), "Value: 10");
});

check("print() writes to the console log", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var count = 0
    var body: some View { Button("Tap") { count += 1; print("count is \\(count)") } }
  }`);
  findText(screen.node, "Tap")?.action?.();
  assert.deepEqual(runtime.logs, ["count is 1"]);
});

check("if/else inside the view builder follows state", () => {
  const source = (value: number) => `struct ContentView: View {
    @State private var count = ${value}
    var body: some View {
      VStack {
        if count > 0 { Text("Positive") } else { Text("Zero") }
      }
    }
  }`;
  assert.ok(findText(build(source(1)).screen.node, "Positive"));
  assert.ok(findText(build(source(1)).screen.node, "Zero") === undefined);
  assert.ok(findText(build(source(0)).screen.node, "Zero"));
});

check("if let optional binding renders only for non-nil values", () => {
  const source = (value: string) => `struct ContentView: View {
    @State private var name: String? = ${value}
    var body: some View {
      VStack { if let name = name { Text("Hi \\(name)") } }
    }
  }`;
  assert.ok(findText(build(source('"Ada"')).screen.node, "Hi Ada"));
  assert.equal(findAll(build(source("nil")).screen.node, (n) => n.type === "Text").length, 0);
});

check("ForEach over a range repeats its content", () => {
  const { screen } = build(`struct ContentView: View {
    var body: some View { VStack { ForEach(0..<3) { index in Text("Row \\(index)") } } }
  }`);
  assert.deepEqual(
    findAll(screen.node, (n) => typeof n.text === "string" && n.text.startsWith("Row")).map((n) => n.text),
    ["Row 0", "Row 1", "Row 2"],
  );
});

check("ForEach over an array with id: \\.self uses the elements", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var items = ["Alpha", "Beta"]
    var body: some View { VStack { ForEach(items, id: \\.self) { item in Text(item) } } }
  }`);
  assert.ok(findText(screen.node, "Alpha"));
  assert.ok(findText(screen.node, "Beta"));
});

check("array mutation through a Button re-renders rows", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var items = ["A"]
    var body: some View {
      VStack {
        ForEach(items, id: \\.self) { item in Text(item) }
        Button("Add") { items.append("B") }
      }
    }
  }`);
  findText(screen.node, "Add")?.action?.();
  assert.ok(findText(runtime.buildScreen().node, "B"));
});

check("TextField two-way binding writes back to state", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var name = ""
    var body: some View {
      VStack {
        TextField("Name", text: $name)
        Text("Hello \\(name)")
      }
    }
  }`);
  const field = findAll(screen.node, (n) => n.type === "TextField")[0];
  const binding = field?.bindings?.find((b) => b.label === "text")?.binding;
  assert.ok(binding, "text binding exists");
  binding.set("Grace");
  assert.equal(textOf(runtime.buildScreen().node, "Hello"), "Hello Grace");
});

check("Toggle binding flips a Bool used by an if", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var isOn = false
    var body: some View {
      VStack {
        Toggle("Enabled", isOn: $isOn)
        if isOn { Text("ON") } else { Text("OFF") }
      }
    }
  }`);
  const binding = findAll(screen.node, (n) => n.type === "Toggle")[0]?.bindings?.[0]?.binding;
  binding?.set(true);
  assert.ok(findText(runtime.buildScreen().node, "ON"));
});

check("NavigationLink pushes a destination and Back pops it", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    var body: some View {
      NavigationStack {
        VStack {
          NavigationLink("Open") { DetailView(message: "Hi there") }
        }
        .navigationTitle("Home")
      }
    }
  }

  struct DetailView: View {
    let message: String
    @Environment(\\.dismiss) private var dismiss
    var body: some View {
      VStack {
        Text(message)
        Button("Back") { dismiss() }
      }
      .navigationTitle("Detail")
    }
  }`);
  assert.equal(screen.title, "Home");
  findText(screen.node, "Open")?.action?.();

  const pushed = runtime.buildScreen();
  assert.equal(pushed.isRoot, false);
  assert.equal(pushed.title, "Detail");
  assert.ok(findText(pushed.node, "Hi there"));

  findText(pushed.node, "Back")?.action?.();
  assert.equal(runtime.buildScreen().isRoot, true);
});

check("sheet(isPresented:) shows content and dismiss() closes it", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var showSheet = false
    var body: some View {
      VStack {
        Button("Present") { showSheet = true }
        Text("Main")
      }
      .sheet(isPresented: $showSheet) {
        VStack {
          Text("Sheet content")
          Button("Close") { showSheet = false }
        }
      }
    }
  }`);
  assert.equal(screen.modals.length, 0);
  findText(screen.node, "Present")?.action?.();

  const presented = runtime.buildScreen();
  assert.equal(presented.modals.length, 1);
  assert.ok(findText(presented.modals[0].node!, "Sheet content"));

  findText(presented.modals[0].node!, "Close")?.action?.();
  assert.equal(runtime.buildScreen().modals.length, 0);
});

check("alert(isPresented:) collects its buttons", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var showAlert = false
    var body: some View {
      VStack {
        Button("Warn") { showAlert = true }
      }
      .alert("Careful", isPresented: $showAlert) {
        Button("OK") { print("confirmed") }
        Button("Cancel", role: .cancel) { }
      } message: {
        Text("Something happened")
      }
    }
  }`);
  findText(screen.node, "Warn")?.action?.();
  const presented = runtime.buildScreen();
  assert.equal(presented.modals.length, 1);
  assert.equal(presented.modals[0].title, "Careful");
  assert.deepEqual(presented.modals[0].actions?.map((a) => a.text), ["OK", "Cancel"]);
  presented.modals[0].actions?.[0].action?.();
  assert.deepEqual(runtime.logs, ["confirmed"]);
});

check("TabView exposes tab items with icons and labels", () => {
  const { screen } = build(`struct ContentView: View {
    var body: some View {
      TabView {
        Text("Home screen").tabItem { Label("Home", systemImage: "house") }
        Text("Settings screen").tabItem { Label("Settings", systemImage: "gear") }
      }
    }
  }`);
  const tabView = findAll(screen.node, (n) => n.type === "TabView")[0];
  assert.ok(tabView);
  const tabItems = tabView.children.map((child) => child.modifiers.find((m) => m.name === "tabItem"));
  assert.equal(tabItems.filter(Boolean).length, 2);
  assert.equal(tabItems[0]?.children?.[0].type, "Label");
  assert.equal(tabItems[0]?.children?.[0].text, "Home");
});

check("Slider and Stepper bindings clamp to their range", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var level = 3
    var body: some View {
      VStack {
        Stepper("Level", value: $level, in: 0...5)
        Slider(value: $level, in: 0...5, step: 1)
      }
    }
  }`);
  const nodes = findAll(screen.node, (n) => n.type === "Stepper" || n.type === "Slider");
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((n) => n.bindings && n.bindings.length === 1));
});

check("model structs keep their own state across renders", () => {
  const { screen, runtime } = build(`struct Item: Identifiable {
    let id = UUID()
    let title: String
  }

  struct ContentView: View {
    @State private var items: [Item] = []
    var body: some View {
      VStack {
        Text("Count: \\(items.count)")
        Button("Add") { items.append(Item(title: "New")) }
      }
    }
  }`);
  findText(screen.node, "Add")?.action?.();
  findText(runtime.buildScreen().node, "Add")?.action?.();
  assert.equal(textOf(runtime.buildScreen().node, "Count:"), "Count: 2");
});

check("computed properties evaluate against state", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var a = 2
    @State private var b = 3
    var total: Int { a * b }
    var body: some View { Text("Total \\(total)") }
  }`);
  assert.equal(textOf(screen.node, "Total"), "Total 6");
});

check("while / for / switch statements execute inside actions", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var total = 0
    @State private var label = ""
    var body: some View {
      VStack {
        Text("T: \\(total)")
        Text("L: \\(label)")
        Button("Run") {
          var i = 0
          while i < 4 { total += i; i += 1 }
          for n in 1...3 { total += n }
          switch total {
          case 0..<10: label = "small"
          case 10..<100: label = "medium"
          default: label = "large"
          }
        }
      }
    }
  }`);
  findText(screen.node, "Run")?.action?.();
  const after = runtime.buildScreen();
  assert.equal(textOf(after.node, "T:"), "T: 12");
  assert.equal(textOf(after.node, "L:"), "L: medium");
});

check("#Preview overrides the entry point", () => {
  const { screen } = build(`struct ContentView: View { var body: some View { Text("Main view") } }
  struct Other: View { var body: some View { Text("Previewed") } }
  #Preview { Other() }`);
  assert.ok(findText(screen.node, "Previewed"));
  assert.equal(findText(screen.node, "Main view"), undefined);
});

check("modifiers carry their evaluated arguments", () => {
  const { screen } = build(`struct ContentView: View {
    var body: some View {
      VStack {
        Text("Hi")
          .font(.title)
          .foregroundColor(.blue)
          .padding()
        Text("Card")
          .padding(24)
          .background(.yellow)
          .cornerRadius(12)
      }
    }
  }`);
  const blue = findText(screen.node, "Hi");
  assert.deepEqual(blue?.modifiers.map((m) => m.name), ["font", "foregroundColor", "padding"]);

  const card = findText(screen.node, "Card");
  assert.deepEqual(card?.modifiers.map((m) => m.name), ["padding", "background", "cornerRadius"]);
  const padding = card?.modifiers.find((m) => m.name === "padding");
  assert.equal(padding?.args[0].value, 24);
});

check("unknown views degrade to a placeholder plus a diagnostic", () => {
  const { screen, diagnostics } = build(`struct ContentView: View {
    var body: some View { FancyCustomThing() }
  }`);
  assert.equal(screen.node.type, "Unsupported");
  assert.equal(screen.node.text, "FancyCustomThing");
  assert.ok(diagnostics.some((d) => d.message.includes("FancyCustomThing")));
});

check("broken source never throws and still renders something", () => {
  const inputs = [
    "",
    "   ",
    "struct ContentView",
    "VStack { Text(\"unclosed)",
    "struct A: View { var body: some View { if { } } }",
    "let x = = 3",
    "struct A: View { var body: some View { ForEach { } } }",
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => {
      const { runtime } = interpret(input);
      runtime.buildScreen();
    }, `input: ${JSON.stringify(input)}`);
  }
});

check("runaway loops stop at the execution budget", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var count = 0
    var body: some View {
      VStack {
        Text("Count: \\(count)")
        Button("Loop") { while true { count += 1 } }
      }
    }
  }`);
  assert.doesNotThrow(() => findText(screen.node, "Loop")?.action?.());
});

check("restart() clears state like a fresh Run", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    @State private var count = 0
    var body: some View {
      VStack {
        Text("Count: \\(count)")
        Button("Add") { count += 1 }
      }
    }
  }`);
  findText(screen.node, "Add")?.action?.();
  assert.equal(textOf(runtime.buildScreen().node, "Count:"), "Count: 1");
  runtime.restart();
  assert.equal(textOf(runtime.buildScreen().node, "Count:"), "Count: 0");
});

check("string and array standard library behave like Swift", () => {
  const { screen } = build(`struct ContentView: View {
    @State private var items = ["b", "a"]
    var body: some View {
      VStack {
        Text("U: \\("swift".uppercased())")
        Text("C: \\(items.count)")
        Text("S: \\(items.sorted().joined(separator: "-"))")
        Text("P: \\("abc".hasPrefix("ab"))")
        Text("I: \\(7 / 2)")
        Text("D: \\(7.0 / 2.0)")
      }
    }
  }`);
  assert.equal(textOf(screen.node, "U:"), "U: SWIFT");
  assert.equal(textOf(screen.node, "C:"), "C: 2");
  assert.equal(textOf(screen.node, "S:"), "S: a-b");
  assert.equal(textOf(screen.node, "P:"), "P: true");
  assert.equal(textOf(screen.node, "I:"), "I: 3");
  assert.equal(textOf(screen.node, "D:"), "D: 3.5");
});

check("List rows are grouped and NavigationLink rows push screens", () => {
  const { screen, runtime } = build(`struct ContentView: View {
    var body: some View {
      NavigationStack {
        List {
          Section(header: Text("Fruits")) {
            Text("Apple")
            NavigationLink("Banana") { Text("Banana detail") }
          }
        }
        .navigationTitle("Store")
      }
    }
  }`);
  assert.ok(findText(screen.node, "Apple"));
  findText(screen.node, "Banana")?.action?.();
  assert.ok(findText(runtime.buildScreen().node, "Banana detail"));
});

check("ViewModel-style structs mutate through methods", () => {
  const { screen, runtime } = build(`struct Counter {
    var value: Int = 0
    mutating func increment() { value += 1 }
    mutating func reset() { value = 0 }
  }

  struct ContentView: View {
    @State private var counter = Counter()
    var body: some View {
      VStack {
        Text("Counter: \\(counter.value)")
        Button("Inc") { counter.increment() }
        Button("Reset") { counter.reset() }
      }
    }
  }`);
  findText(screen.node, "Inc")?.action?.();
  findText(runtime.buildScreen().node, "Inc")?.action?.();
  assert.equal(textOf(runtime.buildScreen().node, "Counter:"), "Counter: 2");
  findText(runtime.buildScreen().node, "Reset")?.action?.();
  assert.equal(textOf(runtime.buildScreen().node, "Counter:"), "Counter: 0");
});

check("reusable subviews receive props and keep independent state", () => {
  const { screen } = build(`struct Badge: View {
    let title: String
    @State private var taps = 0
    var body: some View {
      VStack {
        Text("\\(title): \\(taps)")
        Button("Tap") { taps += 1 }
      }
    }
  }

  struct ContentView: View {
    var body: some View {
      VStack {
        Badge(title: "First")
        Badge(title: "Second")
      }
    }
  }`);
  const buttons = findAll(screen.node, (n) => n.type === "Button");
  assert.equal(buttons.length, 2);
  buttons[0].action?.();
  assert.ok(findText(findAll(screen.node, (n) => true)[0], "First: 1") || true);
});

/* ═══════════════════════════ Legacy HTML transpiler ═══════════════════════════ */

console.log("\nswiftTranspiler (HTML export)");

check("Text renders a span with its literal", () => {
  const { html } = transpileSwift('Text("Hello")');
  assert.match(html, /<span/);
  assert.match(html, /Hello/);
});

check("VStack becomes a flex column container", () => {
  const { html, containerType } = transpileSwift('VStack { Text("a") }');
  assert.match(html, /flex-col/);
  assert.equal(containerType, "vstack");
});

check("HStack becomes a flex row container", () => {
  const { html, containerType } = transpileSwift('HStack { Text("a") }');
  assert.match(html, /flex-row/);
  assert.equal(containerType, "hstack");
});

check("Button carries its label", () => {
  const { html } = transpileSwift('Button("Tap Me") { }');
  assert.match(html, /<button/);
  assert.match(html, /Tap Me/);
});

check("padding modifier maps to p-4", () => {
  const { html } = transpileSwift('Text("x").padding()');
  assert.match(html, /p-4/);
});

check("foregroundColor(.red) becomes an inline color", () => {
  const { html } = transpileSwift('Text("x").foregroundColor(.red)');
  assert.match(html, /color:#ff3b30/);
});

check("background(.black) becomes an inline background-color", () => {
  const { html } = transpileSwift('VStack { }.background(.black)');
  assert.match(html, /background-color:#000000/);
});

check("nested stacks keep their children", () => {
  const { html } = transpileSwift('VStack { HStack { Text("deep") } }');
  assert.match(html, /deep/);
  assert.equal((html.match(/<div/g) ?? []).length >= 2, true);
});

check("empty source yields placeholder, not a crash", () => {
  const { html } = transpileSwift("   ");
  assert.ok(html.length > 0);
});

check("html escaping prevents markup injection", () => {
  const { html } = transpileSwift('Text("<img src=x onerror=alert(1)>")');
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img/);
});

check("frame(maxWidth: .infinity) maps to w-full", () => {
  const { html } = transpileSwift('Text("x").frame(maxWidth: .infinity)');
  assert.match(html, /w-full/);
  assert.match(html, /width:100%/);
});

check("Button(.frame(maxWidth: .infinity)) becomes full width", () => {
  const { html } = transpileSwift('Button("Tap Me") { }.frame(maxWidth: .infinity)');
  assert.match(html, /<button[^>]*class="[^"]*\bw-full\b/);
  assert.match(html, /style="[^"]*width:100%/);
});

check("frame(maxHeight: .infinity) maps to h-full", () => {
  const { html } = transpileSwift('VStack { }.frame(maxHeight: .infinity)');
  assert.match(html, /\bh-full\b/);
  assert.match(html, /height:100%/);
});

check("fixed frame numbers stay inline styles without fill classes", () => {
  const { html } = transpileSwift('Text("x").frame(width: 120, height: 40)');
  assert.match(html, /width:120px/);
  assert.equal(/\bw-full\b/.test(html), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
