import { createDatabase } from "~/utils/sql";
import type { CardReviewState, StoredReviewLog } from "../scheduler/types";
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

/** Queue constants matching official Anki desktop. */
const QUEUE_SUSPENDED = -1;
const QUEUE_SCHED_BURIED = -2;
export const QUEUE_USER_BURIED = -3;

/** SQL used to update card rows during sync write-back. */
export const CARD_UPDATE_SQL =
  "UPDATE cards SET type=?, queue=?, due=?, ivl=?, factor=?, reps=?, lapses=?, left=?, flags=?, mod=?, data=?, odue=?, odid=?, usn=? WHERE id=?";

/** SQL used to insert graves (deleted objects) during sync write-back. */
export const GRAVES_INSERT_SQL =
  "INSERT INTO graves (usn, oid, type) VALUES (?, ?, ?)";

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
 * When interval >= 1 day, learning/relearning cards use queue 3 (dayLearning).
 */
function phaseToQueue(phase: SM2CardState["phase"], interval?: number): number {
  switch (phase) {
    case "new": return 0;
    case "learning":
    case "relearning":
      return (interval ?? 0) >= 1 ? 3 : 1;
    case "review": return 2;
  }
}

/**
 * Convert a due timestamp (ms) to Anki's `due` column value.
 * - Review cards: days since collection creation
 * - Learning/relearning with interval >= 1 day (dayLearning): days since collection creation
 * - Learning/relearning with interval < 1 day: Unix timestamp in seconds
 * - New cards: leave as-is (position)
 */
export function convertDue(
  state: { phase: string; due: number; interval?: number },
  collectionCreationSecs: number,
  position?: number,
): number {
  if (state.phase === "review") {
    return Math.floor((state.due - collectionCreationSecs * 1000) / MS_PER_DAY);
  }
  if (state.phase === "learning" || state.phase === "relearning") {
    // dayLearning: interval >= 1 day → store as day offset like review cards
    if ((state.interval ?? 0) >= 1) {
      return Math.floor((state.due - collectionCreationSecs * 1000) / MS_PER_DAY);
    }
    return Math.floor(state.due / 1000);
  }
  // New cards — return position (will be reassigned on next desktop sync)
  return position ?? 0;
}

/**
 * Encode learning step into Anki's `left` field.
 * Anki encodes: stepsToday * 1000 + stepsRemaining
 * stepsToday may differ from stepsRemaining when a card spans midnight.
 */
export function encodeLeft(
  state: { phase: string; step: number },
  totalSteps: number,
  stepsToday?: number,
): number {
  if (state.phase !== "learning" && state.phase !== "relearning") {
    return 0;
  }
  const stepsRemaining = Math.max(0, totalSteps - state.step);
  const todaySteps = stepsToday ?? stepsRemaining;
  return todaySteps * 1000 + stepsRemaining;
}

/**
 * Map SM-2 phase to Anki revlog type.
 * 0=learning, 1=review, 2=relearning, 3=filtered, 4=manual
 */
export function phaseToRevlogType(phase: string, daysLate?: number): number {
  switch (phase) {
    case "new": return 0;
    case "learning": return 0;
    case "review": return (daysLate !== undefined && daysLate < 0) ? 3 : 1;
    case "relearning": return 2;
    default: return 1;
  }
}

/**
 * Encode factor for the revlog/card factor column.
 * SM-2: ease * 1000 (e.g. 2.5 → 2500)
 * FSRS: difficulty_shifted * 1000, where difficulty_shifted = (difficulty - 1) / 9 + 0.1
 *   Maps 1.0-10.0 difficulty to 100-1100 range matching Anki desktop.
 */
export function encodeFactor(
  ease: number,
  algorithm: "sm2" | "fsrs" = "sm2",
  difficulty?: number,
): number {
  if (algorithm === "fsrs" && difficulty !== undefined) {
    return Math.round(((difficulty - 1) / 9 + 0.1) * 1000);
  }
  return Math.round(ease * 1000);
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
    const { reviewDB } = await import("../scheduler/db");
    const reviewedCards = await reviewDB.getCardsForDeck(deckId);
    if (reviewedCards.length === 0) {
      return new Uint8Array(db.export());
    }

    // Determine learning step counts from deck config (default steps)
    const defaultLearnSteps = 2; // [1, 10]
    const defaultRelearnSteps = 1; // [10]

    // Update each reviewed card in the SQLite database
    const updateStmt = db.prepare(CARD_UPDATE_SQL);

    const nowMs = Date.now();
    const nowSecs = Math.floor(nowMs / 1000);

    for (const card of reviewedCards) {
      const ankiCardId = Number(card.cardId);
      if (isNaN(ankiCardId)) continue; // legacy positional ID, skip

      // Apply queueOverride (bury/suspend) even for unreviewed cards
      const hasOverride =
        card.queueOverride === QUEUE_SUSPENDED ||
        card.queueOverride === QUEUE_SCHED_BURIED ||
        card.queueOverride === QUEUE_USER_BURIED;
      if (!card.lastReviewed && !hasOverride && card.flags === undefined) continue;

      const state = card.cardState as SM2CardState;
      const type = phaseToType(state.phase);
      const queue = hasOverride ? card.queueOverride! : phaseToQueue(state.phase, state.interval);
      const due = convertDue(state, collectionCreationSecs);
      const ivl = Math.max(0, Math.round(state.interval));
      const factor = encodeFactor(state.ease, card.algorithm);
      const totalSteps =
        state.phase === "relearning" ? defaultRelearnSteps : defaultLearnSteps;
      const stepsRemaining = Math.max(0, totalSteps - state.step);
      const left = encodeLeft(state, totalSteps, stepsRemaining);
      const flags = card.flags ?? 0;
      const data = serializeCardData(card);

      updateStmt.run([type, queue, due, ivl, factor, state.reps, state.lapses, left, flags, nowSecs, data, 0, 0, -1, ankiCardId]);
    }
    updateStmt.free();

    // Insert review logs into revlog table
    await insertRevlogs(db, deckId, reviewedCards);

    // Insert graves for deleted cards
    await insertGraves(db, deckId);

    // Update collection modification timestamp (milliseconds, matching official Anki)
    db.run("UPDATE col SET mod=?", [nowMs]);

    const result = new Uint8Array(db.export());
    return result;
  } finally {
    db.close();
  }
}

