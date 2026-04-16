import { describe, it, expect } from "vitest";
import { sanitizeHtmlForPreview } from "../sanitize";

describe("sanitizeHtmlForPreview", () => {
  it("removes script tags and their content", () => {
    expect(sanitizeHtmlForPreview('<p>ok</p><script>alert("xss")</script>')).toBe("<p>ok</p>");
  });

  it("removes style tags and their content", () => {
    expect(sanitizeHtmlForPreview("<style>.card { color: red; }</style><p>text</p>")).toBe(
      "<p>text</p>",
    );
  });

  it("removes event handler attributes", () => {
    expect(sanitizeHtmlForPreview('<div onclick="evil()">text</div>')).toBe("<div>text</div>");
  });

  it("removes onmouseover attributes", () => {
    expect(sanitizeHtmlForPreview('<span onmouseover="bad()">hi</span>')).toBe("<span>hi</span>");
  });

  it("removes audio-container divs", () => {
    const html = '<div class="audio-container"><audio src="x.mp3"></audio></div><p>text</p>';
    expect(sanitizeHtmlForPreview(html)).toBe("<p>text</p>");
  });

  it("preserves safe HTML", () => {
    const html = "<b>bold</b> <i>italic</i> <a href='#'>link</a>";
    expect(sanitizeHtmlForPreview(html)).toBe(html);
  });

  it("handles empty string", () => {
    expect(sanitizeHtmlForPreview("")).toBe("");
  });

  it("handles multiple event handlers on one element", () => {
    const html = '<div onclick="a()" onload="b()">text</div>';
    expect(sanitizeHtmlForPreview(html)).toBe("<div>text</div>");
  });
});
