import { describe, it, expect, beforeEach } from "vitest";
import { getDataFromAnki21b } from "../anki21b";
import {
  createAnki21bDatabase,
  insertAnki21bData,
  type Anki21bNotetype,
  type Anki21bField,
  type Anki21bTemplate,
  type Anki21bNote,
} from "./testUtils";
import { Database } from "sql.js";

describe("Anki21b Parser", () => {
  describe("Example Data Parsing", () => {
    let db: Database;

    beforeEach(async () => {
      db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1234567890123",
          name: "Basic",
          config: {
            css: ".card { font-family: arial; font-size: 20px; }",
            latexPre: "\\documentclass[12pt]{article}",
            latexPost: "\\end{document}",
            latexSvg: false,
            kind: 0,
          },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1234567890123",
          ord: 0,
          name: "Front",
          config: {
            fontName: "Arial",
            fontSize: 20,
            sticky: false,
            rtl: false,
          },
        },
        {
          ntid: "1234567890123",
          ord: 1,
          name: "Back",
          config: {
            fontName: "Arial",
            fontSize: 20,
            sticky: false,
            rtl: false,
          },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1234567890123",
          ord: 0,
          name: "Card 1",
          qFormat: "{{Front}}",
          aFormat: "{{FrontSide}}<hr id=answer>{{Back}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1234567890123",
          tags: ["vocabulary", "french"],
          fields: {
            Front: "Bonjour",
            Back: "Hello",
          },
        },
        {
          id: 2,
          mid: "1234567890123",
          tags: ["vocabulary"],
          fields: {
            Front: "Au revoir",
            Back: "Goodbye",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
    });

    it("should parse cards correctly", () => {
      const result = getDataFromAnki21b(db);

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]?.values).toEqual({
        Front: "Bonjour",
        Back: "Hello",
      });
      expect(result.cards[1]?.values).toEqual({
        Front: "Au revoir",
        Back: "Goodbye",
      });
    });

    it("should parse templates correctly", () => {
      const result = getDataFromAnki21b(db);

      expect(result.cards[0]?.templates).toHaveLength(1);
      expect(result.cards[0]?.templates[0]).toEqual({
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
      });
    });

    it("should parse notesTypes", () => {
      const result = getDataFromAnki21b(db);

      expect(result.notesTypes).toHaveLength(1);
      expect(result.notesTypes[0]?.name).toBe("Basic");
      expect(result.notesTypes[0]?.css).toBe(".card { font-family: arial; font-size: 20px; }");
      expect(result.notesTypes[0]?.latexPre).toBe("\\documentclass[12pt]{article}");
    });

    it("should parse tags from notes table", () => {
      const result = getDataFromAnki21b(db);

      // Tags are now parsed from the notes.tags column (space-delimited)
      expect(result.cards[0]?.tags).toEqual(["vocabulary", "french"]);
      expect(result.cards[1]?.tags).toEqual(["vocabulary"]);
    });
  });

  describe("Built from Scratch", () => {
    it("should parse a simple flashcard deck", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Simple",
          config: {
            css: ".card { background: white; }",
            latexPre: "",
            latexPost: "",
            kind: 0,
          },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Question",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Answer",
          config: { fontName: "Arial", fontSize: 20 },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Forward",
          qFormat: "{{Question}}",
          aFormat: "{{Question}}<hr>{{Answer}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Question: "What is the capital of France?",
            Answer: "Paris",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.values.Question).toBe("What is the capital of France?");
      expect(result.cards[0]?.values.Answer).toBe("Paris");
    });

    it("should handle multiple note types", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Basic",
          config: { css: "", kind: 0 },
        },
        {
          id: "2",
          name: "Cloze",
          config: { css: "", kind: 1 },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Front",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Back",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "2",
          ord: 0,
          name: "Text",
          config: { fontName: "Arial", fontSize: 20 },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Card 1",
          qFormat: "{{Front}}",
          aFormat: "{{Back}}",
        },
        {
          ntid: "2",
          ord: 0,
          name: "Cloze",
          qFormat: "{{cloze:Text}}",
          aFormat: "{{cloze:Text}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Front: "Test",
            Back: "Answer",
          },
        },
        {
          id: 2,
          mid: "2",
          tags: [],
          fields: {
            Text: "{{c1::Paris}} is the capital of France",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards).toHaveLength(2);
      expect(result.notesTypes).toHaveLength(2);
      expect(result.notesTypes[0]?.name).toBe("Basic");
      expect(result.notesTypes[1]?.name).toBe("Cloze");
    });

    it("should handle multiple templates per note type", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Bidirectional",
          config: { css: "", kind: 0 },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "English",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Spanish",
          config: { fontName: "Arial", fontSize: 20 },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "English → Spanish",
          qFormat: "{{English}}",
          aFormat: "{{Spanish}}",
        },
        {
          ntid: "1",
          ord: 1,
          name: "Spanish → English",
          qFormat: "{{Spanish}}",
          aFormat: "{{English}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            English: "Dog",
            Spanish: "Perro",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      // One card per template ordinal (card-driven expansion)
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]?.templates).toHaveLength(1);
      expect(result.cards[0]?.templates[0]?.name).toBe("English → Spanish");
      expect(result.cards[1]?.templates).toHaveLength(1);
      expect(result.cards[1]?.templates[0]?.name).toBe("Spanish → English");
    });

    it("should handle complex field configurations", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Advanced",
          config: { css: "", kind: 0 },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Word",
          config: {
            fontName: "Arial",
            fontSize: 24,
            sticky: true,
            rtl: false,
            plainText: false,
          },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Definition",
          config: {
            fontName: "Times New Roman",
            fontSize: 18,
            sticky: false,
            rtl: false,
            plainText: true,
          },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Card",
          qFormat: "{{Word}}",
          aFormat: "{{Definition}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Word: "Serendipity",
            Definition: "The occurrence of events by chance in a happy way",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.values.Word).toBe("Serendipity");
      expect(result.cards[0]?.values.Definition).toBe(
        "The occurrence of events by chance in a happy way",
      );
    });

    it("should handle special characters and HTML in fields", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Basic",
          config: { css: "", kind: 0 },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Front",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Back",
          config: { fontName: "Arial", fontSize: 20 },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Card",
          qFormat: "{{Front}}",
          aFormat: "{{Back}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Front: '<div class="question"><b>HTML</b> & "special" chars</div>',
            Back: "Answer with\nnewlines",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards[0]?.values.Front).toBe(
        '<div class="question"><b>HTML</b> & "special" chars</div>',
      );
      expect(result.cards[0]?.values.Back).toBe("Answer with\nnewlines");
    });

    it("should handle LaTeX configuration in notetypes", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Math",
          config: {
            css: ".card { font-family: 'Computer Modern'; }",
            latexPre: "\\documentclass[12pt]{article}\n\\usepackage{amsmath}\n\\begin{document}",
            latexPost: "\\end{document}",
            latexSvg: true,
            kind: 0,
          },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Question",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Answer",
          config: { fontName: "Arial", fontSize: 20 },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Card",
          qFormat: "{{Question}}",
          aFormat: "{{Answer}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Question: "[latex]\\int_0^\\infty e^{-x} dx[/latex]",
            Answer: "1",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.notesTypes[0]?.latexSvg).toBe(true);
      expect(result.notesTypes[0]?.latexPre).toContain("\\usepackage{amsmath}");
    });
  });
});
