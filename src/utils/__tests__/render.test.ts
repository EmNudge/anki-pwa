import { describe, it, expect } from "vitest";
import { getRenderedCardString } from "../render";

describe("getRenderedCardString", () => {
  it("should correctly render Template 1 from German deck", () => {
    const variables = {
      Front: "haben",
      Back: "to have",
      Formen: "",
      Audio: "[sound:test.mp3]",
      Comments: "",
    };

    // Template 1 - Front: German word
    const template1Front = `{{Front}}
{{Audio}}`;

    const frontHtml = getRenderedCardString({
      templateString: template1Front,
      variables,
      mediaFiles: new Map(),
    });

    console.log("Template 1 Front:", frontHtml);

    // Template 1 - Back: Front + English translation
    const template1Back = `{{FrontSide}}

<hr id=answer>

{{Formen}}</br>
{{Back}}
</br>
</br>
<div class="font-size20">{{Comments}}</div>`;

    const backHtml = getRenderedCardString({
      templateString: template1Back,
      variables: { ...variables, FrontSide: frontHtml },
      mediaFiles: new Map(),
    });

    console.log("Template 1 Back:", backHtml);

    // The front should show the German word and audio
    expect(frontHtml).toContain("haben");
    expect(frontHtml).toContain("<audio");

    // The back should show BOTH the German (via FrontSide) AND the English
    expect(backHtml).toContain("haben"); // from FrontSide
    expect(backHtml).toContain("to have"); // from Back field
    expect(backHtml).toContain("<audio");
    expect(backHtml).toContain("<hr");

    // Verify the back is NOT just showing the front
    expect(backHtml).not.toBe(frontHtml);
    expect(backHtml.length).toBeGreaterThan(frontHtml.length);
  });

  it("should correctly render Template 2 from German deck", () => {
    const variables = {
      Front: "haben",
      Back: "to have",
      Formen: "",
      Audio: "[sound:test.mp3]",
    };

    // Template 2 - Front: English word
    const template2Front = "{{Back}}";
    const frontHtml = getRenderedCardString({
      templateString: template2Front,
      variables,
      mediaFiles: new Map(),
    });

    console.log("Template 2 Front:", frontHtml);
    expect(frontHtml).toBe("to have");

    // Template 2 - Back: English + German with audio
    const template2Back = `{{FrontSide}}

<hr id=answer>

{{Front}}
{{Audio}} </br>
{{Formen}}`;

    const backHtml = getRenderedCardString({
      templateString: template2Back,
      variables: { ...variables, FrontSide: frontHtml },
      mediaFiles: new Map(),
    });

    console.log("Template 2 Back:", backHtml);

    // The back should contain both the front side AND the additional content
    expect(backHtml).toContain("to have"); // from FrontSide
    expect(backHtml).toContain("haben"); // from Front field
    expect(backHtml).toContain("<audio");

    // Verify the back is NOT just showing the front
    expect(backHtml).not.toBe(frontHtml);
    expect(backHtml.length).toBeGreaterThan(frontHtml.length);
  });

  it("should handle field names with special characters", () => {
    const variables = {
      "Field-Name": "value1",
      Field_Name: "value2",
    };

    const template = "{{Field-Name}} and {{Field_Name}}";
    const html = getRenderedCardString({
      templateString: template,
      variables,
      mediaFiles: new Map(),
    });

    expect(html).toBe("value1 and value2");
  });

  it("should handle FrontSide that contains HTML", () => {
    const variables = {
      Front: "test<br>content",
      Back: "answer",
    };

    const frontHtml = getRenderedCardString({
      templateString: "{{Front}}",
      variables,
      mediaFiles: new Map(),
    });

    const backHtml = getRenderedCardString({
      templateString: "{{FrontSide}}\n<hr>\n{{Back}}",
      variables: { ...variables, FrontSide: frontHtml },
      mediaFiles: new Map(),
    });

    expect(backHtml).toContain("test<br>content");
    expect(backHtml).toContain("answer");
  });

  it("should handle FrontSide containing template-like syntax", () => {
    // Test case where FrontSide value might contain {{...}}
    const variables = {
      Front: "test {{notAField}}",
      Back: "answer",
    };

    const frontHtml = getRenderedCardString({
      templateString: "{{Front}}",
      variables,
      mediaFiles: new Map(),
    });

    console.log("Front with template-like syntax:", frontHtml);

    const backHtml = getRenderedCardString({
      templateString: "{{FrontSide}}\n<hr>\n{{Back}}",
      variables: { ...variables, FrontSide: frontHtml },
      mediaFiles: new Map(),
    });

    console.log("Back with FrontSide containing template-like syntax:", backHtml);

    // The {{notAField}} is in the FIELD VALUE, not the template, so it stays as-is
    expect(frontHtml).toBe("test {{notAField}}");
    // The back should contain the front content AND the back content
    expect(backHtml).toContain("test {{notAField}}");
    expect(backHtml).toContain("answer");
  });

  it("should properly close audio tags to prevent nesting issues", () => {
    // Regression test for bug where self-closing <audio /> caused subsequent HTML to be nested inside
    const variables = {
      Front: "Hallo",
      Back: "Hello",
      Audio: "[sound:test.mp3]",
    };

    const frontTemplate = `{{Front}}
{{Audio}}`;

    const frontHtml = getRenderedCardString({
      templateString: frontTemplate,
      variables,
      mediaFiles: new Map(),
    });

    const backTemplate = `{{FrontSide}}

<hr id=answer>

{{Back}}`;

    const backHtml = getRenderedCardString({
      templateString: backTemplate,
      variables: { ...variables, FrontSide: frontHtml },
      mediaFiles: new Map(),
    });

    // Audio tag should NOT be self-closing (which would cause browsers to treat it as an opening tag)
    expect(frontHtml).toContain("</audio>");
    expect(frontHtml).not.toMatch(/<audio[^>]*\/>/);

    // The back should contain the front AND the translation (not nested inside audio tag)
    expect(backHtml).toContain("Hallo");
    expect(backHtml).toContain("Hello");
    expect(backHtml).toContain("<hr");

    // Verify audio tag is properly closed in the back as well
    expect(backHtml).toContain("</audio>");
    expect(backHtml).not.toMatch(/<audio[^>]*\/>/);
  });

  it("should render latex with HTML tags inside", () => {
    // Anki stores multiline field content with HTML tags like <div>
    const variables = {
      Front: "Define acceleration.",
      Back: "a vector quantity<div>[latex]</div><div><br></div><div>\\begin{align*}</div><div>&amp;a = \\dfrac{\\Delta v}{t} \\\\</div><div>&amp;F = ma \\\\</div><div>&amp;a = \\dfrac{F}{m}</div><div>\\end{align*}</div><div>[/latex]</div>",
    };

    const html = getRenderedCardString({
      templateString: "{{Front}}\n<hr>\n{{Back}}",
      variables,
      mediaFiles: new Map(),
    });

    console.log("Latex with HTML:", html);

    // Should contain rendered KaTeX HTML
    expect(html).toContain("katex");
    // Should NOT contain the raw [latex] tags
    expect(html).not.toContain("[latex]");
    expect(html).not.toContain("[/latex]");
  });

  it("should render inline math within latex blocks", () => {
    // Test inline $...$ expressions within [latex] blocks
    const variables = {
      Front: "[latex]Linear Motion Equations<div><br>Solve for $V_f$ (2 eqns)</div>[/latex]",
    };

    const html = getRenderedCardString({
      templateString: "{{Front}}",
      variables,
      mediaFiles: new Map(),
    });

    console.log("Inline math HTML:", html);

    // Should contain rendered KaTeX for the inline math
    expect(html).toContain("katex");
    // Should contain the plain text
    expect(html).toContain("Linear Motion Equations");
    expect(html).toContain("Solve for");
    expect(html).toContain("(2 eqns)");
    // Should NOT contain the raw [latex] tags or $ delimiters
    expect(html).not.toContain("[latex]");
    expect(html).not.toContain("[/latex]");
    expect(html).not.toContain("$V_f$");
  });

  it("should render [$] and [$$] tags with empty and LaTeX content", () => {
    // Test [$]...[/$] and [$$]...[/$$] blocks
    const variables = {
      Front:
        "Linear vs non-linear of<div>[$] [/$]</div><div>[$]X&nbsp;\\text{ vs }&nbsp;Y[/$]</div><div>[$] [/$]</div><div>[$]X \\text{ vs } \\dfrac{1}{Y}[/$]</div>",
    };

    const html = getRenderedCardString({
      templateString: "{{Front}}",
      variables,
      mediaFiles: new Map(),
    });

    console.log("[$] tags HTML:", html);

    // Should contain rendered KaTeX
    expect(html).toContain("katex");
    // Should contain the plain text
    expect(html).toContain("Linear vs non-linear of");
    // Should NOT contain the raw [$] tags
    expect(html).not.toContain("[$]");
    expect(html).not.toContain("[/$]");
    // Should NOT contain &nbsp; (should be converted to space)
    expect(html).not.toContain("&nbsp;");
  });

  it("should render complex latex with align environment and inline math", () => {
    // Test complex case with \begin{align}, HTML entities, nested divs, and inline math
    const variables = {
      Front:
        "[latex]\\begin{align}&amp; \\dfrac{GM_E m}{r^2} = ma \\\\&nbsp;\\text{becomes&nbsp;} &amp;\\dfrac{GM_E}{r^2} = a \\end{align}<div><div><div><div><div><br /><div><div><div>where $M_E$ is the mass of the earth</div><div><br /></div><div>and $r$ is the distance between mass $m$ and the center of the earth.</div><div>[/latex]</div></div></div></div></div></div></div></div>",
    };

    const html = getRenderedCardString({
      templateString: "{{Front}}",
      variables,
      mediaFiles: new Map(),
    });

    console.log("Complex latex HTML:", html);

    // Should contain rendered KaTeX (both for the align environment and inline math)
    expect(html).toContain("katex");
    expect(html).toContain("katex-display"); // Display mode for align environment
    // Should contain the plain text
    expect(html).toContain("where");
    expect(html).toContain("is the mass of the earth");
    expect(html).toContain("is the distance between mass");
    expect(html).toContain("and the center of the earth");
    // Should NOT contain the raw [latex] tags
    expect(html).not.toContain("[latex]");
    expect(html).not.toContain("[/latex]");
    // Should NOT contain raw $ delimiters in the inline math (visible text)
    expect(html).not.toContain("$M_E$");
    expect(html).not.toContain("$r$");
    expect(html).not.toContain("$m$");
    // Should have properly rendered the align environment
    expect(html).toContain("\\begin{align}"); // In MathML annotation
    expect(html).toContain("dfrac"); // The fraction commands were parsed
  });
});
