import type { editor, languages } from "monaco-editor";

/**
 * Monaco does not ship a Swift grammar, so we register a Monarch tokenizer of
 * our own. It targets the SwiftUI subset this IDE actually edits, but the
 * keyword/type tables cover general Swift well enough for daily use.
 */

export const SWIFT_LANGUAGE_ID = "swift";

const KEYWORDS = [
  "actor", "any", "as", "async", "await", "associatedtype", "break", "case",
  "catch", "class", "continue", "convenience", "default", "defer", "deinit",
  "didSet", "do", "dynamic", "else", "enum", "extension", "fallthrough",
  "false", "fileprivate", "final", "for", "func", "get", "guard", "if",
  "import", "in", "indirect", "init", "inout", "internal", "is", "isolated",
  "lazy", "let", "mutating", "nil", "nonisolated", "open", "operator",
  "override", "postfix", "prefix", "private", "protocol", "public", "repeat",
  "required", "rethrows", "return", "self", "set", "some", "static", "struct",
  "subscript", "super", "switch", "throw", "throws", "true", "try", "typealias",
  "var", "weak", "where", "while", "willSet",
];

const TYPES = [
  "Any", "AnyObject", "Array", "Bool", "Character", "Data", "Dictionary",
  "Double", "Error", "Float", "Int", "Never", "Optional", "Result", "Set",
  "String", "Substring", "UInt", "URL", "Void",
];

/**
 * SwiftUI view types and modifier names get their own token class so the
 * editor visually distinguishes framework surface from user code.
 */
const SWIFTUI_TYPES = [
  "App", "Button", "Circle", "Color", "Divider", "ForEach", "GeometryReader",
  "Grid", "Group", "HStack", "Image", "LazyHStack", "LazyVStack", "Link",
  "List", "NavigationLink", "NavigationStack", "NavigationView", "Picker",
  "ProgressView", "Rectangle", "RoundedRectangle", "ScrollView", "Section",
  "SecureField", "Slider", "Spacer", "Stepper", "TabView", "Text", "TextField",
  "Toggle", "VStack", "ZStack", "Capsule", "Ellipse", "Form", "Label",
];

const SWIFTUI_MODIFIERS = [
  "background", "bold", "border", "buttonStyle", "clipShape", "cornerRadius",
  "disabled", "fill", "fixedSize", "font", "fontWeight", "foregroundColor",
  "foregroundStyle", "frame", "ignoresSafeArea", "italic", "lineLimit",
  "lineSpacing", "multilineTextAlignment", "offset", "onAppear", "onTapGesture",
  "opacity", "overlay", "padding", "position", "progressViewStyle", "resizable",
  "rotationEffect", "scaleEffect", "scaledToFill", "scaledToFit", "shadow",
  "stroke", "symbolRenderingMode", "tag", "tint", "underline", "aspectRatio",
  "accentColor", "environment", "environmentObject", "navigationTitle",
  "listStyle", "textFieldStyle", "toggleStyle", "presentationDetents",
];

