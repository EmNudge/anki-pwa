import { backupDB, type BackupMeta } from "./db";
import { createColpkg, restoreColpkg } from "./colpkg";
import { downloadBlob } from "../utils/downloadBlob";

const SETTINGS_KEY = "anki-backup-settings";

export interface BackupSettings {
  autoBackupEnabled: boolean;
  maxBackupCount: number;
  backupBeforeSync: boolean;
  periodicIntervalMs: number;
  lastAutoBackupTime: number;
}

const DEFAULT_SETTINGS: BackupSettings = {
  autoBackupEnabled: true,
  maxBackupCount: 5,
  backupBeforeSync: true,
  periodicIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  lastAutoBackupTime: 0,
};

export function getBackupSettings(): BackupSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveBackupSettings(settings: BackupSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Create a backup, store it in IndexedDB, prune old ones. Returns the backup id. */
export async function createBackup(label: string): Promise<string> {
  const blob = await createColpkg();
  const id = await backupDB.saveBackup(label, blob);
  const settings = getBackupSettings();
  await backupDB.pruneOldBackups(settings.maxBackupCount);
  return id;
}

/** Restore from a stored backup by id. */
export async function restoreFromBackup(id: string): Promise<void> {
  const blob = await backupDB.getBackup(id);
  if (!blob) throw new Error("Backup not found");
  await restoreColpkg(blob);
}

/** Export the current collection as a .colpkg file download. */
export async function exportToFile(): Promise<void> {
  const blob = await createColpkg();
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `collection-${date}.colpkg`);
}

/** Import a .colpkg file and restore it. */
export async function importFromFile(file: Blob): Promise<void> {
  await restoreColpkg(file);
}

/** List all stored backups (metadata only). */
export async function listBackups(): Promise<BackupMeta[]> {
  return backupDB.listBackups();
}

/** Delete a stored backup. */
export async function deleteStoredBackup(id: string): Promise<void> {
  await backupDB.deleteBackup(id);
}

/** Download a stored backup as a .colpkg file. */
export async function downloadStoredBackup(id: string): Promise<void> {
  const blob = await backupDB.getBackup(id);
  if (!blob) throw new Error("Backup not found");
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `backup-${date}.colpkg`);
}
