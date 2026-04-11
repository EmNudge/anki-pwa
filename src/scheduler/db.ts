import type { CardReviewState, DailyStats, SchedulerSettings, StoredReviewLog } from "./types";
import type { CardState } from "./algorithm";
import { DEFAULT_SCHEDULER_SETTINGS } from "./types";

const DB_NAME = "anki-review-db";
const DB_VERSION = 4; // 4: added deletedNotes and deletedDecks stores for sync graves

/**
 * IndexedDB wrapper for persisting review state
 */
class ReviewDB {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  /**
   * Initialize the database
   */
  private async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const transaction = request.transaction;
        if (!transaction) throw new Error("Missing versionchange transaction");
        const oldVersion = event.oldVersion;

        // Store for card review states
        if (!db.objectStoreNames.contains("cards")) {
          const cardStore = db.createObjectStore("cards", { keyPath: "cardId" });
          cardStore.createIndex("deckId", "deckId", { unique: false });
          cardStore.createIndex("algorithm", "algorithm", { unique: false });
        } else if (oldVersion < 2) {
          // Migration from version 1 to 2: Update card structure
          const cardStore = transaction.objectStore("cards");

          // Remove old due index if it exists
          if (cardStore.indexNames.contains("due")) {
            cardStore.deleteIndex("due");
          }

          // Add new algorithm index
          if (!cardStore.indexNames.contains("algorithm")) {
            cardStore.createIndex("algorithm", "algorithm", { unique: false });
          }

          // Migrate existing cards from sm2State to cardState
          const getAllRequest = cardStore.getAll();
          getAllRequest.onsuccess = () => {
            const cards = getAllRequest.result;
            for (const card of cards as Array<CardReviewState & { sm2State?: unknown }>) {
              if (card.sm2State && !card.cardState) {
                const { sm2State, ...rest } = card;
                const migratedCard: CardReviewState = {
                  ...rest,
                  algorithm: "sm2",
                  cardState: sm2State as CardState,
                };
                cardStore.put(migratedCard);
              }
            }
          };
        }

        // Store for review logs
        if (!db.objectStoreNames.contains("reviewLogs")) {
          const logStore = db.createObjectStore("reviewLogs", { keyPath: "timestamp" });
          logStore.createIndex("cardId", "cardId", { unique: false });
          logStore.createIndex("date", "timestamp", { unique: false });
        }

        // Store for daily statistics
        if (!db.objectStoreNames.contains("dailyStats")) {
          db.createObjectStore("dailyStats", { keyPath: "date" });
        }

