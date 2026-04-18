/**
 * Shared test utilities for SQL.js database tests.
 */
import initSqlJs, { type SqlJsStatic, type Database } from "sql.js";
import { join } from "node:path";

let _SQL: SqlJsStatic | undefined;

/** Lazily initialize and return the SQL.js static instance. */
export async function getSqlJs(): Promise<SqlJsStatic> {
  if (!_SQL) {
    const wasmPath = join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
    _SQL = await initSqlJs({ locateFile: () => wasmPath });
  }
  return _SQL;
}

/** Read a scalar value from the database. */
export function scalar(db: Database, sql: string): unknown {
  const r = db.exec(sql);
  return r[0]?.values[0]?.[0] ?? null;
}

// ── Anki2 schema & factory ──────────────────────────────────────────

const ANKI2_SCHEMA = `
CREATE TABLE col (
  id integer primary key, crt integer NOT NULL, mod integer NOT NULL,
  scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
  usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
  models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
);
CREATE TABLE notes (
  id integer primary key, guid text NOT NULL, mid integer NOT NULL,
  mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL,
  flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL,
  flags integer NOT NULL, data text NOT NULL
);
CREATE TABLE cards (
  id integer primary key, nid integer NOT NULL, did integer NOT NULL,
  ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL,
  type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL,
  ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
  lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL,
  odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL
);
CREATE TABLE revlog (
  id integer primary key, cid integer NOT NULL, usn integer NOT NULL,
  ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL,
  factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL
);
CREATE TABLE graves (
  usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL
);
`;

const INSERT_CARD_SQL = "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

function insertCard(db: Database, overrides: Record<string, unknown>, nowSec: number) {
  const c = {
    id: 201,
    nid: 100,
    did: 1,
    ord: 0,
    mod: nowSec,
    usn: 0,
    type: 0,
    queue: 0,
    due: 0,
    ivl: 0,
    factor: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    odue: 0,
    odid: 0,
    flags: 0,
    data: "",
    ...overrides,
  };
  db.run(INSERT_CARD_SQL, [
    c.id,
    c.nid,
    c.did,
    c.ord,
    c.mod,
    c.usn,
    c.type,
    c.queue,
    c.due,
    c.ivl,
    c.factor,
    c.reps,
    c.lapses,
    c.left,
    c.odue,
    c.odid,
    c.flags,
    c.data,
  ]);
}