/**
 * Round a float to the specified number of decimal places.
 * Matches Anki's round_to_places (storage/card/data.rs).
 */
function roundToPlaces(value: number, decimalPlaces: number): number {
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(value * factor) / factor;
}

/**
 * Serialize card data (FSRS state, etc.) for the cards.data column.
 * Matches Anki's CardData format: { pos, s, d, dr, decay, lrt, cd }
 * with field-specific precision rounding.
 */
export function serializeCardData(card: CardReviewState): string {
  if (card.algorithm === "fsrs") {
    const fsrsState = card.cardState as {
      stability?: number;
      difficulty?: number;
      desiredRetention?: number;
      decay?: number;
    };
    if (fsrsState.stability !== undefined && fsrsState.difficulty !== undefined) {
      const data: Record<string, number> = {
        s: roundToPlaces(fsrsState.stability, 4),
        d: roundToPlaces(fsrsState.difficulty, 3),
      };
      if (fsrsState.desiredRetention !== undefined) {
        data.dr = roundToPlaces(fsrsState.desiredRetention, 2);
      }
      if (fsrsState.decay !== undefined) {
        data.decay = roundToPlaces(fsrsState.decay, 3);
      }
      if (card.lastReviewed != null) {
        data.lrt = Math.floor(card.lastReviewed / 1000);
      }
      return JSON.stringify(data);
    }
  }
  return "";
}

/**
 * Insert IndexedDB review logs into the SQLite revlog table.
 */
async function insertRevlogs(
  db: import("sql.js").Database,
  _deckId: string,
  reviewedCards: CardReviewState[],
): Promise<void> {
  const allLogs: StoredReviewLog[] = [];

  const { reviewDB } = await import("../scheduler/db");
  for (const card of reviewedCards) {
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

  // Build a map of cardId → card state for revlog type lookup
  const cardStateMap = new Map(reviewedCards.map((c) => [c.cardId, c]));

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
      phase?: string;
    } | null;

    const ivl = Math.round(reviewLog?.interval ?? 0);
    const lastIvl = Math.round(reviewLog?.previousInterval ?? 0);

    // Encode factor based on algorithm
    const cardState = cardStateMap.get(log.cardId);
    const algorithm = cardState?.algorithm ?? "sm2";
    const factor = algorithm === "fsrs"
      ? encodeFactor(0, "fsrs", reviewLog?.ease ?? 5.0)
      : Math.round((reviewLog?.ease ?? 2.5) * 1000);

    const time = reviewLog?.reviewTime ?? 0; // ms

    // Determine revlog type from card phase (0=learning, 1=review, 2=relearning)
    const phase = reviewLog?.phase ?? (cardState?.cardState as SM2CardState | undefined)?.phase ?? "review";
    const type = phaseToRevlogType(phase);

    insertStmt.run([id, ankiCardId, -1, ease, ivl, lastIvl, factor, time, type]);
  }

  insertStmt.free();
}

/**
 * Insert graves entries for any deleted cards in this deck.
 */
async function insertGraves(
  db: import("sql.js").Database,
  deckId: string,
): Promise<void> {
  const { reviewDB } = await import("../scheduler/db");
  const db_ = reviewDB as unknown as { getDeletedCardsForDeck?: (deckId: string) => Promise<{ cardId: string }[]> };
  const deletedCards = await db_.getDeletedCardsForDeck?.(deckId) ?? [];
  if (deletedCards.length === 0) return;

  const insertStmt = db.prepare(GRAVES_INSERT_SQL);
  for (const deleted of deletedCards) {
    const ankiCardId = Number(deleted.cardId);
    if (isNaN(ankiCardId)) continue;
    // type 0 = card deletion
    insertStmt.run([-1, ankiCardId, 0]);
  }
  insertStmt.free();
}
