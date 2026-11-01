import React from "react";
import { countProjectFiles, type ProjectNode } from "../data/projectTree";
import type { CreateNodeKind, ProjectState } from "../hooks/useProject";
import { findNode } from "../utils/projectTreeOps";
import {
  ChevronIcon,
  EllipsisIcon,
  FileTypeIcon,
  NewFileIcon,
  NewFolderIcon,
  PencilIcon,
  SidebarProjectIcon,
  TrashIcon,
} from "./FileIcons";

const INDENT_PX = 13;
const MENU_WIDTH = 196;
const MENU_HEIGHT = 186;

interface RenameInputProps {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

const RenameInput: React.FC<RenameInputProps> = ({
  initialName,
  onCommit,
  onCancel,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const finishedRef = React.useRef(false);
  const [value, setValue] = React.useState(initialName);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialName) onCommit(trimmed);
    else onCancel();
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      aria-label="Rename item"
      spellCheck={false}
      className="h-[18px] min-w-0 flex-1 rounded-[3px] border border-[#5AA1F0] bg-[#1B1B1F] px-1 text-[12px] leading-none text-white outline-none"
    />
  );
};

interface TreeRowProps {
  node: ProjectNode;
  depth: number;
  project: ProjectState;
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onOpenMenu: (nodeId: string, x: number, y: number) => void;
}

