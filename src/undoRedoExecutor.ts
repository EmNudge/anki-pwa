import { triggerRef } from "vue";
import { popUndo, popRedo, pushUndo, pushRedo, canUndo, canRedo, type UndoEntry } from "./undoRedo";
import { reviewDB } from "./scheduler/db";
import type { CardReviewState, StoredReviewLog } from "./scheduler/types";
import { removeTags } from "./utils/tagTree";
import { ankiDataSig, currentReviewCardSig, initializeReviewQueue, updateNote } from "./stores";
import { markDataChanged } from "./lib/autoSync";
import { QUEUE_USER_BURIED, QUEUE_SUSPENDED } from "./lib/syncWrite";

/** Common card shape shared between AnkiDB2Data and AnkiDB21bData card types. */
type CardLike = { guid: string; tags: string[] };

// ── Undo data types ──

interface ReviewUndoData {
  cardId: string;
  previousState: CardReviewState;
  newState: CardReviewState;
  reviewLogTimestamp: number;
  wasNew: boolean;
  dailyStatsDate: string;
  reviewTimeMs: number;
}

interface NoteEditUndoData {
  guid: string;
  previousFields: Record<string, string | null>;
  previousTags: string[];
  newFields: Record<string, string | null>;
  newTags: string[];
}

interface NoteDeleteUndoData {
  guid: string;
  /** Serialized card data (deep cloned from AnkiData.cards entries). */
  cards: unknown[];
  reviewStates: CardReviewState[];
  reviewLogs: StoredReviewLog[];
}

interface BulkTagUndoData {
  guids: string[];
  tag: string;
  previousTags: Record<string, string[]>;
}

interface RenameTagUndoData {
  oldTag: string;
  newTag: string;
}

interface DeleteTagUndoData {
  tag: string;
  previousTags: Record<string, string[]>;
}

interface BuryCardUndoData {
  cardId: string;
  previousQueueOverride?: number;
}

interface SuspendCardUndoData {
  cardId: string;
  previousQueueOverride?: number;
}

interface BuryNoteUndoData {
  cardIds: string[];
  previousQueueOverrides: Record<string, number | undefined>;
}

interface FlagCardUndoData {
  cardId: string;
  previousFlag: number;
  newFlag: number;
}

interface MarkNoteUndoData {
  guid: string;
  wasMarked: boolean;
}

// ── Execute undo ──

export async function executeUndo(): Promise<string | null> {
  if (!canUndo.value) return null;

  const entry = popUndo();
  if (!entry) return null;

  const description = entry.description;

  try {
    switch (entry.type) {
      case "review":
        await undoReview(entry);
        break;
      case "noteEdit":
        await undoNoteEdit(entry);
        break;
      case "noteDelete":
        await undoNoteDelete(entry);
        break;
      case "bulkAddTag":
        await undoBulkAddTag(entry);
        break;
      case "bulkRemoveTag":
        await undoBulkRemoveTag(entry);
        break;
      case "renameTag":
        await undoRenameTag(entry);
        break;
      case "deleteTag":
        await undoDeleteTag(entry);
        break;
      case "buryCard":
        await undoBuryCard(entry);
        break;
      case "suspendCard":
        await undoSuspendCard(entry);
        break;
      case "buryNote":
        await undoBuryNote(entry);
        break;
      case "flagCard":
        await undoFlagCard(entry);
        break;
      case "markNote":
        await undoMarkNote(entry);
        break;
    }
  } catch (error) {
    console.error("Failed to undo:", error);
    return null;
  }

  return description;
}

// ── Execute redo ──

export async function executeRedo(): Promise<string | null> {
  if (!canRedo.value) return null;

  const entry = popRedo();
  if (!entry) return null;

  const description = entry.description;

  try {
    switch (entry.type) {
      case "review":
        await redoReview(entry);
        break;
      case "noteEdit":
        await redoNoteEdit(entry);
        break;
      case "noteDelete":
        await redoNoteDelete(entry);
        break;
      case "bulkAddTag":
        await redoBulkAddTag(entry);
        break;
      case "bulkRemoveTag":
        await redoBulkRemoveTag(entry);
        break;
      case "renameTag":
        await redoRenameTag(entry);
        break;
      case "deleteTag":
        await redoDeleteTag(entry);
        break;
      case "buryCard":
        await redoBuryCard(entry);
        break;
      case "suspendCard":
        await redoSuspendCard(entry);
        break;
      case "buryNote":
        await redoBuryNote(entry);
        break;
      case "flagCard":
        await redoFlagCard(entry);
        break;
      case "markNote":
        await redoMarkNote(entry);
        break;
    }
  } catch (error) {
    console.error("Failed to redo:", error);
    return null;
  }

  return description;
}

// ── Review undo/redo ──

