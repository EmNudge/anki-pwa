import { describe, it, expect } from "vitest";
import {
  normalizeForComparison,
  stringSimilarity,
  findExactDuplicates,
  findFuzzyDuplicates,
  findDuplicates,
  buildNoteInfos,
  type NoteInfo,
} from "../duplicates";

function makeNote(overrides: Partial<NoteInfo> & { guid: string }): NoteInfo {
  return {
    fieldNames: ["Front", "Back"],
    values: { Front: "test", Back: "answer" },
    tags: [],
    deckName: "Default",
    ...overrides,
  };
}

describe("normalizeForComparison", () => {
  it("strips HTML tags", () => {
    expect(normalizeForComparison("<b>hello</b> <i>world</i>")).toBe("hello world");
  });

  it("strips sound tags", () => {
    const result = normalizeForComparison("[sound:audio.mp3] hello");
    expect(result).toBe("hello");
    // Must strip the whole tag, not just the brackets
    expect(result).not.toContain("sound");
    expect(result).not.toContain("audio.mp3");
  });

  it("normalizes whitespace", () => {
    expect(normalizeForComparison("  hello   world  ")).toBe("hello world");
  });

  it("decodes HTML entities", () => {
    expect(normalizeForComparison("&amp; &lt; &gt; &quot; &#39;")).toBe("& < > \" '");
  });

  it("lowercases text", () => {
    expect(normalizeForComparison("Hello World")).toBe("hello world");
  });

  it("handles null input", () => {
    expect(normalizeForComparison(null)).toBe("");
  });

  it("handles complex HTML", () => {
    expect(
      normalizeForComparison('<div class="front"><p>What is a <b>cat</b>?</p></div>'),
    ).toBe("what is a cat?");
  });

  it("handles nbsp entities", () => {
    expect(normalizeForComparison("hello&nbsp;world")).toBe("hello world");
  });
});

describe("stringSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(stringSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(stringSimilarity("ab", "cd")).toBe(0);
  });

  it("returns value between 0 and 1 for similar strings", () => {
    const sim = stringSimilarity("hello", "hallo");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("returns higher similarity for more similar strings", () => {
    const sim1 = stringSimilarity("cat", "cats");
    const sim2 = stringSimilarity("cat", "dog");
    expect(sim1).toBeGreaterThan(sim2);
    // "cat" vs "cats" should be high but not perfect
    expect(sim1).not.toBe(1);
    // "cat" vs "dog" should be very low (no shared bigrams)
    expect(sim2).toBeLessThan(0.5);
  });

  it("handles short strings", () => {
    expect(stringSimilarity("a", "b")).toBe(0);
    expect(stringSimilarity("a", "a")).toBe(1);
  });
});

describe("findExactDuplicates", () => {
  it("finds exact duplicates by first field", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "hello", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "hello", Back: "b" } }),
      makeNote({ guid: "3", values: { Front: "world", Back: "c" } }),
    ];

    const groups = findExactDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });

    expect(groups).toHaveLength(1);
    expect(groups).not.toHaveLength(2); // "world" is unique, must not form its own group
    expect(groups[0]!.notes).toHaveLength(2);
    expect(groups[0]!.notes).not.toHaveLength(3); // "world" must not be in the group
    expect(groups[0]!.similarity).toBe(1.0);
    // The group should contain guid 1 and 2, not guid 3
    const guids = groups[0]!.notes.map((n) => n.guid);
    expect(guids).toContain("1");
    expect(guids).toContain("2");
    expect(guids).not.toContain("3");
  });

  it("finds duplicates ignoring HTML", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "<b>hello</b>", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "Hello", Back: "b" } }),
    ];

    const groups = findExactDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.notes).toHaveLength(2);
  });

  it("respects deck scope", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "hello", Back: "a" }, deckName: "Deck A" }),
      makeNote({ guid: "2", values: { Front: "hello", Back: "b" }, deckName: "Deck B" }),
      makeNote({ guid: "3", values: { Front: "hello", Back: "c" }, deckName: "Deck A" }),
    ];

    const groups = findExactDuplicates(notes, {
      fieldIndex: 0,
      scope: "deck",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });

    expect(groups).toHaveLength(1);
    // Must not group cross-deck (all 3 have same Front but are in different decks)
    expect(groups[0]!.notes).toHaveLength(2);
    expect(groups[0]!.notes).not.toHaveLength(3);
    expect(groups[0]!.notes.every((n) => n.deckName === "Deck A")).toBe(true);
    // Deck B note must not leak into the group
    expect(groups[0]!.notes.some((n) => n.deckName === "Deck B")).toBe(false);
  });

  it("compares by specified field index", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "different1", Back: "same" } }),
      makeNote({ guid: "2", values: { Front: "different2", Back: "same" } }),
    ];

    const groupsByFront = findExactDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });
    expect(groupsByFront).toHaveLength(0);

    const groupsByBack = findExactDuplicates(notes, {
      fieldIndex: 1,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });
    expect(groupsByBack).toHaveLength(1);
  });

  it("skips notes with empty comparison field", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "", Back: "b" } }),
    ];

    const groups = findExactDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });
    expect(groups).toHaveLength(0);
  });

  it("returns no groups when no duplicates exist", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "hello", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "world", Back: "b" } }),
      makeNote({ guid: "3", values: { Front: "foo", Back: "c" } }),
    ];

    const groups = findExactDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });
    expect(groups).toHaveLength(0);
  });
});

