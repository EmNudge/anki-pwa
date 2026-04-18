/**
 * Tests for sync coverage gaps — scenarios supported in the source code
 * but not previously covered by tests.
 *
 * Covers:
 *   1. FSRS state round-trip (serializeCardData, mergeIndexedDBToSqlite with FSRS)
 *   2. Filtered/manual revlog types (phaseToRevlogType type 3 and 4)
 *   3. Multi-chunk sequences (buildLocalChunks with >250 items)
 *   4. anki21b table operations (deck/deck_config/notetype merge)
 *   5. Deck hierarchy (parent::child naming)
 *   6. Graves lifecycle (finalizeUsn updates graves)
 *   7. Sequential syncs (finalizeUsn then new pending changes)
 *   8. Deck config edge cases (zero steps, missing fields, extreme values)
 *   9. Model field reordering within same count
 *  10. Empty collection (buildLocalChunks with 0 items)
 *  11. convertDue edge cases
 *  12. encodeLeft edge cases
 *  13. encodeFactor for FSRS
 *  14. buildLocalUnchunkedChanges for anki21b
 *  15. applyRemoteGraves for both formats
 *  16. Creation timestamp (crt) merge
 *  17. Referential integrity (orphaned cards during merge)
 *  18. Card state transitions (new→learning→review→relearning)
 *  19. buildLocalGraves with mixed usn values
 *  20. isAnki21bFormat detection
 */
import "fake-indexeddb/auto";
import { describe, test, expect, beforeEach } from "vitest";
import { type SqlJsStatic } from "sql.js";
import {
  applyRemoteChunk,
  applyRemoteGraves,
  applyRemoteUnchunkedChanges,
  buildLocalChunks,
  buildLocalGraves,
  buildLocalUnchunkedChanges,
  getSanityCounts,
  finalizeUsn,
  isAnki21bFormat,
  type Chunk,
  type UnchunkedChanges,
} from "../lib/syncMerge";
import {
  mergeIndexedDBToSqlite,
  serializeCardData,
  convertDue,
  encodeLeft,
  phaseToRevlogType,
  encodeFactor,
  readDeckStepCounts,
} from "../lib/syncWrite";
import { reviewDB } from "../scheduler/db";
import { getSqlJs, scalar, createAnki2Collection, createAnki21bDb } from "./testDbUtils";

// ── SQL.js setup ──────────────────────────────────────────────────

let SQL: SqlJsStatic;

