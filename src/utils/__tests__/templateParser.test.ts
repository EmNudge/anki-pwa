import { describe, it, expect } from "vitest";
import { renderTemplateString, parseClozeNodes, isClozeNode } from "../templateParser";

describe("renderTemplateString", () => {
  it("renders plain text without any template tags", () => {
    const result = renderTemplateString({
      templateString: "Hello world",
      renderField: () => "",
      shouldRenderConditional: () => false,
    });
    expect(result).toBe("Hello world");
  });

  it("substitutes field references", () => {
    const result = renderTemplateString({
      templateString: "{{Front}} - {{Back}}",
      renderField: (ref) => (ref === "Front" ? "Question" : "Answer"),
      shouldRenderConditional: () => false,
    });
    expect(result).toBe("Question - Answer");
  });

  it("renders positive conditional when field is non-empty", () => {
    const result = renderTemplateString({
      templateString: "{{#Extra}}Has extra: {{Extra}}{{/Extra}}",
      renderField: (ref) => (ref === "Extra" ? "details" : ""),
      shouldRenderConditional: (field) => field === "Extra",
    });
    expect(result).toBe("Has extra: details");
  });

  it("hides positive conditional when field is empty", () => {
    const result = renderTemplateString({
      templateString: "Before{{#Extra}} extra content{{/Extra}} After",
      renderField: () => "",
      shouldRenderConditional: () => false,
    });
    expect(result).toBe("Before After");
  });

  it("renders negative conditional when field is empty", () => {
    const result = renderTemplateString({
      templateString: "{{^Hint}}No hint{{/Hint}}",
      renderField: () => "",
      shouldRenderConditional: () => false,
    });
    expect(result).toBe("No hint");
  });

  it("hides negative conditional when field is non-empty", () => {
    const result = renderTemplateString({
      templateString: "{{^Hint}}No hint{{/Hint}}",
      renderField: () => "",
      shouldRenderConditional: () => true,
    });
    expect(result).toBe("");
  });

  it("handles nested conditionals", () => {
    const result = renderTemplateString({
      templateString: "{{#A}}outer{{#B}}inner{{/B}}{{/A}}",
      renderField: () => "",
      shouldRenderConditional: () => true,
    });
    expect(result).toBe("outerinner");
  });

  it("throws on mismatched closing tag", () => {
    expect(() =>
      renderTemplateString({
        templateString: "{{#A}}content{{/B}}",
        renderField: () => "",
        shouldRenderConditional: () => true,
      }),
    ).toThrow("{{/B}}");
  });

  it("renders open-ended conditional without closing tag gracefully", () => {
    // The parser does not throw on unclosed conditionals at end of string —
    // it treats remaining content as the conditional body
    const result = renderTemplateString({
      templateString: "{{#A}}content",
      renderField: () => "",
      shouldRenderConditional: () => true,
    });
    expect(result).toBe("content");
  });

  it("throws on orphan closing tag", () => {
    expect(() =>
      renderTemplateString({
        templateString: "content{{/A}}",
        renderField: () => "",
        shouldRenderConditional: () => false,
      }),
    ).toThrow();
  });

  it("handles unclosed double braces as text", () => {
    const result = renderTemplateString({
      templateString: "hello {{ no close",
      renderField: () => "",
      shouldRenderConditional: () => false,
    });
    expect(result).toBe("hello {{ no close");
  });
});

describe("parseClozeNodes", () => {
  it("parses simple cloze deletion", () => {
    const nodes = parseClozeNodes("{{c1::answer}}");
    expect(nodes).toEqual([{ type: "cloze", ordinal: 1, answer: "answer", hint: null }]);
  });

  it("parses cloze with hint", () => {
    const nodes = parseClozeNodes("{{c1::answer::hint text}}");
    expect(nodes).toEqual([{ type: "cloze", ordinal: 1, answer: "answer", hint: "hint text" }]);
  });

  it("parses text before and after cloze", () => {
    const nodes = parseClozeNodes("before {{c1::word}} after");
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual({ type: "text", value: "before " });
    expect(nodes[1]).toEqual({ type: "cloze", ordinal: 1, answer: "word", hint: null });
    expect(nodes[2]).toEqual({ type: "text", value: " after" });
  });

  it("parses multiple cloze deletions", () => {
    const nodes = parseClozeNodes("{{c1::one}} and {{c2::two}}");
    const clozes = nodes.filter(isClozeNode);
    expect(clozes).toHaveLength(2);
    expect(clozes[0]!.ordinal).toBe(1);
    expect(clozes[1]!.ordinal).toBe(2);
  });

  it("handles multi-digit ordinals", () => {
    const nodes = parseClozeNodes("{{c12::answer}}");
    const clozes = nodes.filter(isClozeNode);
    expect(clozes[0]!.ordinal).toBe(12);
  });

  it("treats invalid cloze syntax as text", () => {
    const nodes = parseClozeNodes("{{cX::answer}}");
    // No valid cloze nodes
    const clozes = nodes.filter(isClozeNode);
    expect(clozes).toHaveLength(0);
  });

  it("handles unclosed cloze as text", () => {
    const nodes = parseClozeNodes("{{c1::no close");
    const clozes = nodes.filter(isClozeNode);
    expect(clozes).toHaveLength(0);
  });

  it("returns single text node for plain text", () => {
    const nodes = parseClozeNodes("just plain text");
    expect(nodes).toEqual([{ type: "text", value: "just plain text" }]);
  });

  it("returns empty array for empty string", () => {
    const nodes = parseClozeNodes("");
    expect(nodes).toEqual([]);
  });
});

describe("isClozeNode", () => {
  it("returns true for cloze nodes", () => {
    expect(isClozeNode({ type: "cloze", ordinal: 1, answer: "x", hint: null })).toBe(true);
  });

  it("returns false for text nodes", () => {
    expect(isClozeNode({ type: "text", value: "x" })).toBe(false);
  });
});
