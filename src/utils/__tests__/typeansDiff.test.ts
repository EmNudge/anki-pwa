import { describe, it, expect } from "vitest";
import { computeDiff, renderDiffHtml, stripHtmlForComparison } from "../typeansDiff";

describe("computeDiff", () => {
  it("returns all correct when strings match exactly", () => {
    const diff = computeDiff("hello", "hello");
    expect(diff).toEqual([
      { type: "correct", value: "h" },
      { type: "correct", value: "e" },
      { type: "correct", value: "l" },
      { type: "correct", value: "l" },
      { type: "correct", value: "o" },
    ]);
  });

  it("detects missing characters", () => {
    const diff = computeDiff("hllo", "hello");
    // 'h' correct, 'e' missing, 'l' correct, 'l' correct, 'o' correct
    expect(diff.filter((d) => d.type === "correct")).toHaveLength(4);
    expect(diff.filter((d) => d.type === "missing")).toHaveLength(1);
  });

  it("detects extra characters", () => {
    const diff = computeDiff("helloo", "hello");
    expect(diff.filter((d) => d.type === "correct")).toHaveLength(5);
    expect(diff.filter((d) => d.type === "extra")).toHaveLength(1);
  });

  it("detects incorrect characters", () => {
    const diff = computeDiff("hxllo", "hello");
    // 'h' correct, 'x' vs 'e' incorrect, 'l' correct, 'l' correct, 'o' correct
    const incorrectEntries = diff.filter((d) => d.type === "incorrect");
    expect(incorrectEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty typed string", () => {
    const diff = computeDiff("", "hello");
    expect(diff).toEqual([{ type: "missing", value: "hello" }]);
  });

  it("handles empty expected string", () => {
    const diff = computeDiff("hello", "");
    expect(diff).toEqual([{ type: "extra", value: "hello" }]);
  });

  it("handles completely different strings", () => {
    const diff = computeDiff("abc", "xyz");
    // No common subsequence
    const hasIncorrect = diff.some((d) => d.type === "incorrect");
    const hasExtra = diff.some((d) => d.type === "extra");
    const hasMissing = diff.some((d) => d.type === "missing");
    expect(hasIncorrect || (hasExtra && hasMissing)).toBe(true);
  });
});

describe("renderDiffHtml", () => {
  it("shows green text for exact match", () => {
    const html = renderDiffHtml("hello", "hello");
    expect(html).toContain('class="typeans-correct"');
    expect(html).toContain("hello");
  });

  it("shows diff with correct and incorrect spans for partial match", () => {
    const html = renderDiffHtml("hxllo", "hello");
    expect(html).toContain('class="typeGood"');
    expect(html).toContain('class="typeBad"');
  });

  it("shows missing spans for incomplete typed answer", () => {
    const html = renderDiffHtml("hel", "hello");
    expect(html).toContain('class="typeGood"');
    expect(html).toContain('class="typeMissed"');
  });

  it("escapes HTML in output", () => {
    const html = renderDiffHtml("<script>", "<script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("wraps output in typeans div", () => {
    const html = renderDiffHtml("test", "test");
    expect(html).toContain('id="typeans"');
  });
});

describe("stripHtmlForComparison", () => {
  it("strips HTML tags", () => {
    expect(stripHtmlForComparison("<b>hello</b>")).toBe("hello");
  });

  it("converts <br> to newline", () => {
    expect(stripHtmlForComparison("hello<br>world")).toBe("hello\nworld");
  });

  it("decodes HTML entities", () => {
    expect(stripHtmlForComparison("&amp; &lt; &gt;")).toBe("& < >");
  });

  it("trims whitespace", () => {
    expect(stripHtmlForComparison("  hello  ")).toBe("hello");
  });

  it("handles complex HTML", () => {
    expect(stripHtmlForComparison('<div class="foo"><span>answer</span></div>')).toBe("answer");
  });
});