const TreeRow: React.FC<TreeRowProps> = ({
  node,
  depth,
  project,
  renamingId,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onOpenMenu,
}) => {
  const isFolder = node.kind === "folder";
  const hasChildren = isFolder && (node.children?.length ?? 0) > 0;
  const isOpen = isFolder && project.expandedIds.has(node.id);
  const isSelected = project.selectedNodeId === node.id;
  const isRenaming = renamingId === node.id;

  const activate = () => {
    project.selectNode(node);
    if (isFolder && hasChildren) project.toggleFolder(node.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      onStartRename(node.id);
      return;
    }
    if (!isFolder || !hasChildren) return;
    if (event.key === "ArrowRight" && !isOpen) {
      event.preventDefault();
      project.toggleFolder(node.id);
    } else if (event.key === "ArrowLeft" && isOpen) {
      event.preventDefault();
      project.toggleFolder(node.id);
    }
  };

  const openRowMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenMenu(node.id, rect.right - MENU_WIDTH, rect.bottom + 4);
  };

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={isFolder ? isOpen : undefined}
        tabIndex={0}
        title={node.name}
        onClick={activate}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          project.selectNode(node);
          onOpenMenu(node.id, event.clientX, event.clientY);
        }}
        className={`group mx-1.5 flex h-[24px] cursor-default items-center gap-1.5 rounded-[5px] pl-0 pr-1 text-[12px] leading-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[#5AA1F0] ${
          isSelected
            ? "bg-[#2E5F9E] text-white"
            : "text-xcode-text/90 hover:bg-white/[0.06]"
        } ${depth === 0 ? "font-medium" : ""}`}
        style={{ paddingLeft: 6 + depth * INDENT_PX }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={hasChildren ? (isOpen ? "Collapse folder" : "Expand folder") : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) project.toggleFolder(node.id);
          }}
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm ${
            hasChildren ? "hover:bg-white/10" : "cursor-default"
          }`}
        >
          {hasChildren && <ChevronIcon open={isOpen} />}
        </button>

        <FileTypeIcon kind={node.fileKind} isFolder={isFolder} name={node.name} />

        {isRenaming ? (
          <RenameInput
            initialName={node.name}
            onCommit={(name) => onCommitRename(node.id, name)}
            onCancel={onCancelRename}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}

        {!isRenaming && (
          <button
            type="button"
            tabIndex={-1}
            data-project-menu-trigger
            title={`Actions for ${node.name}`}
            aria-label={`Actions for ${node.name}`}
            onClick={openRowMenu}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xcode-textDim transition-opacity hover:bg-white/10 hover:text-white ${
              isSelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <EllipsisIcon />
          </button>
        )}
      </div>

      {isFolder && isOpen && hasChildren && (
        <div role="group">
          {node.children?.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              project={project}
              renamingId={renamingId}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </div>
      )}
    </>
  );
};

const ToolbarButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    className="flex h-5 w-5 items-center justify-center rounded text-xcode-textDim transition-colors hover:bg-white/10 hover:text-xcode-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent"
  >
    {children}
  </button>
);

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, onClick, disabled = false }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-xcode-text transition-colors hover:bg-xcode-accent hover:text-white disabled:pointer-events-none disabled:opacity-35"
  >
    <span className="text-xcode-textDim">{icon}</span>
    {label}
  </button>
);

/**
 * Xcode-style project navigator backed by useProject(): recursive folders,
 * inline rename and a right-click / ellipsis action menu for CRUD.
 */
const ProjectNavigator: React.FC<{ project: ProjectState }> = ({ project }) => {
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);

  const openMenu = React.useCallback((nodeId: string, x: number, y: number) => {
    const maxX = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
    const maxY = Math.max(8, window.innerHeight - MENU_HEIGHT - 8);
    setMenu({
      nodeId,
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    });
  }, []);

  const closeMenu = React.useCallback(() => setMenu(null), []);

  React.useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-project-menu]")) return;
      setMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const handleViewportChange = () => setMenu(null);

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [menu]);

  const startRename = (id: string) => {
    setMenu(null);
    setRenamingId(id);
  };

  const commitRename = (id: string, name: string) => {
    project.renameNode(id, name);
    setRenamingId(null);
  };

  const createNode = (kind: CreateNodeKind, referenceId: string) => {
    const created = project.addNode(kind, referenceId);
    setMenu(null);
    if (created) setRenamingId(created.id);
  };

  const menuNode = menu ? findNode(project.tree, menu.nodeId) : null;
  const menuIsRoot = menuNode?.id === project.tree.id;

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-black/50 bg-[#242428] 2xl:w-[276px]">
      <div className="flex h-[36px] shrink-0 items-center justify-between gap-2 border-b border-black/30 px-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-xcode-textDim">
          <SidebarProjectIcon />
          <span className="truncate">Project Navigator</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ToolbarButton
            label="New File"
            onClick={() => createNode("file", project.selectedNodeId || project.tree.id)}
          >
            <NewFileIcon />
          </ToolbarButton>
          <ToolbarButton
            label="New Folder"
            onClick={() => createNode("folder", project.selectedNodeId || project.tree.id)}
          >
            <NewFolderIcon />
          </ToolbarButton>
          <ToolbarButton label="Collapse All" onClick={project.collapseAll}>
            <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
              <path
                d="M2.2 7.6 6 3.8l3.8 3.8M2.2 10.2 6 6.4l3.8 3.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </ToolbarButton>
        </div>
      </div>

      <div
        role="tree"
        aria-label="Project files"
        className="xcode-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1.5"
      >
        <TreeRow
          node={project.tree}
          depth={0}
          project={project}
          renamingId={renamingId}
          onStartRename={startRename}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onOpenMenu={openMenu}
        />
      </div>

      <div className="flex h-[26px] shrink-0 items-center justify-between border-t border-black/30 px-3 text-[10px] text-xcode-textDim/70">
        <span>{countProjectFiles(project.tree)} files</span>
        <span>Swift</span>
      </div>

      {menu && menuNode && (
        <div
          role="menu"
          data-project-menu
          aria-label={`Actions for ${menuNode.name}`}
          onContextMenu={(event) => event.preventDefault()}
          className="fixed z-[60] w-[196px] rounded-md border border-white/10 bg-[#2C2C30]/95 p-1 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur"
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="truncate px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.06em] text-xcode-textDim/80">
            {menuNode.name}
          </div>

          <MenuItem
            icon={<NewFileIcon />}
            label="New File"
            onClick={() => createNode("file", menuNode.id)}
          />
          <MenuItem
            icon={<NewFolderIcon />}
            label="New Folder"
            onClick={() => createNode("folder", menuNode.id)}
          />
          <div className="my-1 h-px bg-white/10" />
          <MenuItem
            icon={<PencilIcon />}
            label="Rename"
            onClick={() => startRename(menuNode.id)}
          />
          <MenuItem
            icon={<TrashIcon />}
            label="Delete"
            disabled={menuIsRoot}
            onClick={() => {
              project.deleteNode(menuNode.id);
              if (renamingId === menuNode.id) setRenamingId(null);
              closeMenu();
            }}
          />
        </div>
      )}
    </aside>
  );
};

export default ProjectNavigator;
