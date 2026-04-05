import { describe, it, expect, beforeEach } from "vitest";
import { getDataFromAnki2 } from "../anki2";
import { createAnki2Database, insertAnki2Data, type Anki2Model, type Anki2Note } from "./testUtils";
import { Database } from "sql.js";

describe("Anki2 Parser", () => {
  describe("Example Data Parsing", () => {
    let db: Database;

    beforeEach(async () => {
      db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1234567890123",
          css: ".card { font-family: arial; }",
          latexPre: "\\documentclass{article}",
          latexPost: "\\end{document}",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            {
              name: "Card 1",
              qfmt: "{{Front}}",
              afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
              ord: 0,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1234567890123",
          tags: ["vocabulary", "spanish"],
          fields: {
            Front: "Hola",
            Back: "Hello",
          },
        },
        {
          id: 2,
          modelId: "1234567890123",
          tags: ["vocabulary"],
          fields: {
            Front: "Adiós",
            Back: "Goodbye",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
    });

    it("should parse cards correctly", () => {
      const result = getDataFromAnki2(db);

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]?.values).toEqual({
        Front: "Hola",
        Back: "Hello",
      });
      expect(result.cards[1]?.values).toEqual({
        Front: "Adiós",
        Back: "Goodbye",
      });
    });

    it("should parse tags correctly", () => {
      const result = getDataFromAnki2(db);

      // Tags are space-delimited in Anki; the parser splits on whitespace
      expect(result.cards[0]?.tags).toEqual(["vocabulary", "spanish"]);
      // Second note has tag "vocabulary" — it maps to card at ord=0
      const vocabCard = result.cards.find((c) => c.values.Front === "Adiós");
      expect(vocabCard?.tags).toEqual(["vocabulary"]);
    });

    it("should include templates in cards", () => {
      const result = getDataFromAnki2(db);

      expect(result.cards[0]?.templates).toHaveLength(1);
      expect(result.cards[0]?.templates[0]).toEqual({
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
        ord: 0,
      });
    });

    it("should return null for notesTypes", () => {
      const result = getDataFromAnki2(db);

      expect(result.notesTypes).toBeNull();
    });
  });

  describe("Built from Scratch", () => {
    it("should parse a simple flashcard deck", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: ".card { background: white; }",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Question" }, { name: "Answer" }],
          templates: [
            {
              name: "Forward",
              qfmt: "{{Question}}",
              afmt: "{{Question}}<hr>{{Answer}}",
              ord: 0,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: [],
          fields: {
            Question: "What is 2+2?",
            Answer: "4",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.values?.Question).toBe("What is 2+2?");
      expect(result.cards[0]?.values?.Answer).toBe("4");
    });

    it("should handle multiple models", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            {
              name: "Card 1",
              qfmt: "{{Front}}",
              afmt: "{{Back}}",
              ord: 0,
            },
          ],
        },
        {
          id: "2",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "English" }, { name: "French" }, { name: "Example" }],
          templates: [
            {
              name: "Recognition",
              qfmt: "{{English}}",
              afmt: "{{French}}<br>{{Example}}",
              ord: 0,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: [],
          fields: {
            Front: "Test",
            Back: "Prueba",
          },
        },
        {
          id: 2,
          modelId: "2",
          tags: ["french"],
          fields: {
            English: "Hello",
            French: "Bonjour",
            Example: "Bonjour, comment allez-vous?",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]?.values).toEqual({
        Front: "Test",
        Back: "Prueba",
      });
      expect(result.cards[1]?.values).toEqual({
        English: "Hello",
        French: "Bonjour",
        Example: "Bonjour, comment allez-vous?",
      });
    });

    it("should handle cards with multiple templates", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            {
              name: "Forward",
              qfmt: "{{Front}}",
              afmt: "{{Back}}",
              ord: 0,
            },
            {
              name: "Reverse",
              qfmt: "{{Back}}",
              afmt: "{{Front}}",
              ord: 1,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: [],
          fields: {
            Front: "Cat",
            Back: "Gato",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      // One card per template ordinal (card-driven expansion)
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]?.templates).toHaveLength(1);
      expect(result.cards[0]?.templates[0]?.name).toBe("Forward");
      expect(result.cards[1]?.templates).toHaveLength(1);
      expect(result.cards[1]?.templates[0]?.name).toBe("Reverse");
    });

    it("should handle empty fields gracefully", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Field1" }, { name: "Field2" }, { name: "Field3" }],
          templates: [
            {
              name: "Card",
              qfmt: "{{Field1}}",
              afmt: "{{Field2}}",
              ord: 0,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: [],
          fields: {
            Field1: "Only first field",
            Field2: "",
            Field3: "",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards[0]?.values).toEqual({
        Field1: "Only first field",
        Field2: null,
        Field3: null,
      });
    });

    it("should handle special characters in fields", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            {
              name: "Card",
              qfmt: "{{Front}}",
              afmt: "{{Back}}",
              ord: 0,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: ["test-tag", "special_chars"],
          fields: {
            Front: '<b>HTML</b> & "quotes"',
            Back: "Line 1\nLine 2",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards[0]?.values.Front).toBe('<b>HTML</b> & "quotes"');
      expect(result.cards[0]?.values.Back).toBe("Line 1\nLine 2");
      expect(result.cards[0]?.tags).toContain("test-tag");
      expect(result.cards[0]?.tags).toContain("special_chars");
    });
  });
});
