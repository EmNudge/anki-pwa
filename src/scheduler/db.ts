import type { CardReviewState, DailyStats, SchedulerSettings, StoredReviewLog } from "./types";
import { DEFAULT_SCHEDULER_SETTINGS } from "./types";

const DB_NAME = "anki-review-db";
const DB_VERSION = 2; // Updated for FSRS support

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
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction!;
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
                  cardState: sm2State,
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
      request.onsuccess = () => resolve(mapResult ? mapResult(request.result) : (request.result as T));
      request.onerror = () => reject(request.error);
    });
  }

  async getCard(cardId: string): Promise<CardReviewState | null> {
    return this.run(["cards"], "readonly", (tx) =>
      tx.objectStore("cards").get(cardId),
      (r) => r as CardReviewState | null ?? null,
    );
  }

  async saveCard(card: CardReviewState): Promise<void> {
    await this.run(["cards"], "readwrite", (tx) =>
      tx.objectStore("cards").put(card),
    );
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
    await this.run(["reviewLogs"], "readwrite", (tx) =>
      tx.objectStore("reviewLogs").put(log),
    );
  }

  async getReviewLogsForCard(cardId: string): Promise<StoredReviewLog[]> {
    return this.run(["reviewLogs"], "readonly", (tx) =>
      tx.objectStore("reviewLogs").index("cardId").getAll(cardId),
    );
  }

  async getDailyStats(date: string): Promise<DailyStats | null> {
    return this.run(["dailyStats"], "readonly", (tx) =>
      tx.objectStore("dailyStats").get(date),
      (r) => r as DailyStats | null ?? null,
    );
  }

  async saveDailyStats(stats: DailyStats): Promise<void> {
    await this.run(["dailyStats"], "readwrite", (tx) =>
      tx.objectStore("dailyStats").put(stats),
    );
  }

  async getSettings(deckId: string): Promise<SchedulerSettings> {
    return this.run(["settings"], "readonly", (tx) =>
      tx.objectStore("settings").get(deckId),
      (r) => (r as { settings?: SchedulerSettings } | undefined)?.settings ?? DEFAULT_SCHEDULER_SETTINGS,
    );
  }

  async saveSettings(deckId: string, settings: SchedulerSettings): Promise<void> {
    await this.run(["settings"], "readwrite", (tx) =>
      tx.objectStore("settings").put({ deckId, settings }),
    );
  }

  /**
   * Clear all review data (for testing or reset)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ["cards", "reviewLogs", "dailyStats", "settings"],
        "readwrite",
      );

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      const stores = ["cards", "reviewLogs", "dailyStats", "settings"];
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
