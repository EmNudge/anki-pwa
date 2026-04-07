import { createDatabase } from "~/utils/sql";
import { reviewDB } from "../scheduler/db";
import type { StoredReviewLog } from "../scheduler/types";
import { MS_PER_DAY } from "../utils/constants";

/**
 * SM-2 card state shape (from anki-sm2-algorithm.ts).
 * Kept as a local type to avoid coupling to the algorithm module.
 */
interface SM2CardState {
  phase: "new" | "learning" | "review" | "relearning";
  step: number;
  ease: number;
  interval: number;
  due: number; // ms timestamp
  lapses: number;
  reps: number;
}

/**
 * Map SM-2 phase to Anki card.type column.
 */
function phaseToType(phase: SM2CardState["phase"]): number {
  switch (phase) {
    case "new": return 0;
    case "learning": return 1;
    case "review": return 2;
    case "relearning": return 3;
  }
}

/**
 * Map SM-2 phase to Anki card.queue column.
 */
function phaseToQueue(phase: SM2CardState["phase"]): number {
  switch (phase) {
    case "new": return 0;
    case "learning": return 1;
    case "review": return 2;
    case "relearning": return 1;
  }
}

/**
 * Convert a due timestamp (ms) to Anki's `due` column value.
 * - Review cards: days since collection creation
 * - Learning/relearning cards: Unix timestamp in seconds
 * - New cards: leave as-is (position)
 */
function convertDue(state: SM2CardState, collectionCreationSecs: number): number {
  if (state.phase === "review") {
    return Math.floor((state.due - collectionCreationSecs * 1000) / MS_PER_DAY);
  }
  if (state.phase === "learning" || state.phase === "relearning") {
    return Math.floor(state.due / 1000);
  }
  // New cards — return 0 (position doesn't matter, will be reassigned on next desktop sync)
  return 0;
}

/**
 * Encode learning step into Anki's `left` field.
 * Anki encodes: remaining_steps + remaining_today * 1000
 */
function encodeLeft(state: SM2CardState, totalSteps: number): number {
  if (state.phase !== "learning" && state.phase !== "relearning") {
    return 0;
  }
  const remaining = Math.max(0, totalSteps - state.step);
  return remaining + remaining * 1000;
}

const ANSWER_TO_EASE: Record<string, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/**
 * Apply all local review state from IndexedDB back into a SQLite collection.
 * Returns the modified SQLite as a Uint8Array ready for upload.
 */
export async function applyReviewStateToSqlite(
  sqliteBytes: Uint8Array,
  deckId: string,
): Promise<Uint8Array> {
  const db = await createDatabase(sqliteBytes);

  try {
    // Get collection creation time for due-date conversion
    const crtResult = db.exec("SELECT crt FROM col");
    const collectionCreationSecs =
      (crtResult[0]?.values[0]?.[0] as number | undefined) ?? 0;

    // Read all reviewed cards from IndexedDB
    const reviewedCards = await reviewDB.getCardsForDeck(deckId);
    if (reviewedCards.length === 0) {
      return new Uint8Array(db.export());
    }

    // Determine learning step counts from deck config (default steps)
    const defaultLearnSteps = 2; // [1, 10]
    const defaultRelearnSteps = 1; // [10]

    // Update each reviewed card in the SQLite database
    const updateStmt = db.prepare(
      "UPDATE cards SET type=?, queue=?, due=?, ivl=?, factor=?, reps=?, lapses=?, left=?, mod=? WHERE id=?",
    );

    const nowSecs = Math.floor(Date.now() / 1000);

    for (const card of reviewedCards) {
      if (!card.lastReviewed) continue; // never reviewed, skip

      const state = card.cardState as SM2CardState;
      const ankiCardId = Number(card.cardId);
      if (isNaN(ankiCardId)) continue; // legacy positional ID, skip

      const type = phaseToType(state.phase);
      const queue = phaseToQueue(state.phase);
      const due = convertDue(state, collectionCreationSecs);
      const ivl = Math.max(0, Math.round(state.interval));
      const factor = Math.round(state.ease * 1000);
      const totalSteps =
        state.phase === "relearning" ? defaultRelearnSteps : defaultLearnSteps;
      const left = encodeLeft(state, totalSteps);

      updateStmt.run([type, queue, due, ivl, factor, state.reps, state.lapses, left, nowSecs, ankiCardId]);
    }
    updateStmt.free();

    // Insert review logs into revlog table
    await insertRevlogs(db, deckId, collectionCreationSecs);

    // Update collection modification timestamp
    db.run("UPDATE col SET mod=?", [nowSecs]);

    const result = new Uint8Array(db.export());
    return result;
  } finally {
    db.close();
  }
}

/**
 * Insert IndexedDB review logs into the SQLite revlog table.
 */
async function insertRevlogs(
  db: import("sql.js").Database,
  deckId: string,
  _collectionCreationSecs: number,
): Promise<void> {
  // Get all card IDs for this deck so we can fetch their logs
  const cards = await reviewDB.getCardsForDeck(deckId);
  const allLogs: StoredReviewLog[] = [];

  for (const card of cards) {
    const logs = await reviewDB.getReviewLogsForCard(card.cardId);
    allLogs.push(...logs);
  }

  if (allLogs.length === 0) return;

  // Get existing revlog IDs to avoid duplicates
  const existingIds = new Set<number>();
  const existingResult = db.exec("SELECT id FROM revlog");
  if (existingResult[0]) {
    for (const row of existingResult[0].values) {
      existingIds.add(row[0] as number);
    }
  }

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  for (const log of allLogs) {
    // revlog.id is timestamp in ms — use the log's timestamp
    const id = Math.round(log.timestamp);
    if (existingIds.has(id)) continue;

    const ankiCardId = Number(log.cardId);
    if (isNaN(ankiCardId)) continue;

    const ease = typeof log.rating === "number"
      ? log.rating
      : (ANSWER_TO_EASE[log.rating] ?? 3);

    // Extract interval and factor from the review log if available
    const reviewLog = log.reviewLog as {
      interval?: number;
      ease?: number;
      previousInterval?: number;
      reviewTime?: number;
    } | null;

    const ivl = Math.round(reviewLog?.interval ?? 0);
    const lastIvl = Math.round(reviewLog?.previousInterval ?? 0);
    const factor = Math.round((reviewLog?.ease ?? 2.5) * 1000);
    const time = reviewLog?.reviewTime ?? 0; // ms

    // Determine revlog type: 0=learning, 1=review, 2=relearning
    const type = ease === 1 ? 0 : 1; // simplified

    insertStmt.run([id, ankiCardId, -1, ease, ivl, lastIvl, factor, time, type]);
  }

  insertStmt.free();
}
