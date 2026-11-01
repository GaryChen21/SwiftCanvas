import type { ProjectNode } from "../data/projectTree";

/** Depth-first lookup by id. Returns null when the node does not exist. */
export function findNode(tree: ProjectNode, id: string): ProjectNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children ?? []) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

/** Root-to-node path, including the node itself. Empty when not found. */
export function findNodePath(tree: ProjectNode, id: string): ProjectNode[] {
  if (tree.id === id) return [tree];
  for (const child of tree.children ?? []) {
    const path = findNodePath(child, id);
    if (path.length > 0) return [tree, ...path];
  }
  return [];
}

/** Id of the folder that directly contains `id`, or null for the root/missing. */
export function findParentId(tree: ProjectNode, id: string): string | null {
  for (const child of tree.children ?? []) {
    if (child.id === id) return tree.id;
    const nested = findParentId(child, id);
    if (nested) return nested;
  }
  return null;
}

/** Replace one node without mutating shared branches. */
export function updateNode(
  tree: ProjectNode,
  id: string,
  updater: (node: ProjectNode) => ProjectNode,
): ProjectNode {
  if (tree.id === id) return updater(tree);
  if (!tree.children?.length) return tree;

  let changed = false;
  const children = tree.children.map((child) => {
    const next = updateNode(child, id, updater);
    if (next !== child) changed = true;
    return next;
  });

  return changed ? { ...tree, children } : tree;
}

/** Insert a node into a folder's children. Files are returned unchanged. */
export function insertChild(
  tree: ProjectNode,
  parentId: string,
  child: ProjectNode,
): ProjectNode {
  return updateNode(tree, parentId, (node) =>
    node.kind === "folder"
      ? { ...node, children: [...(node.children ?? []), child] }
      : node,
  );
}

/** Remove a node (and its subtree). The root is never removed. */
export function removeNode(tree: ProjectNode, id: string): ProjectNode {
  if (tree.id === id || !tree.children?.length) return tree;

  let changed = false;
  const children: ProjectNode[] = [];

  for (const child of tree.children) {
    if (child.id === id) {
      changed = true;
      continue;
    }
    const next = removeNode(child, id);
    if (next !== child) changed = true;
    children.push(next);
  }

  return changed ? { ...tree, children } : tree;
}

export function updateFileContent(
  tree: ProjectNode,
  id: string,
  content: string,
): ProjectNode {
  return updateNode(tree, id, (node) =>
    node.kind === "file" ? { ...node, content } : node,
  );
}

/** First file in depth-first order, used as an editor fallback. */
export function firstFileId(tree: ProjectNode): string | null {
  if (tree.kind === "file") return tree.id;
  for (const child of tree.children ?? []) {
    const found = firstFileId(child);
    if (found) return found;
  }
  return null;
}

/** All folder ids in the tree, used to prune expansion state after delete. */
export function collectFolderIds(tree: ProjectNode): Set<string> {
  const ids = new Set<string>();
  const walk = (node: ProjectNode) => {
    if (node.kind !== "folder") return;
    ids.add(node.id);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return ids;
}

export interface FlatFile {
  node: ProjectNode;
  /** Folder path, e.g. "App/Views". Empty for the project root. */
  folder: string;
}

/** Every file in depth-first order with its folder path (for Quick Open). */
export function flattenFiles(
  tree: ProjectNode,
  folder = "",
): FlatFile[] {
  const out: FlatFile[] = [];
  for (const child of tree.children ?? []) {
    if (child.kind === "file") {
      out.push({ node: child, folder });
      continue;
    }
    const nested = folder ? `${folder}/${child.name}` : child.name;
    out.push(...flattenFiles(child, nested));
  }
  return out;
}

/** Case-insensitive subsequence match used by Quick Open. */
export function fuzzyMatch(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let index = 0;
  let streak = 0;

  for (const ch of q) {
    const found = t.indexOf(ch, index);
    if (found === -1) return 0;
    streak = found === index ? streak + 1 : 1;
    score += 10 + streak * 5 - Math.min(found - index, 8);
    index = found + 1;
  }

  // Prefer shorter names and matches at the start.
  return score + (t.startsWith(q) ? 40 : 0) - Math.floor(target.length / 4);
}
