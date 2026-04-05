/**
 * Tests for parser correctness issues identified by cross-referencing
 * with the Anki source (ankitects/anki via deepwiki).
 *
 * All tests in this file are EXPECTED TO FAIL against the current implementation.
 */
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

describe("Parser Correctness Issues (expected to fail)", () => {
  /**
   * Issue #9: col.models `type` field not parsed — cloze card generation wrong
   *
   * The model schema doesn't parse the `type` field (0=standard, 1=cloze).
   * For cloze notetypes, Anki generates one card per cloze number found in
   * the fields, not one card per template. The card's `ord` is cloze_num - 1,
   * not the template ordinal.
   *
   * Source: rslib/src/card_rendering/mod.rs — card generation for cloze
   */
  describe("#9 - cloze notetype model type field should be parsed", () => {
    it("should parse model type field to distinguish cloze from standard", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          type: 1, // MODEL_CLOZE
          fields: [{ name: "Text" }, { name: "Extra" }],
          templates: [
            {
              name: "Cloze",
              qfmt: "{{cloze:Text}}",
              afmt: "{{cloze:Text}}<br>{{Extra}}",
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
            Text: "{{c1::Paris}} is the capital of {{c2::France}}",
            Extra: "Geography fact",
          },
        },
      ];

      insertAnki2Data(db, models, notes);

      // Manually insert a second card for cloze 2 (ord=1)
      // In real Anki, cloze notetypes auto-generate one card per cloze number
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1001, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      // Should have 2 cards (one per cloze number)
      expect(result.cards).toHaveLength(2);

      // Both cards should use template 0 (cloze notetypes only have one template)
      // Card with ord=0 corresponds to c1, card with ord=1 corresponds to c2
      expect(result.cards[0]?.templates[0]?.qfmt).toBe("{{cloze:Text}}");
      expect(result.cards[1]?.templates[0]?.qfmt).toBe("{{cloze:Text}}");

      // The parsed data should indicate this is a cloze notetype (type=1)
      // so consumers know ord means cloze_num-1, not template ordinal
      const card = result.cards[0] as Record<string, unknown>;
      expect(card).toHaveProperty("noteType", 1); // MODEL_CLOZE
    });
  });

  /**
   * Issue #10: `req` field not parsed — blank cards may be generated
   *
   * Anki uses the `req` (requirements) field to suppress card generation when
   * required fields are empty. Format: [template_ord, "all"|"any", [field_ords]].
   * Without this, the parser may include cards that Anki would never create.
   *
   * Source: rslib/src/card_rendering/mod.rs — card_gen_requires
   */
  describe("#10 - req field should suppress blank cards", () => {
    it("should not generate cards when required fields are empty", async () => {
      const db = await createAnki2Database();

      // Model JSON with req field specifying field 0 ("Front") is required
      const modelsJson = JSON.stringify({
        "1": {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          flds: [{ name: "Front" }, { name: "Back" }],
          tmpls: [
            { name: "Forward", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 },
            { name: "Reverse", qfmt: "{{Back}}", afmt: "{{Front}}", ord: 1 },
          ],
          req: [
            [0, "all", [0]], // Forward requires field 0 (Front)
            [1, "all", [1]], // Reverse requires field 1 (Back)
          ],
        },
      });

      const decksJson = JSON.stringify({ "1": { id: 1, name: "Default" } });

      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [modelsJson, decksJson],
      );

      // Note where Back is empty
      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, '', 'Hello\x1F', '', 0, 0, '')`,
      );

      // Anki would only create the Forward card (ord=0) since Back is empty
      // But we insert both cards to simulate what a naive parser might see
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1001, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      // The Reverse card (ord=1) should be suppressed since Back (field 1) is empty
      // This test documents that the parser doesn't filter based on req
      // In practice, Anki wouldn't even create the card row for ord=1,
      // but the parser should still be aware of req for validation
      expect(result.cards).toHaveLength(2); // Currently passes — both cards returned
      // A correct implementation would either:
      // 1. Filter out cards that don't meet req, or
      // 2. Expose the req data so the consumer can filter
      const card = result.cards[0] as Record<string, unknown>;
      // At minimum, the model's req field should be accessible
      expect(card).toHaveProperty("req");
    });
  });

  /**
   * Issue #13: anki21b parser doesn't extract scheduling data
   *
   * The anki21b card query only selects id, nid, ord, did, odid.
   * Unlike the anki2 parser, it doesn't extract type, queue, due, ivl,
   * factor, reps, lapses, or data from the cards table.
   *
   * Source: rslib/src/cards.rs — Card struct fields
   */
  describe("#13 - anki21b should extract scheduling data", () => {
    it("should include scheduling fields in anki21b card output", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Basic", config: { css: "", kind: 0 } },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Back", config: { fontName: "Arial", fontSize: 20 } },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "Hello", Back: "World" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      // Update the card to have real scheduling data
      db.run(
        `UPDATE cards SET type = 2, queue = 2, due = 100, ivl = 30, factor = 2500, reps = 10, lapses = 2 WHERE id = 1000`,
      );

      const result = getDataFromAnki21b(db);
      const card = result.cards[0] as Record<string, unknown>;

      // anki21b cards should have scheduling data like anki2 cards do
      expect(card).toHaveProperty("scheduling");
      const scheduling = card.scheduling as Record<string, unknown>;
      expect(scheduling).toMatchObject({
        type: 2,
        queue: 2,
        due: 100,
        ivl: 30,
        factor: 2500,
        reps: 10,
        lapses: 2,
      });
    });
  });

  /**
   * Issue #14: anki21b doesn't extract revlog
   *
   * The anki2 parser extracts review log entries, but the anki21b parser
   * doesn't query the revlog table at all.
   *
   * Source: rslib/src/revlog/mod.rs
   */
  describe("#14 - anki21b should extract revlog", () => {
    it("should include review history in anki21b parsed output", async () => {
      const db = await createAnki21bDatabase();

      // Create revlog table (exists in anki21b databases)
      db.run(`
        CREATE TABLE revlog (
          id INTEGER PRIMARY KEY,
          cid INTEGER NOT NULL,
          usn INTEGER NOT NULL,
          ease INTEGER NOT NULL,
          ivl INTEGER NOT NULL,
          lastIvl INTEGER NOT NULL,
          factor INTEGER NOT NULL,
          time INTEGER NOT NULL,
          type INTEGER NOT NULL
        );
      `);

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Basic", config: { css: "", kind: 0 } },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Back", config: { fontName: "Arial", fontSize: 20 } },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "Hello", Back: "World" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      // Insert review history
      db.run(
        `INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
         VALUES (1617000000000, 1000, 0, 3, 1, 0, 2500, 5000, 0)`,
      );
      db.run(
        `INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
         VALUES (1617100000000, 1000, 0, 4, 10, 1, 2600, 3000, 1)`,
      );

      const result = getDataFromAnki21b(db) as Record<string, unknown>;

      expect(result).toHaveProperty("revlog");
      const revlog = result.revlog as Array<Record<string, unknown>>;
      expect(revlog).toHaveLength(2);
      expect(revlog[0]).toMatchObject({ cid: 1000, ease: 3, type: 0 });
      expect(revlog[1]).toMatchObject({ cid: 1000, ease: 4, type: 1 });
    });
  });

  /**
   * Issue #15: FSRS data in anki2 is parsed as JSON, but modern Anki uses protobuf
   *
   * The card.data field in modern Anki (23.10+) stores FSRS memory state as
   * protobuf (FSRSMemoryState message with stability/difficulty floats),
   * not JSON with {s, d, dr} keys.
   *
   * Source: rslib/src/scheduler/fsrs/memory_state.rs — FSRSMemoryState protobuf
   */
  describe("#15 - FSRS data should handle protobuf format", () => {
    it("should parse protobuf-encoded FSRS memory state from card.data", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
        },
      ];

      const notes: Anki2Note[] = [
        { id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } },
      ];

      insertAnki2Data(db, models, notes);

      // Construct a protobuf-encoded FSRSMemoryState
      // FSRSMemoryState { stability: float (field 1), difficulty: float (field 2) }
      // Protobuf float encoding: tag byte + 4 bytes little-endian IEEE 754
      const stability = 12.5;
      const difficulty = 5.2;
      const buf = new ArrayBuffer(10);
      const view = new DataView(buf);
      // Field 1 (stability), wire type 5 (32-bit): tag = (1 << 3) | 5 = 0x0D
      view.setUint8(0, 0x0d);
      view.setFloat32(1, stability, true); // little-endian
      // Field 2 (difficulty), wire type 5 (32-bit): tag = (2 << 3) | 5 = 0x15
      view.setUint8(5, 0x15);
      view.setFloat32(6, difficulty, true);
      const protobufData = new Uint8Array(buf);

      // Update card.data with protobuf bytes
      db.run(`UPDATE cards SET data = ? WHERE id = 1000`, [protobufData]);

      const result = getDataFromAnki2(db);
      const scheduling = result.cards[0]?.scheduling;

      // Should parse protobuf FSRS data, not just JSON
      expect(scheduling?.fsrs).not.toBeNull();
      expect(scheduling?.fsrs?.stability).toBeCloseTo(12.5, 1);
      expect(scheduling?.fsrs?.difficulty).toBeCloseTo(5.2, 1);
    });
  });

  /**
   * Issue #13 (anki21b guid): anki21b cards don't include guid
   *
   * The anki2 parser includes guid in card output, but anki21b does not.
   * GUIDs are needed for deduplication on import.
   *
   * Source: rslib/src/import_export/package/apkg/import/notes.rs
   */
  describe("#13b - anki21b cards should include guid", () => {
    it("should expose guid in anki21b parsed card data", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Basic", config: { css: "", kind: 0 } },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Back", config: { fontName: "Arial", fontSize: 20 } },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "Hello", Back: "World" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      // Update the guid to a known value
      db.run(`UPDATE notes SET guid = 'abc123xyz' WHERE id = 1`);

      const result = getDataFromAnki21b(db);
      const card = result.cards[0] as Record<string, unknown>;

      expect(card).toHaveProperty("guid", "abc123xyz");
    });
  });

  /**
   * Issue #12: latexSvg flag not parsed in anki2 model schema
   *
   * The `latexsvg` boolean from the model JSON is not parsed by jsonParsers.ts.
   * When true, Anki renders LaTeX to SVG instead of PNG.
   *
   * Source: rslib/src/notetype/mod.rs — Notetype struct
   */
  describe("#12 - anki2 model schema should parse latexSvg", () => {
    it("should include latexSvg in parsed model data", async () => {
      const db = await createAnki2Database();

      // Manually insert col with latexsvg field in model JSON
      const modelsJson = JSON.stringify({
        "1": {
          id: "1",
          css: "",
          latexPre: "\\documentclass{article}",
          latexPost: "\\end{document}",
          latexsvg: true,
          flds: [{ name: "Front" }, { name: "Back" }],
          tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
        },
      });
      const decksJson = JSON.stringify({ "1": { id: 1, name: "Default" } });

      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [modelsJson, decksJson],
      );

      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, '', 'Hello\x1FWorld', '', 0, 0, '')`,
      );
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      expect(result.cards).toHaveLength(1);

      // The parsed card should expose the latexSvg flag from the model
      // Currently jsonParsers.ts doesn't parse the `latexsvg` field at all
      const card = result.cards[0] as Record<string, unknown>;
      expect(card).toHaveProperty("latexSvg", true);
    });
  });

  /**
   * Issue #6: Cloze conditional sections {{#c1}}...{{/c1}}
   *
   * In Anki, conditionals can reference cloze numbers like {{#c1}}...{{/c1}}.
   * This is truthy if cloze 1 exists in the note. The current implementation
   * only checks variables[section], which won't have cloze-number keys.
   *
   * Source: rslib/src/card_rendering/render.rs — cloze conditional handling
   */
  describe("#6 - cloze conditional sections should work", () => {
    it("should treat {{#c1}} as truthy when cloze 1 exists", async () => {
      const { getRenderedCardString } = await import("../../utils/render");

      const variables = {
        Text: "{{c1::Paris}} is the capital of {{c2::France}}",
      };

      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}{{#c1}}<div>Hint for cloze 1</div>{{/c1}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
      });

      // {{#c1}} should be truthy since c1 exists in the note
      expect(html).toContain("Hint for cloze 1");
    });

    it("should treat {{#c3}} as falsy when cloze 3 doesn't exist", async () => {
      const { getRenderedCardString } = await import("../../utils/render");

      const variables = {
        Text: "{{c1::Paris}} is the capital of {{c2::France}}",
      };

      const html = getRenderedCardString({
        templateString: "{{cloze:Text}}{{#c3}}<div>This should not show</div>{{/c3}}",
        variables,
        mediaFiles: new Map(),
        cardOrd: 0,
      });

      // {{#c3}} should be falsy since c3 doesn't exist
      expect(html).not.toContain("This should not show");
    });
  });
});
