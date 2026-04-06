import { describe, it, expect, beforeEach } from "vitest";
import { getDataFromAnki2, parseFsrsData } from "../anki2";
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

    it("should return notesTypes array with schema hashes", () => {
      const result = getDataFromAnki2(db);

      expect(result.notesTypes).toBeDefined();
      expect(Array.isArray(result.notesTypes)).toBe(true);
      expect(result.notesTypes.length).toBeGreaterThan(0);
      expect(result.notesTypes[0]).toHaveProperty("schemaHash");
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
        Field2: "",
        Field3: "",
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

  describe("Scheduling Semantics", () => {
    it("should expose dueType based on queue", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }, { name: "Card 2", qfmt: "{{Back}}", afmt: "{{Front}}", ord: 1 }] },
      ];
      const notes: Anki2Note[] = [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }];
      insertAnki2Data(db, models, notes);

      db.run(`UPDATE cards SET type = 0, queue = 0, due = 42 WHERE id = 1000`);
      db.run(`UPDATE cards SET type = 2, queue = 2, due = 42, ivl = 10 WHERE id = 1001`);

      const result = getDataFromAnki2(db);
      const newCard = result.cards.find((c) => c.scheduling?.type === 0);
      const reviewCard = result.cards.find((c) => c.scheduling?.type === 2);

      expect(newCard?.scheduling?.dueType).toBe("position");
      expect(reviewCard?.scheduling?.dueType).toBe("dayOffset");
    });

    it("should expose ivlUnit as seconds for negative ivl", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);
      db.run(`UPDATE cards SET type = 1, queue = 1, ivl = -600, due = ${Math.floor(Date.now() / 1000)} WHERE id = 1000`);

      const result = getDataFromAnki2(db);
      expect(result.cards[0]?.scheduling?.ivl).toBe(-600);
      expect(result.cards[0]?.scheduling?.ivlUnit).toBe("seconds");
    });

    it("should expose odue, flags, and left", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);
      db.run(`UPDATE cards SET did = 2, odid = 1, odue = 100, flags = 3, left = 2002, type = 2, queue = 2 WHERE id = 1000`);

      const result = getDataFromAnki2(db);
      const sched = result.cards[0]?.scheduling;
      expect(sched?.odue).toBe(100);
      expect(sched?.flags).toBe(3);
      expect(sched?.left).toBe(2002);
    });

    it("should set easeFactor to null when factor is 0", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);
      db.run(`UPDATE cards SET type = 0, queue = 0, factor = 0 WHERE id = 1000`);

      const result = getDataFromAnki2(db);
      expect(result.cards[0]?.scheduling?.factor).toBe(0);
      expect(result.cards[0]?.scheduling?.easeFactor).toBeNull();
    });
  });

  describe("Extended Data Extraction", () => {
    it("should expose noteData from notes.data", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);
      db.run(`UPDATE notes SET data = '{"key":"value"}' WHERE id = 1`);

      const result = getDataFromAnki2(db);
      expect(result.cards[0]?.noteData).toBe('{"key":"value"}');
    });

    it("should expose csum and sfld", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);
      db.run(`UPDATE notes SET sfld = 'Hello', csum = 12345678 WHERE id = 1`);

      const result = getDataFromAnki2(db);
      expect(result.cards[0]?.csum).toBe(12345678);
      expect(result.cards[0]?.sfld).toBe("Hello");
    });

    it("should parse graves table", async () => {
      const db = await createAnki2Database();
      db.run(`CREATE TABLE IF NOT EXISTS graves (usn INTEGER NOT NULL, oid INTEGER NOT NULL, type INTEGER NOT NULL)`);
      db.run(`INSERT INTO graves (usn, oid, type) VALUES (0, 999, 1)`);
      db.run(`INSERT INTO graves (usn, oid, type) VALUES (0, 888, 0)`);

      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);

      const result = getDataFromAnki2(db);
      expect(result.graves).toHaveLength(2);
    });

    it("should parse deck config learn/relearn steps", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);
      db.run(`UPDATE col SET dconf = ? WHERE id = 1`, [
        JSON.stringify({ "1": { id: 1, name: "Default", new: { delays: [1, 10, 30] }, lapse: { delays: [10] } } }),
      ]);

      const result = getDataFromAnki2(db);
      expect(result.deckConfigs["1"]?.learnSteps).toEqual([1, 10, 30]);
      expect(result.deckConfigs["1"]?.relearnSteps).toEqual([10]);
    });

    it("should compute schema hash for notesTypes", async () => {
      const db = await createAnki2Database();
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);

      const result = getDataFromAnki2(db);
      expect(result.notesTypes).not.toBeNull();
      expect(result.notesTypes[0]).toHaveProperty("schemaHash");
      expect(typeof result.notesTypes[0]!.schemaHash).toBe("string");
    });

    it("should label revlog types correctly", async () => {
      const db = await createAnki2Database();
      db.run(`CREATE TABLE IF NOT EXISTS revlog (id INTEGER PRIMARY KEY, cid INTEGER NOT NULL, usn INTEGER NOT NULL, ease INTEGER NOT NULL, ivl INTEGER NOT NULL, lastIvl INTEGER NOT NULL, factor INTEGER NOT NULL, time INTEGER NOT NULL, type INTEGER NOT NULL)`);
      const models: Anki2Model[] = [
        { id: "1", css: "", latexPre: "", latexPost: "", fields: [{ name: "Front" }, { name: "Back" }], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }] },
      ];
      insertAnki2Data(db, models, [{ id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } }]);

      const now = Date.now();
      for (let t = 0; t <= 4; t++) {
        db.run(`INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, 1000, 0, 3, 1, 0, 2500, 5000, ?)`, [now + t, t]);
      }

      const result = getDataFromAnki2(db);
      const typeNames = result.revlog.map((e) => e.typeName);
      expect(typeNames).toContain("learning");
      expect(typeNames).toContain("review");
      expect(typeNames).toContain("relearning");
      expect(typeNames).toContain("filtered");
      expect(typeNames).toContain("manual");
    });
  });

  describe("FSRS Parsing", () => {
    it("should not hardcode desiredRetention when dr is absent from JSON", () => {
      const fsrs = parseFsrsData(JSON.stringify({ s: 10.0, d: 5.0 }));
      expect(fsrs).not.toBeNull();
      expect(fsrs!.desiredRetention).toBeUndefined();
    });

    it("should not hardcode desiredRetention for protobuf FSRS data", () => {
      const buf = new ArrayBuffer(10);
      const view = new DataView(buf);
      view.setUint8(0, 0x0d);
      view.setFloat32(1, 10.0, true);
      view.setUint8(5, 0x15);
      view.setFloat32(6, 5.0, true);

      const fsrs = parseFsrsData(new Uint8Array(buf));
      expect(fsrs).not.toBeNull();
      expect(fsrs!.desiredRetention).toBeUndefined();
    });
  });
});
