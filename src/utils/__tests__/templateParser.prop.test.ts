import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { renderTemplateString, parseClozeNodes, isClozeNode } from "../templateParser";
import { NUM_RUNS } from "~/test/pbt";

describe("Template Parser — property-based tests", () => {
  describe("renderTemplateString", () => {
    it("plain text without {{ renders to itself", () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 200 }).filter((s) => !s.includes("{{")),
          (text) => {
            const result = renderTemplateString({
              templateString: text,
              renderField: (ref) => ref,
              shouldRenderConditional: () => true,
            });
            expect(result).toBe(text);
          },
        ),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });

    it("field substitution: {{Field}} renders to the field value", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,15}$/),
          fc.stringMatching(/^[a-zA-Z0-9 ]{0,30}$/),
          (fieldName, value) => {
            const template = `{{${fieldName}}}`;
            const result = renderTemplateString({
              templateString: template,
              renderField: (ref) => (ref === fieldName ? value : ""),
              shouldRenderConditional: () => true,
            });
            expect(result).toBe(value);
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("positive conditional renders content when field is present", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          (field, content) => {
            const template = `{{#${field}}}${content}{{/${field}}}`;
            const result = renderTemplateString({
              templateString: template,
              renderField: (ref) => ref,
              shouldRenderConditional: () => true,
            });
            expect(result).toBe(content);
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("positive conditional hides content when field is absent", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          (field, content) => {
            const template = `{{#${field}}}${content}{{/${field}}}`;
            const result = renderTemplateString({
              templateString: template,
              renderField: (ref) => ref,
              shouldRenderConditional: () => false,
            });
            expect(result).toBe("");
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("negative conditional (^) is the inverse of positive (#)", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          fc.boolean(),
          (field, content, isPresent) => {
            const positive = `{{#${field}}}${content}{{/${field}}}`;
            const negative = `{{^${field}}}${content}{{/${field}}}`;

            const posResult = renderTemplateString({
              templateString: positive,
              renderField: (ref) => ref,
              shouldRenderConditional: () => isPresent,
            });
            const negResult = renderTemplateString({
              templateString: negative,
              renderField: (ref) => ref,
              shouldRenderConditional: () => isPresent,
            });

            // Exactly one of them should render the content
            expect([posResult, negResult].filter((r) => r === content).length).toBe(1);
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("multiple fields render independently", () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/), {
            minLength: 1,
            maxLength: 5,
          }),
          (fields) => {
            // Deduplicate field names
            const unique = [...new Set(fields)];
            if (unique.length === 0) return;

            const template = unique.map((f) => `{{${f}}}`).join(" ");
            const values = Object.fromEntries(unique.map((f, i) => [f, `val${i}`]));

            const result = renderTemplateString({
              templateString: template,
              renderField: (ref) => values[ref] ?? "",
              shouldRenderConditional: () => true,
            });

            expect(result).toBe(unique.map((_, i) => `val${i}`).join(" "));
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });

  describe("parseClozeNodes", () => {
    it("text without {{c returns a single text node", () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 100 }).filter((s) => !s.includes("{{c")),
          (text) => {
            const nodes = parseClozeNodes(text);
            // May produce multiple text nodes if there are partial matches,
            // but all should be text type
            for (const node of nodes) {
              expect(node.type).toBe("text");
            }
            // Concatenating all text values should equal the original
            const reconstructed = nodes.map((n) => (n.type === "text" ? n.value : "")).join("");
            expect(reconstructed).toBe(text);
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("valid cloze {{cN::answer}} parses correctly", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 99 }),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,30}$/),
          (ordinal, answer) => {
            const text = `{{c${ordinal}::${answer}}}`;
            const nodes = parseClozeNodes(text);
            const clozeNodes = nodes.filter(isClozeNode);

            expect(clozeNodes.length).toBe(1);
            expect(clozeNodes[0]!.ordinal).toBe(ordinal);
            expect(clozeNodes[0]!.answer).toBe(answer);
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("cloze with hint parses hint correctly", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 99 }),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          (ordinal, answer, hint) => {
            const text = `{{c${ordinal}::${answer}::${hint}}}`;
            const nodes = parseClozeNodes(text);
            const clozeNodes = nodes.filter(isClozeNode);

            expect(clozeNodes.length).toBe(1);
            expect(clozeNodes[0]!.ordinal).toBe(ordinal);
            expect(clozeNodes[0]!.answer).toBe(answer);
            expect(clozeNodes[0]!.hint).toBe(hint);
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("surrounding text is preserved around cloze nodes", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/),
          fc.integer({ min: 1, max: 9 }),
          fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/),
          (before, after, ord, answer) => {
            const text = `${before}{{c${ord}::${answer}}}${after}`;
            const nodes = parseClozeNodes(text);

            // First node should be text with 'before'
            expect(nodes[0]!.type).toBe("text");
            if (nodes[0]!.type === "text") {
              expect(nodes[0]!.value).toBe(before);
            }

            // Last node should be text with 'after'
            const last = nodes[nodes.length - 1]!;
            expect(last.type).toBe("text");
            if (last.type === "text") {
              expect(last.value).toBe(after);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("multiple clozes produce the correct count", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), (count) => {
          const parts: string[] = [];
          for (let i = 1; i <= count; i++) {
            parts.push(`{{c${i}::answer${i}}}`);
          }
          const text = parts.join(" ");
          const nodes = parseClozeNodes(text);
          const clozeNodes = nodes.filter(isClozeNode);
          expect(clozeNodes.length).toBe(count);
        }),
        { numRuns: NUM_RUNS ?? 50 },
      );
    });
  });
});
