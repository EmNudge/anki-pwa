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

/**
 * Rename a tag across all notes. Returns updated tags arrays.
 * Handles hierarchical tags: renaming "foo" to "bar" also renames "foo::baz" to "bar::baz".
 */
export function renameTagInList(tags: string[], oldTag: string, newTag: string): string[] {
  return tags.map((tag) => {
    if (tag === oldTag) return newTag;
    if (tag.startsWith(oldTag + "::")) return newTag + tag.slice(oldTag.length);
    return tag;
  });
}

/**
 * Remove a tag from a tags list. Also removes child tags.
 */
export function removeTagFromList(tags: string[], tagToRemove: string): string[] {
  return tags.filter((tag) => tag !== tagToRemove && !tag.startsWith(tagToRemove + "::"));
}
