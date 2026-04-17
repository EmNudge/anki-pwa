import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  normalizeForComparison,
  stringSimilarity,
  findExactDuplicates,
  type NoteInfo,
  type DuplicateSearchOptions,
} from "../duplicates";
import { NUM_RUNS } from "~/test/pbt";

describe("Duplicate detection — property-based tests", () => {
  describe("stringSimilarity", () => {
    it("is symmetric: sim(a,b) === sim(b,a)", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), fc.string({ maxLength: 100 }), (a, b) => {
          expect(stringSimilarity(a, b)).toBeCloseTo(stringSimilarity(b, a), 10);
        }),
        { numRuns: NUM_RUNS ?? 500 },
      );
    });

    it("identity: sim(a,a) === 1 for strings with length >= 2", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 2, maxLength: 100 }), (a) => {
          expect(stringSimilarity(a, a)).toBe(1);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("returns 1 for identical single-char strings", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 1 }), (a) => {
          expect(stringSimilarity(a, a)).toBe(1);
        }),
      );
    });

    it("returns 0 when one string has length < 2 and strings differ", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 2, maxLength: 50 }),
          (b) => {
            // Single char 'x' vs longer string — should be 0 unless b === "x"
            const a = "x";
            if (a !== b) {
              expect(stringSimilarity(a, b)).toBe(0);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("range: result is always in [0, 1]", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), fc.string({ maxLength: 100 }), (a, b) => {
          const sim = stringSimilarity(a, b);
          expect(sim).toBeGreaterThanOrEqual(0);
          expect(sim).toBeLessThanOrEqual(1);
        }),
        { numRuns: NUM_RUNS ?? 500 },
      );
    });

    it("completely different strings have low similarity", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 20 }),
          fc.integer({ min: 5, max: 20 }),
          (lenA, lenB) => {
            const a = "a".repeat(lenA);
            const b = "z".repeat(lenB);
            expect(stringSimilarity(a, b)).toBe(0);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe("normalizeForComparison", () => {
    it("idempotence: normalize(normalize(s)) === normalize(s)", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 200 }), (s) => {
          const once = normalizeForComparison(s);
          const twice = normalizeForComparison(once);
          expect(twice).toBe(once);
        }),
        { numRuns: NUM_RUNS ?? 500 },
      );
    });

    it("strips HTML tags", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,30}$/),
          fc.constantFrom("b", "i", "span", "div", "p"),
          (text, tag) => {
            const html = `<${tag}>${text}</${tag}>`;
            expect(normalizeForComparison(html)).toBe(normalizeForComparison(text));
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("strips sound tags", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          fc.stringMatching(/^[a-zA-Z0-9_]{1,20}\.(mp3|wav|ogg)$/),
          (text, filename) => {
            const withSound = `${text} [sound:${filename}]`;
            expect(normalizeForComparison(withSound)).toBe(normalizeForComparison(text));
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("collapses whitespace", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z]{1,10}$/),
          fc.stringMatching(/^[a-zA-Z]{1,10}$/),
          fc.stringMatching(/^[ \t\n]{1,5}$/),
          (a, b, ws) => {
            const spaced = `${a}${ws}${b}`;
            expect(normalizeForComparison(spaced)).toBe(`${a.toLowerCase()} ${b.toLowerCase()}`);
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("returns empty string for null/empty input", () => {
      expect(normalizeForComparison(null)).toBe("");
      expect(normalizeForComparison("")).toBe("");
    });

    it("is case-insensitive", () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-zA-Z]{1,30}$/), (s) => {
          expect(normalizeForComparison(s.toUpperCase())).toBe(
            normalizeForComparison(s.toLowerCase()),
          );
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("findExactDuplicates", () => {
    const defaultOptions: DuplicateSearchOptions = {
      fieldIndex: 0,
      scope: "all",
      fuzzy: false,
      fuzzyThreshold: 0.8,
    };

    function makeNote(guid: string, front: string, back = "back"): NoteInfo {
      return {
        guid,
        values: { Front: front, Back: back },
        tags: [],
        deckName: "Default",
        fieldNames: ["Front", "Back"],
      };
    }

    it("every group has size >= 2", () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z]{1,10}$/), { minLength: 1, maxLength: 20 }),
          (fronts) => {
            const notes = fronts.map((f, i) => makeNote(`guid-${i}`, f));
            const groups = findExactDuplicates(notes, defaultOptions);
            for (const group of groups) {
              expect(group.notes.length).toBeGreaterThanOrEqual(2);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("every group has similarity === 1.0", () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z]{1,10}$/), { minLength: 1, maxLength: 20 }),
          (fronts) => {
            const notes = fronts.map((f, i) => makeNote(`guid-${i}`, f));
            const groups = findExactDuplicates(notes, defaultOptions);
            for (const group of groups) {
              expect(group.similarity).toBe(1.0);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("groups are disjoint (no guid appears in multiple groups)", () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z]{1,10}$/), { minLength: 1, maxLength: 30 }),
          (fronts) => {
            const notes = fronts.map((f, i) => makeNote(`guid-${i}`, f));
            const groups = findExactDuplicates(notes, defaultOptions);
            const seen = new Set<string>();
            for (const group of groups) {
              for (const note of group.notes) {
                expect(seen.has(note.guid)).toBe(false);
                seen.add(note.guid);
              }
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("duplicating a note always produces at least one group", () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-z]{1,20}$/), (front) => {
          const notes = [makeNote("guid-1", front), makeNote("guid-2", front)];
          const groups = findExactDuplicates(notes, defaultOptions);
          expect(groups.length).toBeGreaterThanOrEqual(1);
          expect(groups[0]!.notes.length).toBe(2);
        }),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("notes with distinct normalized fronts produce no groups", () => {
      // Use letters that won't collide after normalization
      const notes = [
        makeNote("guid-1", "alpha"),
        makeNote("guid-2", "bravo"),
        makeNote("guid-3", "charlie"),
      ];
      const groups = findExactDuplicates(notes, defaultOptions);
      expect(groups.length).toBe(0);
    });
  });
});
