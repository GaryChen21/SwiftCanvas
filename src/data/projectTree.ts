import { DEFAULT_SWIFT_CODE } from "../utils/swiftTranspiler";

export type ProjectNodeKind = "folder" | "file";

export type ProjectFileKind = "swift" | "asset" | "plist" | "json" | "generic";

export interface ProjectNode {
  id: string;
  name: string;
  kind: ProjectNodeKind;
  fileKind?: ProjectFileKind;
  /** Text content for editable files. Folders leave this undefined. */
  content?: string;
  children?: ProjectNode[];
}

const ASSET_INFO = `{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`;

const APP_ICON_SET = `{
  "images" : [
    {
      "filename" : "AppIcon.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`;

const ACCENT_COLOR_SET = `{
  "colors" : [
    {
      "color" : {
        "color-space" : "srgb",
        "components" : {
          "alpha" : "1.000",
          "blue" : "1.000",
          "green" : "0.518",
          "red" : "0.039"
        }
      },
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`;

/**
 * Mock Xcode project used by the navigator. Path-like ids keep selection and
 * expansion state stable while still allowing arbitrarily deep folders.
 */
export const PROJECT_TREE: ProjectNode = {
  id: "root",
  name: "SwiftCanvas",
  kind: "folder",
  children: [
    {
      id: "SwiftCanvasApp.swift",
      name: "SwiftCanvasApp.swift",
      kind: "file",
      fileKind: "swift",
      content: `import SwiftUI

@main
struct SwiftCanvasApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`,
    },
    {
      id: "App",
      name: "App",
      kind: "folder",
      children: [
        {
          id: "App/Views",
          name: "Views",
          kind: "folder",
          children: [
            {
              id: "App/Views/ContentView.swift",
              name: "ContentView.swift",
              kind: "file",
              fileKind: "swift",
              content: DEFAULT_SWIFT_CODE,
            },
            {
              id: "App/Views/Components",
              name: "Components",
              kind: "folder",
              children: [
                {
                  id: "App/Views/Components/PreviewCard.swift",
                  name: "PreviewCard.swift",
                  kind: "file",
                  fileKind: "swift",
                  content: `import SwiftUI

struct PreviewCard: View {
    var body: some View {
        VStack {
            Text("Preview Card")
                .font(.title)
                .foregroundColor(.blue)

            Text("Reusable component")

            HStack {
                Button("Action") { }
                Button("Cancel") { }
            }
        }
        .padding()
    }
}
`,
                },
                {
                  id: "App/Views/Components/StatusBadge.swift",
                  name: "StatusBadge.swift",
                  kind: "file",
                  fileKind: "swift",
                  content: `import SwiftUI

struct StatusBadge: View {
    var body: some View {
        HStack {
            Circle()
                .foregroundColor(.green)
            Text("Build Succeeded")
                .foregroundColor(.green)
        }
        .padding()
    }
}
`,
                },
              ],
            },
            {
              id: "App/Views/DetailView.swift",
              name: "DetailView.swift",
              kind: "file",
              fileKind: "swift",
              content: `import SwiftUI

struct DetailView: View {
    var body: some View {
        VStack {
            Text("Detail")
                .font(.title)
                .foregroundColor(.blue)

            Text("A second SwiftUI screen.")

            Button("Back") { }
        }
        .padding()
    }
}
`,
            },
          ],
        },
        {
          id: "App/Models",
          name: "Models",
          kind: "folder",
          children: [
            {
              id: "App/Models/CounterModel.swift",
              name: "CounterModel.swift",
              kind: "file",
              fileKind: "swift",
              content: `import Foundation

struct CounterModel {
    var count: Int = 0

    mutating func increment() {
        count += 1
    }

    mutating func reset() {
        count = 0
    }
}
`,
            },
          ],
        },
        {
          id: "App/Assets.xcassets",
          name: "Assets.xcassets",
          kind: "folder",
          fileKind: "asset",
          children: [
            {
              id: "App/Assets.xcassets/AppIcon.appiconset",
              name: "AppIcon.appiconset",
              kind: "folder",
              fileKind: "asset",
              children: [
                {
                  id: "App/Assets.xcassets/AppIcon.appiconset/Contents.json",
                  name: "Contents.json",
                  kind: "file",
                  fileKind: "json",
                  content: APP_ICON_SET,
                },
              ],
            },
            {
              id: "App/Assets.xcassets/AccentColor.colorset",
              name: "AccentColor.colorset",
              kind: "folder",
              fileKind: "asset",
              children: [
                {
                  id: "App/Assets.xcassets/AccentColor.colorset/Contents.json",
                  name: "Contents.json",
                  kind: "file",
                  fileKind: "json",
                  content: ACCENT_COLOR_SET,
                },
              ],
            },
            {
              id: "App/Assets.xcassets/Contents.json",
              name: "Contents.json",
              kind: "file",
              fileKind: "json",
              content: ASSET_INFO,
            },
          ],
        },
      ],
    },
    {
      id: "Supporting Files",
      name: "Supporting Files",
      kind: "folder",
      children: [
        {
          id: "Supporting Files/Info.plist",
          name: "Info.plist",
          kind: "file",
          fileKind: "plist",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>SwiftCanvas</string>
    <key>UILaunchScreen</key>
    <dict/>
</dict>
</plist>
`,
        },
        {
          id: "Supporting Files/Preview Content",
          name: "Preview Content",
          kind: "folder",
          children: [
            {
              id: "Supporting Files/Preview Content/Preview Assets.xcassets",
              name: "Preview Assets.xcassets",
              kind: "folder",
              fileKind: "asset",
              children: [
                {
                  id: "Supporting Files/Preview Content/Preview Assets.xcassets/Contents.json",
                  name: "Contents.json",
                  kind: "file",
                  fileKind: "json",
                  content: ASSET_INFO,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "Products",
      name: "Products",
      kind: "folder",
      children: [
        {
          id: "Products/SwiftCanvas.app",
          name: "SwiftCanvas.app",
          kind: "file",
          fileKind: "generic",
          content: "// SwiftCanvas.app\n// Build product generated by Xcode.\n",
        },
      ],
    },
  ],
};

export const DEFAULT_EXPANDED_FOLDERS: readonly string[] = [
  "root",
  "App",
  "App/Views",
];

export const DEFAULT_SELECTED_FILE = "App/Views/ContentView.swift";

export function countProjectFiles(node: ProjectNode): number {
  if (node.kind === "file") return 1;
  return (node.children ?? []).reduce((total, child) => total + countProjectFiles(child), 0);
}