describe("findFuzzyDuplicates", () => {
  it("finds fuzzy matches above threshold", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "the quick brown fox", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "the quick brown fax", Back: "b" } }),
      makeNote({ guid: "3", values: { Front: "something completely different here", Back: "c" } }),
    ];

    const groups = findFuzzyDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: true,
      fuzzyThreshold: 0.7,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.notes).toHaveLength(2);
    // "fox" vs "fax" is fuzzy, not exact
    expect(groups[0]!.similarity).toBeLessThan(1.0);
    expect(groups[0]!.similarity).toBeGreaterThan(0.7);
    // "something completely different here" must not be in the group
    const guids = groups[0]!.notes.map((n) => n.guid);
    expect(guids).not.toContain("3");
    expect(guids).toContain("1");
    expect(guids).toContain("2");
  });
});

describe("findDuplicates", () => {
  it("returns only exact when fuzzy is false", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "hello", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "hello", Back: "b" } }),
      makeNote({ guid: "3", values: { Front: "hallo", Back: "c" } }),
    ];

    const groups = findDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    });

    expect(groups).toHaveLength(1);
    // Must not include "hallo" as fuzzy match when fuzzy is disabled
    expect(groups[0]!.notes).toHaveLength(2);
    expect(groups[0]!.notes).not.toHaveLength(3);
    const guids = groups[0]!.notes.map((n) => n.guid);
    expect(guids).not.toContain("3"); // "hallo" is only a fuzzy match
  });

  it("returns exact + fuzzy when fuzzy is true", () => {
    const notes: NoteInfo[] = [
      makeNote({ guid: "1", values: { Front: "hello world test", Back: "a" } }),
      makeNote({ guid: "2", values: { Front: "hello world test", Back: "b" } }),
      makeNote({ guid: "3", values: { Front: "hello world tess", Back: "c" } }),
    ];

    const groups = findDuplicates(notes, {
      fieldIndex: 0,
      scope: "all",
      fuzzy: true,
      fuzzyThreshold: 0.8,
    });

    // guid 1 and 2 are exact duplicates (similarity 1.0)
    // guid 3 ("hello world tess") is fuzzy-similar but excluded from fuzzy since 1,2 are in exact group
    // So there should be exactly 1 group: the exact match group
    expect(groups.length).toBe(1);
    expect(groups[0]!.similarity).toBe(1.0);
    expect(groups[0]!.notes).toHaveLength(2);
  });
});

describe("buildNoteInfos", () => {
  it("deduplicates by guid", () => {
    const cards = [
      {
        guid: "abc",
        values: { Front: "hello", Back: "world" },
        tags: ["tag1"],
        deckName: "Default",
        templates: [{ qfmt: "{{Front}}", afmt: "{{Back}}", name: "Card 1" }],
      },
      {
        guid: "abc",
        values: { Front: "hello", Back: "world" },
        tags: ["tag1"],
        deckName: "Default",
        templates: [{ qfmt: "{{Front}}", afmt: "{{Back}}", name: "Card 2" }],
      },
      {
        guid: "def",
        values: { Front: "foo", Back: "bar" },
        tags: [],
        deckName: "Default",
        templates: [{ qfmt: "{{Front}}", afmt: "{{Back}}", name: "Card 1" }],
      },
    ];

    const infos = buildNoteInfos(cards);
    expect(infos).toHaveLength(2);
    expect(infos.map((i) => i.guid).sort()).toEqual(["abc", "def"]);
  });
});
