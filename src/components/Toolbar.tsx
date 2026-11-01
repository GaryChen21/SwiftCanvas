import React from "react";

export interface ToolbarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export interface ToolbarProps {
  title?: string;
  path?: string;
  items?: ToolbarItem[];
  children?: React.ReactNode;
}

/**
 * The thin Xcode source-editor toolbar that sits above the Monaco surface.
 */
const Toolbar: React.FC<ToolbarProps> = ({ title = "Untitled.swift", path, items = [], children }) => {
  return (
    <div
      role="toolbar"
      className="flex h-[34px] shrink-0 items-center justify-between gap-2 border-b border-xcode-border bg-xcode-chrome px-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        {path && (
          <span className="truncate text-[11px] text-xcode-textDim/70" title={path}>
            {path}
          </span>
        )}
        <span className="truncate text-[12px] font-medium text-xcode-text">{title}</span>
      </div>

      <div className="flex items-center gap-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            title={item.label}
            aria-label={item.label}
            className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-xcode-textDim transition-colors hover:bg-white/10 hover:text-xcode-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent"
          >
            {item.icon}
          </button>
        ))}
        {children}
      </div>
    </div>
  );
};

export default Toolbar;
