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
type CardRow = { id: number; nid: number; did: number; type: number; queue: number; due: number; ivl: number; odid: number };

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

/**
 * Get all notetype IDs and their field counts from the database.
 */
function getNotetypeFieldCounts(db: Database): Map<number, number> {
  const result = new Map<number, number>();

  if (isAnki21b(db)) {
    // anki21b: fields table with ntid
    const rows = executeQueryAll<{ ntid: number; cnt: number }>(
      db,
      "SELECT ntid, COUNT(*) as cnt FROM fields GROUP BY ntid",
    );
    for (const row of rows) {
      result.set(row.ntid, row.cnt);
    }
  } else {
    // anki2: models stored as JSON in col table
    try {
      const col = executeQueryAll<{ models: string }>(db, "SELECT models FROM col");
      if (col.length > 0 && col[0]!.models) {
        const models = JSON.parse(col[0]!.models) as Record<string, { flds: unknown[] }>;
        for (const [id, model] of Object.entries(models)) {
          result.set(Number(id), model.flds?.length ?? 0);
        }
      }
    } catch {
      // If parsing fails, return empty
    }
  }

  return result;
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

/**
 * Run all integrity checks against the database and return issues found.
 */
export function checkDatabaseIntegrity(db: Database): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

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

  // 1. Orphaned cards (cards whose note doesn't exist)
  const orphanedCards = cards.filter((c) => !noteIdSet.has(c.nid));
  if (orphanedCards.length > 0) {
    issues.push({
      type: "orphaned-cards",
      severity: "error",
      title: "Orphaned Cards",
      description: "Cards that reference notes which no longer exist. These cards cannot be studied.",
      count: orphanedCards.length,
      details: orphanedCards.slice(0, 20).map((c) => `Card ${c.id} → missing note ${c.nid}`),
      fixable: true,
    });
  }

  // 2. Orphaned notes (notes with no cards)
  const orphanedNotes = notes.filter((n) => !cardNoteIds.has(n.id));
  if (orphanedNotes.length > 0) {
    issues.push({
      type: "orphaned-notes",
      severity: "warning",
      title: "Notes Without Cards",
      description: "Notes that have no associated cards. They take up space but cannot be studied.",
      count: orphanedNotes.length,
      details: orphanedNotes.slice(0, 20).map((n) => `Note ${n.id} (guid: ${n.guid})`),
      fixable: true,
    });
  }

  // 3. Missing notetypes
  const missingNotetypes = new Map<number, number>();
  for (const note of notes) {
    if (!notetypeIds.has(note.mid)) {
      missingNotetypes.set(note.mid, (missingNotetypes.get(note.mid) ?? 0) + 1);
    }
  }
  if (missingNotetypes.size > 0) {
    const total = Array.from(missingNotetypes.values()).reduce((a, b) => a + b, 0);
    issues.push({
      type: "missing-notetype",
      severity: "error",
      title: "Missing Note Types",
      description: "Notes reference note types that don't exist in the database.",
      count: total,
      details: Array.from(missingNotetypes.entries()).map(
        ([mid, cnt]) => `Notetype ${mid}: ${cnt} note${cnt !== 1 ? "s" : ""} affected`,
      ),
      fixable: false,
    });
  }

  // 4. Missing decks
  const missingDecks = new Map<number, number>();
  for (const card of cards) {
    const effectiveDid = card.odid !== 0 ? card.odid : card.did;
    if (!deckIds.has(effectiveDid)) {
      missingDecks.set(effectiveDid, (missingDecks.get(effectiveDid) ?? 0) + 1);
    }
  }
  if (missingDecks.size > 0) {
    const total = Array.from(missingDecks.values()).reduce((a, b) => a + b, 0);
    issues.push({
      type: "missing-deck",
      severity: "error",
      title: "Missing Decks",
      description: "Cards reference decks that don't exist in the database.",
      count: total,
      details: Array.from(missingDecks.entries()).map(
        ([did, cnt]) => `Deck ${did}: ${cnt} card${cnt !== 1 ? "s" : ""} affected`,
      ),
      fixable: true,
    });
  }

  // 5. Field count mismatches
  const fieldMismatches: { noteId: number; expected: number; actual: number }[] = [];
  for (const note of notes) {
    const expectedCount = notetypeFieldCounts.get(note.mid);
    if (expectedCount === undefined) continue; // already caught by missing notetype check
    const actualCount = note.flds.split("\x1f").length;
    if (actualCount !== expectedCount) {
      fieldMismatches.push({ noteId: note.id, expected: expectedCount, actual: actualCount });
    }
  }
  if (fieldMismatches.length > 0) {
    issues.push({
      type: "field-count-mismatch",
      severity: "warning",
      title: "Field Count Mismatches",
      description: "Notes whose field count doesn't match their note type definition.",
      count: fieldMismatches.length,
      details: fieldMismatches.slice(0, 20).map(
        (m) => `Note ${m.noteId}: expected ${m.expected} fields, has ${m.actual}`,
      ),
      fixable: false,
    });
  }

  // 6. Invalid scheduling data
  const invalidScheduling: { cardId: number; reason: string }[] = [];
  for (const card of cards) {
    if (card.ivl < 0 && card.type === 2) {
      invalidScheduling.push({ cardId: card.id, reason: "negative interval on review card" });
    }
    if (card.type < 0 || card.type > 3) {
      invalidScheduling.push({ cardId: card.id, reason: `invalid type ${card.type}` });
    }
    if (card.queue < -3 || card.queue > 4) {
      invalidScheduling.push({ cardId: card.id, reason: `invalid queue ${card.queue}` });
    }
  }
  if (invalidScheduling.length > 0) {
    issues.push({
      type: "invalid-scheduling",
      severity: "warning",
      title: "Invalid Scheduling Data",
      description: "Cards with impossible scheduling values (negative intervals, invalid types/queues).",
      count: invalidScheduling.length,
      details: invalidScheduling.slice(0, 20).map(
        (s) => `Card ${s.cardId}: ${s.reason}`,
      ),
      fixable: true,
    });
  }

  // 7. Duplicate note IDs
  const noteIdCounts = new Map<number, number>();
  for (const note of notes) {
    noteIdCounts.set(note.id, (noteIdCounts.get(note.id) ?? 0) + 1);
  }
  const dupNoteIds = Array.from(noteIdCounts.entries()).filter(([, cnt]) => cnt > 1);
  if (dupNoteIds.length > 0) {
    issues.push({
      type: "duplicate-note-ids",
      severity: "error",
      title: "Duplicate Note IDs",
      description: "Multiple notes share the same ID, which can cause data corruption.",
      count: dupNoteIds.reduce((a, [, cnt]) => a + cnt, 0),
      details: dupNoteIds.map(([id, cnt]) => `Note ID ${id}: ${cnt} occurrences`),
      fixable: false,
    });
  }

  // 8. Duplicate card IDs
  const cardIdCounts = new Map<number, number>();
  for (const card of cards) {
    cardIdCounts.set(card.id, (cardIdCounts.get(card.id) ?? 0) + 1);
  }
  const dupCardIds = Array.from(cardIdCounts.entries()).filter(([, cnt]) => cnt > 1);
  if (dupCardIds.length > 0) {
    issues.push({
      type: "duplicate-card-ids",
      severity: "error",
      title: "Duplicate Card IDs",
      description: "Multiple cards share the same ID, which can cause data corruption.",
      count: dupCardIds.reduce((a, [, cnt]) => a + cnt, 0),
      details: dupCardIds.map(([id, cnt]) => `Card ID ${id}: ${cnt} occurrences`),
      fixable: false,
    });
  }

  // 9. Duplicate GUIDs
  const guidCounts = new Map<string, number>();
  for (const note of notes) {
    guidCounts.set(note.guid, (guidCounts.get(note.guid) ?? 0) + 1);
  }
  const dupGuids = Array.from(guidCounts.entries()).filter(([, cnt]) => cnt > 1);
  if (dupGuids.length > 0) {
    issues.push({
      type: "duplicate-guids",
      severity: "warning",
      title: "Duplicate Note GUIDs",
      description: "Multiple notes share the same GUID. This can cause sync conflicts.",
      count: dupGuids.reduce((a, [, cnt]) => a + cnt, 0),
      details: dupGuids.slice(0, 20).map(([guid, cnt]) => `GUID "${guid}": ${cnt} occurrences`),
      fixable: false,
    });
  }

  return issues;
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

  let fixed = 0;
  for (const card of cards) {
    const effectiveDid = card.odid !== 0 ? card.odid : card.did;
    if (!deckIds.has(effectiveDid)) {
      if (card.odid !== 0) {
        db.run(`UPDATE cards SET odid = 0, did = 1 WHERE id = ${card.id}`);
      } else {
        db.run(`UPDATE cards SET did = 1 WHERE id = ${card.id}`);
      }
      fixed++;
    }
  }
  return fixed;
}

/**
 * Fix invalid scheduling by resetting affected cards to new card state.
 */
function fixInvalidScheduling(db: Database): number {
  const cards = executeQueryAll<CardRow>(
    db,
    "SELECT id, nid, did, type, queue, due, ivl, odid FROM cards",
  );

  let fixed = 0;
  for (const card of cards) {
    const hasNegativeIvl = card.ivl < 0 && card.type === 2;
    const hasInvalidType = card.type < 0 || card.type > 3;
    const hasInvalidQueue = card.queue < -3 || card.queue > 4;

    if (hasNegativeIvl || hasInvalidType || hasInvalidQueue) {
      db.run(
        `UPDATE cards SET type = 0, queue = 0, due = 0, ivl = 0, factor = 0, reps = 0, lapses = 0 WHERE id = ${card.id}`,
      );
      fixed++;
    }
  }
  return fixed;
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
