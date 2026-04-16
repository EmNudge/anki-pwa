import { describe, it, expect } from "vitest";
import {
  isImageOcclusionCard,
  parseOcclusionShapes,
  renderImageOcclusion,
} from "../imageOcclusion";

describe("Image Occlusion", () => {
  describe("isImageOcclusionCard", () => {
    it("returns true for originalStockKind === 6", () => {
      expect(isImageOcclusionCard({ values: {}, originalStockKind: 6 })).toBe(true);
    });

    it("returns false for standard cards", () => {
      expect(isImageOcclusionCard({ values: {}, originalStockKind: 0 })).toBe(false);
    });

    it("returns false for cloze cards", () => {
      expect(isImageOcclusionCard({ values: {}, originalStockKind: 5 })).toBe(false);
    });

    it("returns false when originalStockKind is undefined", () => {
      expect(isImageOcclusionCard({ values: {} })).toBe(false);
    });
  });

  describe("parseOcclusionShapes", () => {
    it("parses rect shapes with data-ordinal", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <rect data-ordinal="1" x="10" y="20" width="100" height="50" fill="#ffeba2" />
        <rect data-ordinal="2" x="200" y="100" width="80" height="60" fill="#ffeba2" />
      </svg>`;
      const shapes = parseOcclusionShapes(svg);
      expect(shapes).toHaveLength(2);
      expect(shapes[0]!.ordinal).toBe(1);
      expect(shapes[1]!.ordinal).toBe(2);
    });

    it("parses ellipse shapes", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <ellipse data-ordinal="1" cx="100" cy="100" rx="50" ry="30" />
      </svg>`;
      const shapes = parseOcclusionShapes(svg);
      expect(shapes).toHaveLength(1);
      expect(shapes[0]!.ordinal).toBe(1);
      expect(shapes[0]!.svgElement).toContain("ellipse");
    });

    it("parses polygon shapes", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <polygon data-ordinal="3" points="100,10 40,198 190,78 10,78 160,198" />
      </svg>`;
      const shapes = parseOcclusionShapes(svg);
      expect(shapes).toHaveLength(1);
      expect(shapes[0]!.ordinal).toBe(3);
    });

    it("parses path shapes", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <path data-ordinal="1" d="M10 10 L100 100" />
      </svg>`;
      const shapes = parseOcclusionShapes(svg);
      expect(shapes).toHaveLength(1);
    });

    it("ignores shapes without data-ordinal", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <rect x="10" y="20" width="100" height="50" />
        <rect data-ordinal="1" x="200" y="100" width="80" height="60" />
      </svg>`;
      const shapes = parseOcclusionShapes(svg);
      expect(shapes).toHaveLength(1);
      expect(shapes[0]!.ordinal).toBe(1);
    });

    it("returns empty array for empty string", () => {
      expect(parseOcclusionShapes("")).toEqual([]);
    });
  });

  describe("renderImageOcclusion", () => {
    const sampleValues = {
      "Image Occlusion": '<img src="anatomy.png">',
      Header: "Brain Anatomy",
      "Back Extra": "Source: Gray's Anatomy",
      Occlusions: `<svg viewBox="0 0 800 600">
        <rect data-ordinal="1" x="10" y="20" width="100" height="50" fill="#ffeba2" />
        <rect data-ordinal="2" x="200" y="100" width="80" height="60" fill="#ffeba2" />
      </svg>`,
    };

    describe("question side (front)", () => {
      it("wraps image in io-container", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).toContain('class="io-container"');
        expect(html).toContain('<img src="anatomy.png">');
      });

      it("includes SVG overlay", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).toContain('class="io-overlay"');
        expect(html).toContain('viewBox="0 0 800 600"');
      });

      it("marks active shape with io-mask-active class", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).toContain('class="io-mask io-mask-active"');
      });

      it("marks non-active shapes with io-mask class only", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: false,
        });
        // The second shape (ordinal 2) should just be io-mask
        const maskMatches = html.match(/class="io-mask"/g);
        expect(maskMatches).not.toBeNull();
        expect(maskMatches!.length).toBeGreaterThanOrEqual(1);
      });

      it("includes header", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).toContain('class="io-header"');
        expect(html).toContain("Brain Anatomy");
      });

      it("does not include back extra on front", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).not.toContain("io-back-extra");
        expect(html).not.toContain("Gray's Anatomy");
      });
    });

    describe("answer side (back)", () => {
      it("reveals active shape with io-mask-reveal class", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: true,
        });
        expect(html).toContain('class="io-mask-reveal"');
      });

      it("keeps non-active shapes as masks", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: true,
        });
        expect(html).toContain('class="io-mask"');
      });

      it("includes back extra with hr separator", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: true,
        });
        expect(html).toContain('id="answer"');
        expect(html).toContain('class="io-back-extra"');
        expect(html).toContain("Gray's Anatomy");
      });

      it("includes header", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 0,
          isAnswer: true,
        });
        expect(html).toContain("Brain Anatomy");
      });
    });

    describe("different card ordinals", () => {
      it("highlights second shape when cardOrd is 1", () => {
        const html = renderImageOcclusion({
          values: sampleValues,
          cardOrd: 1,
          isAnswer: false,
        });
        // The second rect (ordinal 2) should be active
        const lines = html.split("\n");
        const activeLines = lines.filter((l) => l.includes("io-mask-active"));
        expect(activeLines).toHaveLength(1);
        // Verify the active one has ordinal 2's attributes
        expect(activeLines[0]).toContain('x="200"');
      });
    });

    describe("edge cases", () => {
      it("handles missing header gracefully", () => {
        const values = { ...sampleValues, Header: "" };
        const html = renderImageOcclusion({
          values,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).not.toContain("io-header");
      });

      it("handles missing back extra gracefully", () => {
        const values = { ...sampleValues, "Back Extra": "" };
        const html = renderImageOcclusion({
          values,
          cardOrd: 0,
          isAnswer: true,
        });
        expect(html).not.toContain("io-back-extra");
      });

      it("handles empty occlusions field", () => {
        const values = { ...sampleValues, Occlusions: "" };
        const html = renderImageOcclusion({
          values,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).toContain("io-container");
        expect(html).toContain("io-overlay");
      });

      it("handles case-insensitive field names", () => {
        const values = {
          "image occlusion": '<img src="test.png">',
          header: "Test",
          occlusions: `<svg viewBox="0 0 100 100"><rect data-ordinal="1" x="0" y="0" width="10" height="10" /></svg>`,
        };
        const html = renderImageOcclusion({
          values,
          cardOrd: 0,
          isAnswer: false,
        });
        expect(html).toContain('<img src="test.png">');
        expect(html).toContain("Test");
      });
    });
  });
});