/** Create a minimal anki2 collection with proper schema. */
export function createAnki2Collection(
  SQL: SqlJsStatic,
  opts: {
    dconf?: Record<string, unknown>;
    decks?: Record<string, unknown>;
    models?: Record<string, unknown>;
    tags?: Record<string, number>;
    conf?: Record<string, unknown>;
    cardOverrides?: Record<string, unknown>;
    extraCards?: Array<Record<string, unknown>>;
    extraNotes?: Array<Record<string, unknown>>;
  } = {},
): Database {
  const db = new SQL.Database();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const crt = nowSec - 86400 * 30;

  const defaultDconf = {
    "1": {
      id: 1,
      mod: nowSec,
      name: "Default",
      usn: 0,
      new: { delays: [1, 10], order: 1, perDay: 20 },
      lapse: { delays: [10], minInt: 1, mult: 0, leechFails: 8 },
      rev: { perDay: 200, ease4: 1.3, hardFactor: 1.2, ivlFct: 1.0, maxIvl: 36500, fuzz: true },
    },
  };

  const defaultDecks = {
    "1": { id: 1, mod: nowSec, name: "Default", usn: 0, conf: "1" },
  };

  const defaultModels = {
    "1234567890": {
      id: 1234567890,
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

  db.run(ANKI2_SCHEMA);
  db.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)`, [
    crt,
    nowMs,
    nowSec,
    JSON.stringify(opts.conf ?? {}),
    JSON.stringify(opts.models ?? defaultModels),
    JSON.stringify(opts.decks ?? defaultDecks),
    JSON.stringify(opts.dconf ?? defaultDconf),
    JSON.stringify(opts.tags ?? {}),
  ]);

  // Insert default note
  db.run(
    `INSERT INTO notes VALUES (100, 'abc123', 1234567890, ?, 0, '', 'front\x1fback', 'front', 0, 0, '')`,
    [nowSec],
  );

  // Insert extra notes
  for (const note of opts.extraNotes ?? []) {
    const n = {
      id: 101,
      guid: "def456",
      mid: 1234567890,
      mod: nowSec,
      usn: 0,
      tags: "",
      flds: "q\x1fa",
      sfld: "q",
      csum: 0,
      flags: 0,
      data: "",
      ...note,
    };
    db.run("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
      n.id,
      n.guid,
      n.mid,
      n.mod,
      n.usn,
      n.tags,
      n.flds,
      n.sfld,
      n.csum,
      n.flags,
      n.data,
    ]);
  }

  const cardDefaults = {
    id: 200,
    nid: 100,
    did: 1,
    ord: 0,
    mod: nowSec,
    usn: 0,
    type: 0,
    queue: 0,
    due: 0,
    ivl: 0,
    factor: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    odue: 0,
    odid: 0,
    flags: 0,
    data: "",
    ...opts.cardOverrides,
  };
  db.run(INSERT_CARD_SQL, [
    cardDefaults.id,
    cardDefaults.nid,
    cardDefaults.did,
    cardDefaults.ord,
    cardDefaults.mod,
    cardDefaults.usn,
    cardDefaults.type,
    cardDefaults.queue,
    cardDefaults.due,
    cardDefaults.ivl,
    cardDefaults.factor,
    cardDefaults.reps,
    cardDefaults.lapses,
    cardDefaults.left,
    cardDefaults.odue,
    cardDefaults.odid,
    cardDefaults.flags,
    cardDefaults.data,
  ]);

  // Insert extra cards
  for (const card of opts.extraCards ?? []) {
    insertCard(db, card, nowSec);
  }

  return db;
}

// ── Anki21b schema & factory ────────────────────────────────────────

const ANKI21B_EXTRA_SCHEMA = `
CREATE TABLE notetypes (
  id integer primary key, name text NOT NULL, mtime_secs integer NOT NULL,
  usn integer NOT NULL, config text NOT NULL
);
CREATE TABLE decks (
  id integer primary key, name text NOT NULL, mtime integer NOT NULL,
  usn integer NOT NULL, common text NOT NULL
);
CREATE TABLE deck_config (
  id integer primary key, name text NOT NULL, mtime integer NOT NULL,
  usn integer NOT NULL, config text NOT NULL
);
CREATE TABLE tags (tag text primary key, usn integer NOT NULL);
`;

/** Create a minimal anki21b collection with separate tables. */
export function createAnki21bDb(
  SQL: SqlJsStatic,
  opts: {
    notetypes?: Array<{
      id: number;
      name: string;
      mtime_secs: number;
      usn: number;
      config: string;
    }>;
    decks?: Array<{ id: number; name: string; mtime: number; usn: number; common: string }>;
    deckConfigs?: Array<{ id: number; name: string; mtime: number; usn: number; config: string }>;
    tags?: Array<{ tag: string; usn: number }>;
    conf?: Record<string, unknown>;
  } = {},
): Database {
  const db = new SQL.Database();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const crt = nowSec - 86400 * 30;

  db.run(ANKI2_SCHEMA);
  db.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, '{}', '{}', '{}', '{}')`, [
    crt,
    nowMs,
    nowSec,
    JSON.stringify(opts.conf ?? {}),
  ]);

  db.run(ANKI21B_EXTRA_SCHEMA);

  // Insert default deck
  db.run("INSERT INTO decks VALUES (1, 'Default', 0, 0, '{}')");

  for (const d of opts.decks ?? []) {
    db.run("INSERT OR REPLACE INTO decks VALUES (?,?,?,?,?)", [
      d.id,
      d.name,
      d.mtime,
      d.usn,
      d.common,
    ]);
  }
  for (const nt of opts.notetypes ?? []) {
    db.run("INSERT INTO notetypes VALUES (?,?,?,?,?)", [
      nt.id,
      nt.name,
      nt.mtime_secs,
      nt.usn,
      nt.config,
    ]);
  }
  for (const dc of opts.deckConfigs ?? []) {
    db.run("INSERT INTO deck_config VALUES (?,?,?,?,?)", [
      dc.id,
      dc.name,
      dc.mtime,
      dc.usn,
      dc.config,
    ]);
  }
  for (const t of opts.tags ?? []) {
    db.run("INSERT INTO tags VALUES (?,?)", [t.tag, t.usn]);
  }

  return db;
}
