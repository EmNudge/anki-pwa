import { describe, it, expect } from "vitest";
import { buildTagTree } from "../tagTree";

describe("buildTagTree", () => {
  it("returns empty array for no tags", () => {
    expect(buildTagTree([], new Map())).toEqual([]);
  });

  it("builds flat list for tags without hierarchy", () => {
    const tree = buildTagTree(["math", "science"], new Map());
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.name).sort()).toEqual(["math", "science"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("builds nested tree from hierarchical tags", () => {
    const tree = buildTagTree(["lang::french", "lang::spanish"], new Map());
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("lang");
    expect(tree[0]!.fullPath).toBe("lang");
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children.map((c) => c.name).sort()).toEqual(["french", "spanish"]);
  });

  it("creates intermediate parent nodes", () => {
    const tree = buildTagTree(["a::b::c"], new Map());
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("a");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.name).toBe("b");
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.name).toBe("c");
  });

  it("assigns note counts from the count map", () => {
    const counts = new Map([
      ["lang", 5],
      ["lang::french", 3],
    ]);
    const tree = buildTagTree(["lang", "lang::french"], counts);
    expect(tree[0]!.noteCount).toBe(5);
    expect(tree[0]!.children[0]!.noteCount).toBe(3);
  });

  it("defaults noteCount to 0 for tags not in the count map", () => {
    const tree = buildTagTree(["misc"], new Map());
    expect(tree[0]!.noteCount).toBe(0);
  });

  it("sorts root nodes alphabetically", () => {
    const tree = buildTagTree(["zebra", "apple", "mango"], new Map());
    expect(tree.map((n) => n.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("initializes expanded to false", () => {
    const tree = buildTagTree(["tag1"], new Map());
    expect(tree[0]!.expanded).toBe(false);
  });

  it("deduplicates parent nodes from multiple children", () => {
    const tree = buildTagTree(["a::x", "a::y", "a::z"], new Map());
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(3);
  });
});
