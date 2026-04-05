type TemplateNode =
  | { type: "text"; value: string }
  | { type: "field"; reference: string }
  | { type: "conditional"; field: string; positive: boolean; children: TemplateNode[] };

type TemplateTag =
  | { type: "open"; field: string; positive: boolean }
  | { type: "close"; field: string }
  | { type: "field"; reference: string };

type ClozeNode =
  | { type: "text"; value: string }
  | { type: "cloze"; ordinal: number; answer: string; hint: string | null };

export function isClozeNode(node: ClozeNode): node is Extract<ClozeNode, { type: "cloze" }> {
  return node.type === "cloze";
}

export function renderTemplateString({
  templateString,
  renderField,
  shouldRenderConditional,
}: {
  templateString: string;
  renderField: (reference: string) => string;
  shouldRenderConditional: (field: string) => boolean;
}): string {
  return renderTemplateNodes(
    parseTemplateNodes(templateString),
    renderField,
    shouldRenderConditional,
  );
}

export function parseClozeNodes(text: string): ClozeNode[] {
  const nodes: ClozeNode[] = [];
  let index = 0;

  while (index < text.length) {
    const openIndex = text.indexOf("{{c", index);
    if (openIndex === -1) {
      nodes.push({ type: "text", value: text.slice(index) });
      return nodes;
    }
    if (openIndex > index) {
      nodes.push({ type: "text", value: text.slice(index, openIndex) });
    }

    const parsedNode = parseSingleClozeNode(text, openIndex);
    if (!parsedNode) {
      nodes.push({ type: "text", value: text.slice(openIndex, openIndex + 2) });
      index = openIndex + 2;
      continue;
    }

    nodes.push(parsedNode.node);
    index = parsedNode.nextIndex;
  }

  return nodes;
}

function parseTemplateNodes(templateString: string): TemplateNode[] {
  const parseChildren = (
    startIndex: number,
    activeField?: string,
  ): { nodes: TemplateNode[]; nextIndex: number } => {
    const nodes: TemplateNode[] = [];
    let index = startIndex;

    while (index < templateString.length) {
      const openIndex = templateString.indexOf("{{", index);
      if (openIndex === -1) {
        nodes.push({ type: "text", value: templateString.slice(index) });
        return { nodes, nextIndex: templateString.length };
      }
      if (openIndex > index) {
        nodes.push({ type: "text", value: templateString.slice(index, openIndex) });
      }

      const closeIndex = templateString.indexOf("}}", openIndex + 2);
      if (closeIndex === -1) {
        nodes.push({ type: "text", value: templateString.slice(openIndex) });
        return { nodes, nextIndex: templateString.length };
      }

      const tag = parseTemplateTag(templateString.slice(openIndex + 2, closeIndex).trim());
      index = closeIndex + 2;

      if (tag.type === "field") {
        nodes.push(tag);
        continue;
      }

      if (tag.type === "close") {
        if (activeField && tag.field === activeField) {
          return { nodes, nextIndex: index };
        }
        if (activeField) {
          throw new Error(`Found {{/${tag.field}}}, but expected {{/${activeField}}}`);
        }
        throw new Error(
          `Found {{/${tag.field}}}, but missing '{{#${tag.field}}}' or '{{^${tag.field}}}'`,
        );
      }

      const inner = parseChildren(index, tag.field);
      nodes.push({
        type: "conditional",
        field: tag.field,
        positive: tag.positive,
        children: inner.nodes,
      });
      index = inner.nextIndex;
    }

    if (activeField) {
      throw new Error(`Missing {{/${activeField}}}`);
    }

    return { nodes, nextIndex: index };
  };

  return parseChildren(0).nodes;
}

function parseTemplateTag(tagContent: string): TemplateTag {
  const marker = tagContent[0];
  const field = tagContent.slice(1).trim();

  if ((marker === "#" || marker === "^") && field) {
    return { type: "open", field, positive: marker === "#" };
  }

  if (marker === "/" && field) {
    return { type: "close", field };
  }

  return { type: "field", reference: tagContent };
}

function renderTemplateNodes(
  nodes: TemplateNode[],
  renderField: (reference: string) => string,
  shouldRenderConditional: (field: string) => boolean,
): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }
      if (node.type === "field") {
        return renderField(node.reference);
      }
      const shouldRender = shouldRenderConditional(node.field);
      if (shouldRender !== node.positive) {
        return "";
      }
      return renderTemplateNodes(node.children, renderField, shouldRenderConditional);
    })
    .join("");
}

function parseSingleClozeNode(
  text: string,
  startIndex: number,
): { node: Extract<ClozeNode, { type: "cloze" }>; nextIndex: number } | null {
  const numberStart = startIndex + 3;
  let cursor = numberStart;

  while (cursor < text.length && /\d/.test(text[cursor] ?? "")) {
    cursor++;
  }

  if (cursor === numberStart || text.slice(cursor, cursor + 2) !== "::") {
    return null;
  }

  const ordinal = Number.parseInt(text.slice(numberStart, cursor), 10);
  const closeIndex = text.indexOf("}}", cursor + 2);
  if (closeIndex === -1) {
    return null;
  }

  const body = text.slice(cursor + 2, closeIndex);
  const separatorIndex = body.indexOf("::");
  const answer = separatorIndex === -1 ? body : body.slice(0, separatorIndex);
  const hint = separatorIndex === -1 ? null : body.slice(separatorIndex + 2);

  return {
    node: { type: "cloze", ordinal, answer, hint },
    nextIndex: closeIndex + 2,
  };
}
