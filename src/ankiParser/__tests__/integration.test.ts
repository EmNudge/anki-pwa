import { describe, it, expect } from "vitest";
import { getDataFromAnki2 } from "../anki2";
import { getDataFromAnki21b } from "../anki21b";
import {
  createAnki2Database,
  createAnki21bDatabase,
  insertAnki2Data,
  insertAnki21bData,
  type Anki2Model,
  type Anki2Note,
  type Anki21bNotetype,
  type Anki21bField,
  type Anki21bTemplate,
  type Anki21bNote,
} from "./testUtils";

describe("Anki Parser Integration Tests", () => {
  describe("Complete Anki2 Workflow", () => {
    it("should build and parse a complete language learning deck", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1593812345678",
          css: `
            .card {
              font-family: arial;
              font-size: 20px;
              text-align: center;
              color: black;
              background-color: white;
            }
            .question { color: #000080; }
            .answer { color: #008000; }
          `,
          latexPre: "\\documentclass[12pt]{article}\\begin{document}",
          latexPost: "\\end{document}",
          fields: [
            { name: "Spanish" },
            { name: "English" },
            { name: "Example Sentence" },
            { name: "Audio" },
          ],
          templates: [
            {
              name: "Spanish → English",
              qfmt: '<div class="question">{{Spanish}}</div>',
              afmt: '<div class="question">{{Spanish}}</div><hr id=answer><div class="answer">{{English}}</div><br>{{Example Sentence}}<br>{{Audio}}',
              ord: 0,
            },
            {
              name: "English → Spanish",
              qfmt: '<div class="question">{{English}}</div>',
              afmt: '<div class="question">{{English}}</div><hr id=answer><div class="answer">{{Spanish}}</div><br>{{Example Sentence}}',
              ord: 1,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1593812345678",
          tags: ["vocabulary", "verbs", "common"],
          fields: {
            Spanish: "hablar",
            English: "to speak",
            "Example Sentence": "Yo hablo español",
            Audio: "[sound:hablar.mp3]",
          },
        },
        {
          id: 2,
          modelId: "1593812345678",
          tags: ["vocabulary", "verbs"],
          fields: {
            Spanish: "comer",
            English: "to eat",
            "Example Sentence": "Me gusta comer",
            Audio: "[sound:comer.mp3]",
          },
        },
        {
          id: 3,
          modelId: "1593812345678",
          tags: ["vocabulary", "nouns"],
          fields: {
            Spanish: "casa",
            English: "house",
            "Example Sentence": "Mi casa es grande",
            Audio: "",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      // 3 notes × 2 templates = 6 cards (one per card row)
      expect(result.cards).toHaveLength(6);

      // First card: note 1, ord 0 (Spanish → English)
      expect(result.cards[0]?.values.Spanish).toBe("hablar");
      expect(result.cards[0]?.tags).toEqual(["vocabulary", "verbs", "common"]);
      expect(result.cards[0]?.templates).toHaveLength(1);

      // Find note 2's first card
      const note2Card = result.cards.find((c) => c.values["Example Sentence"] === "Me gusta comer");
      expect(note2Card?.values.Audio).toBe("[sound:comer.mp3]");

      // Find note 3's card — Audio should be empty string (empty field preserved)
      const note3Card = result.cards.find((c) => c.values.Spanish === "casa");
      expect(note3Card?.values.Audio).toBe("");
      expect(note3Card?.tags).toContain("nouns");
    });

    it("should handle a mixed deck with multiple card types", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: ".card { font-family: arial; }",
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
          css: ".card { font-family: monospace; }",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Code" }, { name: "Output" }, { name: "Language" }],
          templates: [
            {
              name: "Code Test",
              qfmt: "<pre>{{Code}}</pre><br>Language: {{Language}}",
              afmt: "<pre>{{Code}}</pre><hr>Output: <pre>{{Output}}</pre>",
              ord: 0,
            },
          ],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: ["basic"],
          fields: {
            Front: "What is the capital of Japan?",
            Back: "Tokyo",
          },
        },
        {
          id: 2,
          modelId: "2",
          tags: ["programming", "python"],
          fields: {
            Code: "print(2 + 2)",
            Output: "4",
            Language: "Python",
          },
        },
        {
          id: 3,
          modelId: "1",
          tags: ["basic"],
          fields: {
            Front: "What is 10 * 10?",
            Back: "100",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards).toHaveLength(3);
      expect(result.cards[0]?.templates[0]?.qfmt).toBe("{{Front}}");
      expect(result.cards[1]?.templates[0]?.qfmt).toContain("<pre>{{Code}}</pre>");
      expect(result.cards[1]?.values.Language).toBe("Python");
    });
  });

  describe("Complete Anki21b Workflow", () => {
    it("should build and parse a complete medical terminology deck", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1593812345678",
          name: "Medical Term",
          config: {
            css: `
              .card {
                font-family: 'Helvetica Neue', Arial, sans-serif;
                font-size: 18px;
                text-align: center;
              }
              .term { font-weight: bold; color: #2c3e50; }
              .definition { color: #34495e; }
              .etymology { font-style: italic; color: #7f8c8d; }
            `,
            latexPre: "\\documentclass[12pt]{article}\\begin{document}",
            latexPost: "\\end{document}",
            latexSvg: true,
            kind: 0,
          },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1593812345678",
          ord: 0,
          name: "Term",
          config: {
            fontName: "Helvetica Neue",
            fontSize: 22,
            sticky: false,
            rtl: false,
            plainText: false,
          },
        },
        {
          ntid: "1593812345678",
          ord: 1,
          name: "Definition",
          config: {
            fontName: "Arial",
            fontSize: 18,
            sticky: false,
            rtl: false,
            plainText: false,
          },
        },
        {
          ntid: "1593812345678",
          ord: 2,
          name: "Etymology",
          config: {
            fontName: "Georgia",
            fontSize: 14,
            sticky: false,
            rtl: false,
            plainText: false,
          },
        },
        {
          ntid: "1593812345678",
          ord: 3,
          name: "Example",
          config: {
            fontName: "Arial",
            fontSize: 16,
            sticky: false,
            rtl: false,
            plainText: false,
          },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1593812345678",
          ord: 0,
          name: "Recognition",
          qFormat: '<div class="term">{{Term}}</div>',
          aFormat:
            '<div class="term">{{Term}}</div><hr><div class="definition">{{Definition}}</div><br><div class="etymology">{{Etymology}}</div><br>Example: {{Example}}',
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1593812345678",
          tags: [],
          fields: {
            Term: "Cardiology",
            Definition: "The branch of medicine dealing with the heart",
            Etymology: "Greek: kardia (heart) + -logia (study of)",
            Example: "She specialized in cardiology after medical school.",
          },
        },
        {
          id: 2,
          mid: "1593812345678",
          tags: [],
          fields: {
            Term: "Hypertension",
            Definition: "High blood pressure",
            Etymology: "Greek: hyper (over) + Latin: tensio (tension)",
            Example: "Hypertension can lead to serious cardiovascular problems.",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards).toHaveLength(2);
      expect(result.notesTypes).toHaveLength(1);

      expect(result.cards[0]?.values.Term).toBe("Cardiology");
      expect(result.cards[0]?.values.Definition).toBe(
        "The branch of medicine dealing with the heart",
      );
      expect(result.cards[0]?.templates[0]?.name).toBe("Recognition");

      expect(result.notesTypes[0]?.name).toBe("Medical Term");
      expect(result.notesTypes[0]?.latexSvg).toBe(true);
      expect(result.notesTypes[0]?.css).toContain(".term");
    });

    it("should handle a cloze deletion deck", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Cloze",
          config: {
            css: ".card { font-family: arial; font-size: 20px; }",
            kind: 1,
          },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Text",
          config: { fontName: "Arial", fontSize: 20 },
        },
        {
          ntid: "1",
          ord: 1,
          name: "Extra",
          config: { fontName: "Arial", fontSize: 16 },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Cloze",
          qFormat: "{{cloze:Text}}",
          aFormat: "{{cloze:Text}}<br><br>{{Extra}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Text: "The capital of {{c1::France}} is {{c2::Paris}}",
            Extra: "France is in Western Europe",
          },
        },
        {
          id: 2,
          mid: "1",
          tags: [],
          fields: {
            Text: "{{c1::Water}} boils at {{c2::100}} degrees Celsius",
            Extra: "At standard atmospheric pressure",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards).toHaveLength(2);
      expect(result.notesTypes[0]?.kind).toBe(1);
      expect(result.cards[0]?.values.Text).toBe("The capital of {{c1::France}} is {{c2::Paris}}");
      expect(result.cards[0]?.templates[0]?.qfmt).toBe("{{cloze:Text}}");
    });
  });

  describe("Edge Cases and Data Validation", () => {
    it("should handle Anki2 notes with missing field values", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Field1" }, { name: "Field2" }, { name: "Field3" }],
          templates: [{ name: "Card", qfmt: "{{Field1}}", afmt: "{{Field2}}", ord: 0 }],
        },
      ];

      const notes: Anki2Note[] = [
        {
          id: 1,
          modelId: "1",
          tags: [],
          fields: {
            Field1: "Value1",
            Field2: "",
            Field3: "",
          },
        },
      ];

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards[0]?.values.Field2).toBe("");
      expect(result.cards[0]?.values.Field3).toBe("");
    });

    it("should handle Anki21b with RTL text fields", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Hebrew",
          config: { css: ".card { direction: rtl; }", kind: 0 },
        },
      ];

      const fields: Anki21bField[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Hebrew",
          config: { fontName: "Arial", fontSize: 20, rtl: true },
        },
        {
          ntid: "1",
          ord: 1,
          name: "English",
          config: { fontName: "Arial", fontSize: 20, rtl: false },
        },
      ];

      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Card",
          qFormat: "{{Hebrew}}",
          aFormat: "{{English}}",
        },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: {
            Hebrew: "שלום",
            English: "Hello",
          },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      expect(result.cards[0]?.values.Hebrew).toBe("שלום");
      expect(result.notesTypes[0]?.css).toContain("rtl");
    });

    it("should handle large decks with many notes", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [{ name: "Card", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
        },
      ];

      const notes: Anki2Note[] = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        modelId: "1",
        tags: i % 2 === 0 ? ["even"] : ["odd"],
        fields: {
          Front: `Question ${i + 1}`,
          Back: `Answer ${i + 1}`,
        },
      }));

      insertAnki2Data(db, models, notes);
      const result = getDataFromAnki2(db);

      expect(result.cards).toHaveLength(100);
      expect(result.cards[0]?.values.Front).toBe("Question 1");
      expect(result.cards[99]?.values.Back).toBe("Answer 100");
      expect(result.cards[50]?.tags).toEqual(["even"]);
    });
  });
});
