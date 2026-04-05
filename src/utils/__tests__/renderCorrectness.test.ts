/**
 * Tests for rendering correctness issues identified by cross-referencing
 * with the Anki source (ankitects/anki via deepwiki).
 *
 * All tests in this file are EXPECTED TO FAIL against the current implementation.
 */
import { describe, it, expect } from "vitest";
import { getRenderedCardString } from "../render";

describe("Render Correctness Issues (expected to fail)", () => {
  /**
   * Issue #1: Cloze regex doesn't match multiline content
   *
   * The cloze regex uses `.+?` which doesn't match newlines by default.
   * Real Anki cards can have multiline cloze content (e.g. code blocks, lists).
   * Anki's renderer handles this with dotall matching.
   *
   * Source: rslib/src/card_rendering/cloze.rs
   */
  describe("#1 - cloze should match multiline content", () => {
    it("should handle cloze content spanning multiple lines", () => {
      const variables = {
        Text: "{{c1::Line one\nLine two\nLine three}} is the answer",
      };

      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
        isCloze: true,
      });

      // The entire multiline content should be replaced with [...]
      expect(html).toContain("[...]");
      expect(html).not.toContain("{{c1::");
    });

    it("should handle cloze content with div-wrapped lines", () => {
      // Anki wraps each line in <div> tags, producing actual newlines in the content
      const variables = {
        Text: "{{c1::First\nSecond\nThird}} is important",
      };

      const answerHtml = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
        isAnswer: true,
        isCloze: true,
      });

      // The entire multiline cloze should be revealed
      expect(answerHtml).toContain('<span class="cloze">');
      expect(answerHtml).toContain("First");
      expect(answerHtml).toContain("Third");
      expect(answerHtml).not.toContain("{{c1::");
    });

    it("should handle cloze with hint spanning multiple lines", () => {
      const variables = {
        Text: "{{c1::Multi\nline\nanswer::the hint}} is here",
      };

      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
        isCloze: true,
      });

      expect(html).toContain("[the hint]");
      expect(html).not.toContain("Multi");
    });
  });

  /**
   * Issue #2: [$]...[/$] (inline) and [$$]...[/$$] (display) both treated as display
   *
   * In Anki, [$]...[/$] is inline math and [$$]...[/$$] is display math.
   * The current regex treats both as display math.
   *
   * Source: rslib/src/latex.rs
   */
  describe("#2 - [$] should be inline math, [$$] should be display math", () => {
    it("should render [$]...[/$] as inline math (not display)", () => {
      const variables = {
        Front: "The value [$]x^2[/$] is quadratic",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // [$] is inline math — should NOT have display mode class
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-display");
    });

    it("should render [$] and [$$] with different display modes in the same card", () => {
      const variables = {
        Front: "Inline: [$]x^2[/$] and display: [$$]y^2[/$$]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // Both should be rendered, but only [$$] should be display mode
      expect(html).toContain("katex");
      // The inline [$] should NOT produce a display-mode block
      // Count display blocks — should be exactly 1 (from [$$] only)
      const displayCount = (html.match(/katex-display/g) || []).length;
      expect(displayCount).toBe(1);
    });
  });

  /**
   * Issue #3: Filter chain order — right-to-left (innermost first)
   *
   * Anki applies filters right-to-left: {{text:hint:Field}} applies hint first (closest
   * to field), then text. This is now implemented correctly.
   *
   * Source: rslib/src/card_rendering/filters.rs — filters applied from field outward
   */
  describe("#3 - filter chain order should be right-to-left", () => {
    it("should apply filters right-to-left per Anki source", () => {
      const variables = {
        Details: "<em>Important</em> context here",
      };

      // {{text:hint:Details}}
      // R-to-L (correct): hint wraps first → <a>Show Details</a><span>...<em>...</em>...</span>
      //                    then text strips ALL HTML → "Show DetailsImportant context here"
      const html = getRenderedCardString({
        templateString: "{{text:hint:Details}}",
        variables,
        mediaFiles: new Map(),
      });

      // With R-to-L: hint runs first, then text strips all HTML including hint wrapper
      expect(html).toContain("Important");
      expect(html).toContain("context here");
      expect(html).not.toContain("<em>"); // HTML stripped by text filter
      expect(html).not.toContain("<a"); // hint wrapper also stripped by text filter
    });
  });

  /**
   * Issue #5: {{type:Field}} incomplete — no answer comparison
   *
   * On the answer side, Anki's type: filter shows a diff between the typed answer
   * and the correct answer. The current implementation only shows an input box.
   *
   * Source: rslib/src/card_rendering/type_answer.rs
   */
  describe("#5 - type:Field should show answer comparison on answer side", () => {
    it("should show answer comparison on answer side, not just an input", () => {
      const variables = {
        Front: "What is the capital of France?",
        Back: "Paris",
      };

      const answerHtml = getRenderedCardString({
        templateString: "{{type:Back}}",
        variables,
        mediaFiles: new Map(),
        isAnswer: true,
      });

      // On the answer side, type: should show the correct answer, not just an input
      // Anki shows the correct answer (and a diff if the user typed something)
      expect(answerHtml).toContain("Paris");
      // Should NOT still be showing just an input box on the answer side
      expect(answerHtml).not.toContain('<input type="text"');
    });
  });

  /**
   * Issue #7: {{FrontSide}} should strip [sound:...] references
   *
   * When {{FrontSide}} is injected into the answer template, Anki strips
   * all [sound:...] references to prevent audio from playing twice.
   *
   * Source: rslib/src/card_rendering/render.rs — strip_av_tags
   */
  describe("#7 - FrontSide should strip audio references", () => {
    it("should strip [sound:...] when injecting FrontSide into answer", () => {
      const variables = {
        Front: "Hallo",
        Audio: "[sound:pronunciation.mp3]",
        Back: "Hello",
      };

      const frontTemplate = "{{Front}}\n{{Audio}}";
      const backTemplate = "{{FrontSide}}\n<hr id=answer>\n{{Back}}";

      const backHtml = getRenderedCardString({
        templateString: backTemplate,
        variables,
        mediaFiles: new Map(),
        frontTemplate,
        isAnswer: true,
      });

      // The FrontSide content should NOT contain audio elements
      // (audio from the front should be stripped to prevent double-play)
      expect(backHtml).toContain("Hallo");
      expect(backHtml).toContain("Hello");

      // Count audio elements — there should be zero from the FrontSide injection
      const audioCount = (backHtml.match(/<audio/g) || []).length;
      expect(audioCount).toBe(0);
    });
  });

  /**
   * Issue #8: Media filename matching is case-sensitive and not NFC-normalized
   *
   * Anki normalizes media filenames to NFC Unicode form and does case-insensitive
   * matching in some contexts. The current Map.get() is exact-match only.
   *
   * Source: rslib/src/media/files.rs — normalize_filename
   */
  describe("#8 - media filename matching should handle normalization", () => {
    it("should match media filenames case-insensitively", () => {
      const variables = {
        Front: '<img src="Photo.JPG">',
      };

      // The media map has the lowercase version
      const mediaFiles = new Map([["photo.jpg", "blob:http://localhost/abc"]]);

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles,
      });

      // Should match despite case difference
      expect(html).toContain("blob:http://localhost/abc");
    });

    it("should match NFC-normalized filenames", () => {
      // é as composed (NFC) vs decomposed (NFD: e + combining accent)
      const nfdName = "caf\u0065\u0301.mp3"; // NFD: e + combining acute
      const nfcName = "caf\u00E9.mp3"; // NFC: é as single character

      const variables = {
        Front: `[sound:${nfdName}]`,
      };

      const mediaFiles = new Map([[nfcName, "blob:http://localhost/def"]]);

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles,
      });

      expect(html).toContain("blob:http://localhost/def");
    });
  });

  /**
   * Issue #20: {{Card}} special field wrong for cloze notetypes
   *
   * For cloze notetypes, Anki sets {{Card}} to "Cloze N" where N is
   * the cloze number. The current code uses the template name.
   *
   * Source: rslib/src/card_rendering/render.rs
   */
  describe("#20 - Card field should show 'Cloze N' for cloze notetypes", () => {
    it("should show 'Cloze 1' for first cloze card", () => {
      const variables = {
        Text: "{{c1::Paris}} is the capital of {{c2::France}}",
      };

      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}<br>Card: {{Card}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
        cardName: "Cloze",
        isCloze: true,
      });

      // For cloze notetypes, Card should show "Cloze 1", not the template name
      expect(html).toContain("Cloze 1");
    });
  });

  /**
   * Issue #21: No {{Type}} special field
   *
   * Anki supports {{Type}} which returns the notetype name (e.g. "Basic", "Cloze").
   * This is not implemented.
   *
   * Source: rslib/src/card_rendering/render.rs — SPECIAL_FIELDS
   */
  describe("#21 - {{Type}} special field should return notetype name", () => {
    it("should resolve {{Type}} to the notetype name", () => {
      const variables = {
        Front: "Hello",
        Back: "World",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}} ({{Type}})",
        variables,
        mediaFiles: new Map(),
        noteTypeName: "Basic",
      });

      // {{Type}} should resolve to the notetype name
      expect(html).toBe("Hello (Basic)");
    });
  });

  /**
   * Issue #22: Conditional field checks don't strip HTML
   *
   * When evaluating {{#field}}...{{/field}}, Anki strips HTML and checks if the
   * result is non-empty. A field containing only "<br>" or "<div></div>" is treated
   * as empty by Anki but truthy by this parser.
   *
   * Source: rslib/src/card_rendering/render.rs — field_is_not_empty
   */
  describe("#22 - conditional checks should strip HTML before testing emptiness", () => {
    it("should treat HTML-only field as empty for conditionals", () => {
      const variables = {
        Front: "Question",
        Notes: "<br>",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}{{#Notes}}<div class='notes'>{{Notes}}</div>{{/Notes}}",
        variables,
        mediaFiles: new Map(),
      });

      // <br> is HTML with no text content — should be treated as empty
      expect(html).not.toContain("class='notes'");
      expect(html).toBe("Question");
    });

    it("should treat <div></div> as empty for conditionals", () => {
      const variables = {
        Front: "Question",
        Extra: "<div></div>",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}{{#Extra}} - {{Extra}}{{/Extra}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).toBe("Question");
    });

    it("should treat whitespace-only HTML as empty", () => {
      const variables = {
        Front: "Question",
        Notes: "<p> </p>",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}{{#Notes}}({{Notes}}){{/Notes}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).toBe("Question");
    });
  });

  /**
   * Issue #23: \newcommand with arguments not handled in latexPre parsing
   *
   * The parseLatexMacros function handles \newcommand{\cmd}{body} but not
   * \newcommand{\cmd}[N]{body} where [N] is the number of arguments.
   *
   * Source: Standard LaTeX \newcommand syntax
   */
  describe("#23 - latexPre should handle \\newcommand with arguments", () => {
    it("should parse \\newcommand with argument count", () => {
      const variables = {
        Front: "\\(\\highlight{x^2}\\)",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
        latexPre:
          "\\documentclass{article}\n\\newcommand{\\highlight}[1]{\\colorbox{yellow}{$#1$}}\n\\begin{document}",
      });

      // The macro \highlight takes 1 argument — parseLatexMacros should handle [1]
      // Currently it skips [N] and fails to extract the body, so the macro is undefined
      expect(html).toContain("katex");
      // The macro should have been parsed and KaTeX should render it
      // (colorbox with yellow background is the rendered output)
      expect(html).toContain("yellow");
    });
  });
});