export const swiftMonarchLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".swift",

  keywords: KEYWORDS,
  typeKeywords: TYPES,
  swiftuiTypes: SWIFTUI_TYPES,
  swiftuiModifiers: SWIFTUI_MODIFIERS,

  operators: [
    "=", "==", "===", "!=", "!==", "+", "-", "*", "/", "%", "<", "<=", ">",
    ">=", "&&", "||", "!", "?", "??", "?.", "->", "=>", "&", "|", "^", "~",
    "<<", ">>", "+=", "-=", "*=", "/=", "%=",
  ],

  symbols: /[=><!~?:&|+\-*/^%@]+/,
  escapes: /\\(?:[0tnr"'\\]|u\{[0-9a-fA-F]{1,8}\})/,

  tokenizer: {
    root: [
      // Attributes: @State, @Binding, @EnvironmentObject, ...
      [/@[A-Za-z_]\w*/, "attribute"],

      // Identifiers: distinguish SwiftUI API from user symbols.
      [
        /[A-Za-z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "type",
            "@swiftuiTypes": "type.identifier",
            "@swiftuiModifiers": "function",
            "@default": "identifier",
          },
        },
      ],

      { include: "@whitespace" },

      // Numbers: 0x, 0b, decimals, exponents, underscores.
      [/0[xX][0-9a-fA-F_]+/, "number.hex"],
      [/0[bB][01_]+/, "number.binary"],
      [/\d[\d_]*\.\d[\d_]*([eE][-+]?\d+)?/, "number.float"],
      [/\d[\d_]*([eE][-+]?\d+)?/, "number"],

      // Strings, including interpolation backslashes.
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"""/, { token: "string.quote", bracket: "@open", next: "@multilineString" }],
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

      [/[{}()[\]]/, "@brackets"],
      [/[<>](?!@symbols)/, "@brackets"],

      [
        /@symbols/,
        {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        },
      ],

      [/[;,.]/, "delimiter"],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\/\/.*$/, "comment.doc"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
    ],

    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],

    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],

    multilineString: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"""/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
  },
};

/**
 * Xcode Dark's editor colors, mapped onto Monaco's theme schema.
 */
export const xcodeDarkTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "dfdfe0" },
    { token: "comment", foreground: "6c7986", fontStyle: "italic" },
    { token: "comment.doc", foreground: "6c7986", fontStyle: "italic" },
    { token: "keyword", foreground: "fc5fa3" },
    { token: "type", foreground: "5dd8ff" },
    { token: "type.identifier", foreground: "9ef1dd" },
    { token: "identifier", foreground: "dfdfe0" },
    { token: "function", foreground: "41a1c0" },
    { token: "attribute", foreground: "ffa500" },
    { token: "string", foreground: "fc6a5d" },
    { token: "string.escape", foreground: "a167e6" },
    { token: "string.quote", foreground: "fc6a5d" },
    { token: "number", foreground: "d0bf69" },
    { token: "number.float", foreground: "d0bf69" },
    { token: "number.hex", foreground: "d0bf69" },
    { token: "number.binary", foreground: "d0bf69" },
    { token: "operator", foreground: "dfdfe0" },
    { token: "delimiter", foreground: "dfdfe0" },
  ],
  colors: {
    "editor.background": "#1f1f24",
    "editor.foreground": "#dfdfe0",
    "editorLineNumber.foreground": "#5c5c60",
    "editorLineNumber.activeForeground": "#a5a5aa",
    "editorCursor.foreground": "#0a84ff",
    "editor.selectionBackground": "#2f4f8f",
    "editor.inactiveSelectionBackground": "#2a3a5c",
    "editor.lineHighlightBackground": "#2a2a30",
    "editorIndentGuide.background1": "#35353b",
    "editorIndentGuide.activeBackground1": "#4f4f57",
    "editorBracketMatch.background": "#3a4a6a",
    "editorBracketMatch.border": "#0a84ff",
    "editorGutter.background": "#1f1f24",
    "editorWidget.background": "#2c2c2e",
    "editorWidget.border": "#4a4a4d",
    "scrollbarSlider.background": "#ffffff20",
    "scrollbarSlider.hoverBackground": "#ffffff30",
    "scrollbarSlider.activeBackground": "#ffffff40",
  },
};

export const SWIFT_SAMPLE_CODE = `import SwiftUI

struct ContentView: View {
    @State private var count: Int = 0

    var body: some View {
        VStack {
            Image(systemName: "globe")
                .foregroundColor(.blue)

            Text("Hello, SwiftUI!")
                .font(.title)
                .foregroundColor(.white)

            Text("Count: 0")

            HStack {
                Button("Tap Me") {
                    print("tapped")
                }
                Button("Reset") {
                    print("reset")
                }
            }

            Spacer()
        }
        .padding()
        .background(.black)
    }
}

#Preview {
    ContentView()
}
`;
