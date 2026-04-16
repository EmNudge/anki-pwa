/**
 * Image Occlusion rendering utilities.
 *
 * Handles detection and rendering of Anki image occlusion notes.
 * IO notes have originalStockKind === 6 and contain:
 *   - "Image Occlusion" field: <img> tag referencing the base image
 *   - "Occlusions" field: SVG markup with shapes having data-ordinal attributes
 *   - "Header" field: optional text above the image
 *   - "Back Extra" field: optional text below the image on the answer side
 */

const ORIGINAL_STOCK_KIND_IMAGE_OCCLUSION = 6;

/** Known field names for IO notes (case-insensitive lookup). */
const IO_FIELD_NAMES = {
  image: "Image Occlusion",
  header: "Header",
  backExtra: "Back Extra",
  occlusions: "Occlusions",
} as const;

type CardLike = {
  values: Record<string, string | null>;
  originalStockKind?: number;
};

export function isImageOcclusionCard(card: CardLike): boolean {
  return card.originalStockKind === ORIGINAL_STOCK_KIND_IMAGE_OCCLUSION;
}

/**
 * Find a field value by name, case-insensitive.
 */
function getField(values: Record<string, string | null>, name: string): string {
  // Try exact match first
  if (values[name] != null) return values[name]!;
  // Case-insensitive fallback
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(values)) {
    if (key.toLowerCase() === lower && value != null) return value;
  }
  return "";
}

/**
 * Parse shape elements from the Occlusions SVG field.
 * Returns an array of shape descriptors with their ordinals.
 */
export function parseOcclusionShapes(
  svgString: string,
): { ordinal: number; svgElement: string }[] {
  if (!svgString.trim()) return [];

  const shapes: { ordinal: number; svgElement: string }[] = [];

  // Match SVG shape elements with data-ordinal attributes
  // Supports: rect, ellipse, circle, polygon, path
  const shapeRegex =
    /<(rect|ellipse|circle|polygon|path)\b([^>]*?)\/?>(?:<\/\1>)?/gi;

  let match;
  while ((match = shapeRegex.exec(svgString)) !== null) {
    const fullElement = match[0];
    const attrs = match[2] ?? "";

    // Extract ordinal from data-ordinal attribute
    const ordinalMatch = attrs.match(/data-ordinal="(\d+)"/);
    if (!ordinalMatch) continue;

    const ordinal = parseInt(ordinalMatch[1]!, 10);
    shapes.push({ ordinal, svgElement: fullElement });
  }

  return shapes;
}

/**
 * Extract the viewBox from the Occlusions SVG, or return a default.
 */
function extractViewBox(svgString: string): string | null {
  const match = svgString.match(/viewBox="([^"]+)"/);
  return match ? match[1]! : null;
}

/**
 * Render an image occlusion card to HTML.
 *
 * @param values - The card field values
 * @param cardOrd - The 0-based card ordinal (determines which shape is active)
 * @param isAnswer - Whether rendering the answer (back) side
 * @returns HTML string for the card content
 */
export function renderImageOcclusion({
  values,
  cardOrd,
  isAnswer,
}: {
  values: Record<string, string | null>;
  cardOrd: number;
  isAnswer: boolean;
}): string {
  const imageHtml = getField(values, IO_FIELD_NAMES.image);
  const header = getField(values, IO_FIELD_NAMES.header);
  const backExtra = getField(values, IO_FIELD_NAMES.backExtra);
  const occlusionsSvg = getField(values, IO_FIELD_NAMES.occlusions);

  const activeOrdinal = cardOrd + 1; // Anki ordinals are 1-based
  const shapes = parseOcclusionShapes(occlusionsSvg);
  const viewBox = extractViewBox(occlusionsSvg);

  // Build the SVG overlay with shapes
  const svgShapes = shapes
    .map(({ ordinal, svgElement }) => {
      const isActive = ordinal === activeOrdinal;

      if (isAnswer) {
        // Answer side: active shape gets reveal styling, others stay as masks
        if (isActive) {
          return svgElement
            .replace(/class="[^"]*"/, "")
            .replace(/<(rect|ellipse|circle|polygon|path)\b/, `<$1 class="io-mask-reveal"`);
        }
        return svgElement
          .replace(/class="[^"]*"/, "")
          .replace(/<(rect|ellipse|circle|polygon|path)\b/, `<$1 class="io-mask"`);
      } else {
        // Question side: all shapes shown as masks, active one highlighted
        const cssClass = isActive ? "io-mask io-mask-active" : "io-mask";
        return svgElement
          .replace(/class="[^"]*"/, "")
          .replace(/<(rect|ellipse|circle|polygon|path)\b/, `<$1 class="${cssClass}"`);
      }
    })
    .join("\n    ");

  const viewBoxAttr = viewBox ? `viewBox="${viewBox}"` : "";
  const svgOverlay = `<svg class="io-overlay" ${viewBoxAttr} xmlns="http://www.w3.org/2000/svg">
    ${svgShapes}
  </svg>`;

  const parts: string[] = [];

  if (header) {
    parts.push(`<div class="io-header">${header}</div>`);
  }

  parts.push(`<div class="io-container">
  ${imageHtml}
  ${svgOverlay}
</div>`);

  if (isAnswer && backExtra) {
    parts.push(`<hr id="answer">
<div class="io-back-extra">${backExtra}</div>`);
  }

  return parts.join("\n");
}