        // Store for settings
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "deckId" });
        }

        // Store for deleted cards (sync graves)
        if (!db.objectStoreNames.contains("deletedCards")) {
          const delStore = db.createObjectStore("deletedCards", { keyPath: "cardId" });
          delStore.createIndex("deckId", "deckId", { unique: false });
        }

        // Store for deleted notes (sync graves) — added in v4
        if (!db.objectStoreNames.contains("deletedNotes")) {
          const noteStore = db.createObjectStore("deletedNotes", { keyPath: "noteId" });
          noteStore.createIndex("deckId", "deckId", { unique: false });
        }

        // Store for deleted decks (sync graves) — added in v4
        if (!db.objectStoreNames.contains("deletedDecks")) {
          db.createObjectStore("deletedDecks", { keyPath: "deletedDeckId" });
        }
      };
    });
  }

  /**
   * Ensure DB is initialized before operations
   */
  private async ensureInit(): Promise<IDBDatabase> {
    await this.initPromise;
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  /** Run a single IDBRequest-returning operation inside a transaction. */
  private async run<T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => IDBRequest,
    mapResult?: (result: unknown) => T,
  ): Promise<T> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const request = fn(tx);
      request.onsuccess = () =>
        resolve(mapResult ? mapResult(request.result) : (request.result as T));
      request.onerror = () => reject(request.error);
    });
  }

  async getCard(cardId: string): Promise<CardReviewState | null> {
    return this.run(
      ["cards"],
      "readonly",
      (tx) => tx.objectStore("cards").get(cardId),
      (r) => (r as CardReviewState | null) ?? null,
    );
  }

  async saveCard(card: CardReviewState): Promise<void> {
    await this.run(["cards"], "readwrite", (tx) => tx.objectStore("cards").put(card));
  }

  /**
   * Partially update a card's fields without replacing the whole record.
   */
  async patchCard(
    cardId: string,
    patch: Partial<CardReviewState>,
  ): Promise<CardReviewState | null> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readwrite");
      const store = tx.objectStore("cards");
      const getReq = store.get(cardId);
      getReq.onsuccess = () => {
        const existing = getReq.result as CardReviewState | undefined;
        if (!existing) {
          resolve(null);
          return;
        }
        const updated = { ...existing, ...patch };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getCardsForDeck(deckId: string): Promise<CardReviewState[]> {
    return this.run(["cards"], "readonly", (tx) =>
      tx.objectStore("cards").index("deckId").getAll(deckId),
    );
  }

  async getCardIdsForDeck(deckId: string): Promise<string[]> {
    return this.run(["cards"], "readonly", (tx) =>
      tx.objectStore("cards").index("deckId").getAllKeys(deckId),
    ) as Promise<string[]>;
  }

  async saveReviewLog(log: StoredReviewLog): Promise<void> {
    await this.run(["reviewLogs"], "readwrite", (tx) => tx.objectStore("reviewLogs").put(log));
  }

  async getReviewLogsForCard(cardId: string): Promise<StoredReviewLog[]> {
    return this.run(["reviewLogs"], "readonly", (tx) =>
      tx.objectStore("reviewLogs").index("cardId").getAll(cardId),
    );
  }

  async getReviewLogsForCards(cardIds: string[]): Promise<StoredReviewLog[]> {
    if (cardIds.length === 0) return [];
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("reviewLogs", "readonly");
      const index = tx.objectStore("reviewLogs").index("cardId");
      const results: StoredReviewLog[] = [];
      let completed = 0;
      for (const cardId of cardIds) {
        const request = index.getAll(cardId);
        request.onsuccess = () => {
          results.push(...(request.result as StoredReviewLog[]));
          completed++;
          if (completed === cardIds.length) resolve(results);
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  async getDailyStats(date: string): Promise<DailyStats | null> {
    return this.run(
      ["dailyStats"],
      "readonly",
      (tx) => tx.objectStore("dailyStats").get(date),
      (r) => (r as DailyStats | null) ?? null,
    );
  }

  async saveDailyStats(stats: DailyStats): Promise<void> {
    await this.run(["dailyStats"], "readwrite", (tx) => tx.objectStore("dailyStats").put(stats));
  }

  async getSettings(deckId: string): Promise<SchedulerSettings> {
    return this.run(
      ["settings"],
      "readonly",
      (tx) => tx.objectStore("settings").get(deckId),
      (r) =>
        (r as { settings?: SchedulerSettings } | undefined)?.settings ?? DEFAULT_SCHEDULER_SETTINGS,
    );
  }

  async saveSettings(deckId: string, settings: SchedulerSettings): Promise<void> {
    await this.run(["settings"], "readwrite", (tx) =>
      tx.objectStore("settings").put({ deckId, settings }),
    );
  }

  /**
   * Delete a card from the cards store (e.g. when applying remote graves).
   */
  async deleteCard(cardId: string): Promise<void> {
    await this.run(["cards"], "readwrite", (tx) => tx.objectStore("cards").delete(cardId));
  }

  /**
   * Delete all review logs for a specific card.
   */
  async deleteReviewLogsForCard(cardId: string): Promise<void> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("reviewLogs", "readwrite");
      const store = tx.objectStore("reviewLogs");
      const index = store.index("cardId");
      const request = index.openCursor(cardId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Mark a card as deleted (for sync graves tracking).
   */
  async markCardDeleted(cardId: string, deckId: string): Promise<void> {
    await this.run(["deletedCards"], "readwrite", (tx) =>
      tx.objectStore("deletedCards").put({ cardId, deckId, deletedAt: Date.now() }),
    );
  }

  /**
   * Get all deleted card IDs for a deck.
   */
  async getDeletedCardsForDeck(deckId: string): Promise<{ cardId: string }[]> {
    return this.run(["deletedCards"], "readonly", (tx) =>
      tx.objectStore("deletedCards").index("deckId").getAll(deckId),
    );
  }

  /**
   * Clear deleted cards tracking for a deck (after successful sync).
   */
  async clearDeletedCards(deckId: string): Promise<void> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("deletedCards", "readwrite");
      const store = tx.objectStore("deletedCards");
      const index = store.index("deckId");
      const request = index.openCursor(deckId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Mark a note as deleted (for sync graves tracking).
   */
  async markNoteDeleted(noteId: string, deckId: string): Promise<void> {
    await this.run(["deletedNotes"], "readwrite", (tx) =>
      tx.objectStore("deletedNotes").put({ noteId, deckId, deletedAt: Date.now() }),
    );
  }

  /**
   * Get all deleted note IDs for a deck.
   */
  async getDeletedNotesForDeck(deckId: string): Promise<{ noteId: string }[]> {
    return this.run(["deletedNotes"], "readonly", (tx) =>
      tx.objectStore("deletedNotes").index("deckId").getAll(deckId),
    );
  }

  /**
   * Clear deleted notes tracking for a deck (after successful sync).
   */
  async clearDeletedNotes(deckId: string): Promise<void> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("deletedNotes", "readwrite");
      const store = tx.objectStore("deletedNotes");
      const index = store.index("deckId");
      const request = index.openCursor(deckId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Mark a deck as deleted (for sync graves tracking).
   */
  async markDeckDeleted(deletedDeckId: string): Promise<void> {
    await this.run(["deletedDecks"], "readwrite", (tx) =>
      tx.objectStore("deletedDecks").put({ deletedDeckId, deletedAt: Date.now() }),
    );
  }

  /**
   * Get all deleted deck IDs.
   */
  async getDeletedDecks(): Promise<{ deletedDeckId: string }[]> {
    return this.run(["deletedDecks"], "readonly", (tx) =>
      tx.objectStore("deletedDecks").getAll(),
    );
  }

  /**
   * Clear deleted decks tracking (after successful sync).
   */
  async clearDeletedDecks(): Promise<void> {
    await this.run(["deletedDecks"], "readwrite", (tx) =>
      tx.objectStore("deletedDecks").clear(),
    );
  }

  /**
   * Clear all review data (for testing or reset)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const stores = [
        "cards",
        "reviewLogs",
        "dailyStats",
        "settings",
        "deletedCards",
        "deletedNotes",
        "deletedDecks",
      ];
      const transaction = db.transaction(stores, "readwrite");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      for (const storeName of stores) {
        transaction.objectStore(storeName).clear();
      }
    });
  }
}

/**
 * Singleton instance
 */
export const reviewDB = new ReviewDB();
