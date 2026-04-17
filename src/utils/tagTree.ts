export type TagTreeNode = {
  name: string;
  fullPath: string;
  noteCount: number;
  children: TagTreeNode[];
  expanded: boolean;
};

/**
 * Build a hierarchical tree from flat tags using "::" as separator.
 * Each node tracks how many notes have that exact tag or a descendant.
 */
export function buildTagTree(tags: string[], tagNoteCounts: Map<string, number>): TagTreeNode[] {
  const nodeMap = new Map<string, TagTreeNode>();

  for (const tag of tags) {
    const parts = tag.split("::");
    for (const [i] of parts.entries()) {
      const fullPath = parts.slice(0, i + 1).join("::");
      if (nodeMap.has(fullPath)) continue;
      nodeMap.set(fullPath, {
        name: parts[i]!,
        fullPath,
        noteCount: 0,
        children: [],
        expanded: false,
      });
    }
  }

  // Wire up parent-child relationships
  for (const node of nodeMap.values()) {
    const lastSep = node.fullPath.lastIndexOf("::");
    if (lastSep === -1) continue;
    const parentPath = node.fullPath.slice(0, lastSep);
    const parent = nodeMap.get(parentPath);
    if (parent) {
      parent.children.push(node);
    }
  }

  // Compute note counts (exact matches only - parent click will filter with prefix)
  for (const [tag, count] of tagNoteCounts) {
    const node = nodeMap.get(tag);
    if (node) {
      node.noteCount = count;
    }
  }

  // Return only root nodes (no "::" in fullPath), sorted alphabetically
  return Array.from(nodeMap.values())
    .filter((node) => !node.fullPath.includes("::"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Check if a tag matches exactly or is a child of the given parent tag. */
export function tagMatchesOrIsChild(t: string, tag: string): boolean {
  return t === tag || t.startsWith(tag + "::");
}

/** Remove a tag and all its children from a tag list. */
export function removeTags(tags: string[], tag: string): string[] {
  return tags.filter((t) => !tagMatchesOrIsChild(t, tag));
}

