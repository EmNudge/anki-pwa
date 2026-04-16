const DB_NAME = "anki-backup-db";
const DB_VERSION = 1;

export interface BackupMeta {
  id: string;
  createdAt: number;
  label: string;
  sizeBytes: number;
}

interface BackupRecord extends BackupMeta {
  blob: Blob;
}

class BackupDB {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("backups")) {
          const store = db.createObjectStore("backups", { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    });
  }

  private async ensureInit(): Promise<IDBDatabase> {
    await this.initPromise;
    if (!this.db) throw new Error("Backup database not initialized");
    return this.db;
  }

  /** List all backups (metadata only, no blob) sorted by createdAt descending. */
  async listBackups(): Promise<BackupMeta[]> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readonly");
      const store = tx.objectStore("backups");
      const index = store.index("createdAt");
      const results: BackupMeta[] = [];

      const request = index.openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const { id, createdAt, label, sizeBytes } = cursor.value as BackupRecord;
          results.push({ id, createdAt, label, sizeBytes });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Store a backup blob and return its id. */
  async saveBackup(label: string, blob: Blob): Promise<string> {
    const db = await this.ensureInit();
    const record: BackupRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      label,
      sizeBytes: blob.size,
      blob,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readwrite");
      const request = tx.objectStore("backups").put(record);
      request.onsuccess = () => resolve(record.id);
      request.onerror = () => reject(request.error);
    });
  }

  /** Retrieve a backup blob by id. */
  async getBackup(id: string): Promise<Blob | null> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readonly");
      const request = tx.objectStore("backups").get(id);
      request.onsuccess = () => {
        const record = request.result as BackupRecord | undefined;
        resolve(record?.blob ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Delete a backup by id. */
  async deleteBackup(id: string): Promise<void> {
    const db = await this.ensureInit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readwrite");
      const request = tx.objectStore("backups").delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Delete oldest backups beyond maxCount. */
  async pruneOldBackups(maxCount: number): Promise<void> {
    const backups = await this.listBackups();
    if (backups.length <= maxCount) return;

    // backups are sorted newest-first; delete everything after maxCount
    const toDelete = backups.slice(maxCount);
    for (const backup of toDelete) {
      await this.deleteBackup(backup.id);
    }
  }
}

export const backupDB = new BackupDB();
