/**
 * Tests for parser gaps identified by cross-referencing with the Anki source
 * (ankitects/anki via deepwiki.com).
 *
 * All tests in this file are EXPECTED TO FAIL against the current implementation,
 * demonstrating where the parser diverges from real Anki behavior.
 */
import { describe, it, expect, vi } from "vitest";
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip-js/zip-js";
import { getDataFromAnki2 } from "../anki2";
import { getDataFromAnki21b } from "../anki21b";
import { getAnkiDataFromBlob } from "..";
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

vi.mock("../../utils/zstd", () => ({
  decompressZstd: async (data: Uint8Array) => data,
}));

async function buildAnki2ApkgBlob() {
  const db = await createAnki2Database();

  const models: Anki2Model[] = [
    {
      id: "1",
      css: ".card { color: black; }",
      latexPre: "\\documentclass{article}\\begin{document}",
      latexPost: "\\end{document}",
      fields: [{ name: "Front" }, { name: "Back" }],
      templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
    },
  ];
  const notes: Anki2Note[] = [
    { id: 1, modelId: "1", tags: ["runtime"], fields: { Front: "Hello", Back: "World" } },
  ];

  insertAnki2Data(db, models, notes);
  db.run(`UPDATE col SET crt = 1704067200 WHERE id = 1`);

  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
  await zipWriter.add("collection.anki2", new Uint8ArrayReader(db.export()));
  await zipWriter.add("media", new TextReader("{}"));

  return zipWriter.close();
}

