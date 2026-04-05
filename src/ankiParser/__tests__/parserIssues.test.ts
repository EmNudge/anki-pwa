/**
 * Tests demonstrating correctness issues in the Anki parsers,
 * cross-referenced against the Anki source (ankitects/anki).
 *
 * Each test documents the issue number from the audit and describes
 * what the correct behavior should be per the Anki source.
 *
 * All tests in this file are EXPECTED TO FAIL against the current implementation.
 */
import { describe, it, expect } from "vitest";
import { getDataFromAnki2 } from "../anki2";
import { getDataFromAnki21b } from "../anki21b";
import {
  createAnki2Database,
  createAnki21bDatabase,
  insertAnki21bData,
  type Anki21bNotetype,
  type Anki21bField,
  type Anki21bTemplate,
  type Anki21bNote,
} from "./testUtils";

describe("Parser Issues (expected to fail)", () => {
  /**
   * Issue #1: Tags parsed incorrectly in anki2 parser
   *
   * Anki stores tags as SPACE-delimited text in notes.tags (e.g. "vocabulary spanish").
   * The parser splits on \x1F instead of spaces, so multi-word tags come back as a
   * single concatenated string.
   *
   * Source: rslib/src/notes.rs — tags are stored space-separated.
   */
  describe("#1 - anki2 tags should be space-delimited", () => {
    it("should parse space-delimited tags correctly", async () => {
      const db = await createAnki2Database();

      // Insert col data
      const colData = {
        models: JSON.stringify({
          "1": {
            id: "1",
            css: "",
            latexPre: "",
            latexPost: "",
            flds: [{ name: "Front" }, { name: "Back" }],
            tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
          },
        }),
        decks: JSON.stringify({ "1": { id: 1, name: "Default" } }),
      };
      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [colData.models, colData.decks],
      );

      // Insert note with SPACE-delimited tags (the correct Anki format)
      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, ' vocabulary spanish ', 'Hola\x1FHello', '', 0, 0, '')`,
      );
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      // Tags should be split on spaces, with leading/trailing spaces trimmed
      expect(result.cards[0]?.tags).toEqual(["vocabulary", "spanish"]);
    });
  });

  /**
   * Issue #1b: Tags completely discarded in anki21b parser
   *
   * The anki21b parser hardcodes `tags: []` for every card, ignoring the
   * notes.tags column entirely.
   *
   * Source: anki21b/index.ts:122
   */
  describe("#1b - anki21b tags should not be discarded", () => {
    it("should preserve tags from anki21b notes", async () => {
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
        {
          id: 1,
          mid: "1",
          tags: ["vocabulary", "french"],
          fields: { Front: "Bonjour", Back: "Hello" },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      // Fix the tags to be space-delimited (correct Anki format)
      db.run(`UPDATE notes SET tags = ' vocabulary french ' WHERE id = 1`);

      const result = getDataFromAnki21b(db);

      // Tags should NOT be empty — they should be parsed from the notes table
      expect(result.cards[0]?.tags).toEqual(["vocabulary", "french"]);
    });
  });

  /**
   * Issue #5: Notes ≠ Cards conflation
   *
   * A single note with a "Basic (and reversed card)" notetype generates
   * TWO cards (ord=0 and ord=1). The parser treats each note as one card,
   * losing the card-per-template relationship.
   *
   * Source: rslib/src/card_rendering/mod.rs — one card per template ordinal.
   */
  describe("#5 - notes should produce multiple cards per template", () => {
    it("should produce one card per template ordinal in anki2", async () => {
      const db = await createAnki2Database();

      const colData = {
        models: JSON.stringify({
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
          },
        }),
        decks: JSON.stringify({ "1": { id: 1, name: "Default" } }),
      };
      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [colData.models, colData.decks],
      );

      // One note
      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, '', 'Cat\x1FGato', '', 0, 0, '')`,
      );

      // TWO cards for this note (ord=0 forward, ord=1 reverse)
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1001, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      // Should produce 2 cards (one per template), not 1 card with 2 templates
      expect(result.cards).toHaveLength(2);

      // Card 0 should use the Forward template (ord=0)
      expect(result.cards[0]?.templates).toHaveLength(1);
      expect(result.cards[0]?.templates[0]?.qfmt).toBe("{{Front}}");

      // Card 1 should use the Reverse template (ord=1)
      expect(result.cards[1]?.templates).toHaveLength(1);
      expect(result.cards[1]?.templates[0]?.qfmt).toBe("{{Back}}");
    });

    it("should produce one card per template ordinal in anki21b", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Basic (and reversed)", config: { css: "", kind: 0 } },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Back", config: { fontName: "Arial", fontSize: 20 } },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Forward", qFormat: "{{Front}}", aFormat: "{{Back}}" },
        { ntid: "1", ord: 1, name: "Reverse", qFormat: "{{Back}}", aFormat: "{{Front}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "Cat", Back: "Gato" } },
      ];

      // insertAnki21bData now creates one card per template automatically
      insertAnki21bData(db, notetypes, fields, templates, notes);

      const result = getDataFromAnki21b(db);

      // Should produce 2 cards, not 1
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]?.templates).toHaveLength(1);
      expect(result.cards[1]?.templates).toHaveLength(1);
    });
  });

  /**
   * Issue #11: Filtered deck handling missing
   *
   * When a card is in a filtered deck, its `did` points to the filtered deck
   * and `odid` stores the original (home) deck. The parser should use `odid`
   * when non-zero.
   *
   * Source: rslib/src/decks/filtered.rs
   */
  describe("#11 - filtered deck cards should resolve to home deck", () => {
    it("should use odid for cards in filtered decks", async () => {
      const db = await createAnki2Database();

      const colData = {
        models: JSON.stringify({
          "1": {
            id: "1",
            css: "",
            latexPre: "",
            latexPost: "",
            flds: [{ name: "Front" }, { name: "Back" }],
            tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
          },
        }),
        decks: JSON.stringify({
          "1": { id: 1, name: "Spanish" },
          "2": { id: 2, name: "Filtered::Cram" },
        }),
      };
      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [colData.models, colData.decks],
      );

      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, '', 'Hola\x1FHello', '', 0, 0, '')`,
      );

      // Card is in filtered deck (did=2) but home deck is Spanish (odid=1)
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 2, 0, 0, 0, 2, 2, 100, 30, 2500, 10, 2, 0, 100, 1, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      // Card should be assigned to home deck "Spanish", not "Filtered::Cram"
      expect(result.cards[0]?.deckName).toBe("Spanish");
    });
  });

  /**
   * Issue #10: card.data JSON (FSRS state) not parsed
   *
   * Modern Anki stores FSRS scheduling state in cards.data as JSON:
   * {"s": 12.5, "d": 5.2, "dr": 0.9}
   *
   * The parser should extract this so the app can import FSRS state.
   *
   * Source: rslib/src/scheduler/fsrs/memory_state.rs
   */
  describe("#10 - FSRS card.data should be parsed", () => {
    it("should extract FSRS memory state from card.data JSON", async () => {
      const db = await createAnki2Database();

      const colData = {
        models: JSON.stringify({
          "1": {
            id: "1",
            css: "",
            latexPre: "",
            latexPost: "",
            flds: [{ name: "Front" }, { name: "Back" }],
            tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
          },
        }),
        decks: JSON.stringify({ "1": { id: 1, name: "Default" } }),
      };
      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [colData.models, colData.decks],
      );

      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, '', 'Hello\x1FHola', '', 0, 0, '')`,
      );

      // Card with FSRS data in the data column
      const fsrsData = JSON.stringify({ s: 12.5, d: 5.2, dr: 0.9 });
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 2, 2, 100, 30, 2500, 10, 2, 0, 0, 0, 0, ?)`,
        [fsrsData],
      );

      const result = getDataFromAnki2(db);

      // Cards should expose scheduling data including FSRS state
      const card = result.cards[0] as Record<string, unknown>;
      expect(card).toHaveProperty("scheduling");
      const scheduling = card.scheduling as Record<string, unknown>;
      expect(scheduling).toMatchObject({
        type: 2, // review
        queue: 2,
        due: 100,
        ivl: 30,
        factor: 2500,
        reps: 10,
        lapses: 2,
        fsrs: { stability: 12.5, difficulty: 5.2, desiredRetention: 0.9 },
      });
    });
  });

  /**
   * Issue #17: Field ordering not guaranteed in anki21b
   *
   * Fields are filtered by ntid but not sorted by `ord`. If the database
   * returns fields in a different order than their ordinal, values get
   * mapped to the wrong field names.
   *
   * Source: rslib/src/notetype/mod.rs — fields are always ordered by ord.
   */
  describe("#17 - anki21b fields must be ordered by ord", () => {
    it("should map field values correctly even when DB returns fields out of order", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "ThreeField", config: { css: "", kind: 0 } },
      ];

      // Insert fields OUT OF ORD ORDER intentionally
      // We insert ord=2 first, then ord=0, then ord=1
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 2, name: "Extra", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 0, name: "Front", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Back", config: { fontName: "Arial", fontSize: 20 } },
      ];

      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}\n{{Extra}}" },
      ];

      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          // flds will be stored as "Hello\x1FWorld\x1FBonus" (ord 0, 1, 2)
          fields: { Front: "Hello", Back: "World", Extra: "Bonus" },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);
      const result = getDataFromAnki21b(db);

      // Field values must be mapped by ordinal, not insertion order
      expect(result.cards[0]?.values).toEqual({
        Front: "Hello",
        Back: "World",
        Extra: "Bonus",
      });
    });
  });

  /**
   * Issue #9: revlog table ignored
   *
   * The revlog table stores complete review history. For importing scheduling
   * state or showing statistics, this data is essential.
   *
   * Source: rslib/src/revlog/mod.rs
   */
  describe("#9 - revlog table should be accessible", () => {
    it("should include review history in parsed output", async () => {
      const db = await createAnki2Database();

      // Add revlog table
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

      const colData = {
        models: JSON.stringify({
          "1": {
            id: "1",
            css: "",
            latexPre: "",
            latexPost: "",
            flds: [{ name: "Front" }, { name: "Back" }],
            tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
          },
        }),
        decks: JSON.stringify({ "1": { id: 1, name: "Default" } }),
      };
      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [colData.models, colData.decks],
      );

      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'guid1', '1', 0, 0, '', 'Hello\x1FWorld', '', 0, 0, '')`,
      );
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 2, 2, 100, 30, 2500, 10, 2, 0, 0, 0, 0, '')`,
      );

      // Insert review history
      db.run(`INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
              VALUES (1617000000000, 1000, 0, 3, 1, 0, 2500, 5000, 0)`);
      db.run(`INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
              VALUES (1617100000000, 1000, 0, 3, 10, 1, 2500, 3000, 1)`);

      const result = getDataFromAnki2(db) as Record<string, unknown>;

      // The parsed result should include review log data
      expect(result).toHaveProperty("revlog");
      const revlog = result.revlog as Array<Record<string, unknown>>;
      expect(revlog).toHaveLength(2);
      expect(revlog[0]).toMatchObject({ cid: 1000, ease: 3 });
    });
  });

  /**
   * Issue #15: No guid or csum for deduplication
   *
   * Anki uses notes.guid for global uniqueness. Without it, re-importing
   * the same deck creates duplicates.
   *
   * Source: rslib/src/import_export/package/apkg/import/notes.rs
   */
  describe("#15 - notes should include guid for dedup", () => {
    it("should expose guid in parsed card data", async () => {
      const db = await createAnki2Database();

      const colData = {
        models: JSON.stringify({
          "1": {
            id: "1",
            css: "",
            latexPre: "",
            latexPost: "",
            flds: [{ name: "Front" }, { name: "Back" }],
            tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
          },
        }),
        decks: JSON.stringify({ "1": { id: 1, name: "Default" } }),
      };
      db.run(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
        [colData.models, colData.decks],
      );

      db.run(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (1, 'abc123xyz', '1', 0, 0, '', 'Hello\x1FWorld', '', 0, 0, '')`,
      );
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (1000, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );

      const result = getDataFromAnki2(db);

      // Each card should carry the note's guid for deduplication
      const card = result.cards[0] as Record<string, unknown>;
      expect(card).toHaveProperty("guid", "abc123xyz");
    });
  });

  /**
   * Issue #12: Media protobuf index assumption is fragile
   *
   * The parser assumes protobuf media entries are sequential (0, 1, 2...)
   * but should use the actual index field from the proto message.
   * If entries are out of order, the mapping breaks.
   */
  describe("#12 - media proto should use index field, not sequential counter", () => {
    it("should use the protobuf index field for media mapping", async () => {
      // This is tested indirectly — the parseMediaProto function assumes
      // sequential ordering. We construct a proto where entry order doesn't
      // match the index field.
      const { parseMediaProto } = await import("../parseMediaProto");

      // Manually construct a protobuf with entries whose index field (field 2)
      // doesn't match their position in the message.
      // Entry 1: filename="second.jpg", index=1
      // Entry 2: filename="first.jpg", index=0
      // (reversed order — index 1 comes before index 0 in the proto)
      const encoder = new TextEncoder();

      function encodeVarint(value: number): number[] {
        const bytes: number[] = [];
        while (value > 0x7f) {
          bytes.push((value & 0x7f) | 0x80);
          value >>>= 7;
        }
        bytes.push(value & 0x7f);
        return bytes;
      }

      function encodeEntry(filename: string, index: number): Uint8Array {
        const filenameBytes = encoder.encode(filename);
        // field 1 (filename): tag=0x0a, length, data
        // field 2 (index): tag=0x10, varint
        const inner = [
          0x0a,
          ...encodeVarint(filenameBytes.length),
          ...filenameBytes,
          0x10,
          ...encodeVarint(index),
        ];
        return new Uint8Array(inner);
      }

      const entry1 = encodeEntry("second.jpg", 1);
      const entry2 = encodeEntry("first.jpg", 0);

      // Wrap each entry as field 1 of the outer message
      const buffer = new Uint8Array([
        0x0a,
        ...encodeVarint(entry1.length),
        ...entry1,
        0x0a,
        ...encodeVarint(entry2.length),
        ...entry2,
      ]);

      const result = parseMediaProto(buffer);

      // The mapping should use the index field, not positional order
      // ZIP entry "0" should map to "first.jpg" (index=0)
      // ZIP entry "1" should map to "second.jpg" (index=1)
      expect(result["0"]).toBe("first.jpg");
      expect(result["1"]).toBe("second.jpg");
    });
  });
});
