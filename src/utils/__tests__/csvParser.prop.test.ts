import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseCsv, detectDelimiter, resolveDelimiter, type DelimiterName } from "../csvParser";
import { NUM_RUNS } from "~/test/pbt";

// Generate cell values that don't contain special CSV characters
const arbSafeCell = fc.stringMatching(/^[a-zA-Z0-9 ]{0,20}$/);

describe("CSV Parser — property-based tests", () => {
  describe("parseCsv roundtrip", () => {
    it("parse(serialize(data)) === data for safe cells", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.array(arbSafeCell, { minLength: 1, maxLength: 5 }),
            { minLength: 1, maxLength: 10 },
          ),
          fc.constantFrom(",", "\t", ";", "|"),
          (rows, delimiter) => {
            // Serialize: join fields with delimiter, rows with newlines
            const csv = rows.map((row) => row.join(delimiter)).join("\n");
            const parsed = parseCsv(csv, delimiter);

            // Filter out empty rows (parseCsv trims empty lines)
            const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0) || row.join(delimiter).trim().length > 0);

            expect(parsed.length).toBe(nonEmptyRows.length);
            for (let i = 0; i < parsed.length; i++) {
              expect(parsed[i]).toEqual(nonEmptyRows[i]);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });
  });

  describe("uniform column count", () => {
    it("all rows have the same column count when input is uniform", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 2, max: 10 }),
          fc.constantFrom(",", "\t", ";"),
          (numCols, numRows, delimiter) => {
            const rows: string[][] = [];
            for (let r = 0; r < numRows; r++) {
              const row: string[] = [];
              for (let c = 0; c < numCols; c++) {
                row.push(`cell_${r}_${c}`);
              }
              rows.push(row);
            }
            const csv = rows.map((row) => row.join(delimiter)).join("\n");
            const parsed = parseCsv(csv, delimiter);

            expect(parsed.length).toBe(numRows);
            for (const row of parsed) {
              expect(row.length).toBe(numCols);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });

  describe("quoted fields preserve delimiters", () => {
    it("a quoted field containing the delimiter parses as a single field", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z]{1,10}$/),
          fc.stringMatching(/^[a-zA-Z]{1,10}$/),
          fc.constantFrom(",", ";", "|"),
          (before, after, delimiter) => {
            // A field containing the delimiter, properly quoted
            const fieldWithDelim = `${before}${delimiter}${after}`;
            const quoted = `"${fieldWithDelim}"`;
            const csv = `first${delimiter}${quoted}${delimiter}third`;
            const parsed = parseCsv(csv, delimiter);

            expect(parsed.length).toBe(1);
            expect(parsed[0]!.length).toBe(3);
            expect(parsed[0]![1]).toBe(fieldWithDelim);
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });

  describe("escaped quotes roundtrip", () => {
    it("doubled quotes inside quoted fields parse to single quotes", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z]{1,10}$/),
          fc.integer({ min: 1, max: 3 }),
          (text, quoteCount) => {
            // Field value contains quote characters
            const value = `${text}${'"'.repeat(quoteCount)}${text}`;
            // RFC 4180: quotes inside quoted fields are doubled
            const escaped = value.replace(/"/g, '""');
            const csv = `"${escaped}",other`;
            const parsed = parseCsv(csv, ",");

            expect(parsed.length).toBe(1);
            expect(parsed[0]![0]).toBe(value);
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });

  describe("detectDelimiter", () => {
    it("correctly identifies the delimiter for consistent multi-column CSV", () => {
      fc.assert(
        fc.property(
          fc.constantFrom<[string, DelimiterName]>(
            ["\t", "tab"],
            [",", "comma"],
            [";", "semicolon"],
            ["|", "pipe"],
          ),
          fc.integer({ min: 2, max: 5 }),
          fc.integer({ min: 2, max: 5 }),
          ([delimiter, expectedName], numCols, numRows) => {
            const rows: string[] = [];
            for (let r = 0; r < numRows; r++) {
              const cells: string[] = [];
              for (let c = 0; c < numCols; c++) {
                cells.push(`val${r}${c}`);
              }
              rows.push(cells.join(delimiter));
            }
            const csv = rows.join("\n");
            const detected = detectDelimiter(csv);
            expect(detected).toBe(expectedName);
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });

  describe("resolveDelimiter", () => {
    it("returns a non-empty string for all named delimiters", () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DelimiterName>("comma", "tab", "semicolon", "pipe", "custom"),
          fc.string({ minLength: 1, maxLength: 3 }),
          (name, custom) => {
            const result = resolveDelimiter(name, custom);
            expect(result.length).toBeGreaterThan(0);
          },
        ),
      );
    });

    it("custom delimiter uses the custom value", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 3 }), (custom) => {
          expect(resolveDelimiter("custom", custom)).toBe(custom);
        }),
        { numRuns: NUM_RUNS ?? 50 },
      );
    });
  });

  describe("CRLF handling", () => {
    it("CRLF and LF produce the same result", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.array(arbSafeCell, { minLength: 1, maxLength: 3 }),
            { minLength: 2, maxLength: 5 },
          ),
          (rows) => {
            const lf = rows.map((r) => r.join(",")).join("\n");
            const crlf = rows.map((r) => r.join(",")).join("\r\n");
            const parsedLf = parseCsv(lf, ",");
            const parsedCrlf = parseCsv(crlf, ",");
            expect(parsedCrlf).toEqual(parsedLf);
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });
});
