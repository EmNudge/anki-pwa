import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter, resolveDelimiter } from "../csvParser";

describe("resolveDelimiter", () => {
  it("resolves named delimiters", () => {
    expect(resolveDelimiter("comma", "")).toBe(",");
    expect(resolveDelimiter("tab", "")).toBe("\t");
    expect(resolveDelimiter("semicolon", "")).toBe(";");
    expect(resolveDelimiter("pipe", "")).toBe("|");
  });

  it("returns custom delimiter when name is 'custom'", () => {
    expect(resolveDelimiter("custom", "~")).toBe("~");
  });

  it("falls back to comma when custom is empty", () => {
    expect(resolveDelimiter("custom", "")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    const result = parseCsv("a,b,c\n1,2,3", ",");
    expect(result).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields", () => {
    const result = parseCsv('"hello, world",b,c', ",");
    expect(result).toEqual([["hello, world", "b", "c"]]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const result = parseCsv('"say ""hi""",b', ",");
    expect(result).toEqual([['say "hi"', "b"]]);
  });

  it("handles newlines inside quoted fields", () => {
    const result = parseCsv('"line1\nline2",b\nc,d', ",");
    expect(result).toEqual([
      ["line1\nline2", "b"],
      ["c", "d"],
    ]);
  });

  it("handles tab delimiter", () => {
    const result = parseCsv("a\tb\tc", "\t");
    expect(result).toEqual([["a", "b", "c"]]);
  });

  it("normalizes CRLF line endings", () => {
    const result = parseCsv("a,b\r\nc,d", ",");
    expect(result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("skips empty lines", () => {
    const result = parseCsv("a,b\n\nc,d\n", ",");
    expect(result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles single-column data", () => {
    const result = parseCsv("a\nb\nc", ",");
    expect(result).toEqual([["a"], ["b"], ["c"]]);
  });

  it("handles empty quoted field", () => {
    const result = parseCsv('"",b,c', ",");
    expect(result).toEqual([["", "b", "c"]]);
  });
});

describe("detectDelimiter", () => {
  it("detects tab delimiter", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("tab");
  });

  it("detects comma delimiter", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe("comma");
  });

  it("detects semicolon delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe("semicolon");
  });

  it("detects pipe delimiter", () => {
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("pipe");
  });

  it("returns comma for empty input", () => {
    expect(detectDelimiter("")).toBe("comma");
  });

  it("prefers consistent delimiters over higher field counts", () => {
    // Tab gives consistent 3 fields, comma only appears in some lines
    const input = "a\tb\tc\n1\t2\t3\n4\t5\t6";
    expect(detectDelimiter(input)).toBe("tab");
  });
});
