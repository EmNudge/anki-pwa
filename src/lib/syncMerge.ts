/**
 * Merge logic for normal (incremental) sync.
 * Handles applying remote changes to the local SQLite and building
 * local changes to send to the server.
 */
import type { Database } from "sql.js";

const CHUNK_SIZE = 250;

// ── Types ──────────────────────────────────────────────────────────

export interface Graves {
  cards: number[];
  notes: number[];
  decks: number[];
}

/**
 * A revlog row: [id, cid, usn, ease, ivl, lastIvl, factor, time, type]
 */
export type RevlogRow = [
  id: number,
  cid: number,
  usn: number,
  ease: number,
  ivl: number,
  lastIvl: number,
  factor: number,
  time: number,
  type: number,
];

/**
 * A note row: [id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data]
 */
export type NoteRow = [
  id: number,
  guid: string,
  mid: number,
  mod: number,
  usn: number,
  tags: string,
  flds: string,
  sfld: string,
  csum: number,
  flags: number,
  data: string,
];

/**
 * A card row: [id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data]
 */
export type CardRow = [
  id: number,
  nid: number,
  did: number,
  ord: number,
  mod: number,
  usn: number,
  type: number,
  queue: number,
  due: number,
  ivl: number,
  factor: number,
  reps: number,
  lapses: number,
  left: number,
  odue: number,
  odid: number,
  flags: number,
  data: string,
];

export interface Chunk {
  done: boolean;
  revlog: RevlogRow[];
  cards: CardRow[];
  notes: NoteRow[];
}

/** Model/notetype object from sync (anki2 format). */
export interface SyncModel {
  id: number;
  mod?: number;
  name?: string;
  usn?: number;
  [key: string]: unknown;
}

/** Deck object from sync. */
export interface SyncDeck {
  id: number;
  mod?: number;
  mtime?: number;
  name?: string;
  usn?: number;
  [key: string]: unknown;
}

/** Deck config object from sync. */
export interface SyncDeckConfig {
  id: number;
  mod?: number;
  mtime?: number;
  name?: string;
  usn?: number;
  [key: string]: unknown;
}

export interface UnchunkedChanges {
  models: SyncModel[];
  decks: [SyncDeck[], SyncDeckConfig[]];
  tags: string[];
  conf?: Record<string, unknown>;
  crt?: number;
}

/**
 * Sanity check counts as a tuple array matching Anki's Serialize_tuple format:
 * [[new, learn, review], cards, notes, revlog, graves, models, decks, deckConfig]
 */
export type SanityCheckCounts = [
  dueCounts: [newCount: number, learnCount: number, reviewCount: number],
  cards: number,
  notes: number,
  revlog: number,
  graves: number,
  models: number,
  decks: number,
  deckConfig: number,
];

// ── Database format detection ─────────���────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────

/** Read a JSON column from the `col` table and parse it, returning a fallback on failure. */
function getColJson<T>(db: Database, column: string, fallback: T): T {
  const result = db.exec(`SELECT ${column} FROM col`);
  const raw = result[0]?.values[0]?.[0];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw as string);
  } catch {
    return fallback;
  }
}

/**
 * Merge remote items into a local JSON column of the `col` table (anki2 format).
 * Uses mod-time conflict resolution: remote wins if its mod >= local mod.
 */
function mergeColJsonField<T extends { id: number; mod?: number }>(
  db: Database,
  column: string,
  remoteItems: T[],
): void {
  if (remoteItems.length === 0) return;
  const local = getColJson<Record<string, T>>(db, column, {});
  for (const item of remoteItems) {
    const existing = local[String(item.id)];
    if (!existing || (item.mod ?? 0) >= (existing.mod ?? 0)) {
      local[String(item.id)] = item;
    }
  }
  db.run(`UPDATE col SET ${column}=?`, [JSON.stringify(local)]);
}

/** Returns true if the DB uses the anki21b format (separate notetypes table). */
export function isAnki21bFormat(db: Database): boolean {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'");
  return (result[0]?.values.length ?? 0) > 0;
}

