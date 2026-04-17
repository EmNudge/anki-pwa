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
  const nodeEntries = tags.flatMap((tag) => {
    const parts = tag.split("::");
    return parts.map((_, i) => {
      const fullPath = parts.slice(0, i + 1).join("::");
      return [fullPath, parts[i]!] as const;
    });
  });

  const nodeMap = new Map<string, TagTreeNode>(
    nodeEntries.map(([fullPath, name]) => [
      fullPath,
      { name, fullPath, noteCount: 0, children: [], expanded: false },
    ]),
  );

  // Wire up parent-child relationships
  nodeMap.forEach((node) => {
    const lastSep = node.fullPath.lastIndexOf("::");
    if (lastSep === -1) return;
    const parent = nodeMap.get(node.fullPath.slice(0, lastSep));
    if (parent) parent.children.push(node);
  });

  // Compute note counts (exact matches only - parent click will filter with prefix)
  tagNoteCounts.forEach((count, tag) => {
    const node = nodeMap.get(tag);
    if (node) node.noteCount = count;
  });

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

