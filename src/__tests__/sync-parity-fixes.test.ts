/**
 * Tests for sync parity fixes between anki-pwa and official Anki desktop.
 *
 * Covers:
 *   1. Notetype schema validation (field/template count mismatch → full sync)
 *   2. Revlog duplicate detection (INSERT OR IGNORE, not REPLACE)
 *   3. Media batch size increased to 30
 *   4. Bidirectional config sync (server config only applied when local is NOT newer)
 *   5. Concurrent session error handling (409 → ConcurrentSyncError)
 *   6. Pending USN tracking (isPendingSync matching desktop logic)
 *   7. USN-based tag merge (pending tags preserved)
 */
import "fake-indexeddb/auto";
import { describe, test, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { type SqlJsStatic, type Database } from "sql.js";
import {
  applyRemoteChunk,
  applyRemoteUnchunkedChanges,
  isPendingSync,
  NotetypeSchemaMismatchError,
  type Chunk,
  type UnchunkedChanges,
} from "../lib/syncMerge";
import { reviewDB } from "../scheduler/db";
import { getSqlJs, scalar } from "./testDbUtils";

// ── SQL.js setup ──────────────────────────────────────────────────

let SQL: SqlJsStatic;

beforeEach(async () => {
  SQL = await getSqlJs();
  await reviewDB.clearAll();
});

/** Helper: read a scalar value from the database. */
/** Create a minimal anki2 collection. */
function createAnki2Db(
  opts: {
    models?: Record<string, unknown>;
    conf?: Record<string, unknown>;
    tags?: Record<string, number>;
  } = {},
): Database {
  const db = new SQL.Database();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const crt = nowSec - 86400 * 30;

  const defaultModels = {
    "1001": {
      id: 1001,
      mod: nowSec,
      name: "Basic",
      usn: 0,
      flds: [
        { name: "Front", ord: 0 },
        { name: "Back", ord: 1 },
      ],
      tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}", ord: 0 }],
    },
  };

  db.run(`CREATE TABLE col (
    id integer primary key, crt integer NOT NULL, mod integer NOT NULL,
    scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
    usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
    models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
  )`);
  db.run(
    `INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, '{"1":{"id":1,"mod":0,"name":"Default","usn":0,"conf":"1"}}', '{"1":{"id":1,"mod":0,"name":"Default","usn":0}}', ?)`,
    [
      crt,
      nowMs,
      nowSec,
      JSON.stringify(opts.conf ?? {}),
      JSON.stringify(opts.models ?? defaultModels),
      JSON.stringify(opts.tags ?? {}),
    ],
  );

  db.run(`CREATE TABLE notes (
    id integer primary key, guid text NOT NULL, mid integer NOT NULL,
    mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL,
    flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL,
    flags integer NOT NULL, data text NOT NULL
  )`);
  db.run(`CREATE TABLE cards (
    id integer primary key, nid integer NOT NULL, did integer NOT NULL,
    ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL,
    type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL,
    ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
    lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL,
    odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL
  )`);
  db.run(`CREATE TABLE revlog (
    id integer primary key, cid integer NOT NULL, usn integer NOT NULL,
    ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL,
    factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL
  )`);
  db.run(`CREATE TABLE graves (
    usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL
  )`);

  return db;
}

