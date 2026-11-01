import React from "react";
import type { InterpretResult } from "../utils/swift";
import { SWIFT_LANGUAGE_ID } from "../utils/swiftLanguage";
import type { ProjectState } from "../hooks/useProject";
import { findNode } from "../utils/projectTreeOps";
import CodeEditor, { type MonacoEditorHandle } from "./CodeEditor";
import Toolbar, { type ToolbarItem } from "./Toolbar";
import ISSimulator, { DEVICES, type DeviceSpec } from "./iOSSimulator";
import ProjectNavigator from "./ProjectNavigator";
import InspectorPanel from "./InspectorPanel";
import XcodeToolbar from "./XcodeToolbar";
import QuickOpen from "./QuickOpen";
import { DeviceIcon, FileTypeIcon, GenericFileIcon } from "./FileIcons";

export interface IDEWorkspaceProps {
  project: ProjectState;
  preview: InterpretResult;
}

type DebugTab = "console" | "issues";

/**
 * Xcode workspace shell: window toolbar, project navigator, source editor,
 * live SwiftUI canvas, inspector and a toggleable debug area.
 */
const IDEWorkspace: React.FC<IDEWorkspaceProps> = ({ project, preview }) => {
  const editorRef = React.useRef<MonacoEditorHandle>(null);
  const activeFile = project.activeFile;
  const activeContent = activeFile?.content ?? "";
  const documentName = activeFile?.name ?? "No File Selected";
  const parentPath = project.activeFilePath.slice(0, -1);
  const breadcrumb =
    parentPath.length > 0
      ? parentPath.map((node) => node.name).join(" / ")
      : project.tree.name;
  const editorLanguage =
    activeFile?.fileKind === "swift" ? SWIFT_LANGUAGE_ID : "plaintext";

  const [isRunning, setIsRunning] = React.useState(true);
  const [runToken, setRunToken] = React.useState(0);
  const [showNavigator, setShowNavigator] = React.useState(true);
  const [showCanvas, setShowCanvas] = React.useState(true);
  const [showInspector, setShowInspector] = React.useState(false);
  const [showDebug, setShowDebug] = React.useState(false);
  const [debugTab, setDebugTab] = React.useState<DebugTab>("console");
  const [logs, setLogs] = React.useState<string[]>([]);
  const [device, setDevice] = React.useState<DeviceSpec>(DEVICES[0]);
  const [quickOpen, setQuickOpen] = React.useState(false);

  // Canvas-time warnings (unsupported views, execution limits) live on the
  // runtime; subscribing keeps the Issues tab and toolbar badge current.
  React.useSyncExternalStore(preview.runtime.subscribe, preview.runtime.getSnapshot);
  const diagnostics = preview.runtime.diagnostics;

  const selectedNode = React.useMemo(
    () => findNode(project.tree, project.selectedNodeId) ?? activeFile,
    [project.tree, project.selectedNodeId, activeFile],
  );

  const handleLog = React.useCallback((message: string) => {
    setLogs((previous) => [...previous.slice(-199), message]);
  }, []);

  const handleRun = React.useCallback(() => {
    preview.runtime.restart();
    setIsRunning(true);
    setRunToken((token) => token + 1);
    setLogs([`Run SwiftCanvas on ${device.name}…`]);
  }, [preview, device.name]);

  const handleStop = React.useCallback(() => {
    setIsRunning(false);
    setLogs((previous) => [...previous, "Preview stopped."]);
  }, []);

  // Xcode-style keyboard shortcuts.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        handleRun();
        return;
      }
      if (event.key === ".") {
        event.preventDefault();
        handleStop();
        return;
      }
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "k" && event.shiftKey) {
        event.preventDefault();
        setShowDebug(true);
        setDebugTab("console");
        setLogs([]);
        return;
      }
      if (event.key.toLowerCase() === "l" && event.shiftKey) {
        event.preventDefault();
        setShowDebug((value) => !value);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRun, handleStop]);

  const toolbarItems: ToolbarItem[] = [
    {
      id: "preview",
      label: "Refresh Preview",
      icon: <>&#8635;</>,
      onClick: () => {
        window.dispatchEvent(new CustomEvent("swiftcanvas:refresh"));
      },
    },
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-xcode-window">
      <XcodeToolbar
        isRunning={isRunning}
        onRun={handleRun}
        onStop={handleStop}
        showNavigator={showNavigator}
        showCanvas={showCanvas}
        showInspector={showInspector}
        showDebug={showDebug}
        onToggleNavigator={() => setShowNavigator((value) => !value)}
        onToggleCanvas={() => setShowCanvas((value) => !value)}
        onToggleInspector={() => setShowInspector((value) => !value)}
        onToggleDebug={() => setShowDebug((value) => !value)}
        diagnosticCount={diagnostics.length}
        devices={DEVICES}
        device={device}
        onSelectDevice={setDevice}
        onQuickOpen={() => setQuickOpen(true)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showNavigator && <ProjectNavigator project={project} />}

        {/* ── Source editor ── */}
        <section className="flex h-full min-h-0 min-w-0 flex-1 basis-0 flex-col bg-xcode-editor">
          <div className="flex h-[35px] shrink-0 items-end border-b border-black/50 bg-xcode-chromeAlt px-2">
            <div className="flex h-[29px] max-w-full items-center gap-1.5 rounded-t-[6px] border border-b-0 border-xcode-divider bg-xcode-editor px-3 text-[11px] text-xcode-text shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              {activeFile ? (
                <FileTypeIcon kind={activeFile.fileKind} name={activeFile.name} />
              ) : (
                <GenericFileIcon />
              )}
              <span className="truncate whitespace-nowrap">{documentName}</span>
            </div>
          </div>

          <Toolbar title={documentName} path={breadcrumb} items={toolbarItems} />

          <div className="relative min-h-0 flex-1 overflow-hidden select-text">
            {activeFile ? (
              <CodeEditor
                key={activeFile.id}
                ref={editorRef}
                value={activeContent}
                language={editorLanguage}
                onMount={(instance) => {
                  instance.onDidChangeModelContent(() => {
                    project.updateFileContent(activeFile.id, instance.getValue());
                  });
                }}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-xcode-editor text-xcode-textDim">
                <GenericFileIcon />
                <p className="text-[12px] font-medium text-xcode-text">No File Selected</p>
                <p className="text-[11px]">
                  Choose a file in the Project Navigator to start editing.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── Preview canvas ── */}
        {showCanvas && (
          <section className="flex h-full min-h-0 min-w-0 flex-1 basis-0 flex-col border-l border-black/50">
            <div className="flex h-[34px] shrink-0 items-center justify-between gap-2 border-b border-black/40 bg-xcode-chrome px-3">
              <div className="flex min-w-0 items-center gap-2 text-[11px]">
                <span className="text-xcode-textDim">
                  <DeviceIcon />
                </span>
                <span className="text-xcode-textDim">Canvas</span>
                <span className="text-xcode-textDim/40">/</span>
                <span className="truncate font-medium text-xcode-text">{device.name}</span>
              </div>

              <div className="flex shrink-0 items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-xcode-textDim">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    !isRunning
                      ? "bg-[#8e8e93]"
                      : diagnostics.length === 0
                        ? "bg-[#30d158]"
                        : "bg-[#ffd60a]"
                  }`}
                />
                <span>
                  {!isRunning ? "Stopped" : diagnostics.length === 0 ? "Live" : "Issues"}
                </span>
              </div>
            </div>

            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 34%, #f5f5f7 0%, #dedee2 46%, #c9cace 100%)",
              }}
            >
              <ISSimulator
                runtime={preview.runtime}
                device={device}
                isRunning={isRunning}
                runToken={runToken}
                onLog={handleLog}
              />
            </div>
          </section>
        )}

        {showInspector && (
          <InspectorPanel
            node={selectedNode}
            tree={project.tree}
            preview={preview}
            onClose={() => setShowInspector(false)}
          />
        )}
      </div>

      {/* ── Debug area ── */}
      {showDebug && (
        <div className="flex h-[132px] shrink-0 flex-col border-t border-black/50 bg-[#1b1b1f]">
          <div className="flex h-[26px] shrink-0 items-center justify-between border-b border-black/40 bg-xcode-chromeAlt px-2">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setDebugTab("console")}
                className={`flex h-[22px] items-center gap-1.5 rounded-[4px] px-2 text-[10px] transition-colors ${
                  debugTab === "console"
                    ? "bg-white/10 text-xcode-text"
                    : "text-xcode-textDim hover:text-xcode-text"
                }`}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3">
                  <rect x="1.5" y="2" width="13" height="12" rx="1.7" fill="none" stroke="currentColor" strokeWidth="1" />
                  <path d="m4.2 5.6 2.2 2-2.2 2M8 9.6h3.4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Console
              </button>
              <button
                type="button"
                onClick={() => setDebugTab("issues")}
                className={`flex h-[22px] items-center gap-1.5 rounded-[4px] px-2 text-[10px] transition-colors ${
                  debugTab === "issues"
                    ? "bg-white/10 text-xcode-text"
                    : "text-xcode-textDim hover:text-xcode-text"
                }`}
              >
                Issues
                <span className="rounded-full bg-black/30 px-1 text-[9px] tabular-nums">
                  {diagnostics.length}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <span className="mr-2 text-[9.5px] text-xcode-textDim/70">
                {logs.length} log line(s)
              </span>
              <button
                type="button"
                title="Clear Console (Ctrl+Shift+K)"
                aria-label="Clear Console"
                onClick={() => setLogs([])}
                className="flex h-5 w-5 items-center justify-center rounded text-xcode-textDim hover:bg-white/10 hover:text-xcode-text"
              >
                <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3 w-3">
                  <path d="M3 4.2h8M5.2 4.2V3h3.6v1.2M4.2 4.2l.5 7.3h4.6l.5-7.3" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                title="Hide Debug Area"
                aria-label="Hide Debug Area"
                onClick={() => setShowDebug(false)}
                className="flex h-5 w-5 items-center justify-center rounded text-xcode-textDim hover:bg-white/10 hover:text-xcode-text"
              >
                <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2.5 w-2.5">
                  <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="xcode-scroll min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-[10.5px] leading-5 text-xcode-text/85">
            {debugTab === "console" ? (
              logs.length > 0 ? (
                logs.map((line, index) => (
                  <div key={`${index}-${line}`} className="whitespace-pre-wrap">
                    <span className="mr-2 select-none text-xcode-textDim/50">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-xcode-textDim/60">
                  No console output. Use print() or a Button action in the preview.
                </div>
              )
            ) : diagnostics.length > 0 ? (
              diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.start}-${index}`} className="flex items-baseline gap-2">
                  <span
                    className={
                      diagnostic.severity === "error"
                        ? "text-red-400"
                        : diagnostic.severity === "warn"
                          ? "text-amber-400"
                          : "text-sky-400"
                    }
                  >
                    {diagnostic.severity.toUpperCase()}
                  </span>
                  <span className="text-xcode-textDim">line {diagnostic.line}</span>
                  <span className="truncate">{diagnostic.message}</span>
                </div>
              ))
            ) : (
              <div className="text-xcode-textDim/60">No issues in the current file.</div>
            )}
          </div>
        </div>
      )}

      {quickOpen && (
        <QuickOpen
          tree={project.tree}
          onSelect={(node) => project.selectNode(node)}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
};

export default IDEWorkspace;