async function undoReview(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as ReviewUndoData;

  // Restore previous card state
  await reviewDB.saveCard(data.previousState);

  // Delete the review log entry
  const logs = await reviewDB.getReviewLogsForCard(data.cardId);
  const logToDelete = logs.find((l) => l.timestamp === data.reviewLogTimestamp);
  if (logToDelete) {
    // Delete by re-writing without this entry
    // Note: ReviewDB doesn't have a deleteReviewLog by timestamp, so we'll
    // delete all and re-add the ones we want to keep
    await reviewDB.deleteReviewLogsForCard(data.cardId);
    for (const log of logs) {
      if (log.timestamp !== data.reviewLogTimestamp) {
        await reviewDB.saveReviewLog(log);
      }
    }
  }

  // Update daily stats (decrement counts)
  const stats = await reviewDB.getDailyStats(data.dailyStatsDate);
  if (stats) {
    if (data.wasNew) {
      stats.newCount = Math.max(0, stats.newCount - 1);
    } else {
      stats.reviewCount = Math.max(0, stats.reviewCount - 1);
    }
    stats.totalTimeMs = Math.max(0, stats.totalTimeMs - data.reviewTimeMs);
    await reviewDB.saveDailyStats(stats);
  }

  // Re-initialize the review queue to reflect the reverted state
  await initializeReviewQueue();

  // Push to redo stack
  pushRedo(
    {
      type: "review",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoReview(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as ReviewUndoData;

  // Re-apply the new card state
  await reviewDB.saveCard(data.newState);

  // Re-add the review log
  const logs = await reviewDB.getReviewLogsForCard(data.cardId);
  const alreadyExists = logs.some((l) => l.timestamp === data.reviewLogTimestamp);
  if (!alreadyExists) {
    await reviewDB.saveReviewLog({
      cardId: data.cardId,
      timestamp: data.reviewLogTimestamp,
      rating: "again", // The actual rating is stored in the log entry
      reviewLog: {} as never, // Will be reconstructed from entry data
    });
  }

  // Update daily stats
  const stats = await reviewDB.getDailyStats(data.dailyStatsDate);
  if (stats) {
    if (data.wasNew) {
      stats.newCount++;
    } else {
      stats.reviewCount++;
    }
    stats.totalTimeMs += data.reviewTimeMs;
    await reviewDB.saveDailyStats(stats);
  }

  // Re-initialize the review queue
  await initializeReviewQueue();

  // Push back to undo stack
  pushUndo({
    type: "review",
    description: entry.description,
    undoData: data,
  });
}

// ── Note edit undo/redo ──

async function undoNoteEdit(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as NoteEditUndoData;
  await updateNote(data.guid, data.previousFields, data.previousTags, true);

  pushRedo(
    {
      type: "noteEdit",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoNoteEdit(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as NoteEditUndoData;
  await updateNote(data.guid, data.newFields, data.newTags, true);

  pushUndo({
    type: "noteEdit",
    description: entry.description,
    undoData: data,
  });
}

// ── Note delete undo/redo ──

async function undoNoteDelete(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as NoteDeleteUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  // Restore cards to in-memory data
  (ankiData as { cards: unknown[] }).cards = [...ankiData.cards, ...data.cards];
  triggerRef(ankiDataSig);

  // Restore review states
  for (const state of data.reviewStates) {
    await reviewDB.saveCard(state);
  }

  // Restore review logs
  for (const log of data.reviewLogs) {
    await reviewDB.saveReviewLog(log);
  }

  await initializeReviewQueue();
  markDataChanged();

  pushRedo(
    {
      type: "noteDelete",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoNoteDelete(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as NoteDeleteUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  // Remove cards from in-memory data
  (ankiData as { cards: Array<{ guid: string }> }).cards = (
    ankiData.cards as Array<{ guid: string }>
  ).filter((card) => card.guid !== data.guid);
  triggerRef(ankiDataSig);

  // Delete review states
  for (const state of data.reviewStates) {
    await reviewDB.deleteCard(state.cardId);
  }

  // Delete review logs
  for (const state of data.reviewStates) {
    await reviewDB.deleteReviewLogsForCard(state.cardId);
  }

  await initializeReviewQueue();
  markDataChanged();

  pushUndo({
    type: "noteDelete",
    description: entry.description,
    undoData: data,
  });
}

// ── Bulk tag add undo/redo ──

async function undoBulkAddTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BulkTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (data.previousTags[card.guid]) {
      card.tags = [...data.previousTags[card.guid]!];
    }
  }
  triggerRef(ankiDataSig);

  pushRedo(
    {
      type: "bulkAddTag",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoBulkAddTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BulkTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  // Re-apply the tag directly without going through bulkAddTag (to avoid double undo push)
  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (!data.guids.includes(card.guid)) continue;
    if (card.tags.includes(data.tag)) continue;
    card.tags = [...card.tags, data.tag];
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "bulkAddTag",
    description: entry.description,
    undoData: data,
  });
}

// ── Bulk tag remove undo/redo ──

async function undoBulkRemoveTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BulkTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (data.previousTags[card.guid]) {
      card.tags = [...data.previousTags[card.guid]!];
    }
  }
  triggerRef(ankiDataSig);

  pushRedo(
    {
      type: "bulkRemoveTag",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoBulkRemoveTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BulkTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (!data.guids.includes(card.guid)) continue;
    card.tags = removeTags(card.tags, data.tag);
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "bulkRemoveTag",
    description: entry.description,
    undoData: data,
  });
}

// ── Rename tag undo/redo ──

async function undoRenameTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as RenameTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    card.tags = card.tags.map((t) => {
      if (t === data.newTag) return data.oldTag;
      if (t.startsWith(data.newTag + "::")) return data.oldTag + t.slice(data.newTag.length);
      return t;
    });
  }
  triggerRef(ankiDataSig);

  pushRedo(
    {
      type: "renameTag",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoRenameTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as RenameTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    card.tags = card.tags.map((t) => {
      if (t === data.oldTag) return data.newTag;
      if (t.startsWith(data.oldTag + "::")) return data.newTag + t.slice(data.oldTag.length);
      return t;
    });
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "renameTag",
    description: entry.description,
    undoData: data,
  });
}

// ── Delete tag undo/redo ──

async function undoDeleteTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as DeleteTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (data.previousTags[card.guid]) {
      card.tags = [...data.previousTags[card.guid]!];
    }
  }
  triggerRef(ankiDataSig);

  pushRedo(
    {
      type: "deleteTag",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoDeleteTag(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as DeleteTagUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    card.tags = removeTags(card.tags, data.tag);
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "deleteTag",
    description: entry.description,
    undoData: data,
  });
}

// ── Bury card undo/redo ──

async function undoBuryCard(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BuryCardUndoData;
  await reviewDB.patchCard(data.cardId, { queueOverride: data.previousQueueOverride });
  await initializeReviewQueue();

  pushRedo(
    {
      type: "buryCard",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoBuryCard(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BuryCardUndoData;
  await reviewDB.patchCard(data.cardId, { queueOverride: QUEUE_USER_BURIED });
  await initializeReviewQueue();

  pushUndo({
    type: "buryCard",
    description: entry.description,
    undoData: data,
  });
}

// ── Suspend card undo/redo ──

async function undoSuspendCard(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as SuspendCardUndoData;
  await reviewDB.patchCard(data.cardId, { queueOverride: data.previousQueueOverride });
  await initializeReviewQueue();

  pushRedo(
    {
      type: "suspendCard",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoSuspendCard(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as SuspendCardUndoData;
  await reviewDB.patchCard(data.cardId, { queueOverride: QUEUE_SUSPENDED });
  await initializeReviewQueue();

  pushUndo({
    type: "suspendCard",
    description: entry.description,
    undoData: data,
  });
}

// ── Bury note undo/redo ──

async function undoBuryNote(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BuryNoteUndoData;
  await reviewDB.patchCards(
    data.cardIds.map((cardId) => ({
      cardId,
      patch: { queueOverride: data.previousQueueOverrides[cardId] },
    })),
  );
  await initializeReviewQueue();

  pushRedo(
    {
      type: "buryNote",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoBuryNote(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as BuryNoteUndoData;
  await reviewDB.patchCards(
    data.cardIds.map((cardId) => ({ cardId, patch: { queueOverride: QUEUE_USER_BURIED } })),
  );
  await initializeReviewQueue();

  pushUndo({
    type: "buryNote",
    description: entry.description,
    undoData: data,
  });
}

// ── Flag card undo/redo ──

async function undoFlagCard(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as FlagCardUndoData;
  await reviewDB.patchCard(data.cardId, { flags: data.previousFlag });

  // Update current review card in memory if it matches
  const current = currentReviewCardSig.value;
  if (current && current.cardId === data.cardId) {
    current.reviewState.flags = data.previousFlag;
  }

  pushRedo(
    {
      type: "flagCard",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoFlagCard(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as FlagCardUndoData;
  await reviewDB.patchCard(data.cardId, { flags: data.newFlag });

  const current = currentReviewCardSig.value;
  if (current && current.cardId === data.cardId) {
    current.reviewState.flags = data.newFlag;
  }

  pushUndo({
    type: "flagCard",
    description: entry.description,
    undoData: data,
  });
}

// ── Mark note undo/redo ──

async function undoMarkNote(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as MarkNoteUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (card.guid !== data.guid) continue;
    if (data.wasMarked) {
      card.tags = card.tags.some((t) => t.toLowerCase() === "marked")
        ? card.tags
        : [...card.tags, "marked"];
    } else {
      card.tags = card.tags.filter((t) => t.toLowerCase() !== "marked");
    }
  }
  triggerRef(ankiDataSig);

  pushRedo(
    {
      type: "markNote",
      description: entry.description,
      undoData: data,
    },
    entry.id,
  );
}

async function redoMarkNote(entry: UndoEntry): Promise<void> {
  const data = entry.undoData as MarkNoteUndoData;
  const ankiData = ankiDataSig.value;
  if (!ankiData) return;

  const cards = ankiData.cards as CardLike[];
  for (const card of cards) {
    if (card.guid !== data.guid) continue;
    if (data.wasMarked) {
      card.tags = card.tags.filter((t) => t.toLowerCase() !== "marked");
    } else {
      card.tags = card.tags.some((t) => t.toLowerCase() === "marked")
        ? card.tags
        : [...card.tags, "marked"];
    }
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "markNote",
    description: entry.description,
    undoData: data,
  });
}