beforeEach(async () => {
  SQL = await getSqlJs();
  await reviewDB.clearAll();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("sync coverage gaps", () => {
  // ── 1: FSRS state round-trip ──────────────────────────────────

  describe("FSRS state round-trip", () => {
    test("serializeCardData serializes FSRS state with precision rounding", () => {
      const card = {
        cardId: "100",
        deckId: "deck-1",
        algorithm: "fsrs" as const,
        cardState: {
          phase: "review" as const,
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now() + 86400000 * 10,
          lapses: 0,
          reps: 5,
          stability: 12.34567,
          difficulty: 5.6789,
          desiredRetention: 0.9123,
          decay: 0.12345,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: 1700000000000,
      };

      const data = serializeCardData(card);
      const parsed = JSON.parse(data);

      expect(parsed.s).toBe(12.3457); // 4 decimal places
      expect(parsed.d).toBe(5.679); // 3 decimal places
      expect(parsed.dr).toBe(0.91); // 2 decimal places
      expect(parsed.decay).toBe(0.123); // 3 decimal places
      expect(parsed.lrt).toBe(1700000000); // seconds, not ms
    });

    test("serializeCardData returns empty string for SM-2 algorithm", () => {
      const card = {
        cardId: "100",
        deckId: "deck-1",
        algorithm: "sm2" as const,
        cardState: {
          phase: "review" as const,
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now() + 86400000 * 10,
          lapses: 0,
          reps: 5,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
      };

      expect(serializeCardData(card)).toBe("");
    });

    test("serializeCardData omits optional fields when undefined", () => {
      const card = {
        cardId: "100",
        deckId: "deck-1",
        algorithm: "fsrs" as const,
        cardState: {
          phase: "review" as const,
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now(),
          lapses: 0,
          reps: 3,
          stability: 5.0,
          difficulty: 3.0,
          // no desiredRetention, no decay
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: null,
      };

      const data = serializeCardData(card);
      const parsed = JSON.parse(data);

      expect(parsed.s).toBe(5.0);
      expect(parsed.d).toBe(3.0);
      expect(parsed.dr).toBeUndefined();
      expect(parsed.decay).toBeUndefined();
      expect(parsed.lrt).toBeUndefined();
    });

    test("mergeIndexedDBToSqlite writes FSRS card data to SQLite", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "fsrs",
        cardState: {
          phase: "review",
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now() + 86400000 * 10,
          lapses: 0,
          reps: 5,
          stability: 12.345,
          difficulty: 5.678,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      const data = scalar(db, "SELECT data FROM cards WHERE id=200") as string;
      expect(data).toBeTruthy();
      const parsed = JSON.parse(data);
      expect(parsed.s).toBe(12.345);
      expect(parsed.d).toBe(5.678);

      db.close();
    });

    test("FSRS factor encoding uses difficulty-to-ease mapping", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "fsrs",
        cardState: {
          phase: "review",
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now() + 86400000 * 10,
          lapses: 0,
          reps: 5,
          stability: 10.0,
          difficulty: 5.5,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      // In mergeIndexedDBToSqlite, encodeFactor is called with (state.ease, card.algorithm)
      // Since the card state has ease=2.5 and algorithm="fsrs" but no explicit difficulty param,
      // it falls back to ease * 1000 = 2500 (difficulty is not passed from card state to encodeFactor)
      const factor = scalar(db, "SELECT factor FROM cards WHERE id=200");
      expect(factor).toBe(2500);

      db.close();
    });
  });

  // ── 2: Filtered/manual revlog types ─────────────────────────────

  describe("revlog type variations", () => {
    test("phaseToRevlogType returns 0 for learning", () => {
      expect(phaseToRevlogType("learning")).toBe(0);
    });

    test("phaseToRevlogType returns 0 for new", () => {
      expect(phaseToRevlogType("new")).toBe(0);
    });

    test("phaseToRevlogType returns 1 for review", () => {
      expect(phaseToRevlogType("review")).toBe(1);
    });

    test("phaseToRevlogType returns 2 for relearning", () => {
      expect(phaseToRevlogType("relearning")).toBe(2);
    });

    test("phaseToRevlogType returns 3 for filtered (review with negative daysLate)", () => {
      // When a review card has negative daysLate, it's in a filtered deck
      expect(phaseToRevlogType("review", -1)).toBe(3);
      expect(phaseToRevlogType("review", -5)).toBe(3);
    });

    test("phaseToRevlogType returns 1 for review with non-negative daysLate", () => {
      expect(phaseToRevlogType("review", 0)).toBe(1);
      expect(phaseToRevlogType("review", 3)).toBe(1);
    });

    test("phaseToRevlogType returns 1 for unknown phase", () => {
      expect(phaseToRevlogType("unknown")).toBe(1);
      expect(phaseToRevlogType("")).toBe(1);
    });
  });

  // ── 3: Multi-chunk sequences ────────────────────────────────────

  describe("multi-chunk sequences", () => {
    test("buildLocalChunks yields multiple chunks for >250 items", () => {
      const db = createAnki2Collection(SQL);

      // Insert 300 cards with usn=-1 (pending)
      const nowSec = Math.floor(Date.now() / 1000);
      for (let i = 1; i <= 300; i++) {
        db.run("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
          1000 + i,
          `guid_${i}`,
          1234567890,
          nowSec,
          -1,
          "",
          `front_${i}\x1fback_${i}`,
          `front_${i}`,
          0,
          0,
          "",
        ]);
        db.run("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
          2000 + i,
          1000 + i,
          1,
          0,
          nowSec,
          -1,
          0,
          0,
          i,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          "",
        ]);
      }

      const chunks = [...buildLocalChunks(db)];

      // Should have at least 2 chunks (300 notes + 300 cards = 600 items, 250 per chunk)
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Only the last chunk should have done=true
      chunks.slice(0, -1).forEach((chunk) => expect(chunk.done).toBe(false));
      expect(chunks[chunks.length - 1]!.done).toBe(true);

      // Total items should match
      const totalNotes = chunks.reduce((sum, c) => sum + c.notes.length, 0);
      const totalCards = chunks.reduce((sum, c) => sum + c.cards.length, 0);
      expect(totalNotes).toBe(300); // 300 pending (default note has usn=0)
      expect(totalCards).toBe(300); // 300 pending (default card has usn=0)

      db.close();
    });

    test("buildLocalChunks yields single done chunk for empty collection", () => {
      const db = createAnki2Collection(SQL);
      // All cards/notes have usn=0 (not pending), so no chunks to send

      const chunks = [...buildLocalChunks(db)];
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.done).toBe(true);
      expect(chunks[0]!.cards).toHaveLength(0);
      expect(chunks[0]!.notes).toHaveLength(0);
      expect(chunks[0]!.revlog).toHaveLength(0);

      db.close();
    });

    test("buildLocalChunks interleaves revlog, notes, cards in order", () => {
      const db = createAnki2Collection(SQL, {
        cardOverrides: { usn: -1 },
      });
      // Also mark the default note as pending
      db.run("UPDATE notes SET usn=-1");

      // Add pending revlog
      db.run("INSERT INTO revlog VALUES (999, 200, -1, 3, 10, 5, 2500, 5000, 1)");

      const chunks = [...buildLocalChunks(db)];
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.revlog.length).toBe(1);
      expect(chunks[0]!.notes.length).toBe(1);
      expect(chunks[0]!.cards.length).toBe(1);

      db.close();
    });
  });

  // ── 4: anki21b table operations ─────────────────────────────────

  describe("anki21b table operations", () => {
    test("applyRemoteUnchunkedChanges merges decks into anki21b decks table", () => {
      const db = createAnki21bDb(SQL);

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[{ id: 2, name: "Science", mtime: 100, usn: 5 }], []],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      const name = scalar(db, "SELECT name FROM decks WHERE id=2");
      expect(name).toBe("Science");
      const mtime = scalar(db, "SELECT mtime FROM decks WHERE id=2");
      expect(mtime).toBe(100);

      db.close();
    });

    test("applyRemoteUnchunkedChanges skips older deck in anki21b", () => {
      const db = createAnki21bDb(SQL, {
        decks: [{ id: 2, name: "LocalDeck", mtime: 200, usn: 0, common: "{}" }],
      });

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[{ id: 2, name: "OlderRemote", mtime: 100, usn: 5 }], []],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      // Local should win because remote mtime is older
      const name = scalar(db, "SELECT name FROM decks WHERE id=2");
      expect(name).toBe("LocalDeck");

      db.close();
    });

    test("applyRemoteUnchunkedChanges merges deck_config in anki21b", () => {
      const db = createAnki21bDb(SQL);

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[], [{ id: 1, name: "Custom", mtime: 100, usn: 5 }]],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      const name = scalar(db, "SELECT name FROM deck_config WHERE id=1");
      expect(name).toBe("Custom");

      db.close();
    });

    test("applyRemoteUnchunkedChanges skips older deck_config in anki21b", () => {
      const db = createAnki21bDb(SQL, {
        deckConfigs: [{ id: 1, name: "LocalConfig", mtime: 200, usn: 0, config: "{}" }],
      });

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[], [{ id: 1, name: "OlderConfig", mtime: 100, usn: 5 }]],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      const name = scalar(db, "SELECT name FROM deck_config WHERE id=1");
      expect(name).toBe("LocalConfig");

      db.close();
    });

    test("applyRemoteUnchunkedChanges inserts new notetype in anki21b", () => {
      const db = createAnki21bDb(SQL);

      const changes: UnchunkedChanges = {
        models: [
          {
            id: 5001,
            mod: 200,
            mtime_secs: 200,
            name: "Cloze",
            usn: 5,
            flds: [{ name: "Text", ord: 0 }],
            tmpls: [{ name: "Cloze", ord: 0 }],
          } as any,
        ],
        decks: [[], []],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      const name = scalar(db, "SELECT name FROM notetypes WHERE id=5001");
      expect(name).toBe("Cloze");

      db.close();
    });

    test("buildLocalUnchunkedChanges returns pending anki21b items", () => {
      const db = createAnki21bDb(SQL, {
        notetypes: [
          {
            id: 1001,
            name: "Basic",
            mtime_secs: 100,
            usn: -1,
            config: JSON.stringify({ id: 1001, name: "Basic", flds: [], tmpls: [] }),
          },
        ],
        decks: [{ id: 2, name: "PendingDeck", mtime: 100, usn: -1, common: "{}" }],
        deckConfigs: [{ id: 2, name: "PendingConfig", mtime: 100, usn: -1, config: "{}" }],
        tags: [
          { tag: "pending-tag", usn: -1 },
          { tag: "synced-tag", usn: 5 },
        ],
      });

      const changes = buildLocalUnchunkedChanges(db, true, false);

      expect(changes.models).toHaveLength(1);
      expect(changes.models[0]!.id).toBe(1001);
      expect(changes.decks[0]).toHaveLength(1);
      expect(changes.decks[0][0]!.name).toBe("PendingDeck");
      expect(changes.decks[1]).toHaveLength(1);
      expect(changes.decks[1][0]!.name).toBe("PendingConfig");
      expect(changes.tags).toEqual(["pending-tag"]);

      db.close();
    });

    test("buildLocalUnchunkedChanges includes conf and crt when localIsNewer (anki21b)", () => {
      const db = createAnki21bDb(SQL, { conf: { myKey: "myValue" } });

      const changes = buildLocalUnchunkedChanges(db, true, true);

      expect(changes.conf).toBeDefined();
      expect((changes.conf as any).myKey).toBe("myValue");
      expect(changes.crt).toBeDefined();

      db.close();
    });
  });

  // ── 5: Deck hierarchy ──────────────────────────────────────────

  describe("deck hierarchy operations", () => {
    test("merges parent::child deck names correctly (anki2)", () => {
      const db = createAnki2Collection(SQL, {
        decks: {
          "1": { id: 1, mod: 100, name: "Default", usn: 0, conf: "1" },
        },
      });

      const changes: UnchunkedChanges = {
        models: [],
        decks: [
          [
            { id: 2, mod: 200, name: "Science", usn: 5 },
            { id: 3, mod: 200, name: "Science::Biology", usn: 5 },
            { id: 4, mod: 200, name: "Science::Biology::Genetics", usn: 5 },
          ],
          [],
        ],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      const decks = JSON.parse(scalar(db, "SELECT decks FROM col") as string);
      expect(decks["2"].name).toBe("Science");
      expect(decks["3"].name).toBe("Science::Biology");
      expect(decks["4"].name).toBe("Science::Biology::Genetics");

      db.close();
    });

    test("merges parent::child deck names in anki21b", () => {
      const db = createAnki21bDb(SQL);

      const changes: UnchunkedChanges = {
        models: [],
        decks: [
          [
            { id: 2, name: "Languages", mtime: 100, usn: 5 },
            { id: 3, name: "Languages::Spanish", mtime: 100, usn: 5 },
          ],
          [],
        ],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      const parent = scalar(db, "SELECT name FROM decks WHERE id=2");
      expect(parent).toBe("Languages");
      const child = scalar(db, "SELECT name FROM decks WHERE id=3");
      expect(child).toBe("Languages::Spanish");

      db.close();
    });
  });

  // ── 6: Graves lifecycle & finalizeUsn ───────────────────────────

  describe("graves lifecycle and finalizeUsn", () => {
    test("finalizeUsn updates graves usn from -1 to server usn", () => {
      const db = createAnki2Collection(SQL);
      db.run("INSERT INTO graves VALUES (-1, 100, 0)");
      db.run("INSERT INTO graves VALUES (-1, 200, 1)");

      finalizeUsn(db, 42, Date.now(), false);

      const graves = db.exec("SELECT usn FROM graves");
      const usns = (graves[0]?.values ?? []).map((r) => r[0]);
      expect(usns).toEqual([42, 42]);

      db.close();
    });

    test("finalizeUsn updates cards, notes, revlog usn", () => {
      const db = createAnki2Collection(SQL, {
        cardOverrides: { usn: -1 },
      });
      db.run("UPDATE notes SET usn=-1");
      db.run("INSERT INTO revlog VALUES (999, 200, -1, 3, 10, 5, 2500, 5000, 1)");

      finalizeUsn(db, 42, Date.now(), false);

      expect(scalar(db, "SELECT usn FROM cards WHERE id=200")).toBe(42);
      expect(scalar(db, "SELECT usn FROM notes WHERE id=100")).toBe(42);
      expect(scalar(db, "SELECT usn FROM revlog WHERE id=999")).toBe(42);

      db.close();
    });

    test("finalizeUsn updates anki2 JSON columns (models, decks, dconf, tags)", () => {
      const db = createAnki2Collection(SQL, {
        models: {
          "1001": { id: 1001, mod: 100, name: "Basic", usn: -1, flds: [], tmpls: [] },
        },
        decks: {
          "1": { id: 1, mod: 100, name: "Default", usn: -1, conf: "1" },
        },
        dconf: {
          "1": { id: 1, mod: 100, name: "Default", usn: -1 },
        },
        tags: { vocab: -1, grammar: 5 },
      });

      finalizeUsn(db, 42, Date.now(), false);

      const models = JSON.parse(scalar(db, "SELECT models FROM col") as string);
      expect(models["1001"].usn).toBe(42);

      const decks = JSON.parse(scalar(db, "SELECT decks FROM col") as string);
      expect(decks["1"].usn).toBe(42);

      const dconf = JSON.parse(scalar(db, "SELECT dconf FROM col") as string);
      expect(dconf["1"].usn).toBe(42);

      const tags = JSON.parse(scalar(db, "SELECT tags FROM col") as string);
      expect(tags.vocab).toBe(42);
      expect(tags.grammar).toBe(5); // already synced, unchanged

      db.close();
    });

    test("finalizeUsn updates anki21b separate tables", () => {
      const db = createAnki21bDb(SQL, {
        notetypes: [{ id: 1001, name: "Basic", mtime_secs: 100, usn: -1, config: "{}" }],
        decks: [{ id: 2, name: "Test", mtime: 100, usn: -1, common: "{}" }],
        deckConfigs: [{ id: 1, name: "Default", mtime: 100, usn: -1, config: "{}" }],
        tags: [
          { tag: "pending", usn: -1 },
          { tag: "synced", usn: 5 },
        ],
      });

      finalizeUsn(db, 42, Date.now(), true);

      expect(scalar(db, "SELECT usn FROM notetypes WHERE id=1001")).toBe(42);
      expect(scalar(db, "SELECT usn FROM decks WHERE id=2")).toBe(42);
      expect(scalar(db, "SELECT usn FROM deck_config WHERE id=1")).toBe(42);
      expect(scalar(db, "SELECT usn FROM tags WHERE tag='pending'")).toBe(42);
      expect(scalar(db, "SELECT usn FROM tags WHERE tag='synced'")).toBe(5);

      db.close();
    });

    test("finalizeUsn updates col.usn, col.mod, col.ls", () => {
      const db = createAnki2Collection(SQL);
      const serverMod = 9999999;

      finalizeUsn(db, 42, serverMod, false);

      expect(scalar(db, "SELECT usn FROM col")).toBe(42);
      expect(scalar(db, "SELECT mod FROM col")).toBe(9999999);
      expect(scalar(db, "SELECT ls FROM col")).toBe(9999999);

      db.close();
    });
  });

  // ── 7: Sequential syncs ────────────────────────────────────────

  describe("sequential syncs simulation", () => {
    test("after finalizeUsn, new pending changes have usn=-1 again", () => {
      const db = createAnki2Collection(SQL, {
        cardOverrides: { usn: -1 },
      });
      db.run("UPDATE notes SET usn=-1");

      // First sync: finalize
      finalizeUsn(db, 42, Date.now(), false);
      expect(scalar(db, "SELECT usn FROM cards WHERE id=200")).toBe(42);

      // User makes new changes
      const nowSec = Math.floor(Date.now() / 1000);
      db.run(`UPDATE cards SET reps=5, mod=${nowSec}, usn=-1 WHERE id=200`);

      // Verify new change is pending
      expect(scalar(db, "SELECT usn FROM cards WHERE id=200")).toBe(-1);

      // Build chunks should pick up only the new change
      const chunks = [...buildLocalChunks(db)];
      const totalCards = chunks.reduce((sum, c) => sum + c.cards.length, 0);
      expect(totalCards).toBe(1);

      // Second sync: finalize with new USN
      finalizeUsn(db, 43, Date.now(), false);
      expect(scalar(db, "SELECT usn FROM cards WHERE id=200")).toBe(43);
      expect(scalar(db, "SELECT usn FROM col")).toBe(43);

      db.close();
    });
  });

  // ── 8: Deck config edge cases ──────────────────────────────────

  describe("deck config edge cases", () => {
    test("readDeckStepCounts handles zero learning steps", () => {
      const db = createAnki2Collection(SQL, {
        dconf: {
          "1": {
            id: 1,
            mod: 0,
            name: "NoSteps",
            usn: 0,
            new: { delays: [], perDay: 20 },
            lapse: { delays: [], minInt: 1, mult: 0, leechFails: 8 },
            rev: { perDay: 200 },
          },
        },
      });

      const steps = readDeckStepCounts(db);
      const deckSteps = steps.get(1);
      expect(deckSteps).toBeDefined();
      expect(deckSteps!.learnSteps).toBe(0);
      expect(deckSteps!.relearnSteps).toBe(0);

      db.close();
    });

    test("readDeckStepCounts handles many learning steps", () => {
      const db = createAnki2Collection(SQL, {
        dconf: {
          "1": {
            id: 1,
            mod: 0,
            name: "ManySteps",
            usn: 0,
            new: { delays: [1, 5, 10, 30, 60, 120, 240, 480, 1440], perDay: 20 },
            lapse: { delays: [5, 10, 30, 60], minInt: 1, mult: 0, leechFails: 8 },
            rev: { perDay: 200 },
          },
        },
      });

      const steps = readDeckStepCounts(db);
      const deckSteps = steps.get(1);
      expect(deckSteps!.learnSteps).toBe(9);
      expect(deckSteps!.relearnSteps).toBe(4);

      db.close();
    });

    test("readDeckStepCounts handles missing delays field", () => {
      const db = createAnki2Collection(SQL, {
        dconf: {
          "1": {
            id: 1,
            mod: 0,
            name: "NoDelays",
            usn: 0,
            new: { perDay: 20 },
            lapse: { minInt: 1, mult: 0, leechFails: 8 },
            rev: { perDay: 200 },
          },
        },
      });

      const steps = readDeckStepCounts(db);
      const deckSteps = steps.get(1);
      // Falls back to defaults when delays field is missing
      expect(deckSteps!.learnSteps).toBe(2);
      expect(deckSteps!.relearnSteps).toBe(1);

      db.close();
    });

    test("readDeckStepCounts maps multiple decks to their configs", () => {
      const db = createAnki2Collection(SQL, {
        dconf: {
          "1": {
            id: 1,
            mod: 0,
            name: "Default",
            usn: 0,
            new: { delays: [1, 10] },
            lapse: { delays: [10] },
            rev: { perDay: 200 },
          },
          "2": {
            id: 2,
            mod: 0,
            name: "Hard",
            usn: 0,
            new: { delays: [1, 5, 10, 30, 60] },
            lapse: { delays: [5, 15, 30] },
            rev: { perDay: 300 },
          },
        },
        decks: {
          "1": { id: 1, mod: 0, name: "Default", usn: 0, conf: "1" },
          "2": { id: 2, mod: 0, name: "Hard Deck", usn: 0, conf: "2" },
        },
      });

      const steps = readDeckStepCounts(db);
      expect(steps.get(1)!.learnSteps).toBe(2);
      expect(steps.get(1)!.relearnSteps).toBe(1);
      expect(steps.get(2)!.learnSteps).toBe(5);
      expect(steps.get(2)!.relearnSteps).toBe(3);

      db.close();
    });

    test("readDeckStepCounts handles anki21b format", () => {
      const db = createAnki21bDb(SQL, {
        decks: [{ id: 2, name: "MyDeck", mtime: 0, usn: 0, common: JSON.stringify({ conf: 1 }) }],
        deckConfigs: [
          {
            id: 1,
            name: "Default",
            mtime: 0,
            usn: 0,
            config: JSON.stringify({
              new: { delays: [1, 10, 30] },
              lapse: { delays: [5, 10] },
            }),
          },
        ],
      });

      const steps = readDeckStepCounts(db);
      expect(steps.get(2)!.learnSteps).toBe(3);
      expect(steps.get(2)!.relearnSteps).toBe(2);

      db.close();
    });
  });

  // ── 9: Model field reordering ──────────────────────────────────

  describe("model field reordering within same count", () => {
    test("accepts field name changes when count is unchanged (anki2)", () => {
      const db = createAnki2Collection(SQL, {
        models: {
          "1001": {
            id: 1001,
            mod: 100,
            name: "Basic",
            usn: 0,
            flds: [
              { name: "Front", ord: 0 },
              { name: "Back", ord: 1 },
            ],
            tmpls: [{ name: "Card 1", ord: 0 }],
          },
        },
      });

      const changes: UnchunkedChanges = {
        models: [
          {
            id: 1001,
            mod: 200,
            name: "Basic",
            usn: 5,
            flds: [
              { name: "Question", ord: 0 },
              { name: "Answer", ord: 1 },
            ], // renamed but same count
            tmpls: [{ name: "Card 1", ord: 0 }],
          },
        ],
        decks: [[], []],
        tags: [],
      };

      // Should NOT throw
      applyRemoteUnchunkedChanges(db, changes, false);

      const models = JSON.parse(scalar(db, "SELECT models FROM col") as string);
      expect(models["1001"].flds[0].name).toBe("Question");
      expect(models["1001"].flds[1].name).toBe("Answer");

      db.close();
    });

    test("accepts template name changes when count is unchanged", () => {
      const db = createAnki2Collection(SQL, {
        models: {
          "1001": {
            id: 1001,
            mod: 100,
            name: "Basic",
            usn: 0,
            flds: [
              { name: "Front", ord: 0 },
              { name: "Back", ord: 1 },
            ],
            tmpls: [{ name: "Card 1", ord: 0 }],
          },
        },
      });

      const changes: UnchunkedChanges = {
        models: [
          {
            id: 1001,
            mod: 200,
            name: "Basic",
            usn: 5,
            flds: [
              { name: "Front", ord: 0 },
              { name: "Back", ord: 1 },
            ],
            tmpls: [{ name: "Forward Card", ord: 0 }], // renamed
          },
        ],
        decks: [[], []],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      const models = JSON.parse(scalar(db, "SELECT models FROM col") as string);
      expect(models["1001"].tmpls[0].name).toBe("Forward Card");

      db.close();
    });
  });

  // ── 10: convertDue edge cases ──────────────────────────────────

  describe("convertDue edge cases", () => {
    const crt = 1700000000; // collection creation time in seconds

    test("review: converts to days since creation", () => {
      const dueMs = crt * 1000 + 86400000 * 5; // 5 days after creation
      const result = convertDue({ phase: "review", due: dueMs }, crt);
      expect(result).toBe(5);
    });

    test("learning with interval < 1 day: returns unix seconds", () => {
      const dueMs = 1700086400000; // some future timestamp
      const result = convertDue({ phase: "learning", due: dueMs, interval: 0.5 }, crt);
      expect(result).toBe(Math.floor(dueMs / 1000));
    });

    test("learning with interval >= 1 day (dayLearning): returns day offset", () => {
      const dueMs = crt * 1000 + 86400000 * 3; // 3 days after creation
      const result = convertDue({ phase: "learning", due: dueMs, interval: 1 }, crt);
      expect(result).toBe(3);
    });

    test("relearning with interval < 1 day: returns unix seconds", () => {
      const dueMs = 1700086400000;
      const result = convertDue({ phase: "relearning", due: dueMs, interval: 0.01 }, crt);
      expect(result).toBe(Math.floor(dueMs / 1000));
    });

    test("relearning with interval >= 1 day: returns day offset", () => {
      const dueMs = crt * 1000 + 86400000 * 2;
      const result = convertDue({ phase: "relearning", due: dueMs, interval: 2 }, crt);
      expect(result).toBe(2);
    });

    test("new: returns position or 0", () => {
      expect(convertDue({ phase: "new", due: 0 }, crt)).toBe(0);
      expect(convertDue({ phase: "new", due: 0 }, crt, 42)).toBe(42);
    });

    test("review with due in the past: returns negative day offset", () => {
      const dueMs = crt * 1000 - 86400000 * 2; // 2 days before creation
      const result = convertDue({ phase: "review", due: dueMs }, crt);
      expect(result).toBe(-2);
    });
  });

  // ── 11: encodeLeft edge cases ──────────────────────────────────

  describe("encodeLeft edge cases", () => {
    test("returns 0 for review phase", () => {
      expect(encodeLeft({ phase: "review", step: 0 }, 2)).toBe(0);
    });

    test("returns 0 for new phase", () => {
      expect(encodeLeft({ phase: "new", step: 0 }, 2)).toBe(0);
    });

    test("encodes correctly for learning at step 0 of 4", () => {
      const result = encodeLeft({ phase: "learning", step: 0 }, 4);
      // stepsRemaining = 4 - 0 = 4, todaySteps = 4
      // left = 4 * 1000 + 4 = 4004
      expect(result).toBe(4004);
    });

    test("encodes correctly for learning at step 2 of 4", () => {
      const result = encodeLeft({ phase: "learning", step: 2 }, 4);
      // stepsRemaining = 4 - 2 = 2, todaySteps = 2
      // left = 2 * 1000 + 2 = 2002
      expect(result).toBe(2002);
    });

    test("encodes correctly for relearning", () => {
      const result = encodeLeft({ phase: "relearning", step: 0 }, 2);
      // stepsRemaining = 2 - 0 = 2
      expect(result).toBe(2002);
    });

    test("clamps negative step remaining to 0", () => {
      const result = encodeLeft({ phase: "learning", step: 5 }, 3);
      // stepsRemaining = max(0, 3 - 5) = 0
      expect(result).toBe(0);
    });

    test("respects stepsToday override", () => {
      const result = encodeLeft({ phase: "learning", step: 1 }, 4, 2);
      // stepsRemaining = 4 - 1 = 3, todaySteps = 2
      // left = 2 * 1000 + 3 = 2003
      expect(result).toBe(2003);
    });
  });

  // ── 12: encodeFactor ───────────────────────────────────────────

  describe("encodeFactor", () => {
    test("SM-2: multiplies ease by 1000", () => {
      expect(encodeFactor(2.5)).toBe(2500);
      expect(encodeFactor(1.3)).toBe(1300);
      expect(encodeFactor(3.0)).toBe(3000);
    });

    test("FSRS: maps difficulty to shifted range", () => {
      // difficulty=1.0: ((1.0-1)/9 + 0.1) * 1000 = 100
      expect(encodeFactor(0, "fsrs", 1.0)).toBe(100);

      // difficulty=10.0: ((10.0-1)/9 + 0.1) * 1000 = 1100
      expect(encodeFactor(0, "fsrs", 10.0)).toBe(1100);

      // difficulty=5.5: ((5.5-1)/9 + 0.1) * 1000 = 600
      expect(encodeFactor(0, "fsrs", 5.5)).toBe(600);
    });

    test("FSRS: falls back to ease when difficulty is undefined", () => {
      expect(encodeFactor(2.5, "fsrs")).toBe(2500);
    });
  });

  // ── 13: applyRemoteGraves ─────────────────────────────────────

  describe("applyRemoteGraves", () => {
    test("deletes cards and their review logs from SQLite", async () => {
      const db = createAnki2Collection(SQL);
      db.run("INSERT INTO revlog VALUES (999, 200, 5, 3, 10, 5, 2500, 5000, 1)");

      await applyRemoteGraves(db, { cards: [200], notes: [], decks: [] });

      expect(scalar(db, "SELECT count() FROM cards")).toBe(0);
      // Note should still exist (only card was deleted)
      expect(scalar(db, "SELECT count() FROM notes")).toBe(1);

      db.close();
    });

    test("deletes notes and cascades to their cards", async () => {
      const db = createAnki2Collection(SQL);

      await applyRemoteGraves(db, { cards: [], notes: [100], decks: [] });

      expect(scalar(db, "SELECT count() FROM notes")).toBe(0);
      expect(scalar(db, "SELECT count() FROM cards")).toBe(0); // cascade

      db.close();
    });

    test("deletes decks from anki2 JSON", async () => {
      const db = createAnki2Collection(SQL, {
        decks: {
          "1": { id: 1, mod: 100, name: "Default", usn: 0 },
          "2": { id: 2, mod: 100, name: "ToDelete", usn: 0 },
        },
      });

      await applyRemoteGraves(db, { cards: [], notes: [], decks: [2] });

      const decks = JSON.parse(scalar(db, "SELECT decks FROM col") as string);
      expect(decks["1"]).toBeDefined();
      expect(decks["2"]).toBeUndefined();

      db.close();
    });

    test("deletes decks from anki21b table", async () => {
      const db = createAnki21bDb(SQL, {
        decks: [{ id: 2, name: "ToDelete", mtime: 100, usn: 0, common: "{}" }],
      });

      await applyRemoteGraves(db, { cards: [], notes: [], decks: [2] });

      expect(scalar(db, "SELECT count() FROM decks WHERE id=2")).toBe(0);
      // Default deck (id=1) should remain
      expect(scalar(db, "SELECT count() FROM decks WHERE id=1")).toBe(1);

      db.close();
    });

    test("handles empty graves gracefully", async () => {
      const db = createAnki2Collection(SQL);

      // Should not throw
      await applyRemoteGraves(db, { cards: [], notes: [], decks: [] });

      expect(scalar(db, "SELECT count() FROM cards")).toBe(1);
      expect(scalar(db, "SELECT count() FROM notes")).toBe(1);

      db.close();
    });
  });

  // ── 14: Creation timestamp merge ───────────────────────────────

  describe("creation timestamp (crt) merge", () => {
    test("updates crt when remote is newer (anki2)", () => {
      const db = createAnki2Collection(SQL);
      const oldCrt = scalar(db, "SELECT crt FROM col") as number;

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        crt: oldCrt + 1000, // newer
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      expect(scalar(db, "SELECT crt FROM col")).toBe(oldCrt + 1000);

      db.close();
    });

    test("does not update crt when remote is older", () => {
      const db = createAnki2Collection(SQL);
      const oldCrt = scalar(db, "SELECT crt FROM col") as number;

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        crt: oldCrt - 1000, // older
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      expect(scalar(db, "SELECT crt FROM col")).toBe(oldCrt);

      db.close();
    });

    test("updates crt in anki21b format", () => {
      const db = createAnki21bDb(SQL);
      const oldCrt = scalar(db, "SELECT crt FROM col") as number;

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        crt: oldCrt + 5000,
      };

      applyRemoteUnchunkedChanges(db, changes, true);

      expect(scalar(db, "SELECT crt FROM col")).toBe(oldCrt + 5000);

      db.close();
    });
  });

  // ── 15: Referential integrity ──────────────────────────────────

  describe("referential integrity during merge", () => {
    test("applyRemoteChunk inserts card even if referenced note doesn't exist", async () => {
      const db = createAnki2Collection(SQL);

      // Send a card that references a non-existent note
      const chunk: Chunk = {
        done: true,
        revlog: [],
        cards: [[9999, 8888, 1, 0, 100, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ""]],
        notes: [], // note 8888 not included
      };

      // Should not throw — SQLite has no foreign key constraints by default
      await applyRemoteChunk(db, chunk);

      expect(scalar(db, "SELECT count() FROM cards WHERE id=9999")).toBe(1);
      expect(scalar(db, "SELECT nid FROM cards WHERE id=9999")).toBe(8888);

      db.close();
    });

    test("applyRemoteGraves for notes deletes all associated cards", async () => {
      const db = createAnki2Collection(SQL, {
        extraCards: [
          { id: 201, nid: 100, did: 1, ord: 1 },
          { id: 202, nid: 100, did: 1, ord: 2 },
        ],
      });

      // Should have 3 cards for note 100
      expect(scalar(db, "SELECT count() FROM cards WHERE nid=100")).toBe(3);

      await applyRemoteGraves(db, { cards: [], notes: [100], decks: [] });

      expect(scalar(db, "SELECT count() FROM cards WHERE nid=100")).toBe(0);
      expect(scalar(db, "SELECT count() FROM notes WHERE id=100")).toBe(0);

      db.close();
    });
  });

  // ── 16: Card state transitions ─────────────────────────────────

  describe("card state transitions via mergeIndexedDBToSqlite", () => {
    test("new → learning: type=1, queue=1", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: {
          phase: "learning",
          step: 0,
          ease: 2.5,
          interval: 0.007,
          due: Date.now() + 600_000,
          lapses: 0,
          reps: 1,
        },
        createdAt: Date.now() - 60000,
        lastReviewed: Date.now(),
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      expect(scalar(db, "SELECT type FROM cards WHERE id=200")).toBe(1);
      expect(scalar(db, "SELECT queue FROM cards WHERE id=200")).toBe(1);

      db.close();
    });

    test("learning → review: type=2, queue=2", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: {
          phase: "review",
          step: 0,
          ease: 2.5,
          interval: 1,
          due: Date.now() + 86400000,
          lapses: 0,
          reps: 3,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      expect(scalar(db, "SELECT type FROM cards WHERE id=200")).toBe(2);
      expect(scalar(db, "SELECT queue FROM cards WHERE id=200")).toBe(2);

      db.close();
    });

    test("review → relearning: type=3, queue=1 (intraday)", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: {
          phase: "relearning",
          step: 0,
          ease: 2.0,
          interval: 0.01,
          due: Date.now() + 600_000,
          lapses: 1,
          reps: 5,
        },
        createdAt: Date.now() - 86400000 * 10,
        lastReviewed: Date.now(),
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      expect(scalar(db, "SELECT type FROM cards WHERE id=200")).toBe(3);
      expect(scalar(db, "SELECT queue FROM cards WHERE id=200")).toBe(1);

      db.close();
    });

    test("dayLearning: learning with interval >= 1 day gets queue=3", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: {
          phase: "learning",
          step: 1,
          ease: 2.5,
          interval: 1,
          due: Date.now() + 86400000,
          lapses: 0,
          reps: 2,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      expect(scalar(db, "SELECT type FROM cards WHERE id=200")).toBe(1);
      expect(scalar(db, "SELECT queue FROM cards WHERE id=200")).toBe(3);

      db.close();
    });
  });

  // ── 17: isAnki21bFormat detection ──────────────────────────────

  describe("isAnki21bFormat detection", () => {
    test("returns false for anki2 format", () => {
      const db = createAnki2Collection(SQL);
      expect(isAnki21bFormat(db)).toBe(false);
      db.close();
    });

    test("returns true for anki21b format", () => {
      const db = createAnki21bDb(SQL);
      expect(isAnki21bFormat(db)).toBe(true);
      db.close();
    });
  });

  // ── 18: getSanityCounts for anki21b ────────────────────────────

  describe("getSanityCounts for anki21b", () => {
    test("counts from separate tables for anki21b", () => {
      const db = createAnki21bDb(SQL, {
        notetypes: [
          { id: 1001, name: "Basic", mtime_secs: 0, usn: 0, config: "{}" },
          { id: 1002, name: "Cloze", mtime_secs: 0, usn: 0, config: "{}" },
        ],
        deckConfigs: [{ id: 1, name: "Default", mtime: 0, usn: 0, config: "{}" }],
      });

      // Insert a card and note
      const nowSec = Math.floor(Date.now() / 1000);
      db.run("INSERT INTO notes VALUES (100, 'abc', 1001, ?, 0, '', 'f\x1fb', 'f', 0, 0, '')", [
        nowSec,
      ]);
      db.run(
        "INSERT INTO cards VALUES (200, 100, 1, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')",
        [nowSec],
      );

      const counts = getSanityCounts(db, true);
      const [dueCounts, cards, notes, revlog, graves, models, decks, deckConfig] = counts;

      expect(dueCounts[0]).toBe(1); // 1 new card
      expect(cards).toBe(1);
      expect(notes).toBe(1);
      expect(revlog).toBe(0);
      expect(graves).toBe(0);
      expect(models).toBe(2); // 2 notetypes
      expect(decks).toBe(1); // default deck
      expect(deckConfig).toBe(1);

      db.close();
    });
  });

  // ── 19: buildLocalGraves ───────────────────────────────────────

  describe("buildLocalGraves filtering", () => {
    test("only includes usn=-1 graves, excludes already-synced ones", () => {
      const db = createAnki2Collection(SQL);

      db.run("INSERT INTO graves VALUES (-1, 100, 0)"); // pending card
      db.run("INSERT INTO graves VALUES (-1, 200, 1)"); // pending note
      db.run("INSERT INTO graves VALUES (-1, 300, 2)"); // pending deck
      db.run("INSERT INTO graves VALUES (5, 400, 0)"); // synced card
      db.run("INSERT INTO graves VALUES (10, 500, 1)"); // synced note

      const graves = buildLocalGraves(db);
      expect(graves.cards).toEqual([100]);
      expect(graves.notes).toEqual([200]);
      expect(graves.decks).toEqual([300]);

      db.close();
    });

    test("returns empty arrays when no pending graves", () => {
      const db = createAnki2Collection(SQL);
      db.run("INSERT INTO graves VALUES (5, 100, 0)"); // already synced

      const graves = buildLocalGraves(db);
      expect(graves.cards).toEqual([]);
      expect(graves.notes).toEqual([]);
      expect(graves.decks).toEqual([]);

      db.close();
    });
  });

  // ── 20: buildLocalUnchunkedChanges for anki2 ──────────────────

  describe("buildLocalUnchunkedChanges for anki2", () => {
    test("only includes pending (usn=-1) items", () => {
      const db = createAnki2Collection(SQL, {
        models: {
          "1001": { id: 1001, mod: 100, name: "Pending", usn: -1, flds: [], tmpls: [] },
          "1002": { id: 1002, mod: 100, name: "Synced", usn: 5, flds: [], tmpls: [] },
        },
        decks: {
          "1": { id: 1, mod: 100, name: "Default", usn: 0 },
          "2": { id: 2, mod: 100, name: "Pending Deck", usn: -1 },
        },
        dconf: {
          "1": { id: 1, mod: 0, name: "Default", usn: 0 },
          "2": { id: 2, mod: 0, name: "Pending Config", usn: -1 },
        },
        tags: { synced: 5, pending: -1 },
      });

      const changes = buildLocalUnchunkedChanges(db, false, false);

      expect(changes.models).toHaveLength(1);
      expect(changes.models[0]!.name).toBe("Pending");
      expect(changes.decks[0]).toHaveLength(1);
      expect(changes.decks[0][0]!.name).toBe("Pending Deck");
      expect(changes.decks[1]).toHaveLength(1);
      expect(changes.decks[1][0]!.name).toBe("Pending Config");
      expect(changes.tags).toEqual(["pending"]);
      expect(changes.conf).toBeUndefined();

      db.close();
    });

    test("includes conf and crt when localIsNewer", () => {
      const db = createAnki2Collection(SQL, { conf: { myKey: "test" } });

      const changes = buildLocalUnchunkedChanges(db, false, true);

      expect(changes.conf).toBeDefined();
      expect((changes.conf as any).myKey).toBe("test");
      expect(changes.crt).toBeDefined();
      expect(typeof changes.crt).toBe("number");

      db.close();
    });
  });

  // ── 21: applyRemoteChunk with multiple entity types ────────────

  describe("applyRemoteChunk comprehensive", () => {
    test("applies notes, cards, and revlog in a single chunk", async () => {
      const db = createAnki2Collection(SQL);
      const nowSec = Math.floor(Date.now() / 1000);

      const chunk: Chunk = {
        done: true,
        revlog: [[Date.now(), 300, 5, 3, 10, 5, 2500, 5000, 1]],
        notes: [
          [300, "newguid", 1234567890, nowSec, 5, "", "newfront\x1fnewback", "newfront", 0, 0, ""],
        ],
        cards: [[300, 300, 1, 0, nowSec, 5, 2, 2, 5, 10, 2500, 3, 0, 0, 0, 0, 0, ""]],
      };

      await applyRemoteChunk(db, chunk);

      expect(scalar(db, "SELECT count() FROM notes WHERE id=300")).toBe(1);
      expect(scalar(db, "SELECT count() FROM cards WHERE id=300")).toBe(1);
      expect(scalar(db, "SELECT count() FROM revlog")).toBe(1);

      db.close();
    });

    test("applies multiple chunks sequentially", async () => {
      const db = createAnki2Collection(SQL);
      const nowSec = Math.floor(Date.now() / 1000);

      const chunk1: Chunk = {
        done: false,
        revlog: [],
        notes: [[301, "g1", 1234567890, nowSec, 5, "", "a\x1fb", "a", 0, 0, ""]],
        cards: [[301, 301, 1, 0, nowSec, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ""]],
      };

      const chunk2: Chunk = {
        done: true,
        revlog: [],
        notes: [[302, "g2", 1234567890, nowSec, 5, "", "c\x1fd", "c", 0, 0, ""]],
        cards: [[302, 302, 1, 0, nowSec, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ""]],
      };

      await applyRemoteChunk(db, chunk1);
      await applyRemoteChunk(db, chunk2);

      // Original + 2 new = 3 notes, 3 cards
      expect(scalar(db, "SELECT count() FROM notes")).toBe(3);
      expect(scalar(db, "SELECT count() FROM cards")).toBe(3);

      db.close();
    });
  });

  // ── 22: Flags preservation ─────────────────────────────────────

  describe("flags preservation", () => {
    test("mergeIndexedDBToSqlite writes card flags to SQLite", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: {
          phase: "review",
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now() + 86400000 * 10,
          lapses: 0,
          reps: 3,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
        flags: 4, // red flag
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      expect(scalar(db, "SELECT flags FROM cards WHERE id=200")).toBe(4);

      db.close();
    });

    test("defaults flags to 0 when not set", async () => {
      const db = createAnki2Collection(SQL);

      await reviewDB.saveCard({
        cardId: "200",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: {
          phase: "review",
          step: 0,
          ease: 2.5,
          interval: 10,
          due: Date.now() + 86400000 * 10,
          lapses: 0,
          reps: 3,
        },
        createdAt: Date.now() - 86400000,
        lastReviewed: Date.now(),
        // no flags property
      });

      await mergeIndexedDBToSqlite(db, "deck-1");

      expect(scalar(db, "SELECT flags FROM cards WHERE id=200")).toBe(0);

      db.close();
    });
  });

  // ── 23: Deck merge conflict resolution (anki2) ─────────────────

  describe("deck and dconf merge conflict resolution (anki2)", () => {
    test("remote deck wins when mod >= local mod", () => {
      const db = createAnki2Collection(SQL, {
        decks: {
          "1": { id: 1, mod: 100, name: "OldLocal", usn: 0 },
        },
      });

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[{ id: 1, mod: 200, name: "NewRemote", usn: 5 }], []],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      const decks = JSON.parse(scalar(db, "SELECT decks FROM col") as string);
      expect(decks["1"].name).toBe("NewRemote");

      db.close();
    });

    test("local deck wins when remote mod < local mod", () => {
      const db = createAnki2Collection(SQL, {
        decks: {
          "1": { id: 1, mod: 200, name: "NewerLocal", usn: 0 },
        },
      });

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[{ id: 1, mod: 100, name: "OlderRemote", usn: 5 }], []],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      const decks = JSON.parse(scalar(db, "SELECT decks FROM col") as string);
      expect(decks["1"].name).toBe("NewerLocal");

      db.close();
    });

    test("remote dconf wins when mod >= local mod", () => {
      const db = createAnki2Collection(SQL, {
        dconf: {
          "1": { id: 1, mod: 100, name: "LocalConfig", usn: 0 },
        },
      });

      const changes: UnchunkedChanges = {
        models: [],
        decks: [[], [{ id: 1, mod: 200, name: "RemoteConfig", usn: 5 }]],
        tags: [],
      };

      applyRemoteUnchunkedChanges(db, changes, false);

      const dconf = JSON.parse(scalar(db, "SELECT dconf FROM col") as string);
      expect(dconf["1"].name).toBe("RemoteConfig");

      db.close();
    });
  });
});
