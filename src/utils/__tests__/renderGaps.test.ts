/**
 * Tests for rendering gaps identified by cross-referencing with the Anki source
 * (ankitects/anki via deepwiki.com).
 *
 * All tests in this file are EXPECTED TO FAIL against the current implementation,
 * demonstrating where the renderer diverges from real Anki behavior.
 */
import { describe, it, expect } from "vitest";
import { getRenderedCardString } from "../render";

describe("Rendering Gaps (expected to fail)", () => {
  describe("#23 - invalid templates should surface explicit parser errors", () => {
    it("should reject references to unknown fields", () => {
      expect(() =>
        getRenderedCardString({
          templateString: "{{Front}} {{MissingField}}",
          variables: { Front: "Known field" },
          mediaFiles: new Map(),
        }),
      ).toThrow(/MissingField|no field called/i);
    });

    it("should reject mismatched conditional closing tags", () => {
      expect(() =>
        getRenderedCardString({
          templateString: "{{#Front}}value{{/Back}}",
          variables: { Front: "shown", Back: "hidden" },
          mediaFiles: new Map(),
        }),
      ).toThrow(/expected|missing|Front|Back/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #4: furigana/kanji/kana filters not implemented
  //
  // Anki has built-in filters: furigana, kanji, kana.
  // furigana: renders "漢字[かんじ]" as ruby markup
  // kanji: strips readings, keeps base characters
  // kana: strips kanji, keeps readings
  //
  // The renderer only handles single-CJK-char ruby in replaceTemplatingSyntax,
  // and doesn't recognize furigana:/kanji:/kana: as template filters at all.
  //
  // Source: rslib/src/card_rendering/filters.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#4 - furigana/kanji/kana filters", () => {
    it("should render furigana filter with multi-character base", () => {
      const variables = {
        Reading: " 漢字[かんじ]を 勉強[べんきょう]する",
      };

      const html = getRenderedCardString({
        templateString: "{{furigana:Reading}}",
        variables,
        mediaFiles: new Map(),
      });

      // furigana: filter should produce ruby annotations
      expect(html).toContain("<ruby>");
      expect(html).toContain("漢字");
      expect(html).toContain("<rt>かんじ</rt>");
      expect(html).toContain("勉強");
      expect(html).toContain("<rt>べんきょう</rt>");
    });

    it("should render kanji filter (strip readings, keep base)", () => {
      const variables = {
        Reading: " 漢字[かんじ]を 勉強[べんきょう]する",
      };

      const html = getRenderedCardString({
        templateString: "{{kanji:Reading}}",
        variables,
        mediaFiles: new Map(),
      });

      // kanji: filter should strip the bracketed readings
      expect(html).toContain("漢字");
      expect(html).toContain("勉強");
      expect(html).not.toContain("かんじ");
      expect(html).not.toContain("べんきょう");
    });

    it("should render kana filter (strip base, keep readings)", () => {
      const variables = {
        Reading: " 漢字[かんじ]を 勉強[べんきょう]する",
      };

      const html = getRenderedCardString({
        templateString: "{{kana:Reading}}",
        variables,
        mediaFiles: new Map(),
      });

      // kana: filter should replace kanji with their readings and output
      // just the kana. The result should be "かんじをべんきょうする".
      // Currently the unknown filter just returns the raw value unchanged.
      expect(html).toBe("かんじをべんきょうする");
    });

    it("should handle multi-character ruby without furigana filter", () => {
      // Even without furigana: filter, the replaceTemplatingSyntax should
      // handle multi-character bases. Currently only single CJK chars work.
      const variables = {
        Front: "漢字[かんじ]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // Multi-character base should produce ruby annotation
      expect(html).toContain("<ruby>");
      expect(html).toContain("漢字");
      expect(html).toContain("<rt>かんじ</rt>");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #5: tts filter not implemented
  //
  // {{tts en_US:FieldName}} is a built-in filter for text-to-speech.
  // It should either be rendered as an audio element or stripped cleanly,
  // not passed through as raw text with "tts en_US" prepended.
  //
  // Source: rslib/src/card_rendering/tts.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#5 - tts filter", () => {
    it("should produce a TTS audio element or placeholder, not just raw text", () => {
      const variables = {
        Front: "Bonjour",
      };

      const html = getRenderedCardString({
        templateString: "{{tts fr_FR:Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // The tts filter should produce some kind of audio/TTS element,
      // not just silently pass the raw text through as if the filter doesn't exist.
      // Currently "tts fr_FR" is treated as the field name (unknown filter behavior),
      // which means the field lookup fails and returns empty string.
      // A correct implementation would render Bonjour with a TTS audio control.
      expect(html).toContain("Bonjour");
      // There should be some indication that TTS was requested
      expect(html).toMatch(/audio|tts|speak/i);
    });

    it("should parse tts filter with language and options correctly", () => {
      const variables = {
        Front: "Hello world",
      };

      // tts filter: {{tts en_US voices=Apple_Samantha speed=1.2:Front}}
      // The filter name contains spaces — "tts en_US voices=..." is all the filter,
      // and "Front" is the field name. The current split-on-colon approach would
      // parse this incorrectly, treating "tts en_US voices=Apple_Samantha speed=1.2"
      // as the field name.
      const html = getRenderedCardString({
        templateString: "{{tts en_US voices=Apple_Samantha speed=1.2:Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // Should still render the field content
      expect(html).toContain("Hello world");
      // Should produce TTS markup
      expect(html).toMatch(/audio|tts|speak/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #6: FrontSide on answer doesn't strip type: input fields
  //
  // When FrontSide is injected into the answer template, Anki strips
  // type: input fields and replaces them with the answer comparison.
  // The current implementation doesn't do this.
  //
  // Source: rslib/src/card_rendering/render.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#6 - FrontSide should strip type: inputs on answer side", () => {
    it("should not contain input elements from FrontSide on answer side", () => {
      const variables = {
        Front: "What is 2+2?",
        Back: "4",
      };

      const frontTemplate = "{{Front}}<br>{{type:Back}}";
      const backTemplate = "{{FrontSide}}<hr id=answer>{{Back}}";

      const html = getRenderedCardString({
        templateString: backTemplate,
        variables,
        mediaFiles: new Map(),
        isAnswer: true,
        frontTemplate,
      });

      // FrontSide on answer side should NOT contain the type: input box
      // from the front template — it should be stripped or replaced
      expect(html).not.toContain('<input type="text"');
      expect(html).toContain("What is 2+2?");
      expect(html).toContain("4");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #11: [latex]...[/latex] doesn't use latexPre/latexPost
  //
  // In real Anki, [latex]...[/latex] wraps content with latexPre/latexPost
  // and compiles the full document. [$]...[/$] wraps in \begin{math}.
  // [$$]...[/$$] wraps in \begin{displaymath}.
  //
  // The current implementation doesn't apply latexPre/latexPost at all
  // for [latex] blocks, and doesn't use the math environment wrappers.
  //
  // Source: rslib/src/latex.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#11 - [latex] should respect latexPre/latexPost context", () => {
    it("should use macros from latexPre in [latex] blocks", () => {
      const latexPre =
        "\\documentclass{article}\n\\newcommand{\\R}{\\mathbb{R}}\n\\begin{document}";
      const variables = {
        Front: "[latex]$\\R^n$[/latex]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
        latexPre,
      });

      // The \R macro from latexPre should be available inside [latex] blocks
      expect(html).toContain("katex");
      // Should render the blackboard-bold R, not show an error
      expect(html).not.toContain("\\R");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #14: Conditional sections don't support nesting
  //
  // Anki supports nested conditionals:
  //   {{#A}}{{#B}}both{{/B}}{{^B}}only A{{/B}}{{/A}}
  //
  // The flat regex approach processes sections independently which can
  // produce wrong results with nesting.
  //
  // Source: rslib/src/template.rs — template parsing with proper AST
  // ─────────────────────────────────────────────────────────────────────
  describe("#14 - nested conditional sections", () => {
    it("should handle multiple instances of same conditional correctly", () => {
      // When the same field conditional appears multiple times, the flat
      // regex with .+ greedy/lazy matching can consume across boundaries
      const variables = {
        A: "value",
        B: "",
      };

      // Pattern: {{#A}}x{{/A}}{{#B}}y{{/B}}{{#A}}z{{/A}}
      // Expected: A is truthy, B is empty → "xz"
      // The regex approach may fail because {{#A}}...{{/A}} with (.|\\n)+?
      // could match "x{{/A}}{{#B}}y{{/B}}{{#A}}z" as the content
      const html = getRenderedCardString({
        templateString:
          "{{#A}}x{{/A}}{{#B}}y{{/B}}{{#A}}z{{/A}}",
        variables,
        mediaFiles: new Map(),
      });

      // Both A blocks should render (A is non-empty), B block should not
      expect(html).toBe("xz");
    });

    it("should handle conditional with field reference inside that matches section name", () => {
      // Tricky: the field reference {{A}} inside the conditional {{#A}}...{{/A}}
      // contains the section name, which could confuse regex-based parsing
      const variables = {
        A: "",
        B: "present",
      };

      // {{^A}}{{B}} has no A{{/A}} — inverse conditional for A
      const html = getRenderedCardString({
        templateString: "{{^A}}{{B}} has no A{{/A}}",
        variables,
        mediaFiles: new Map(),
      });

      // A is empty so inverse should render
      expect(html).toBe("present has no A");
    });

    it("should handle conditionals with field content containing braces", () => {
      // Field values containing {{ }} sequences could confuse template parsing
      const variables = {
        Code: "function() { return {{value}}; }",
        HasCode: "yes",
      };

      const html = getRenderedCardString({
        templateString: "{{#HasCode}}Code: {{Code}}{{/HasCode}}",
        variables,
        mediaFiles: new Map(),
      });

      // The {{ in the field value should not be interpreted as template syntax
      expect(html).toContain("function() { return {{value}}; }");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #15: cloze filter on non-cloze notetype should not process
  //
  // On standard (non-cloze) notetypes, {{cloze:Field}} should output
  // the raw field value without processing cloze syntax.
  //
  // Source: rslib/src/card_rendering/cloze.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#15 - cloze filter on non-cloze notetypes", () => {
    it("should not process cloze syntax on standard notetypes", () => {
      const variables = {
        Text: "This has {{c1::fake cloze}} syntax",
      };

      // On a non-cloze notetype, the cloze filter should be a no-op
      // isCloze is false (default)
      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
        isCloze: false,
      });

      // On a standard notetype, cloze should not replace anything
      // The raw text including {{c1::...}} should remain or be shown as-is
      expect(html).toContain("fake cloze");
      expect(html).not.toContain("[...]");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #17: Ruby/furigana regex only handles single CJK characters
  //
  // The replaceTemplatingSyntax regex for ruby only matches a single
  // CJK character before [...]. Real Anki uses space-delimited groups
  // for multi-character words: " 食べる[たべる]".
  //
  // Source: rslib/src/card_rendering/ruby.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#17 - ruby annotations for multi-character words", () => {
    it("should handle space-delimited multi-char ruby", () => {
      // Anki format: space before word signals ruby group
      const variables = {
        Front: " 食べる[たべる]は 美味しい[おいしい]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).toContain("<ruby>食べる<rt>たべる</rt></ruby>");
      expect(html).toContain("<ruby>美味しい<rt>おいしい</rt></ruby>");
    });

    it("should handle two-character ruby base", () => {
      const variables = {
        Front: "漢字[かんじ]",
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // Two CJK characters should be treated as a single ruby base
      expect(html).toContain("<ruby>漢字<rt>かんじ</rt></ruby>");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #18: hint filter always says "Show Hint" instead of field name
  //
  // In real Anki, {{hint:ExtraInfo}} creates a link that says
  // "Show ExtraInfo", not "Show Hint".
  //
  // Source: rslib/src/card_rendering/filters.rs — hint filter
  // ─────────────────────────────────────────────────────────────────────
  describe("#18 - hint filter should use field name", () => {
    it("should show the field name in the hint toggle", () => {
      const variables = {
        Etymology: "From Latin 'exemplum'",
      };

      const html = getRenderedCardString({
        templateString: "{{hint:Etymology}}",
        variables,
        mediaFiles: new Map(),
      });

      // Should say "Show Etymology", not "Show Hint"
      expect(html).toContain("Show Etymology");
      expect(html).not.toContain("Show Hint");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #20: <anki-mathjax> tags not handled
  //
  // Newer Anki versions (2.1.50+) use <anki-mathjax> HTML elements
  // in field content for MathJax formulas. These need to be rendered.
  //
  // Source: ts/mathjax/ in Anki source
  // ─────────────────────────────────────────────────────────────────────
  describe("#20 - anki-mathjax tags", () => {
    it("should render <anki-mathjax> inline tags", () => {
      const variables = {
        Front: 'The formula is <anki-mathjax>x^2 + y^2 = r^2</anki-mathjax>.',
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      // <anki-mathjax> should be rendered as math, not left as raw HTML
      expect(html).toContain("katex");
      expect(html).not.toContain("<anki-mathjax>");
    });

    it("should render <anki-mathjax block=true> as display math", () => {
      const variables = {
        Front: '<anki-mathjax block="true">\\sum_{i=1}^n i = \\frac{n(n+1)}{2}</anki-mathjax>',
      };

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map(),
      });

      expect(html).toContain("katex-display");
      expect(html).not.toContain("<anki-mathjax");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #12: latexPost is never used
  //
  // latexPost is parsed from the database but the renderer never receives
  // or uses it. In real Anki, latexPre and latexPost wrap the LaTeX content
  // to form a complete document.
  //
  // Source: rslib/src/latex.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#12 - latexPost should be available to renderer", () => {
    it("should accept latexPost in the function signature", () => {
      // getRenderedCardString should accept latexPost as a typed parameter.
      // Currently it only accepts latexPre. We verify this by checking if
      // the type includes latexPost.
      type RenderParams = Parameters<typeof getRenderedCardString>[0];
      type HasLatexPost = "latexPost" extends keyof RenderParams ? true : false;

      // This compile-time check documents that latexPost is missing from the type.
      // A value of type `true` should be assignable to HasLatexPost.
      const hasIt: HasLatexPost = true as HasLatexPost;
      expect(hasIt).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #13: latexsvg mode not handled in rendering
  //
  // When latexSvg is true, Anki looks for pre-rendered SVG files in media
  // with names like "latex-<hash>.svg". The renderer should look for these
  // instead of trying to render with KaTeX.
  //
  // Source: rslib/src/latex.rs — latex_to_img
  // ─────────────────────────────────────────────────────────────────────
  describe("#13 - latexSvg rendering mode", () => {
    it("should use pre-rendered SVG from media instead of KaTeX when latexSvg mode", () => {
      // When latexSvg=true, Anki generates SVG images and stores them in media.
      // The renderer should look for these pre-rendered images instead of
      // re-rendering with KaTeX. Currently there's no way to enable this mode.
      //
      // In real Anki, [$]x^2[/$] with latexSvg=true would generate a media file
      // like "latex-<hash>.svg" and replace the LaTeX with <img src="latex-<hash>.svg">.
      const variables = {
        Front: "[$]x^2[/$]",
      };

      // The renderer doesn't accept latexSvg, so we force it
      const fn = getRenderedCardString as (args: Record<string, unknown>) => string;
      const html = fn({
        templateString: "{{Front}}",
        variables,
        mediaFiles: new Map([["latex-abcdef.svg", "blob:http://localhost/svg1"]]),
        latexSvg: true,
      });

      // When latexSvg is true AND the pre-rendered file exists in media,
      // the output should reference the SVG file, not use KaTeX rendering
      expect(html).toContain("blob:http://localhost/svg1");
    });
  });

  describe("#24 - TTS syntaxes beyond inline filters", () => {
    it("should render [anki:tts] blocks instead of leaving raw tags in place", () => {
      const html = getRenderedCardString({
        templateString: "[anki:tts lang=en_US]Hello world[/anki:tts]",
        variables: {},
        mediaFiles: new Map(),
      });

      expect(html).toContain("Hello world");
      expect(html).not.toContain("[anki:tts");
      expect(html).toMatch(/tts|audio|speak/i);
    });

    it("should resolve the tts-voices special field", () => {
      const html = getRenderedCardString({
        templateString: "{{tts-voices:}}",
        variables: {},
        mediaFiles: new Map(),
      });

      expect(html).not.toBe("");
      expect(html).toMatch(/voice|Apple|Microsoft|Google/i);
    });
  });
});