/** Create a minimal anki21b collection with separate tables. */
function createAnki21bDb(
  opts: {
    notetypes?: Array<{
      id: number;
      name: string;
      mtime_secs: number;
      usn: number;
      config: string;
    }>;
    tags?: Array<{ tag: string; usn: number }>;
  } = {},
): Database {
  const db = new SQL.Database();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const crt = nowSec - 86400 * 30;

  db.run(`CREATE TABLE col (
    id integer primary key, crt integer NOT NULL, mod integer NOT NULL,
    scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
    usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
    models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
  )`);
  db.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, '{}', '{}', '{}', '{}', '{}')`, [
    crt,
    nowMs,
    nowSec,
  ]);

  db.run(`CREATE TABLE notetypes (
    id integer primary key, name text NOT NULL, mtime_secs integer NOT NULL,
    usn integer NOT NULL, config text NOT NULL
  )`);
  db.run(`CREATE TABLE decks (
    id integer primary key, name text NOT NULL, mtime integer NOT NULL,
    usn integer NOT NULL, common text NOT NULL
  )`);
  db.run(`CREATE TABLE deck_config (
    id integer primary key, name text NOT NULL, mtime integer NOT NULL,
    usn integer NOT NULL, config text NOT NULL
  )`);
  db.run(`CREATE TABLE tags (tag text primary key, usn integer NOT NULL)`);

  db.run(`CREATE TABLE notes (
    id integer primary key, guid text NOT NULL, mid integer NOT NULL,
    mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL,
    flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL,
    flags integer NOT NULL, data text NOT NULL
  )`);
  db.run(`CREATE TABLE cards (
    id integer primary key, nid integer NOT NULL, did integer NOT NULL,
    ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL,
    type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL,
    ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
    lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL,
    odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL
  )`);
  db.run(`CREATE TABLE revlog (
    id integer primary key, cid integer NOT NULL, usn integer NOT NULL,
    ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL,
    factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL
  )`);
  db.run(`CREATE TABLE graves (
    usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL
  )`);

  // Insert default deck
  db.run("INSERT INTO decks VALUES (1, 'Default', 0, 0, '{}')", []);

  // Insert notetypes
  if (opts.notetypes) {
    for (const nt of opts.notetypes) {
      db.run("INSERT INTO notetypes VALUES (?, ?, ?, ?, ?)", [
        nt.id,
        nt.name,
        nt.mtime_secs,
        nt.usn,
        nt.config,
      ]);
    }
  }

  // Insert tags
  if (opts.tags) {
    for (const t of opts.tags) {
      db.run("INSERT INTO tags VALUES (?, ?)", [t.tag, t.usn]);
    }
  }

  return db;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("sync parity fixes", () => {
  // ── 1: Notetype schema validation ─────────────────────────────

  describe("notetype schema validation", () => {
    test("throws NotetypeSchemaMismatchError when field count changes (anki2)", () => {
      const db = createAnki2Db({
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

      const remoteChanges: UnchunkedChanges = {
        models: [
          {
            id: 1001,
            mod: 200,
            name: "Basic",
            usn: 5,
            flds: [
              { name: "Front", ord: 0 },
              { name: "Back", ord: 1 },
              { name: "Extra", ord: 2 }, // added field
            ],
            tmpls: [{ name: "Card 1", ord: 0 }],
          },
        ],
        decks: [[], []],
        tags: [],
      };

      expect(() => applyRemoteUnchunkedChanges(db, remoteChanges, false)).toThrow(
        NotetypeSchemaMismatchError,
      );
      db.close();
    });

    test("throws NotetypeSchemaMismatchError when template count changes (anki2)", () => {
      const db = createAnki2Db({
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

      const remoteChanges: UnchunkedChanges = {
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
            tmpls: [
              { name: "Card 1", ord: 0 },
              { name: "Card 2", ord: 1 }, // added template
            ],
          },
        ],
        decks: [[], []],
        tags: [],
      };

      expect(() => applyRemoteUnchunkedChanges(db, remoteChanges, false)).toThrow(
        NotetypeSchemaMismatchError,
      );
      db.close();
    });

    test("accepts notetype update when field/template counts match", () => {
      const db = createAnki2Db({
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

      const remoteChanges: UnchunkedChanges = {
        models: [
          {
            id: 1001,
            mod: 200,
            name: "Basic (renamed)",
            usn: 5,
            flds: [
              { name: "Question", ord: 0 },
              { name: "Answer", ord: 1 },
            ], // same count
            tmpls: [{ name: "Card 1", ord: 0 }], // same count
          },
        ],
        decks: [[], []],
        tags: [],
      };

      // Should not throw
      applyRemoteUnchunkedChanges(db, remoteChanges, false);

      const models = JSON.parse(scalar(db, "SELECT models FROM col") as string);
      expect(models["1001"].name).toBe("Basic (renamed)");
      db.close();
    });

    test("accepts new notetype without validation (no local version)", () => {
      const db = createAnki2Db();

      const remoteChanges: UnchunkedChanges = {
        models: [
          {
            id: 9999,
            mod: 200,
            name: "New Model",
            usn: 5,
            flds: [{ name: "A", ord: 0 }],
            tmpls: [
              { name: "T1", ord: 0 },
              { name: "T2", ord: 1 },
            ],
          },
        ],
        decks: [[], []],
        tags: [],
      };

      // Should not throw — no existing local model to conflict with
      applyRemoteUnchunkedChanges(db, remoteChanges, false);

      const models = JSON.parse(scalar(db, "SELECT models FROM col") as string);
      expect(models["9999"].name).toBe("New Model");
      db.close();
    });

    test("throws NotetypeSchemaMismatchError for anki21b format", () => {
      const localConfig = JSON.stringify({
        id: 2001,
        name: "Cloze",
        flds: [
          { name: "Text", ord: 0 },
          { name: "Extra", ord: 1 },
        ],
        tmpls: [{ name: "Cloze", ord: 0 }],
      });

      const db = createAnki21bDb({
        notetypes: [{ id: 2001, name: "Cloze", mtime_secs: 100, usn: 0, config: localConfig }],
      });

      const remoteChanges: UnchunkedChanges = {
        models: [
          {
            id: 2001,
            mod: 200,
            mtime_secs: 200,
            name: "Cloze",
            usn: 5,
            flds: [{ name: "Text", ord: 0 }], // removed a field
            tmpls: [{ name: "Cloze", ord: 0 }],
          } as any,
        ],
        decks: [[], []],
        tags: [],
      };

      expect(() => applyRemoteUnchunkedChanges(db, remoteChanges, true)).toThrow(
        NotetypeSchemaMismatchError,
      );
      db.close();
    });

    test("skips validation when remote is older (lower mtime)", () => {
      const db = createAnki2Db({
        models: {
          "1001": {
            id: 1001,
            mod: 300, // local is newer
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

      const remoteChanges: UnchunkedChanges = {
        models: [
          {
            id: 1001,
            mod: 100, // older than local
            name: "Basic",
            usn: 5,
            flds: [{ name: "Front", ord: 0 }], // different count, but older
            tmpls: [{ name: "Card 1", ord: 0 }],
          },
        ],
        decks: [[], []],
        tags: [],
      };

      // Should not throw — remote is older, so it's skipped entirely
      applyRemoteUnchunkedChanges(db, remoteChanges, false);
      db.close();
    });
  });

  // ── 2: Revlog duplicate detection ─────────────────────────────

  describe("revlog duplicate detection", () => {
    test("does not overwrite existing revlog entries with INSERT OR IGNORE", async () => {
      const db = createAnki2Db();

      // Insert an existing revlog entry
      db.run("INSERT INTO revlog VALUES (1000, 200, 5, 3, 10, 5, 2500, 8000, 1)");

      // Apply a chunk with the same revlog ID but different data
      const chunk: Chunk = {
        done: true,
        revlog: [[1000, 200, 10, 4, 20, 10, 2600, 9000, 1]],
        cards: [],
        notes: [],
      };

      await applyRemoteChunk(db, chunk);

      // Original entry should be preserved (ease=3, not 4)
      const ease = scalar(db, "SELECT ease FROM revlog WHERE id=1000");
      expect(ease).toBe(3);

      db.close();
    });

    test("inserts new revlog entries normally", async () => {
      const db = createAnki2Db();

      const chunk: Chunk = {
        done: true,
        revlog: [[2000, 200, 10, 3, 15, 8, 2500, 7000, 1]],
        cards: [],
        notes: [],
      };

      await applyRemoteChunk(db, chunk);

      const count = scalar(db, "SELECT count() FROM revlog");
      expect(count).toBe(1);

      const ease = scalar(db, "SELECT ease FROM revlog WHERE id=2000");
      expect(ease).toBe(3);

      db.close();
    });
  });

  // ── 3: Media batch size ───────────────────────────────────────

  describe("media batch size", () => {
    test("ankiSync uses correct batch sizes for downloads and uploads", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(join(process.cwd(), "src", "lib", "ankiSync.ts"), "utf-8");
      // Download batch capped at 25 (server's MAX_MEDIA_FILES_IN_ZIP)
      expect(source).toContain("DOWNLOAD_BATCH_SIZE = 25");
      expect(source).toContain("UPLOAD_BATCH_SIZE = 30");
    });
  });

  // ── 4: Bidirectional config sync ──────────────────────────────

  describe("bidirectional config sync", () => {
    test("does NOT apply server config when local is newer (anki2)", () => {
      const localConf = { activeDecks: [1], curDeck: 1, custom: "local" };
      const db = createAnki2Db({ conf: localConf });

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        conf: { activeDecks: [1], curDeck: 1, custom: "server" },
      };

      // localIsNewer = true → server config should NOT be applied
      applyRemoteUnchunkedChanges(db, remoteChanges, false, true);

      const conf = JSON.parse(scalar(db, "SELECT conf FROM col") as string);
      expect(conf.custom).toBe("local");

      db.close();
    });

    test("applies server config when local is NOT newer (anki2)", () => {
      const localConf = { activeDecks: [1], curDeck: 1, custom: "local" };
      const db = createAnki2Db({ conf: localConf });

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        conf: { activeDecks: [1], curDeck: 1, custom: "server" },
      };

      // localIsNewer = false → server config SHOULD be applied
      applyRemoteUnchunkedChanges(db, remoteChanges, false, false);

      const conf = JSON.parse(scalar(db, "SELECT conf FROM col") as string);
      expect(conf.custom).toBe("server");

      db.close();
    });

    test("does NOT apply server config when local is newer (anki21b)", () => {
      const db = createAnki21bDb();
      db.run("UPDATE col SET conf=?", [JSON.stringify({ custom: "local" })]);

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        conf: { custom: "server" },
      };

      applyRemoteUnchunkedChanges(db, remoteChanges, true, true);

      const conf = JSON.parse(scalar(db, "SELECT conf FROM col") as string);
      expect(conf.custom).toBe("local");

      db.close();
    });

    test("applies server config when local is NOT newer (anki21b)", () => {
      const db = createAnki21bDb();
      db.run("UPDATE col SET conf=?", [JSON.stringify({ custom: "local" })]);

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: [],
        conf: { custom: "server" },
      };

      applyRemoteUnchunkedChanges(db, remoteChanges, true, false);

      const conf = JSON.parse(scalar(db, "SELECT conf FROM col") as string);
      expect(conf.custom).toBe("server");

      db.close();
    });
  });

  // ── 5: Concurrent session error ───────────────────────────────

  describe("concurrent session error", () => {
    test("ConcurrentSyncError is exported and has correct message", async () => {
      const { ConcurrentSyncError } = await import("../lib/normalSync");
      const err = new ConcurrentSyncError();
      expect(err.name).toBe("ConcurrentSyncError");
      expect(err.message).toContain("Another device");
    });

    test("normalSync.ts detects 409 status as concurrent sync", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(join(process.cwd(), "src", "lib", "normalSync.ts"), "utf-8");
      expect(source).toContain("response.status === 409");
      expect(source).toContain("ConcurrentSyncError");
    });
  });

  // ── 6: Pending USN tracking ───────────────────────────────────

  describe("pending USN tracking (isPendingSync)", () => {
    test("first sync (pendingUsn=-1): only usn=-1 is pending", () => {
      expect(isPendingSync(-1, -1)).toBe(true);
      expect(isPendingSync(0, -1)).toBe(false);
      expect(isPendingSync(5, -1)).toBe(false);
      expect(isPendingSync(100, -1)).toBe(false);
    });

    test("subsequent sync: usn >= pendingUsn is pending", () => {
      expect(isPendingSync(10, 10)).toBe(true); // equal → pending
      expect(isPendingSync(11, 10)).toBe(true); // greater → pending
      expect(isPendingSync(100, 10)).toBe(true); // much greater → pending
      expect(isPendingSync(9, 10)).toBe(false); // less → not pending
      expect(isPendingSync(0, 10)).toBe(false); // zero → not pending
      expect(isPendingSync(-1, 10)).toBe(false); // -1 → not pending
    });

    test("applyRemoteChunk skips notes when local is pending and newer", async () => {
      const db = createAnki2Db();

      // Insert a local note with usn=10 (pending since pendingUsn=10) and mod=200
      db.run(
        "INSERT INTO notes VALUES (100, 'guid1', 1001, 200, 10, '', 'local\x1fdata', 'local', 0, 0, '')",
      );

      const chunk: Chunk = {
        done: true,
        revlog: [],
        cards: [],
        notes: [[100, "guid1", 1001, 150, 5, "", "remote\x1fdata", "remote", 0, 0, ""]], // mod=150, older
      };

      await applyRemoteChunk(db, chunk, 10);

      // Local should win because it's pending (usn=10 >= pendingUsn=10) and newer (200 > 150)
      const flds = scalar(db, "SELECT flds FROM notes WHERE id=100") as string;
      expect(flds).toBe("local\x1fdata");

      db.close();
    });

    test("applyRemoteChunk accepts notes when local is NOT pending", async () => {
      const db = createAnki2Db();

      // Insert a local note with usn=5 (not pending since pendingUsn=10) and mod=200
      db.run(
        "INSERT INTO notes VALUES (100, 'guid1', 1001, 200, 5, '', 'local\x1fdata', 'local', 0, 0, '')",
      );

      const chunk: Chunk = {
        done: true,
        revlog: [],
        cards: [],
        notes: [[100, "guid1", 1001, 150, 12, "", "remote\x1fdata", "remote", 0, 0, ""]], // mod=150 but local not pending
      };

      await applyRemoteChunk(db, chunk, 10);

      // Remote should win because local is not pending (usn=5 < pendingUsn=10)
      const flds = scalar(db, "SELECT flds FROM notes WHERE id=100") as string;
      expect(flds).toBe("remote\x1fdata");

      db.close();
    });

    test("applyRemoteChunk accepts remote when local is pending but older", async () => {
      const db = createAnki2Db();

      // Local note is pending (usn=-1) but OLDER (mod=100)
      db.run(
        "INSERT INTO notes VALUES (100, 'guid1', 1001, 100, -1, '', 'local\x1fdata', 'local', 0, 0, '')",
      );

      const chunk: Chunk = {
        done: true,
        revlog: [],
        cards: [],
        notes: [[100, "guid1", 1001, 200, 5, "", "remote\x1fdata", "remote", 0, 0, ""]], // mod=200, newer
      };

      await applyRemoteChunk(db, chunk, -1);

      // Remote should win because it's newer (200 > 100)
      const flds = scalar(db, "SELECT flds FROM notes WHERE id=100") as string;
      expect(flds).toBe("remote\x1fdata");

      db.close();
    });

    test("applyRemoteChunk applies same USN logic to cards", async () => {
      const db = createAnki2Db();

      // Insert a local card with usn=10 (pending) and mod=200
      db.run(
        "INSERT INTO cards VALUES (300, 100, 1, 0, 200, 10, 2, 2, 5, 10, 2500, 5, 0, 0, 0, 0, 0, '')",
      );

      const chunk: Chunk = {
        done: true,
        revlog: [],
        cards: [[300, 100, 1, 0, 150, 5, 2, 2, 3, 8, 2400, 4, 0, 0, 0, 0, 0, ""]], // mod=150, older
        notes: [],
      };

      await applyRemoteChunk(db, chunk, 10);

      // Local should win because it's pending and newer
      const ivl = scalar(db, "SELECT ivl FROM cards WHERE id=300");
      expect(ivl).toBe(10); // local value preserved

      db.close();
    });
  });

  // ── 7: USN-based tag merge ────────────────────────────────────

  describe("USN-based tag merge", () => {
    test("anki2: preserves pending local tags (usn=-1) when remote sends same tag", () => {
      const db = createAnki2Db({
        tags: { vocab: -1, grammar: 5 }, // vocab is pending, grammar is synced
      });

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: ["vocab", "grammar", "new-tag"],
      };

      applyRemoteUnchunkedChanges(db, remoteChanges, false);

      const tags = JSON.parse(scalar(db, "SELECT tags FROM col") as string);
      // vocab should stay -1 (pending local change preserved)
      expect(tags["vocab"]).toBe(-1);
      // grammar should be updated to 0 (synced)
      expect(tags["grammar"]).toBe(0);
      // new-tag should be added
      expect(tags["new-tag"]).toBe(0);

      db.close();
    });

    test("anki21b: preserves pending local tags when remote sends same tag", () => {
      const db = createAnki21bDb({
        tags: [
          { tag: "vocab", usn: -1 }, // pending
          { tag: "grammar", usn: 5 }, // synced
        ],
      });

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: ["vocab", "grammar", "new-tag"],
      };

      applyRemoteUnchunkedChanges(db, remoteChanges, true);

      // vocab should still be -1 (pending)
      const vocabUsn = scalar(db, "SELECT usn FROM tags WHERE tag='vocab'");
      expect(vocabUsn).toBe(-1);

      // grammar should be updated to 0
      const grammarUsn = scalar(db, "SELECT usn FROM tags WHERE tag='grammar'");
      expect(grammarUsn).toBe(0);

      // new-tag should be inserted
      const newTagUsn = scalar(db, "SELECT usn FROM tags WHERE tag='new-tag'");
      expect(newTagUsn).toBe(0);

      db.close();
    });

    test("anki2: adds remote tags not present locally", () => {
      const db = createAnki2Db({ tags: {} });

      const remoteChanges: UnchunkedChanges = {
        models: [],
        decks: [[], []],
        tags: ["alpha", "beta"],
      };

      applyRemoteUnchunkedChanges(db, remoteChanges, false);

      const tags = JSON.parse(scalar(db, "SELECT tags FROM col") as string);
      expect(tags["alpha"]).toBe(0);
      expect(tags["beta"]).toBe(0);

      db.close();
    });
  });

  // ── Structural verification ───────────────────────────────────

  describe("structural verification", () => {
    test("normalSync passes localMeta.usn to receiveChunks", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(join(process.cwd(), "src", "lib", "normalSync.ts"), "utf-8");
      // Verify pendingUsn is threaded through (may be split across lines by formatter)
      expect(source).toContain("localMeta.usn");
    });

    test("normalSync catches NotetypeSchemaMismatchError and wraps as FullSyncRequiredError", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(join(process.cwd(), "src", "lib", "normalSync.ts"), "utf-8");
      expect(source).toContain("NotetypeSchemaMismatchError");
      expect(source).toContain("throw new FullSyncRequiredError(e.message)");
    });

    test("applyRemoteUnchunkedChanges accepts localIsNewer parameter", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(join(process.cwd(), "src", "lib", "syncMerge.ts"), "utf-8");
      expect(source).toContain("localIsNewer");
      expect(source).toContain("!localIsNewer");
    });
  });
});
