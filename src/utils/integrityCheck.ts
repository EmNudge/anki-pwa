import { type Database } from "sql.js";
import { executeQueryAll } from "./sql";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueType =
  | "orphaned-cards"
  | "orphaned-notes"
  | "missing-notetype"
  | "missing-deck"
  | "field-count-mismatch"
  | "invalid-scheduling"
  | "duplicate-note-ids"
  | "duplicate-card-ids"
  | "duplicate-guids";

export type IntegrityIssue = {
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  count: number;
  details: string[];
  fixable: boolean;
};

type NoteRow = { id: number; mid: number; flds: string; guid: string };
type CardRow = {
  id: number;
  nid: number;
  did: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  odid: number;
};

function tableExists(db: Database, name: string): boolean {
  const rows = executeQueryAll<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`,
  );
  return rows.length > 0;
}

/**
 * Detect the database format and return appropriate table info.
 */
function isAnki21b(db: Database): boolean {
  return tableExists(db, "notetypes");
}

function countByKey<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Map<K, number> {
  const map = new Map<K, number>();
  items.forEach((item) => {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return map;
}

function sumValues(map: Map<unknown, number>): number {
  let total = 0;
  map.forEach((v) => {
    total += v;
  });
  return total;
}

/**
 * Get all notetype IDs and their field counts from the database.
 */
function getNotetypeFieldCounts(db: Database): Map<number, number> {
  if (isAnki21b(db)) {
    const rows = executeQueryAll<{ ntid: number; cnt: number }>(
      db,
      "SELECT ntid, COUNT(*) as cnt FROM fields GROUP BY ntid",
    );
    return new Map(rows.map((row) => [row.ntid, row.cnt]));
  }

  try {
    const col = executeQueryAll<{ models: string }>(db, "SELECT models FROM col");
    if (col.length > 0 && col[0]!.models) {
      const models = JSON.parse(col[0]!.models) as Record<string, { flds: unknown[] }>;
      return new Map(
        Object.entries(models).map(([id, model]) => [Number(id), model.flds?.length ?? 0]),
      );
    }
  } catch {
    // If parsing fails, return empty
  }

  return new Map();
}

/**
 * Get all valid deck IDs from the database.
 */
function getDeckIds(db: Database): Set<number> {
  if (isAnki21b(db)) {
    const rows = executeQueryAll<{ id: number }>(db, "SELECT id FROM decks");
    return new Set(rows.map((r) => r.id));
  } else {
    try {
      const col = executeQueryAll<{ decks: string }>(db, "SELECT decks FROM col");
      if (col.length > 0 && col[0]!.decks) {
        const decks = JSON.parse(col[0]!.decks) as Record<string, unknown>;
        return new Set(Object.keys(decks).map(Number));
      }
    } catch {
      // fallthrough
    }
    return new Set();
  }
}

/**
 * Get all valid notetype IDs from the database.
 */
function getNotetypeIds(db: Database): Set<number> {
  if (isAnki21b(db)) {
    const rows = executeQueryAll<{ id: number }>(db, "SELECT id FROM notetypes");
    return new Set(rows.map((r) => r.id));
  } else {
    try {
      const col = executeQueryAll<{ models: string }>(db, "SELECT models FROM col");
      if (col.length > 0 && col[0]!.models) {
        const models = JSON.parse(col[0]!.models) as Record<string, unknown>;
        return new Set(Object.keys(models).map(Number));
      }
    } catch {
      // fallthrough
    }
    return new Set();
  }
}

function checkOrphanedCards(cards: CardRow[], noteIdSet: Set<number>): IntegrityIssue | null {
  const orphanedCards = cards.filter((c) => !noteIdSet.has(c.nid));
  if (orphanedCards.length === 0) return null;
  return {
    type: "orphaned-cards",
    severity: "error",
    title: "Orphaned Cards",
    description: "Cards that reference notes which no longer exist. These cards cannot be studied.",
    count: orphanedCards.length,
    details: orphanedCards.slice(0, 20).map((c) => `Card ${c.id} → missing note ${c.nid}`),
    fixable: true,
  };
}

function checkOrphanedNotes(notes: NoteRow[], cardNoteIds: Set<number>): IntegrityIssue | null {
  const orphanedNotes = notes.filter((n) => !cardNoteIds.has(n.id));
  if (orphanedNotes.length === 0) return null;
  return {
    type: "orphaned-notes",
    severity: "warning",
    title: "Notes Without Cards",
    description: "Notes that have no associated cards. They take up space but cannot be studied.",
    count: orphanedNotes.length,
    details: orphanedNotes.slice(0, 20).map((n) => `Note ${n.id} (guid: ${n.guid})`),
    fixable: true,
  };
}

function checkMissingNotetypes(notes: NoteRow[], notetypeIds: Set<number>): IntegrityIssue | null {
  const missingNotetypes = countByKey(
    notes.filter((n) => !notetypeIds.has(n.mid)),
    (n) => n.mid,
  );
  if (missingNotetypes.size === 0) return null;
  return {
    type: "missing-notetype",
    severity: "error",
    title: "Missing Note Types",
    description: "Notes reference note types that don't exist in the database.",
    count: sumValues(missingNotetypes),
    details: Array.from(missingNotetypes.entries()).map(
      ([mid, cnt]) => `Notetype ${mid}: ${cnt} note${cnt !== 1 ? "s" : ""} affected`,
    ),
    fixable: false,
  };
}

function checkMissingDecks(cards: CardRow[], deckIds: Set<number>): IntegrityIssue | null {
  const missingDecks = countByKey(
    cards.filter((c) => !deckIds.has(c.odid !== 0 ? c.odid : c.did)),
    (c) => (c.odid !== 0 ? c.odid : c.did),
  );
  if (missingDecks.size === 0) return null;
  return {
    type: "missing-deck",
    severity: "error",
    title: "Missing Decks",
    description: "Cards reference decks that don't exist in the database.",
    count: sumValues(missingDecks),
    details: Array.from(missingDecks.entries()).map(
      ([did, cnt]) => `Deck ${did}: ${cnt} card${cnt !== 1 ? "s" : ""} affected`,
    ),
    fixable: true,
  };
}

function checkFieldCountMismatches(
  notes: NoteRow[],
  notetypeFieldCounts: Map<number, number>,
): IntegrityIssue | null {
  const fieldMismatches = notes
    .filter((note) => notetypeFieldCounts.has(note.mid))
    .map((note) => ({
      noteId: note.id,
      expected: notetypeFieldCounts.get(note.mid)!,
      actual: note.flds.split("\x1f").length,
    }))
    .filter((m) => m.actual !== m.expected);
  if (fieldMismatches.length === 0) return null;
  return {
    type: "field-count-mismatch",
    severity: "warning",
    title: "Field Count Mismatches",
    description: "Notes whose field count doesn't match their note type definition.",
    count: fieldMismatches.length,
    details: fieldMismatches
      .slice(0, 20)
      .map((m) => `Note ${m.noteId}: expected ${m.expected} fields, has ${m.actual}`),
    fixable: false,
  };
}

function hasInvalidScheduling(card: CardRow): boolean {
  return (
    (card.ivl < 0 && card.type === 2) ||
    card.type < 0 ||
    card.type > 3 ||
    card.queue < -3 ||
    card.queue > 4
  );
}

function describeSchedulingIssue(card: CardRow): string[] {
  return [
    ...(card.ivl < 0 && card.type === 2
      ? [`Card ${card.id}: negative interval on review card`]
      : []),
    ...(card.type < 0 || card.type > 3 ? [`Card ${card.id}: invalid type ${card.type}`] : []),
    ...(card.queue < -3 || card.queue > 4 ? [`Card ${card.id}: invalid queue ${card.queue}`] : []),
  ];
}

function checkInvalidScheduling(cards: CardRow[]): IntegrityIssue | null {
  const invalidCards = cards.filter(hasInvalidScheduling);
  const details = invalidCards.flatMap(describeSchedulingIssue);
  if (details.length === 0) return null;
  return {
    type: "invalid-scheduling",
    severity: "warning",
    title: "Invalid Scheduling Data",
    description:
      "Cards with impossible scheduling values (negative intervals, invalid types/queues).",
    count: details.length,
    details: details.slice(0, 20),
    fixable: true,
  };
}

function checkDuplicateIds<T>(
  items: T[],
  keyFn: (item: T) => string | number,
  type: IssueType,
  severity: IssueSeverity,
  title: string,
  description: string,
  labelFn: (key: string | number, cnt: number) => string,
  limit?: number,
): IntegrityIssue | null {
  const counts = countByKey(items, keyFn);
  const dups = Array.from(counts.entries()).filter(([, cnt]) => cnt > 1);
  if (dups.length === 0) return null;
  const details = limit !== undefined ? dups.slice(0, limit) : dups;
  return {
    type,
    severity,
    title,
    description,
    count: sumValues(new Map(dups)),
    details: details.map(([key, cnt]) => labelFn(key, cnt)),
    fixable: false,
  };
}

/**
 * Run all integrity checks against the database and return issues found.
 */
export function checkDatabaseIntegrity(db: Database): IntegrityIssue[] {
  const notes = executeQueryAll<NoteRow>(db, "SELECT id, mid, flds, guid FROM notes");
  const cards = executeQueryAll<CardRow>(
    db,
    "SELECT id, nid, did, type, queue, due, ivl, odid FROM cards",
  );

  const noteIdSet = new Set(notes.map((n) => n.id));
  const cardNoteIds = new Set(cards.map((c) => c.nid));
  const deckIds = getDeckIds(db);
  const notetypeIds = getNotetypeIds(db);
  const notetypeFieldCounts = getNotetypeFieldCounts(db);

  return [
    checkOrphanedCards(cards, noteIdSet),
    checkOrphanedNotes(notes, cardNoteIds),
    checkMissingNotetypes(notes, notetypeIds),
    checkMissingDecks(cards, deckIds),
    checkFieldCountMismatches(notes, notetypeFieldCounts),
    checkInvalidScheduling(cards),
    checkDuplicateIds(
      notes,
      (n) => n.id,
      "duplicate-note-ids",
      "error",
      "Duplicate Note IDs",
      "Multiple notes share the same ID, which can cause data corruption.",
      (id, cnt) => `Note ID ${id}: ${cnt} occurrences`,
    ),
    checkDuplicateIds(
      cards,
      (c) => c.id,
      "duplicate-card-ids",
      "error",
      "Duplicate Card IDs",
      "Multiple cards share the same ID, which can cause data corruption.",
      (id, cnt) => `Card ID ${id}: ${cnt} occurrences`,
    ),
    checkDuplicateIds(
      notes,
      (n) => n.guid,
      "duplicate-guids",
      "warning",
      "Duplicate Note GUIDs",
      "Multiple notes share the same GUID. This can cause sync conflicts.",
      (guid, cnt) => `GUID "${guid}": ${cnt} occurrences`,
      20,
    ),
  ].filter((issue): issue is IntegrityIssue => issue !== null);
}

/**
 * Fix orphaned cards by deleting cards whose notes don't exist.
 */
function fixOrphanedCards(db: Database): number {
  const notes = executeQueryAll<{ id: number }>(db, "SELECT id FROM notes");
  const noteIdSet = new Set(notes.map((n) => n.id));
  const cards = executeQueryAll<{ id: number; nid: number }>(db, "SELECT id, nid FROM cards");
  const orphanedIds = cards.filter((c) => !noteIdSet.has(c.nid)).map((c) => c.id);

  if (orphanedIds.length === 0) return 0;
  db.run(`DELETE FROM cards WHERE id IN (${orphanedIds.join(",")})`);
  return orphanedIds.length;
}

/**
 * Fix orphaned notes by deleting notes that have no cards.
 */
function fixOrphanedNotes(db: Database): number {
  const notes = executeQueryAll<{ id: number }>(db, "SELECT id FROM notes");
  const cards = executeQueryAll<{ nid: number }>(db, "SELECT DISTINCT nid FROM cards");
  const cardNoteIds = new Set(cards.map((c) => c.nid));
  const orphanedIds = notes.filter((n) => !cardNoteIds.has(n.id)).map((n) => n.id);

  if (orphanedIds.length === 0) return 0;
  db.run(`DELETE FROM notes WHERE id IN (${orphanedIds.join(",")})`);
  return orphanedIds.length;
}

/**
 * Fix cards referencing missing decks by moving them to the default deck (id=1).
 */
function fixMissingDecks(db: Database): number {
  const deckIds = getDeckIds(db);
  const cards = executeQueryAll<CardRow>(
    db,
    "SELECT id, nid, did, type, queue, due, ivl, odid FROM cards",
  );

  const cardsToFix = cards.filter((c) => !deckIds.has(c.odid !== 0 ? c.odid : c.did));
  cardsToFix.forEach((card) => {
    if (card.odid !== 0) {
      db.run(`UPDATE cards SET odid = 0, did = 1 WHERE id = ${card.id}`);
    } else {
      db.run(`UPDATE cards SET did = 1 WHERE id = ${card.id}`);
    }
  });
  return cardsToFix.length;
}

/**
 * Fix invalid scheduling by resetting affected cards to new card state.
 */
function fixInvalidScheduling(db: Database): number {
  const cards = executeQueryAll<CardRow>(
    db,
    "SELECT id, nid, did, type, queue, due, ivl, odid FROM cards",
  );

  const cardsToFix = cards.filter(hasInvalidScheduling);
  cardsToFix.forEach((card) => {
    db.run(
      `UPDATE cards SET type = 0, queue = 0, due = 0, ivl = 0, factor = 0, reps = 0, lapses = 0 WHERE id = ${card.id}`,
    );
  });
  return cardsToFix.length;
}

/**
 * Apply a specific fix based on issue type. Returns number of items fixed.
 */
export function applyFix(db: Database, issueType: IssueType): number {
  switch (issueType) {
    case "orphaned-cards":
      return fixOrphanedCards(db);
    case "orphaned-notes":
      return fixOrphanedNotes(db);
    case "missing-deck":
      return fixMissingDecks(db);
    case "invalid-scheduling":
      return fixInvalidScheduling(db);
    default:
      return 0;
  }
}
