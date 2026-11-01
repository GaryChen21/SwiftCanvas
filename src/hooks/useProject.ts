import React from "react";
import {
  DEFAULT_EXPANDED_FOLDERS,
  DEFAULT_SELECTED_FILE,
  PROJECT_TREE,
  type ProjectNode,
} from "../data/projectTree";
import {
  collectFolderIds,
  findNode,
  findNodePath,
  findParentId,
  firstFileId,
  insertChild,
  removeNode,
  updateFileContent as patchFileContent,
  updateNode,
} from "../utils/projectTreeOps";

export type CreateNodeKind = "file" | "folder";

export interface CreatedNode {
  id: string;
  kind: CreateNodeKind;
}

export interface ProjectState {
  tree: ProjectNode;
  expandedIds: ReadonlySet<string>;
  selectedNodeId: string;
  activeFileId: string;
  activeFile: ProjectNode | null;
  activeFilePath: ProjectNode[];
  toggleFolder: (id: string) => void;
  collapseAll: () => void;
  selectNode: (node: ProjectNode) => void;
  addNode: (kind: CreateNodeKind, referenceId: string) => CreatedNode | null;
  renameNode: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
}

const NEW_SWIFT_FILE = `import SwiftUI

struct NewView: View {
    var body: some View {
        VStack {
            Text("New SwiftUI file")
                .font(.title)
                .foregroundColor(.blue)
                .padding()
        }
    }
}
`;

let nodeIdCounter = 0;

function createNodeId(parentId: string): string {
  nodeIdCounter += 1;
  return `${parentId}/node-${Date.now().toString(36)}-${nodeIdCounter}`;
}

function uniqueChildName(
  parent: ProjectNode,
  baseName: string,
  extension = "",
): string {
  const names = new Set(
    (parent.children ?? []).map((child) => child.name.toLowerCase()),
  );

  let name = `${baseName}${extension}`;
  let index = 2;
  while (names.has(name.toLowerCase())) {
    name = `${baseName} ${index}${extension}`;
    index += 1;
  }
  return name;
}

/**
 * Owns the mutable Xcode project: nested tree, folder expansion, selection and
 * the active editor file. All tree updates are immutable.
 */
export function useProject(): ProjectState {
  const [tree, setTree] = React.useState<ProjectNode>(PROJECT_TREE);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(
    () => new Set(DEFAULT_EXPANDED_FOLDERS),
  );
  const [selectedNodeId, setSelectedNodeId] = React.useState(DEFAULT_SELECTED_FILE);
  const [activeFileId, setActiveFileId] = React.useState(DEFAULT_SELECTED_FILE);

  const toggleFolder = React.useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = React.useCallback(() => {
    setExpandedIds(new Set(["root"]));
  }, []);

  const selectNode = React.useCallback((node: ProjectNode) => {
    setSelectedNodeId(node.id);
    if (node.kind === "file") setActiveFileId(node.id);
  }, []);

  const addNode = React.useCallback(
    (kind: CreateNodeKind, referenceId: string): CreatedNode | null => {
      const reference = findNode(tree, referenceId) ?? tree;
      const parentId =
        reference.kind === "folder"
          ? reference.id
          : (findParentId(tree, reference.id) ?? tree.id);
      const parent = findNode(tree, parentId);

      if (!parent || parent.kind !== "folder") return null;

      const id = createNodeId(parentId);
      const node: ProjectNode =
        kind === "folder"
          ? {
              id,
              name: uniqueChildName(parent, "New Folder"),
              kind: "folder",
              children: [],
            }
          : {
              id,
              name: uniqueChildName(parent, "Untitled", ".swift"),
              kind: "file",
              fileKind: "swift",
              content: NEW_SWIFT_FILE,
            };

      setTree((previous) => insertChild(previous, parentId, node));
      setExpandedIds((previous) => new Set(previous).add(parentId));
      setSelectedNodeId(node.id);
      if (node.kind === "file") setActiveFileId(node.id);

      return { id: node.id, kind };
    },
    [tree],
  );

  const renameNode = React.useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setTree((previous) =>
      updateNode(previous, id, (node) =>
        node.name === trimmed ? node : { ...node, name: trimmed },
      ),
    );
  }, []);

  const deleteNode = React.useCallback(
    (id: string) => {
      if (id === tree.id) return;

      const nextTree = removeNode(tree, id);
      if (nextTree === tree) return;

      setTree(nextTree);

      setExpandedIds((previous) => {
        const folderIds = collectFolderIds(nextTree);
        const pruned = new Set([...previous].filter((folderId) => folderIds.has(folderId)));
        return pruned.size === previous.size ? previous : pruned;
      });

      if (activeFileId) {
        if (!findNode(nextTree, activeFileId)) {
          const preferred = findNode(nextTree, DEFAULT_SELECTED_FILE);
          const fallback =
            preferred?.kind === "file" ? preferred.id : firstFileId(nextTree);
          setActiveFileId(fallback ?? "");
          setSelectedNodeId(fallback ?? nextTree.id);
          if (fallback) {
            const fallbackPath = findNodePath(nextTree, fallback);
            setExpandedIds((previous) => {
              const next = new Set(previous);
              for (const ancestor of fallbackPath.slice(0, -1)) next.add(ancestor.id);
              return next;
            });
          }
        } else if (!findNode(nextTree, selectedNodeId)) {
          setSelectedNodeId(activeFileId);
          const activePath = findNodePath(nextTree, activeFileId);
          setExpandedIds((previous) => {
            const next = new Set(previous);
            for (const ancestor of activePath.slice(0, -1)) next.add(ancestor.id);
            return next;
          });
        }
      } else if (!findNode(nextTree, selectedNodeId)) {
        setSelectedNodeId(nextTree.id);
      }
    },
    [tree, activeFileId, selectedNodeId],
  );

  const updateFileContent = React.useCallback((id: string, content: string) => {
    setTree((previous) => patchFileContent(previous, id, content));
  }, []);

  const activeFile = React.useMemo(() => {
    if (!activeFileId) return null;
    const node = findNode(tree, activeFileId);
    return node?.kind === "file" ? node : null;
  }, [tree, activeFileId]);

  const activeFilePath = React.useMemo(
    () => (activeFile ? findNodePath(tree, activeFile.id) : []),
    [tree, activeFile],
  );

  return {
    tree,
    expandedIds,
    selectedNodeId,
    activeFileId,
    activeFile,
    activeFilePath,
    toggleFolder,
    collapseAll,
    selectNode,
    addNode,
    renameNode,
    deleteNode,
    updateFileContent,
  };
}