// ── Apply remote data ─────────��────────────────────────────────────

/** Delete cards/notes/decks from SQLite and IndexedDB based on remote graves. */
export async function applyRemoteGraves(db: Database, graves: Graves): Promise<void> {
  const { reviewDB } = await import("../scheduler/db");

  // Delete cards
  if (graves.cards.length > 0) {
    for (const cardId of graves.cards) {
      db.run("DELETE FROM cards WHERE id=?", [cardId]);
      await reviewDB.deleteCard(String(cardId));
      await reviewDB.deleteReviewLogsForCard(String(cardId));
    }
  }

  // Delete notes
  if (graves.notes.length > 0) {
    for (const noteId of graves.notes) {
      // Also delete cards belonging to this note
      const cardRows = db.exec("SELECT id FROM cards WHERE nid=?", [noteId]);
      if (cardRows[0]) {
        for (const row of cardRows[0].values) {
          const cid = String(row[0]);
          await reviewDB.deleteCard(cid);
          await reviewDB.deleteReviewLogsForCard(cid);
        }
      }
      db.run("DELETE FROM cards WHERE nid=?", [noteId]);
      db.run("DELETE FROM notes WHERE id=?", [noteId]);
    }
  }

  // Delete decks
  if (graves.decks.length > 0) {
    const anki21b = isAnki21bFormat(db);
    for (const deckId of graves.decks) {
      if (anki21b) {
        db.run("DELETE FROM decks WHERE id=?", [deckId]);
      } else {
        // anki2: decks are stored as JSON in col.decks
        const decks = getColJson<Record<string, unknown>>(db, "decks", {});
        delete decks[String(deckId)];
        db.run("UPDATE col SET decks=?", [JSON.stringify(decks)]);
      }
    }
  }
}

/** Apply a chunk of incoming cards/notes/revlog from the server. */
export async function applyRemoteChunk(db: Database, chunk: Chunk): Promise<void> {
  // Apply revlog entries (always merge, no conflict)
  for (const [id, cid, usn, ease, ivl, lastIvl, factor, time, type] of chunk.revlog ?? []) {
    db.run(
      "INSERT OR REPLACE INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, cid, usn, ease, ivl, lastIvl, factor, time, type],
    );
  }

  // Apply notes
  for (const [id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data] of chunk.notes ?? []) {
    // Check if we have a local version
    const existing = db.exec("SELECT mod, usn FROM notes WHERE id=?", [id]);
    if (existing[0]?.values[0]) {
      const localMod = existing[0].values[0][0] as number;
      const localUsn = existing[0].values[0][1] as number;
      // If local has pending changes (usn=-1) and local is newer, skip
      if (localUsn === -1 && localMod >= mod) continue;
    }
    db.run(
      "INSERT OR REPLACE INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data],
    );
  }

  // Apply cards
  const { reviewDB } = await import("../scheduler/db");
  for (const [
    id,
    nid,
    did,
    ord,
    mod,
    usn,
    ctype,
    queue,
    due,
    ivl,
    factor,
    reps,
    lapses,
    left,
    odue,
    odid,
    flags,
    data,
  ] of chunk.cards ?? []) {
    // Check if we have a local version
    const existing = db.exec("SELECT mod, usn FROM cards WHERE id=?", [id]);
    if (existing[0]?.values[0]) {
      const localMod = existing[0].values[0][0] as number;
      const localUsn = existing[0].values[0][1] as number;
      // If local has pending changes (usn=-1) and local is newer, skip
      if (localUsn === -1 && localMod >= mod) continue;
    }
    db.run(
      "INSERT OR REPLACE INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        nid,
        did,
        ord,
        mod,
        usn,
        ctype,
        queue,
        due,
        ivl,
        factor,
        reps,
        lapses,
        left,
        odue,
        odid,
        flags,
        data,
      ],
    );
    // Also update IndexedDB if this card exists there — remote is newer
    await reviewDB.deleteCard(String(id));
  }
}

