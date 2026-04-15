import { ref, computed } from "vue";

/**
 * Undo/Redo system using the command pattern.
 *
 * Each undoable operation records its inverse so it can be reverted.
 * The stack is persisted to IndexedDB so it survives page refreshes.
 * Capped at MAX_UNDO_DEPTH entries to limit memory usage.
 */

const MAX_UNDO_DEPTH = 30;
const DB_NAME = "anki-undo-db";
const DB_VERSION = 1;
const STORE_NAME = "undoStack";

// ── Types ──

export type UndoEntryType =
  | "review"
  | "noteEdit"
  | "noteDelete"
  | "bulkAddTag"
  | "bulkRemoveTag"
  | "renameTag"
  | "deleteTag"
  | "buryCard"
  | "suspendCard"
  | "buryNote"
  | "flagCard"
  | "markNote";

export interface UndoEntry {
  /** Unique ID for this entry */
  id: number;
  /** Type of operation */
  type: UndoEntryType;
  /** Human-readable description shown in the UI */
  description: string;
  /** Timestamp when the operation was performed */
  timestamp: number;
  /** Serialized data needed to undo this operation */
  undoData: unknown;
}

// ── Reactive state ──

const undoStack = ref<UndoEntry[]>([]);
const redoStack = ref<UndoEntry[]>([]);
let nextId = 1;

// ── IndexedDB persistence ──

let db: IDBDatabase | null = null;
let dbReady: Promise<void>;

function initDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

dbReady = initDB();

async function persistStacks(): Promise<void> {
  await dbReady;
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db!.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      key: "stacks",
      undoStack: undoStack.value,
      redoStack: redoStack.value,
      nextId,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadStacks(): Promise<void> {
  await dbReady;
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db!.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get("stacks");
    request.onsuccess = () => {
      const data = request.result;
      if (data) {
        undoStack.value = data.undoStack ?? [];
        redoStack.value = data.redoStack ?? [];
        nextId = data.nextId ?? 1;
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

// Load persisted stacks on startup
loadStacks();

// ── Public API ──

/**
 * Push an undoable operation onto the undo stack.
 * Clears the redo stack (new action invalidates redo history).
 */
export function pushUndo(entry: Omit<UndoEntry, "id" | "timestamp">): void {
  const newEntry: UndoEntry = {
    ...entry,
    id: nextId++,
    timestamp: Date.now(),
  };

  undoStack.value = [...undoStack.value, newEntry].slice(-MAX_UNDO_DEPTH);
  redoStack.value = [];
  persistStacks();
}

/**
 * Pop the most recent undo entry. Returns null if the stack is empty.
 * The caller is responsible for executing the undo operation.
 */
export function popUndo(): UndoEntry | null {
  if (undoStack.value.length === 0) return null;
  const stack = [...undoStack.value];
  const entry = stack.pop()!;
  undoStack.value = stack;
  // Don't persist here — the caller will push to redo via pushRedo
  return entry;
}

/**
 * Push an entry onto the redo stack (called after undoing).
 */
export function pushRedo(entry: Omit<UndoEntry, "id" | "timestamp">, originalId?: number): void {
  const newEntry: UndoEntry = {
    ...entry,
    id: originalId ?? nextId++,
    timestamp: Date.now(),
  };
  redoStack.value = [...redoStack.value, newEntry];
  persistStacks();
}

/**
 * Pop the most recent redo entry. Returns null if the stack is empty.
 */
export function popRedo(): UndoEntry | null {
  if (redoStack.value.length === 0) return null;
  const stack = [...redoStack.value];
  const entry = stack.pop()!;
  redoStack.value = stack;
  return entry;
}

/**
 * Clear both stacks (e.g., when switching decks or resetting).
 */
export function clearUndoHistory(): void {
  undoStack.value = [];
  redoStack.value = [];
  persistStacks();
}

// ── Computed accessors ──

/** Whether there is an action available to undo. */
export const canUndo = computed(() => undoStack.value.length > 0);

/** Whether there is an action available to redo. */
export const canRedo = computed(() => redoStack.value.length > 0);

/** Description of the next undoable action (e.g., "Answer Again"). */
export const undoDescription = computed(() => {
  const stack = undoStack.value;
  return stack.length > 0 ? stack[stack.length - 1]!.description : null;
});

/** Description of the next redoable action. */
export const redoDescription = computed(() => {
  const stack = redoStack.value;
  return stack.length > 0 ? stack[stack.length - 1]!.description : null;
});
