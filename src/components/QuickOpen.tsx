import React from "react";
import type { ProjectNode } from "../data/projectTree";
import { flattenFiles, fuzzyMatch } from "../utils/projectTreeOps";
import { FileTypeIcon } from "./FileIcons";

export interface QuickOpenProps {
  tree: ProjectNode;
  onSelect: (node: ProjectNode) => void;
  onClose: () => void;
}

/**
 * Xcode's Open Quickly (⌘⇧O / ⌘P): fuzzy match across every file in the
 * project with arrow-key navigation and Enter to open.
 */
const QuickOpen: React.FC<QuickOpenProps> = ({ tree, onSelect, onClose }) => {
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const results = React.useMemo(() => {
    const files = flattenFiles(tree);
    return files
      .map((file) => ({
        file,
        score: fuzzyMatch(query, file.node.name) + fuzzyMatch(query, file.folder) * 0.35,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }, [tree, query]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const commit = (index: number) => {
    const entry = results[index];
    if (!entry) return;
    onSelect(entry.file.node);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-center bg-black/35 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="h-fit w-[520px] max-w-[92vw] overflow-hidden rounded-lg border border-white/12 bg-[#2C2C30]/97 shadow-[0_28px_70px_rgba(0,0,0,0.6)] backdrop-blur">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 text-xcode-textDim">
            <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="m10.4 10.4 3.4 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                commit(activeIndex);
              }
            }}
            placeholder="Open quickly — type a file name"
            spellCheck={false}
            className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-xcode-text outline-none placeholder:text-xcode-textDim/70"
          />
          <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-xcode-textDim">
            esc
          </span>
        </div>

        <div className="xcode-scroll max-h-[46vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11.5px] text-xcode-textDim">
              No matching files
            </div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.file.node.id}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                  index === activeIndex ? "bg-[#2E5F9E] text-white" : "text-xcode-text/90 hover:bg-white/[0.06]"
                }`}
              >
                <FileTypeIcon kind={entry.file.node.fileKind} name={entry.file.node.name} />
                <span className="truncate font-medium">{entry.file.node.name}</span>
                {entry.file.folder && (
                  <span
                    className={`truncate text-[10.5px] ${
                      index === activeIndex ? "text-white/70" : "text-xcode-textDim"
                    }`}
                  >
                    {entry.file.folder}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickOpen;