/** Merge unchunked changes (models/decks/dconf/tags/config) from server. */
export function applyRemoteUnchunkedChanges(
  db: Database,
  changes: UnchunkedChanges,
  anki21b: boolean,
): void {
  if (anki21b) {
    applyRemoteUnchunkedAnki21b(db, changes);
  } else {
    applyRemoteUnchunkedAnki2(db, changes);
  }
}

function applyRemoteUnchunkedAnki2(db: Database, changes: UnchunkedChanges): void {
  // Models, decks, deck configs — merge with mod-time conflict resolution
  mergeColJsonField(db, "models", changes.models);
  const [remoteDecks, remoteDconf] = changes.decks;
  mergeColJsonField(db, "decks", remoteDecks);
  mergeColJsonField(db, "dconf", remoteDconf);

  // Tags — merge (union)
  if (changes.tags.length > 0) {
    const localTags = getColJson<Record<string, number>>(db, "tags", {});
    for (const tag of changes.tags) {
      if (!localTags[tag]) {
        localTags[tag] = 0;
      }
    }
    db.run("UPDATE col SET tags=?", [JSON.stringify(localTags)]);
  }

  // Config — server wins if provided
  if (changes.conf !== undefined) {
    db.run("UPDATE col SET conf=?", [JSON.stringify(changes.conf)]);
  }

  // Creation timestamp — use newer
  if (changes.crt !== undefined) {
    db.run("UPDATE col SET crt=? WHERE crt < ?", [changes.crt, changes.crt]);
  }
}

function applyRemoteUnchunkedAnki21b(db: Database, changes: UnchunkedChanges): void {
  // Models (notetypes) — stored in notetypes table
  for (const m of changes.models) {
    const mtimeSecs = (m as SyncModel & { mtime_secs?: number }).mtime_secs;
    const existing = db.exec("SELECT mtime_secs FROM notetypes WHERE id=?", [m.id]);
    if (existing[0]?.values[0]) {
      const localMtime = existing[0].values[0][0] as number;
      if ((mtimeSecs ?? 0) < localMtime) continue;
    }
    db.run(
      "INSERT OR REPLACE INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?,?,?,?,?)",
      [m.id, m.name ?? "", mtimeSecs ?? 0, m.usn ?? 0, JSON.stringify(m)],
    );
  }

  // Decks
  const [remoteDecks, remoteDconf] = changes.decks;
  for (const d of remoteDecks) {
    const existing = db.exec("SELECT mtime FROM decks WHERE id=?", [d.id]);
    if (existing[0]?.values[0]) {
      const localMtime = existing[0].values[0][0] as number;
      if ((d.mtime ?? 0) < localMtime) continue;
    }
    db.run("INSERT OR REPLACE INTO decks (id, name, mtime, usn, common) VALUES (?,?,?,?,?)", [
      d.id,
      d.name ?? "",
      d.mtime ?? 0,
      d.usn ?? 0,
      JSON.stringify(d),
    ]);
  }

  // Deck configs
  for (const c of remoteDconf) {
    const existing = db.exec("SELECT mtime FROM deck_config WHERE id=?", [c.id]);
    if (existing[0]?.values[0]) {
      const localMtime = existing[0].values[0][0] as number;
      if ((c.mtime ?? 0) < localMtime) continue;
    }
    db.run("INSERT OR REPLACE INTO deck_config (id, name, mtime, usn, config) VALUES (?,?,?,?,?)", [
      c.id,
      c.name ?? "",
      c.mtime ?? 0,
      c.usn ?? 0,
      JSON.stringify(c),
    ]);
  }

  // Tags
  for (const tag of changes.tags) {
    db.run("INSERT OR IGNORE INTO tags (tag, usn) VALUES (?, 0)", [tag]);
  }

  // Config
  if (changes.conf !== undefined) {
    db.run("UPDATE col SET conf=?", [JSON.stringify(changes.conf)]);
  }

  if (changes.crt !== undefined) {
    db.run("UPDATE col SET crt=? WHERE crt < ?", [changes.crt, changes.crt]);
  }
}

