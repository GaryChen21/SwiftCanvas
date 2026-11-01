import React from "react";
import type { ProjectNode } from "../data/projectTree";
import type { InterpretResult } from "../utils/swift";
import { findNodePath } from "../utils/projectTreeOps";
import { FileTypeIcon } from "./FileIcons";

export interface InspectorPanelProps {
  node: ProjectNode | null;
  tree: ProjectNode;
  preview: InterpretResult;
  onClose: () => void;
}

type InspectorTab = "file" | "help" | "attributes";

const Field: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono = false,
}) => (
  <div className="grid grid-cols-[92px_1fr] items-center gap-2">
    <span className="text-[10px] text-xcode-textDim">{label}</span>
    <div
      className={`truncate rounded-[4px] border border-black/40 bg-black/20 px-1.5 py-1 text-[10.5px] text-xcode-text ${
        mono ? "font-mono" : ""
      }`}
      title={value}
    >
      {value}
    </div>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="border-b border-black/25 px-3 py-2.5">
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-xcode-textDim">
      {title}
    </h3>
    <div className="space-y-1.5">{children}</div>
  </section>
);

/** Right-hand Xcode inspector with functional File / Quick Help / Attributes tabs. */
const InspectorPanel: React.FC<InspectorPanelProps> = ({
  node,
  tree,
  preview,
  onClose,
}) => {
  const [tab, setTab] = React.useState<InspectorTab>("file");
  const [targetMember, setTargetMember] = React.useState(true);

  const path = node ? findNodePath(tree, node.id) : [];
  const pathText = path.map((entry) => entry.name).join(" / ") || "—";
  const isFolder = node?.kind === "folder";
  const lineCount = node?.content ? node.content.split("\n").length : 0;
  const byteCount = node?.content ? new Blob([node.content]).size : 0;

  const summary = React.useMemo(() => preview.runtime.summarize(), [preview]);
  const diagnosticCount = preview.runtime.diagnostics.length;

  return (
    <aside className="flex h-full w-[250px] shrink-0 flex-col border-l border-black/50 bg-[#242428]">
      <div className="flex h-[36px] shrink-0 items-center justify-between border-b border-black/30 px-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-xcode-textDim">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <rect x="1.5" y="2" width="13" height="12" rx="1.7" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M9.8 2v12" stroke="currentColor" strokeWidth="1" />
          </svg>
          Inspector
        </div>
        <button
          type="button"
          title="Close Inspector"
          aria-label="Close Inspector"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-xcode-textDim hover:bg-white/10 hover:text-xcode-text"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2.5 w-2.5">
            <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex h-[28px] shrink-0 items-end gap-0.5 border-b border-black/30 px-2">
        {(
          [
            ["file", "File"],
            ["help", "Quick Help"],
            ["attributes", "Attributes"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`h-[24px] rounded-t-[4px] px-2 text-[10px] transition-colors ${
              tab === id
                ? "bg-[#2E2E33] text-xcode-text"
                : "text-xcode-textDim hover:text-xcode-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="xcode-scroll min-h-0 flex-1 overflow-y-auto">
        {!node ? (
          <div className="p-4 text-[11px] text-xcode-textDim">
            No selection. Choose a file or folder in the Project Navigator.
          </div>
        ) : tab === "file" ? (
          <>
            <div className="flex items-center gap-2 border-b border-black/25 px-3 py-3">
              <FileTypeIcon kind={node.fileKind} isFolder={isFolder} name={node.name} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-xcode-text">{node.name}</div>
                <div className="text-[10px] text-xcode-textDim">
                  {isFolder ? "Folder" : node.fileKind ?? "File"}
                </div>
              </div>
            </div>

            <Section title="Identity and Type">
              <Field label="Name" value={node.name} />
              <Field label="Type" value={isFolder ? "Folder" : node.fileKind ?? "File"} />
              <Field label="Location" value={pathText} mono />
              {!isFolder && (
                <>
                  <Field label="Size" value={`${byteCount} bytes`} />
                  <Field label="Lines" value={String(lineCount)} />
                </>
              )}
              {isFolder && (
                <Field label="Children" value={String(node.children?.length ?? 0)} />
              )}
            </Section>

            <Section title="Target Membership">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-xcode-text">
                <input
                  type="checkbox"
                  checked={targetMember}
                  onChange={(event) => setTargetMember(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#0a84ff]"
                />
                SwiftCanvas
              </label>
            </Section>
          </>
        ) : tab === "help" ? (
          <div className="space-y-3 p-3 text-[11px] leading-relaxed text-xcode-textDim">
            <h4 className="text-[12px] font-medium text-xcode-text">{node.name}</h4>
            <p>
              {isFolder
                ? "A group in the SwiftCanvas project. Groups organize source files and do not appear in the built product."
                : node.fileKind === "swift"
                  ? "A Swift source file. Every View struct in it is parsed by the preview runtime; the canvas renders ContentView, the first View, or a #Preview block."
                  : "A project resource. It is copied into the app bundle and can be inspected from the editor."}
            </p>
            <div className="rounded border border-white/10 bg-black/20 p-2 font-mono text-[10px] text-xcode-text/80">
              {pathText}
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <Section title="SwiftUI Preview">
              <Field label="Entry view" value={summary.entryName} />
              <Field label="State" value={`${summary.stateCount} declaration(s)`} />
              <Field label="Functions" value={`${summary.functionCount}`} />
              <Field label="Navigation" value={summary.hasNavigation ? "NavigationStack" : "None"} />
              <Field label="Dismiss" value={summary.hasEnvironmentDismiss ? "@Environment" : "Not used"} />
              <Field label="Diagnostics" value={String(diagnosticCount)} />
            </Section>

            <Section title="Runtime">
              <Field label="Navigation" value="Push / pop stack" />
              <Field label="Bindings" value="$value two-way" />
              <Field label="Console" value="print() captured" />
            </Section>

            <Section title="Screens">
              <div className="flex flex-wrap gap-1">
                {summary.viewNames.length === 0 ? (
                  <span className="text-[10.5px] text-xcode-textDim">No View structs.</span>
                ) : (
                  summary.viewNames.map((name) => (
                    <span
                      key={name}
                      className="rounded-[3px] border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] text-xcode-textDim"
                    >
                      {name}
                    </span>
                  ))
                )}
              </div>
            </Section>
          </div>
        )}
      </div>
    </aside>
  );
};

export default InspectorPanel;
