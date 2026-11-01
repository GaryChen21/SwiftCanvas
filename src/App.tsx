import React from "react";
import { interpret } from "./utils/swift";
import { useProject } from "./hooks/useProject";
import IDEWorkspace from "./components/IDEWorkspace";
import TitleBar from "./components/TitleBar";

const App: React.FC = () => {
  const project = useProject();
  const activeContent = project.activeFile?.content ?? "";
  const [previewSource, setPreviewSource] = React.useState(activeContent);
  const lastActiveFileRef = React.useRef(project.activeFileId);

  // Switching files refreshes the canvas immediately; typing is debounced.
  React.useEffect(() => {
    const switchedFile = lastActiveFileRef.current !== project.activeFileId;
    lastActiveFileRef.current = project.activeFileId;

    if (switchedFile) {
      setPreviewSource(activeContent);
      return;
    }

    const timer = window.setTimeout(() => setPreviewSource(activeContent), 300);
    return () => window.clearTimeout(timer);
  }, [activeContent, project.activeFileId]);

  const preview = React.useMemo(() => interpret(previewSource), [previewSource]);

  // The runtime owns its diagnostics; subscribe so canvas-time warnings update
  // the title bar and the issues strip.
  React.useSyncExternalStore(preview.runtime.subscribe, preview.runtime.getSnapshot);
  const diagnostics = preview.runtime.diagnostics;
  const clean = diagnostics.length === 0;

  // Manual refresh from the editor toolbar.
  const activeContentRef = React.useRef(activeContent);
  activeContentRef.current = activeContent;

  React.useEffect(() => {
    const handler = () => setPreviewSource(activeContentRef.current);
    window.addEventListener("swiftcanvas:refresh", handler);
    return () => window.removeEventListener("swiftcanvas:refresh", handler);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-xcode-window font-ui text-xcode-text">
      {/* Title bar — frameless window drag region */}
      <TitleBar
        documentName={project.activeFile?.name ?? "No File"}
        right={
          <>
            <span
              className={`h-2 w-2 rounded-full ${
                clean ? "bg-green-500" : "bg-amber-400"
              }`}
              title={clean ? "Preview compiles cleanly" : `${diagnostics.length} diagnostic(s)`}
            />
            <span className="tabular-nums">
              {diagnostics.length} diagnostic
            </span>
          </>
        }
      />

      {/* Three-pane workspace */}
      <main className="min-h-0 flex-1">
        <IDEWorkspace project={project} preview={preview} />
      </main>

      {/* Diagnostics strip */}
      {diagnostics.length > 0 && (
        <footer className="max-h-32 shrink-0 overflow-y-auto border-t border-xcode-border bg-xcode-panel">
          {diagnostics.map((d, i) => (
            <div
              key={`${d.start}-${i}`}
              className="flex items-baseline gap-2 border-b border-xcode-divider px-3 py-1 text-[11px] last:border-0"
            >
              <span
                className={
                  d.severity === "error"
                    ? "text-red-400"
                    : d.severity === "warn"
                      ? "text-amber-400"
                      : "text-sky-400"
                }
              >
                {d.severity.toUpperCase()}
              </span>
              <span className="text-xcode-textDim">@{d.start}</span>
              <span className="truncate text-xcode-text">{d.message}</span>
            </div>
          ))}
        </footer>
      )}
    </div>
  );
};

export default App;