// ── Build local data for sending ───────────────────────────────────

/** Build local graves (deletions) from SQLite rows with usn=-1. */
export function buildLocalGraves(db: Database): Graves {
  const graves: Graves = { cards: [], notes: [], decks: [] };
  const result = db.exec("SELECT oid, type FROM graves WHERE usn=-1");
  if (!result[0]) return graves;
  for (const row of result[0].values) {
    const oid = row[0] as number;
    const type = row[1] as number;
    if (type === 0) graves.cards.push(oid);
    else if (type === 1) graves.notes.push(oid);
    else if (type === 2) graves.decks.push(oid);
  }
  return graves;
}

/** Build unchunked changes to send. PWA doesn't modify these, so send current state. */
export function buildLocalUnchunkedChanges(
  db: Database,
  anki21b: boolean,
  localIsNewer: boolean,
): UnchunkedChanges {
  if (anki21b) {
    return buildLocalUnchunkedAnki21b(db, localIsNewer);
  }
  return buildLocalUnchunkedAnki2(db, localIsNewer);
}

function buildLocalUnchunkedAnki2(db: Database, localIsNewer: boolean): UnchunkedChanges {
  const changes: UnchunkedChanges = {
    models: [],
    decks: [[], []],
    tags: [],
  };

  // Models (notetypes) with pending changes (usn=-1)
  for (const m of Object.values(getColJson<Record<string, SyncModel>>(db, "models", {}))) {
    if (m.usn === -1) changes.models.push(m);
  }

  // Decks with pending changes (usn=-1)
  for (const d of Object.values(getColJson<Record<string, SyncDeck>>(db, "decks", {}))) {
    if (d.usn === -1) changes.decks[0].push(d);
  }

  // Deck configs with pending changes (usn=-1)
  for (const c of Object.values(getColJson<Record<string, SyncDeckConfig>>(db, "dconf", {}))) {
    if (c.usn === -1) changes.decks[1].push(c);
  }

  // Tags with pending changes (value=-1 in the JSON object)
  for (const [tag, usn] of Object.entries(getColJson<Record<string, number>>(db, "tags", {}))) {
    if (usn === -1) changes.tags.push(tag);
  }

  // If local is newer, include conf and crt so the server can update
  if (localIsNewer) {
    const result = db.exec("SELECT conf, crt FROM col");
    if (result[0]?.values[0]) {
      const confStr = result[0].values[0][0] as string;
      try {
        changes.conf = JSON.parse(confStr);
      } catch {
        /* skip */
      }
      changes.crt = result[0].values[0][1] as number;
    }
  }

  return changes;
}

