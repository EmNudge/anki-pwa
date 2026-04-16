import { getCachedSqlite } from "../stores";
import { createBackup, getBackupSettings, saveBackupSettings } from "./backupService";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;
let backing = false;

async function tick() {
  if (backing) return;

  const settings = getBackupSettings();
  if (!settings.autoBackupEnabled) return;

  const elapsed = Date.now() - settings.lastAutoBackupTime;
  if (elapsed < settings.periodicIntervalMs) return;

  // Only backup if there's a collection loaded
  const bytes = await getCachedSqlite();
  if (!bytes) return;

  backing = true;
  try {
    await createBackup("Auto: periodic");
    saveBackupSettings({ ...settings, lastAutoBackupTime: Date.now() });
    console.log("[auto-backup] Periodic backup created.");
  } catch (err) {
    console.warn("[auto-backup] Failed:", err);
  } finally {
    backing = false;
  }
}

/**
 * Start the auto-backup check timer. Idempotent.
 */
export function startAutoBackup() {
  if (intervalId === null) {
    intervalId = setInterval(tick, CHECK_INTERVAL_MS);
  }
}

/**
 * Trigger a backup before sync, if enabled in settings.
 * Call this before sync operations that may replace local data.
 */
export async function triggerPreSyncBackup(): Promise<void> {
  const settings = getBackupSettings();
  if (!settings.backupBeforeSync) return;

  const bytes = await getCachedSqlite();
  if (!bytes) return;

  try {
    await createBackup("Auto: before sync");
    saveBackupSettings({ ...settings, lastAutoBackupTime: Date.now() });
    console.log("[auto-backup] Pre-sync backup created.");
  } catch (err) {
    console.warn("[auto-backup] Pre-sync backup failed:", err);
  }
}
