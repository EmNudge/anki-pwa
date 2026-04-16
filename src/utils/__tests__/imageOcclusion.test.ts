import { describe, it, expect } from "vitest";
import {
  isImageOcclusionCard,
  parseOcclusionShapes,
  parseOcclusionShapesForEditor,
  serializeShapesToSvg,
  renderImageOcclusion,
  getImageFilename,
  type OcclusionShape,
} from "../imageOcclusion";

describe("Image Occlusion", () => {
  describe("isImageOcclusionCard", () => {
    it("returns true for originalStockKind === 6", () => {
      expect(isImageOcclusionCard({ values: {}, originalStockKind: 6 })).toBe(true);
    });

    it("returns false for standard cards", () => {
      expect(isImageOcclusionCard({ values: {}, originalStockKind: 0 })).toBe(false);
    });

    it("returns false when originalStockKind is undefined", () => {
      expect(isImageOcclusionCard({ values: {} })).toBe(false);
    });
  });

  describe("getImageFilename", () => {
    it("extracts filename from img tag", () => {
      expect(getImageFilename('<img src="anatomy.png">')).toBe("anatomy.png");
    });

    it("returns null for empty string", () => {
      expect(getImageFilename("")).toBeNull();
    });

    it("returns null for text without img", () => {
      expect(getImageFilename("just text")).toBeNull();
    });
  });

  describe("parseOcclusionShapes (for rendering)", () => {
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
      expect(shapes[0]!.svgElement).toContain("ellipse");
    });

    it("ignores shapes without data-ordinal", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <rect x="10" y="20" width="100" height="50" />
        <rect data-ordinal="1" x="200" y="100" width="80" height="60" />
      </svg>`;
      const shapes = parseOcclusionShapes(svg);
      expect(shapes).toHaveLength(1);
    });

    it("returns empty array for empty string", () => {
      expect(parseOcclusionShapes("")).toEqual([]);
    });
  });

  describe("parseOcclusionShapesForEditor", () => {
    it("parses rect into OcclusionShape", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <rect data-ordinal="1" x="10" y="20" width="100" height="50" />
      </svg>`;
      const shapes = parseOcclusionShapesForEditor(svg);
      expect(shapes).toHaveLength(1);
      expect(shapes[0]!.type).toBe("rect");
      expect(shapes[0]!.ordinal).toBe(1);
      expect(shapes[0]!.x).toBe(10);
      expect(shapes[0]!.y).toBe(20);
      expect(shapes[0]!.width).toBe(100);
      expect(shapes[0]!.height).toBe(50);
    });

    it("parses ellipse into OcclusionShape bounding box", () => {
      const svg = `<svg viewBox="0 0 800 600">
        <ellipse data-ordinal="2" cx="100" cy="200" rx="50" ry="30" />
      </svg>`;
      const shapes = parseOcclusionShapesForEditor(svg);
      expect(shapes).toHaveLength(1);
      expect(shapes[0]!.type).toBe("ellipse");
      expect(shapes[0]!.ordinal).toBe(2);
      expect(shapes[0]!.x).toBe(50); // cx - rx
      expect(shapes[0]!.y).toBe(170); // cy - ry
      expect(shapes[0]!.width).toBe(100); // rx * 2
      expect(shapes[0]!.height).toBe(60); // ry * 2
    });

    it("parses circle as ellipse", () => {
      const svg = `<svg><circle data-ordinal="1" cx="50" cy="50" r="25" /></svg>`;
      const shapes = parseOcclusionShapesForEditor(svg);
      expect(shapes).toHaveLength(1);
      expect(shapes[0]!.type).toBe("ellipse");
      expect(shapes[0]!.x).toBe(25);
      expect(shapes[0]!.y).toBe(25);
      expect(shapes[0]!.width).toBe(50);
      expect(shapes[0]!.height).toBe(50);
    });

    it("returns empty for no shapes", () => {
      expect(parseOcclusionShapesForEditor("")).toEqual([]);
    });
  });

  describe("serializeShapesToSvg", () => {
    it("serializes rect shapes", () => {
      const shapes: OcclusionShape[] = [
        { id: "1", type: "rect", ordinal: 1, x: 10, y: 20, width: 100, height: 50 },
      ];
      const svg = serializeShapesToSvg(shapes, 800, 600);
      expect(svg).toContain('viewBox="0 0 800 600"');
      expect(svg).toContain('data-ordinal="1"');
      expect(svg).toContain('x="10"');
      expect(svg).toContain('width="100"');
    });

    it("serializes ellipse shapes with cx/cy/rx/ry", () => {
      const shapes: OcclusionShape[] = [
        { id: "1", type: "ellipse", ordinal: 1, x: 50, y: 70, width: 100, height: 60 },
      ];
      const svg = serializeShapesToSvg(shapes, 800, 600);
      expect(svg).toContain("ellipse");
      expect(svg).toContain('cx="100"'); // x + width/2
      expect(svg).toContain('cy="100"'); // y + height/2
      expect(svg).toContain('rx="50"'); // width/2
      expect(svg).toContain('ry="30"'); // height/2
    });

    it("round-trips rect shapes", () => {
      const original: OcclusionShape[] = [
        { id: "a", type: "rect", ordinal: 1, x: 10, y: 20, width: 100, height: 50 },
        { id: "b", type: "rect", ordinal: 2, x: 200, y: 100, width: 80, height: 60 },
      ];
      const svg = serializeShapesToSvg(original, 800, 600);
      const parsed = parseOcclusionShapesForEditor(svg);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]!.ordinal).toBe(1);
      expect(parsed[0]!.x).toBe(10);
      expect(parsed[0]!.y).toBe(20);
      expect(parsed[0]!.width).toBe(100);
      expect(parsed[0]!.height).toBe(50);
      expect(parsed[1]!.ordinal).toBe(2);
      expect(parsed[1]!.x).toBe(200);
    });

    it("round-trips ellipse shapes", () => {
      const original: OcclusionShape[] = [
        { id: "a", type: "ellipse", ordinal: 1, x: 50, y: 70, width: 100, height: 60 },
      ];
      const svg = serializeShapesToSvg(original, 800, 600);
      const parsed = parseOcclusionShapesForEditor(svg);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.type).toBe("ellipse");
      expect(parsed[0]!.x).toBe(50);
      expect(parsed[0]!.y).toBe(70);
      expect(parsed[0]!.width).toBe(100);
      expect(parsed[0]!.height).toBe(60);
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

    it("renders front side with masks", () => {
      const html = renderImageOcclusion({ values: sampleValues, cardOrd: 0, isAnswer: false });
      expect(html).toContain('class="io-container"');
      expect(html).toContain('class="io-mask io-mask-active"');
      expect(html).toContain('class="io-mask"');
      expect(html).toContain("Brain Anatomy");
      expect(html).not.toContain("io-back-extra");
    });

    it("renders back side with reveal", () => {
      const html = renderImageOcclusion({ values: sampleValues, cardOrd: 0, isAnswer: true });
      expect(html).toContain('class="io-mask-reveal"');
      expect(html).toContain('class="io-mask"');
      expect(html).toContain("io-back-extra");
      expect(html).toContain("Gray's Anatomy");
    });

    it("highlights correct shape for different card ordinals", () => {
      const html = renderImageOcclusion({ values: sampleValues, cardOrd: 1, isAnswer: false });
      const lines = html.split("\n");
      const activeLines = lines.filter((l) => l.includes("io-mask-active"));
      expect(activeLines).toHaveLength(1);
      expect(activeLines[0]).toContain('x="200"');
    });

    it("handles missing header", () => {
      const values = { ...sampleValues, Header: "" };
      const html = renderImageOcclusion({ values, cardOrd: 0, isAnswer: false });
      expect(html).not.toContain("io-header");
    });

    it("handles case-insensitive field names", () => {
      const values = {
        "image occlusion": '<img src="test.png">',
        header: "Test",
        occlusions: `<svg viewBox="0 0 100 100"><rect data-ordinal="1" x="0" y="0" width="10" height="10" /></svg>`,
      };
      const html = renderImageOcclusion({ values, cardOrd: 0, isAnswer: false });
      expect(html).toContain('<img src="test.png">');
      expect(html).toContain("Test");
    });
  });
});