function buildLocalUnchunkedAnki21b(db: Database, localIsNewer: boolean): UnchunkedChanges {
  const changes: UnchunkedChanges = {
    models: [],
    decks: [[], []],
    tags: [],
  };

  // Notetypes with pending changes (usn=-1)
  const ntResult = db.exec("SELECT id, name, mtime_secs, usn, config FROM notetypes WHERE usn=-1");
  if (ntResult[0]) {
    for (const row of ntResult[0].values) {
      let obj: SyncModel;
      try {
        obj = {
          ...JSON.parse(row[4] as string),
          id: row[0],
          name: row[1],
          mtime_secs: row[2],
          usn: row[3],
        };
      } catch {
        obj = {
          id: row[0] as number,
          name: row[1] as string,
          mtime_secs: row[2] as number,
          usn: row[3] as number,
        };
      }
      changes.models.push(obj);
    }
  }

  // Decks with pending changes (usn=-1)
  const decksResult = db.exec("SELECT id, name, mtime, usn, common FROM decks WHERE usn=-1");
  if (decksResult[0]) {
    for (const row of decksResult[0].values) {
      let obj: SyncDeck;
      try {
        obj = {
          ...JSON.parse(row[4] as string),
          id: row[0],
          name: row[1],
          mtime: row[2],
          usn: row[3],
        };
      } catch {
        obj = {
          id: row[0] as number,
          name: row[1] as string,
          mtime: row[2] as number,
          usn: row[3] as number,
        };
      }
      changes.decks[0].push(obj);
    }
  }

  // Deck configs with pending changes (usn=-1)
  const dcResult = db.exec("SELECT id, name, mtime, usn, config FROM deck_config WHERE usn=-1");
  if (dcResult[0]) {
    for (const row of dcResult[0].values) {
      let obj: SyncDeckConfig;
      try {
        obj = {
          ...JSON.parse(row[4] as string),
          id: row[0],
          name: row[1],
          mtime: row[2],
          usn: row[3],
        };
      } catch {
        obj = {
          id: row[0] as number,
          name: row[1] as string,
          mtime: row[2] as number,
          usn: row[3] as number,
        };
      }
      changes.decks[1].push(obj);
    }
  }

  // Tags with pending changes (usn=-1)
  const tagsResult = db.exec("SELECT tag FROM tags WHERE usn=-1");
  if (tagsResult[0]) {
    for (const row of tagsResult[0].values) {
      changes.tags.push(row[0] as string);
    }
  }

  if (localIsNewer) {
    const result = db.exec("SELECT conf, crt FROM col");
    if (result[0]?.values[0]) {
      const confStr = result[0].values[0][0] as string;
      try {
        changes.conf = JSON.parse(confStr);
      } catch {
        /* skip */
      }
      changes.crt = result[0].values[0][1] as number;
    }
  }

  return changes;
}

/** Yield local chunks of cards/notes/revlog with usn=-1. */
export function* buildLocalChunks(db: Database): Generator<Chunk> {
  // Gather all pending items
  const pendingCards: CardRow[] = [];
  const cardsResult = db.exec(
    "SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards WHERE usn=-1",
  );
  if (cardsResult[0]) {
    for (const row of cardsResult[0].values) {
      pendingCards.push(row as unknown as CardRow);
    }
  }

  const pendingNotes: NoteRow[] = [];
  const notesResult = db.exec(
    "SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes WHERE usn=-1",
  );
  if (notesResult[0]) {
    for (const row of notesResult[0].values) {
      pendingNotes.push(row as unknown as NoteRow);
    }
  }

  const pendingRevlog: RevlogRow[] = [];
  const revlogResult = db.exec(
    "SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog WHERE usn=-1",
  );
  if (revlogResult[0]) {
    for (const row of revlogResult[0].values) {
      pendingRevlog.push(row as unknown as RevlogRow);
    }
  }

  // Yield in chunks of CHUNK_SIZE (interleaving types)
  let ci = 0,
    ni = 0,
    ri = 0;
  const total = pendingCards.length + pendingNotes.length + pendingRevlog.length;
  if (total === 0) {
    yield { done: true, cards: [], notes: [], revlog: [] };
    return;
  }

  while (ci < pendingCards.length || ni < pendingNotes.length || ri < pendingRevlog.length) {
    const chunk: Chunk = { done: false, cards: [], notes: [], revlog: [] };
    let count = 0;

    while (count < CHUNK_SIZE && ri < pendingRevlog.length) {
      chunk.revlog.push(pendingRevlog[ri]!);
      ri++;
      count++;
    }
    while (count < CHUNK_SIZE && ni < pendingNotes.length) {
      chunk.notes.push(pendingNotes[ni]!);
      ni++;
      count++;
    }
    while (count < CHUNK_SIZE && ci < pendingCards.length) {
      chunk.cards.push(pendingCards[ci]!);
      ci++;
      count++;
    }

    if (ci >= pendingCards.length && ni >= pendingNotes.length && ri >= pendingRevlog.length) {
      chunk.done = true;
    }

    yield chunk;
  }
}