describe("Parser Gaps (expected to fail)", () => {
  describe("#23 - anki21b should apply req filtering like anki2", () => {
    it("should filter blank reverse cards using notetype reqs", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Basic (and reversed card)",
          config: {
            css: "",
            kind: 0,
            reqs: [
              { kind: 1, fieldOrds: [0] },
              { kind: 1, fieldOrds: [1] },
            ],
          },
        },
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
        { id: 1, mid: "1", tags: [], fields: { Front: "Question", Back: "" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      const result = getDataFromAnki21b(db);
      const templateNames = result.cards.map((card) => card.templates[0]?.name);

      expect(templateNames).toEqual(["Forward"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #1: Missing card queue states 3 (day-learning), 4 (preview),
  //           and -3 (scheduler-buried)
  //
  // Anki defines queue values: 0=new, 1=learning, 2=review,
  // 3=day-learning, 4=preview, -1=suspended, -2=user-buried,
  // -3=scheduler-buried.
  //
  // The parser stores raw numbers but the CardScheduling type doesn't
  // document or validate these extended states.
  //
  // Source: rslib/src/card/mod.rs — CardQueue enum
  // ─────────────────────────────────────────────────────────────────────
  describe("#1 - card queue states should be semantically typed", () => {
    it("should expose queue as a typed enum, not just a raw number", async () => {
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

      // Set card to day-learning state (queue=3)
      db.run(`UPDATE cards SET queue = 3, type = 1, due = 19000 WHERE id = 1000`);

      const result = getDataFromAnki2(db);
      const scheduling = result.cards[0]?.scheduling;

      // The scheduling data should include a human-readable queue name
      // or at minimum document that queue=3 means "day-learning"
      // Currently it's a raw number with no enum/type narrowing
      expect(scheduling).not.toBeNull();

      // The CardScheduling type should have a queueName or similar
      // that maps -3=schedulerBuried, -2=userBuried, -1=suspended,
      // 0=new, 1=learning, 2=review, 3=dayLearning, 4=preview
      const card = result.cards[0] as Record<string, unknown>;
      const sched = card.scheduling as Record<string, unknown>;
      expect(sched).toHaveProperty("queueName", "dayLearning");
    });

    it("should distinguish all buried states with typed names", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            { name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 },
            { name: "Card 2", qfmt: "{{Back}}", afmt: "{{Front}}", ord: 1 },
          ],
        },
      ];
      const notes: Anki2Note[] = [
        { id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "World" } },
      ];

      insertAnki2Data(db, models, notes);

      db.run(`UPDATE cards SET queue = -2 WHERE id = 1000`);
      db.run(`UPDATE cards SET queue = -3 WHERE id = 1001`);

      const result = getDataFromAnki2(db);
      const schedules = result.cards.map(
        (c) => (c as Record<string, unknown>).scheduling as Record<string, unknown>,
      );

      // Should have distinct named states
      const queueNames = schedules.map((s) => s.queueName);
      expect(queueNames).toContain("userBuried");
      expect(queueNames).toContain("schedulerBuried");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #2: Missing card type 3 (relearning)
  //
  // Anki card types: 0=new, 1=learning, 2=review, 3=relearning.
  // Relearning means a review card that was lapsed and is being relearned.
  //
  // Source: rslib/src/card/mod.rs — CardType enum
  // ─────────────────────────────────────────────────────────────────────
  describe("#2 - card type 3 (relearning) should be semantically typed", () => {
    it("should expose type as a typed enum with relearning state", async () => {
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

      // Set card to relearning state: type=3
      db.run(
        `UPDATE cards SET type = 3, queue = 1, ivl = 30, factor = 2500, reps = 15, lapses = 3, due = 1700000000 WHERE id = 1000`,
      );

      const result = getDataFromAnki2(db);
      const card = result.cards[0] as Record<string, unknown>;
      const scheduling = card.scheduling as Record<string, unknown>;

      // The CardScheduling type should have a typeName that maps
      // 0=new, 1=learning, 2=review, 3=relearning
      expect(scheduling).toHaveProperty("typeName", "relearning");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #3: `due` field interpretation varies by queue — col.crt needed
  //
  // For review cards, `due` is days since collection creation (col.crt).
  // For learning cards, `due` is an epoch timestamp.
  // For new cards, `due` is a position integer.
  // Without col.crt, review due dates cannot be converted to real dates.
  //
  // Source: rslib/src/card/mod.rs — due field semantics
  // ─────────────────────────────────────────────────────────────────────
  describe("#3 - col.crt should be extracted for due date interpretation", () => {
    it("should expose collection creation time for due date calculation", async () => {
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

      // Set crt (collection creation time) to a known epoch
      const crt = 1577836800; // 2020-01-01 00:00:00 UTC
      db.run(`UPDATE col SET crt = ? WHERE id = 1`, [crt]);

      // Set card as review (type=2, queue=2) with due = 365 (days since crt)
      // Real due date = 2020-01-01 + 365 days = 2021-01-01
      db.run(`UPDATE cards SET type = 2, queue = 2, due = 365, ivl = 30 WHERE id = 1000`);

      const result = getDataFromAnki2(db) as Record<string, unknown>;

      // The parser should expose crt so consumers can compute actual due dates
      expect(result).toHaveProperty("collectionCreationTime");
      expect(result.collectionCreationTime).toBe(crt);
    });

    it("should expose crt in anki21b format too", async () => {
      const db = await createAnki21bDatabase();

      // anki21b stores crt in a config table or col table
      // Add a col table with crt
      db.run(`
        CREATE TABLE IF NOT EXISTS col (
          id INTEGER PRIMARY KEY,
          crt INTEGER NOT NULL
        )
      `);
      db.run(`INSERT INTO col (id, crt) VALUES (1, 1577836800)`);

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

      const result = getDataFromAnki21b(db) as Record<string, unknown>;

      expect(result).toHaveProperty("collectionCreationTime");
      expect(result.collectionCreationTime).toBe(1577836800);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #8: anki21b cards missing noteType/kind, latexSvg, and req
  //
  // The anki2 parser includes noteType, latexSvg, and req on each card.
  // The anki21b parser doesn't thread these through from notesTypes.
  // This means consumers can't detect cloze, use SVG latex, or filter
  // blank cards for anki21b format.
  //
  // Source: rslib/src/notetype/mod.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#8 - anki21b cards should include noteType, latexSvg, req", () => {
    it("should include noteType (kind) on anki21b cards", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Cloze", config: { css: "", kind: 1 } }, // kind=1 is cloze
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Text", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Extra", config: { fontName: "Arial", fontSize: 20 } },
      ];
      const templates: Anki21bTemplate[] = [
        {
          ntid: "1",
          ord: 0,
          name: "Cloze",
          qFormat: "{{cloze:Text}}",
          aFormat: "{{cloze:Text}}<br>{{Extra}}",
        },
      ];
      const notes: Anki21bNote[] = [
        {
          id: 1,
          mid: "1",
          tags: [],
          fields: { Text: "{{c1::Paris}} is the capital of {{c2::France}}", Extra: "" },
        },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      const result = getDataFromAnki21b(db);
      const card = result.cards[0] as Record<string, unknown>;

      // anki21b card should expose noteType/kind for cloze detection
      expect(card).toHaveProperty("noteType", 1);
    });

    it("should include latexSvg on anki21b cards", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Math", config: { css: "", kind: 0, latexSvg: true } },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: { fontName: "Arial", fontSize: 20 } },
        { ntid: "1", ord: 1, name: "Back", config: { fontName: "Arial", fontSize: 20 } },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "[$]x^2[/$]", Back: "x squared" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      const result = getDataFromAnki21b(db);
      const card = result.cards[0] as Record<string, unknown>;

      expect(card).toHaveProperty("latexSvg", true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #9: Blank card filtering via req not implemented
  //
  // The req array specifies which fields must be non-empty for each card
  // ordinal. Cards that don't meet requirements should be filtered out
  // (or at minimum, the req data should be exposed so consumers can filter).
  //
  // Source: rslib/src/card_rendering/mod.rs — card_gen_requires
  // ─────────────────────────────────────────────────────────────────────
  describe("#9 - blank card filtering via req", () => {
    it("should filter or flag cards that don't meet req requirements", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          req: [
            [0, "any", [0]], // Card 0 requires field 0 (Front)
            [1, "any", [1]], // Card 1 requires field 1 (Back)
          ],
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            { name: "Forward", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 },
            { name: "Reverse", qfmt: "{{Back}}", afmt: "{{Front}}", ord: 1 },
          ],
        },
      ];

      // Note with Front filled, Back empty
      const notes: Anki2Note[] = [
        { id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "" } },
      ];

      insertAnki2Data(db, models, notes);

      // insertAnki2Data creates cards for both templates.
      // Anki would normally not create the Reverse card since Back is empty.
      // The parser should filter it based on req.
      const result = getDataFromAnki2(db);

      // With req filtering, only the Forward card (ord=0) should remain
      // because Back (field 1) is empty and Reverse requires it
      const forwardCards = result.cards.filter(
        (c) => c.templates[0]?.name === "Forward",
      );
      const reverseCards = result.cards.filter(
        (c) => c.templates[0]?.name === "Reverse",
      );

      expect(forwardCards).toHaveLength(1);
      // This is the assertion that should fail — reverse card should be filtered
      expect(reverseCards).toHaveLength(0);
    });

    it("should handle 'all' req mode (all listed fields must be non-empty)", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "",
          latexPost: "",
          req: [
            [0, "all", [0, 1]], // Card 0 requires BOTH field 0 AND field 1
          ],
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [
            { name: "Card 1", qfmt: "{{Front}} - {{Back}}", afmt: "{{Back}}", ord: 0 },
          ],
        },
      ];

      // Only Front is filled, Back is empty
      const notes: Anki2Note[] = [
        { id: 1, modelId: "1", tags: [], fields: { Front: "Hello", Back: "" } },
      ];

      insertAnki2Data(db, models, notes);

      const result = getDataFromAnki2(db);

      // With "all" mode, both fields must be non-empty. Back is empty → no card.
      expect(result.cards).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #16: desiredRetention hardcoded to 0.9
  //
  // FSRS desired_retention is per-deck, stored in deck_config protobuf.
  // The parser hardcodes 0.9 instead of reading from deck config.
  //
  // Source: rslib/src/scheduler/fsrs/params.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#16 - desiredRetention should come from deck config", () => {
    it("should read desiredRetention from deck_config, not hardcode 0.9", async () => {
      const db = await createAnki2Database();

      // Create deck_config table
      db.run(`
        CREATE TABLE IF NOT EXISTS deck_config (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          mtime_secs INTEGER NOT NULL,
          usn INTEGER NOT NULL,
          config BLOB NOT NULL
        )
      `);

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

      // FSRS data without dr (desired retention)
      const fsrsData = JSON.stringify({ s: 15.0, d: 4.5 });
      db.run(`UPDATE cards SET data = ? WHERE id = 1000`, [fsrsData]);

      const result = getDataFromAnki2(db);
      const scheduling = result.cards[0]?.scheduling;

      // Without dr in card data, should fall back to deck config, not hardcode 0.9
      // A correct implementation would parse deck_config and use its desired_retention
      expect(scheduling?.fsrs).not.toBeNull();
      // The desiredRetention should NOT be the hardcoded 0.9 but should come from
      // deck_config. Since we haven't inserted a deck_config with a specific value,
      // test that the parser at least attempts to read from deck_config.
      // For this test, we verify the parser exposes deck config data.
      const resultObj = result as Record<string, unknown>;
      expect(resultObj).toHaveProperty("deckConfigs");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #8 (continued): anki21b exported data missing noteType/latexSvg/req
  // in the top-level AnkiData type
  //
  // getAnkiDataFromBlob discards notesTypes for anki21b — the main
  // AnkiData return type doesn't include it.
  //
  // Source: comparison of AnkiDB2Data vs AnkiDB21bData card shapes
  // ─────────────────────────────────────────────────────────────────────
  describe("#8b - AnkiData should have consistent card shape across formats", () => {
    it("anki2 and anki21b cards should have the same fields", async () => {
      // Create anki2 card
      const db2 = await createAnki2Database();
      const models: Anki2Model[] = [
        {
          id: "1",
          css: ".card {}",
          latexPre: "\\documentclass{article}",
          latexPost: "\\end{document}",
          type: 1,
          latexsvg: true,
          req: [[0, "any", [0]]],
          fields: [{ name: "Text" }],
          templates: [
            { name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}", ord: 0 },
          ],
        },
      ];
      const notes2: Anki2Note[] = [
        { id: 1, modelId: "1", tags: ["test"], fields: { Text: "{{c1::answer}}" } },
      ];
      insertAnki2Data(db2, models, notes2);
      const result2 = getDataFromAnki2(db2);
      const card2Keys = Object.keys(result2.cards[0]!).sort();

      // Create anki21b card
      const db21b = await createAnki21bDatabase();
      const notetypes: Anki21bNotetype[] = [
        { id: "1", name: "Cloze", config: { css: ".card {}", kind: 1, latexSvg: true } },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Text", config: {} },
      ];
      const templates21b: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Cloze", qFormat: "{{cloze:Text}}", aFormat: "{{cloze:Text}}" },
      ];
      const notes21b: Anki21bNote[] = [
        { id: 1, mid: "1", tags: ["test"], fields: { Text: "{{c1::answer}}" } },
      ];
      insertAnki21bData(db21b, notetypes, fields, templates21b, notes21b);
      const result21b = getDataFromAnki21b(db21b);
      const card21bKeys = Object.keys(result21b.cards[0]!).sort();

      // Both formats should produce cards with the same set of keys
      // anki2 now has noteData, csum, sfld which anki21b doesn't have yet
      // Check that anki21b has at least the core fields
      const coreKeys = ["values", "tags", "templates", "css", "deckName", "guid", "scheduling", "noteType", "latexSvg", "latexPre", "req"];
      for (const key of coreKeys) {
        expect(card21bKeys).toContain(key);
        expect(card2Keys).toContain(key);
      }
      // The remaining difference is noteData, csum, sfld (anki2-only for now)
      const anki2Only = card2Keys.filter((k) => !card21bKeys.includes(k));
      expect(anki2Only.sort()).toEqual(["csum", "noteData", "sfld"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #10: Media filename 120-byte limit not handled
  //
  // Anki truncates media filenames to 120 bytes. If an exported deck
  // has truncated filenames, lookups could fail.
  //
  // Source: rslib/src/media/files.rs — MAX_FILENAME_LENGTH = 120
  // ─────────────────────────────────────────────────────────────────────
  describe("#10 - media filename normalization should truncate to 120 bytes", () => {
    it("should match media files with truncated filenames to long references", async () => {
      // In the renderer, replaceMediaFiles should handle the case where
      // the template references a long filename but the media map has
      // the Anki-truncated version (120 bytes max).
      // This can't be fully tested at the parser level, but we can verify
      // that the renderer's media matching handles truncation.
      const { getRenderedCardString } = await import("../../utils/render");

      const longName = "a".repeat(150) + ".png"; // 154 chars, over 120 limit
      const truncatedName = "a".repeat(116) + ".png"; // 120 chars (Anki's limit)

      const variables = {
        Front: `<img src="${longName}">`,
      };

      // Media map has the truncated name
      const mediaFiles = new Map([[truncatedName, "blob:http://localhost/img1"]]);

      const html = getRenderedCardString({
        templateString: "{{Front}}",
        variables,
        mediaFiles,
      });

      // The renderer should match the long reference to the truncated media file
      expect(html).toContain("blob:http://localhost/img1");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #3 (supplement): anki21b FSRS data may be protobuf, not JSON
  //
  // The anki21b parser only tries JSON.parse on card.data. Modern Anki
  // may store FSRS state as protobuf in anki21b databases too.
  //
  // Source: rslib/src/scheduler/fsrs/memory_state.rs
  // ─────────────────────────────────────────────────────────────────────
  describe("#3b - anki21b should handle protobuf FSRS data", () => {
    it("should parse protobuf FSRS data in anki21b cards", async () => {
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

      // Construct protobuf-encoded FSRSMemoryState
      const stability = 10.0;
      const difficulty = 6.0;
      const buf = new ArrayBuffer(10);
      const view = new DataView(buf);
      view.setUint8(0, 0x0d); // field 1, wire type 5 (32-bit)
      view.setFloat32(1, stability, true);
      view.setUint8(5, 0x15); // field 2, wire type 5 (32-bit)
      view.setFloat32(6, difficulty, true);
      const protobufData = new Uint8Array(buf);

      // Update card.data with protobuf bytes
      db.run(`UPDATE cards SET type = 2, queue = 2, data = ? WHERE id = 1000`, [protobufData]);

      const result = getDataFromAnki21b(db);
      const scheduling = result.cards[0]?.scheduling;

      expect(scheduling).not.toBeNull();
      expect(scheduling?.fsrs).not.toBeNull();
      expect(scheduling?.fsrs?.stability).toBeCloseTo(10.0, 1);
      expect(scheduling?.fsrs?.difficulty).toBeCloseTo(6.0, 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Issue #8c: anki21b notesTypes not included in main AnkiData
  //
  // getAnkiDataFromBlob destructures only { cards, deckName, decks }
  // from anki21b, discarding notesTypes entirely. Consumers can't
  // access latexPre, latexPost, kind, etc.
  //
  // Source: comparison of index.ts getAnkiDataFromBlob return
  // ─────────────────────────────────────────────────────────────────────
  describe("#8c - AnkiData should include notesTypes from anki21b", () => {
    it("should expose notesTypes for rendering context", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Math Notes",
          config: {
            css: ".card { font-size: 20px; }",
            kind: 0,
            latexPre: "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}",
            latexPost: "\\end{document}",
            latexSvg: true,
          },
        },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: {} },
        { ntid: "1", ord: 1, name: "Back", config: {} },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "[$]x^2[/$]", Back: "x squared" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      const result = getDataFromAnki21b(db);

      // notesTypes should be accessible and contain latexPre for rendering
      expect(result.notesTypes).not.toBeNull();
      expect(result.notesTypes).toHaveLength(1);
      expect(result.notesTypes![0]!.latexPre).toContain("amsmath");
      expect(result.notesTypes![0]!.latexSvg).toBe(true);

      // But crucially, this data needs to be available per-card too
      // Currently it's only on notesTypes, not threaded to individual cards
      const card = result.cards[0] as Record<string, unknown>;
      expect(card).toHaveProperty("latexPre");
    });
  });

  describe("#24 - getAnkiDataFromBlob should preserve parser metadata", () => {
    it("should expose collection and notetype metadata at the public API boundary", async () => {
      const apkg = await buildAnki2ApkgBlob();

      const result = await getAnkiDataFromBlob(apkg);

      expect(result).toHaveProperty("collectionCreationTime", 1704067200);
      expect(result).toHaveProperty("notesTypes");
      expect(result).toHaveProperty("deckConfigs");
    });
  });

  describe("#25 - cards should retain latexPost across formats", () => {
    it("should include latexPost on anki2 cards", async () => {
      const db = await createAnki2Database();

      const models: Anki2Model[] = [
        {
          id: "1",
          css: "",
          latexPre: "\\documentclass{article}\\begin{document}",
          latexPost: "\\end{document}",
          fields: [{ name: "Front" }, { name: "Back" }],
          templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
        },
      ];
      const notes: Anki2Note[] = [
        { id: 1, modelId: "1", tags: [], fields: { Front: "[latex]x^2[/latex]", Back: "square" } },
      ];

      insertAnki2Data(db, models, notes);

      expect(resultWithLatexPost(getDataFromAnki2(db).cards[0])).toBe("\\end{document}");
    });

    it("should include latexPost on anki21b cards", async () => {
      const db = await createAnki21bDatabase();

      const notetypes: Anki21bNotetype[] = [
        {
          id: "1",
          name: "Math",
          config: {
            css: "",
            kind: 0,
            latexPre: "\\documentclass{article}\\begin{document}",
            latexPost: "\\end{document}",
          },
        },
      ];
      const fields: Anki21bField[] = [
        { ntid: "1", ord: 0, name: "Front", config: {} },
        { ntid: "1", ord: 1, name: "Back", config: {} },
      ];
      const templates: Anki21bTemplate[] = [
        { ntid: "1", ord: 0, name: "Card 1", qFormat: "{{Front}}", aFormat: "{{Back}}" },
      ];
      const notes: Anki21bNote[] = [
        { id: 1, mid: "1", tags: [], fields: { Front: "[latex]x^2[/latex]", Back: "square" } },
      ];

      insertAnki21bData(db, notetypes, fields, templates, notes);

      expect(resultWithLatexPost(getDataFromAnki21b(db).cards[0])).toBe("\\end{document}");
    });
  });
});

function resultWithLatexPost(card: unknown) {
  return (card as { latexPost?: string } | undefined)?.latexPost;
}
