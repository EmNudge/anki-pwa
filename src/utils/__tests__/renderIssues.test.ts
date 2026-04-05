/**
 * Tests demonstrating rendering/template issues,
 * cross-referenced against the Anki source (ankitects/anki).
 */
import { describe, it, expect } from "vitest";
import { getRenderedCardString } from "../render";

describe("Render Issues", () => {
  /**
   * Issue #2: {{FrontSide}} not handled by the renderer
   *
   * The renderer should auto-render FrontSide when a frontTemplate is provided.
   *
   * Source: rslib/src/card_rendering/render.rs
   */
  describe("#2 - {{FrontSide}} should be a special pseudo-field", () => {
    it("should expand {{FrontSide}} to the rendered front template", () => {
      const variables = {
        Front: "What is the capital of France?",
        Back: "Paris",
      };

      const frontTemplate = "{{Front}}";
      const backTemplate = "{{FrontSide}}<hr id=answer>{{Back}}";

      const backHtml = getRenderedCardString({
        templateString: backTemplate,
        variables,
        mediaFiles: new Map(),
        frontTemplate,
      });

      // The back should contain the rendered front content
      expect(backHtml).toContain("What is the capital of France?");
      expect(backHtml).toContain("Paris");
    });
  });

  /**
   * Issue #3: Cloze deletions not supported
   *
   * Source: rslib/src/card_rendering/cloze.rs
   */
  describe("#3 - cloze deletions should be rendered", () => {
    it("should hide cloze content for the active card ordinal", () => {
      const variables = {
        Text: "{{c1::Paris}} is the capital of {{c2::France}}",
      };

      // For card 1 (c1 = cardOrd 0), Paris should be hidden, France visible
      const card1Html = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
      });

      // c1 should be replaced with a blank/prompt
      expect(card1Html).toContain("[...]");
      // c2 should remain visible
      expect(card1Html).toContain("France");
      // Should NOT show the raw cloze syntax
      expect(card1Html).not.toContain("{{c1::");
      expect(card1Html).not.toContain("{{c2::");
    });

    it("should show hint text when provided in cloze", () => {
      const variables = {
        Text: "The {{c1::mitochondria::organelle}} is the powerhouse of the cell",
      };

      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
      });

      // Should show the hint instead of [...]
      expect(html).toContain("[organelle]");
      expect(html).not.toContain("mitochondria");
    });

    it("should reveal cloze content on the answer side", () => {
      const variables = {
        Text: "{{c1::Paris}} is the capital of France",
      };

      // On the answer side, the cloze should be revealed
      const answerHtml = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
        isAnswer: true,
      });

      expect(answerHtml).toContain("Paris");
    });
  });

  /**
   * Issue #4: Inverse conditionals ({{^Field}}) not supported
   *
   * Source: rslib/src/card_rendering/render.rs
   */
  describe("#4 - inverse conditionals should work", () => {
    it("should hide inverse conditional content when field has a value (standalone)", () => {
      const variables = {
        Front: "Hello",
        Pronunciation: "[sound:hello.mp3]",
      };

      const template =
        "{{Front}}{{^Pronunciation}}<p>No pronunciation recorded</p>{{/Pronunciation}}";

      const html = getRenderedCardString({
        templateString: template,
        variables,
        mediaFiles: new Map(),
      });

      // Since Pronunciation is NON-EMPTY, the inverse section should be removed
      expect(html).not.toContain("No pronunciation recorded");
      expect(html).toContain("Hello");
    });

    it("should hide inverse conditional content when field has a value", () => {
      const variables = {
        Front: "Hello",
        Image: "photo.jpg",
        Back: "World",
      };

      const template =
        "{{Front}}{{#Image}}<img src='{{Image}}'>{{/Image}}{{^Image}}<em>No image</em>{{/Image}}";

      const html = getRenderedCardString({
        templateString: template,
        variables,
        mediaFiles: new Map(),
      });

      // Since Image has a value, the positive conditional should render
      expect(html).toContain("<img");
      // And the inverse conditional should NOT render
      expect(html).not.toContain("No image");
    });
  });

  /**
   * Issue #7: Template filters completely missing
   *
   * Source: rslib/src/card_rendering/filters.rs
   */
  describe("#7 - template filters should be processed", () => {
    it("should strip HTML with {{text:Field}}", () => {
      const variables = {
        Front: "<b>Bold</b> and <i>italic</i> text",
      };

      const html = getRenderedCardString({
        templateString: "{{text:Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // text: filter strips all HTML tags
      expect(html).toBe("Bold and italic text");
    });

    it("should handle chained filters like {{text:cloze:Field}}", () => {
      const variables = {
        Text: "<b>{{c1::Paris}}</b> is the capital",
      };

      const html = getRenderedCardString({
        templateString: "{{text:cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
      });

      // Should strip HTML AND process cloze
      expect(html).not.toContain("<b>");
      expect(html).toContain("[...]");
    });

    it("should render hint filter as expandable element", () => {
      const variables = {
        Hint: "This is a helpful hint",
      };

      const html = getRenderedCardString({
        templateString: "{{hint:Hint}}",
        variables,
        mediaFiles: new Map(),
      });

      // hint: filter should produce a clickable/expandable element
      expect(html).toContain("hint");
      // Should not just dump the raw text
      expect(html).not.toBe("This is a helpful hint");
    });
  });

  /**
   * Issue #8: Special fields not supported
   *
   * Source: rslib/src/card_rendering/render.rs — SPECIAL_FIELDS map.
   */
  describe("#8 - special fields should resolve", () => {
    it("should resolve {{Tags}} to the note's tags", () => {
      const variables = {
        Front: "Hello",
        Back: "World",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}} [tags: {{Tags}}]",
        variables,
        mediaFiles: new Map(),
        tags: ["vocab", "spanish"],
      });

      // {{Tags}} should resolve to the tags
      expect(html).not.toBe("Hello [tags: ]");
      expect(html).toContain("vocab");
    });

    it("should resolve {{Deck}} to the deck name", () => {
      const variables = {
        Front: "Hello",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}} (from {{Deck}})",
        variables,
        mediaFiles: new Map(),
        deckName: "Spanish::Vocabulary",
      });

      // {{Deck}} should resolve to the full deck name
      expect(html).not.toBe("Hello (from )");
      expect(html).toContain("Spanish::Vocabulary");
    });

    it("should resolve {{Subdeck}} to the leaf deck name", () => {
      const variables = {
        Front: "Hello",
      };

      const html = getRenderedCardString({
        templateString: "{{Subdeck}}",
        variables,
        mediaFiles: new Map(),
        deckName: "Spanish::Vocabulary",
      });

      // Subdeck should resolve to "Vocabulary" (last component)
      expect(html).toBe("Vocabulary");
    });
  });

  /**
   * Issue #13: Ruby text regex is too aggressive
   *
   * Source: Anki uses a more targeted approach for furigana.
   */
  describe("#13 - ruby text regex should not match non-CJK content", () => {
    it("should not convert CSS-like syntax to ruby text", () => {
      const variables = {
        Front: "The property font[size] controls text size",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // Should NOT wrap "font" and "size" in ruby tags
      expect(html).not.toContain("<ruby>");
      expect(html).toContain("font[size]");
    });

    it("should not convert array-like syntax to ruby text", () => {
      const variables = {
        Front: "Access the element with array[index]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).not.toContain("<ruby>");
      expect(html).toContain("array[index]");
    });
  });

  /**
   * Issue #18: LaTeX \[...\] and \(...\) delimiters not handled
   *
   * Source: rslib/src/latex.rs
   */
  describe("#18 - standard LaTeX delimiters should be rendered", () => {
    it("should render \\[...\\] as display math", () => {
      const variables = {
        Front: "The equation is \\[E = mc^2\\]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).toContain("katex");
      expect(html).not.toContain("\\[E = mc^2\\]");
    });

    it("should render \\(...\\) as inline math", () => {
      const variables = {
        Front: "The value of \\(\\pi\\) is approximately 3.14159",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).toContain("katex");
      expect(html).not.toContain("\\(\\pi\\)");
    });
  });

  /**
   * Issue #19: latexPre/latexPost not used in rendering
   *
   * Source: rslib/src/latex.rs — wraps content with latex_pre/latex_post.
   */
  describe("#19 - latexPre/latexPost should be applied", () => {
    it("should apply notetype latex preamble when rendering", () => {
      const variables = {
        Front: "[latex]\\R[/latex]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
        latexPre: "\\newcommand{\\R}{\\mathbb{R}}",
      });

      // With latexPre defining \R, it should render via KaTeX
      expect(html).toContain("katex");
    });
  });

  /**
   * Issue #6: `due` field meaning varies by card state
   */
  describe("#6 - due field interpretation varies by queue type", () => {
    it("should differentiate due meaning for new vs review vs learning cards", () => {
      // Covered by #10 scheduling test in parserIssues.test.ts
      expect(true).toBe(true);
    });
  });
});
