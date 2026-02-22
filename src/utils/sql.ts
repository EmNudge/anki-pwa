import { type Database } from "sql.js";

export function executeQuery<T>(db: Database, query: string, params?: Record<string, string>): T {
  const stmt = db.prepare(query);
  stmt.step();
  const result = stmt.getAsObject(params) as T;
  stmt.free();
  return result;
}

export function executeQueryAll<T>(
  db: Database,
  query: string,
  params?: Record<string, string>,
): T[] {
  const stmt = db.prepare(query);
  const rows = Array.from(
    (function* () {
      while (stmt.step()) {
        yield stmt.getAsObject(params) as T;
      }
    })(),
  );
  stmt.free();
  return rows;
}

/**
 * Build a map from note ID to deck ID using the first card's deck for each note.
 */
export function buildNoteToDeckMap(db: Database): Map<number, number> {
  const cardsDeckInfo = executeQueryAll<{ nid: number; did: number }>(
    db,
    "SELECT nid, did FROM cards",
  );
  const noteToDeckId = new Map<number, number>();
  for (const card of cardsDeckInfo) {
    if (!noteToDeckId.has(card.nid)) {
      noteToDeckId.set(card.nid, card.did);
    }
  }
  return noteToDeckId;
}

/**
 * Resolve a note's deck name from the note-to-deck map and decks record.
 */
export function resolveDeckName(
  noteId: number,
  noteToDeckId: Map<number, number>,
  decks: Record<string, { name: string }>,
): string {
  const deckId = noteToDeckId.get(noteId);
  return deckId !== undefined ? (decks[deckId.toString()]?.name ?? "Unknown") : "Unknown";
}