// ── Sanity check counts ──────────���─────────────────────────────────

export function getSanityCounts(db: Database, anki21b: boolean): SanityCheckCounts {
  const scalar = (sql: string): number => {
    const r = db.exec(sql);
    return (r[0]?.values[0]?.[0] as number) ?? 0;
  };

  const cards = scalar("SELECT count() FROM cards");
  const notes = scalar("SELECT count() FROM notes");
  const revlog = scalar("SELECT count() FROM revlog");
  const graves = scalar("SELECT count() FROM graves");

  // Due counts by queue
  const newCount = scalar("SELECT count() FROM cards WHERE queue=0");
  const learnCount = scalar("SELECT count() FROM cards WHERE queue=1 OR queue=3");
  const reviewCount = scalar("SELECT count() FROM cards WHERE queue=2");

  let models: number;
  let decks: number;
  let deckConfig: number;

  if (anki21b) {
    models = scalar("SELECT count() FROM notetypes");
    decks = scalar("SELECT count() FROM decks");
    deckConfig = scalar("SELECT count() FROM deck_config");
  } else {
    models = Object.keys(getColJson(db, "models", {})).length;
    decks = Object.keys(getColJson(db, "decks", {})).length;
    deckConfig = Object.keys(getColJson(db, "dconf", {})).length;
  }

  return [
    [newCount, learnCount, reviewCount],
    cards,
    notes,
    revlog,
    graves,
    models,
    decks,
    deckConfig,
  ];
}

// ── Finalize USN after sync ────────────────────────────────────────

/** Update all pending items (usn=-1) to the new server USN and update col metadata. */
export function finalizeUsn(
  db: Database,
  serverUsn: number,
  serverMod: number,
  anki21b: boolean,
): void {
  // Chunked data
  db.run("UPDATE cards SET usn=? WHERE usn=-1", [serverUsn]);
  db.run("UPDATE notes SET usn=? WHERE usn=-1", [serverUsn]);
  db.run("UPDATE revlog SET usn=? WHERE usn=-1", [serverUsn]);
  db.run("UPDATE graves SET usn=? WHERE usn=-1", [serverUsn]);

  // Unchunked data
  if (anki21b) {
    db.run("UPDATE notetypes SET usn=? WHERE usn=-1", [serverUsn]);
    db.run("UPDATE decks SET usn=? WHERE usn=-1", [serverUsn]);
    db.run("UPDATE deck_config SET usn=? WHERE usn=-1", [serverUsn]);
    db.run("UPDATE tags SET usn=? WHERE usn=-1", [serverUsn]);
  } else {
    finalizeUsnAnki2Json(db, serverUsn, "models");
    finalizeUsnAnki2Json(db, serverUsn, "decks");
    finalizeUsnAnki2Json(db, serverUsn, "dconf");
    // Tags: update usn values in the JSON object
    const tags = getColJson<Record<string, number>>(db, "tags", {});
    let changed = false;
    for (const [tag, usn] of Object.entries(tags)) {
      if (usn === -1) {
        tags[tag] = serverUsn;
        changed = true;
      }
    }
    if (changed) {
      db.run("UPDATE col SET tags=?", [JSON.stringify(tags)]);
    }
  }

  db.run("UPDATE col SET usn=?, mod=?, ls=?", [serverUsn, serverMod, serverMod]);
}

/** Update usn=-1 inside a JSON column of the col table (anki2 format). */
function finalizeUsnAnki2Json(
  db: Database,
  serverUsn: number,
  column: "models" | "decks" | "dconf",
): void {
  const data = getColJson<Record<string, { usn?: number }>>(db, column, {});
  let changed = false;
  for (const obj of Object.values(data)) {
    if (obj.usn === -1) {
      obj.usn = serverUsn;
      changed = true;
    }
  }
  if (changed) {
    db.run(`UPDATE col SET ${column}=?`, [JSON.stringify(data)]);
  }
}
