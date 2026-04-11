import {
  readSyncConfig,
  readSyncState,
  writeSyncState,
  clearSyncState,
  downloadMedia,
  uploadMedia,
} from "./ankiSync";
import { normalSync, FullSyncRequiredError } from "./normalSync";
import {
  getCachedSqlite,
  getActiveDeckId,
  refreshSyncedCollection,
  addMediaToCache,
  initializeReviewQueue,
  syncActiveSig,
} from "../stores";
import mime from "mime";

const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const DATA_CHANGED_KEY = "anki-auto-sync-last-change";
const LAST_ATTEMPT_KEY = "anki-auto-sync-last-attempt";

let intervalId: ReturnType<typeof setInterval> | null = null;
let syncing = false;
let visibilityListenerAdded = false;

/**
 * Mark that local data has changed and should be synced.
 * Call this after reviews, note edits, deck renames/deletes, etc.
 */
export function markDataChanged() {
  localStorage.setItem(DATA_CHANGED_KEY, String(Date.now()));
}

function getLastDataChange(): number {
  return Number(localStorage.getItem(DATA_CHANGED_KEY) || "0");
}

function getLastAttempt(): number {
  return Number(localStorage.getItem(LAST_ATTEMPT_KEY) || "0");
}

function setLastAttempt() {
  localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now()));
}

/**
 * Acquire the sync lock. Returns false if already locked.
 */
export function acquireSyncLock(): boolean {
  if (syncing) return false;
  syncing = true;
  return true;
}

/**
 * Release the sync lock.
 */
export function releaseSyncLock() {
  syncing = false;
}

/**
 * Perform an incremental sync in the background.
 * Returns true if sync was attempted, false if skipped.
 */
async function performAutoSync(): Promise<boolean> {
  // Don't sync if not logged in
  const state = readSyncState();
  if (!state.hkey) return false;

  // Don't sync if no local collection
  const cachedBytes = await getCachedSqlite();
  if (!cachedBytes) return false;

  // Don't sync if already syncing
  if (!acquireSyncLock()) return false;

  const config = readSyncConfig();
  if (!config) {
    releaseSyncLock();
    return false;
  }

  try {
    setLastAttempt();

    const deckId = getActiveDeckId();
    const result = await normalSync(config.serverUrl, state.hkey, deckId, cachedBytes);

    if (result.action === "noChanges") {
      const now = Date.now();
      writeSyncState({ ...state, lastSync: now });
      return true;
    }

    if (result.sqliteBytes) {
      await refreshSyncedCollection(result.sqliteBytes);
      await initializeReviewQueue();
    }

    // Sync media sequentially — each calls /msync/begin which starts a new
    // server session, so parallel calls would invalidate the first session.
    try {
      const dlMedia = await downloadMedia(config.serverUrl, state.hkey);
      if (dlMedia.size > 0) {
        const typedBlobs = new Map<string, Blob>();
        for (const [filename, blob] of dlMedia) {
          typedBlobs.set(
            filename,
            new Blob([blob], { type: mime.getType(filename) ?? "application/octet-stream" }),
          );
        }
        await addMediaToCache(typedBlobs);
      }
    } catch (dlErr) {
      console.warn("[auto-sync] Media download failed:", dlErr);
    }

    try {
      await uploadMedia(config.serverUrl, state.hkey);
    } catch (ulErr) {
      console.warn("[auto-sync] Media upload failed:", ulErr);
    }

    const newState = { ...state, ...result.newState };
    writeSyncState(newState);

    console.log("[auto-sync] Sync completed successfully.");
    return true;
  } catch (err) {
    if (err instanceof FullSyncRequiredError) {
      console.warn("[auto-sync] Full sync required — skipping auto-sync.");
      return false;
    }
    if (err instanceof Error && err.message.includes("Authentication expired")) {
      syncActiveSig.value = false;
      clearSyncState();
    }
    console.warn("[auto-sync] Sync failed:", err);
    return false;
  } finally {
    releaseSyncLock();
  }
}

async function tick() {
  const lastChange = getLastDataChange();
  const lastAttempt = getLastAttempt();

  // Only sync if data changed since last attempt
  if (lastChange <= lastAttempt) return;

  await performAutoSync();
}

/**
 * Sync on visibility change: push pending changes when leaving,
 * pull fresh data when returning.
 */
function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    // Page losing focus — sync pending changes out
    tick();
  } else {
    // Page regaining focus — pull any remote changes
    performAutoSync();
  }
}

/**
 * Start the auto-sync timer and visibility listeners.
 * Safe to call multiple times (idempotent).
 */
export function startAutoSync() {
  if (intervalId === null) {
    intervalId = setInterval(tick, AUTO_SYNC_INTERVAL_MS);
  }
  if (!visibilityListenerAdded) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAdded = true;
  }
}

