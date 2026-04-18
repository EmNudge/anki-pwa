<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  login,
  downloadCollection,
  downloadMedia,
  uploadCollection,
  uploadMedia,
  readSyncConfig,
  writeSyncConfig,
  readSyncState,
  writeSyncState,
  clearSyncState,
} from "../lib/ankiSync";
import {
  loadSyncedCollection,
  clearSyncedCollection,
  syncActiveSig,
  getActiveDeckId,
  getCachedSqlite,
  refreshSyncedCollection,
  addMediaToCache,
  initializeReviewQueue,
} from "../stores";
import { applyReviewStateToSqlite } from "../lib/syncWrite";
import { normalSync, FullSyncRequiredError, type SyncSummary } from "../lib/normalSync";
import { acquireSyncLock, releaseSyncLock } from "../lib/autoSync";
import { triggerPreSyncBackup } from "../backup/autoBackup";
import { createProgress, type SyncProgress } from "../lib/syncProgress";
import SyncProgressBar from "./SyncProgressBar.vue";
import SyncConflictModal from "./SyncConflictModal.vue";
import SyncSummaryPanel from "./SyncSummaryPanel.vue";
import mime from "mime";

const serverUrl = ref("");
const username = ref("");
const password = ref("");
const isLoggedIn = ref(false);
const isSyncing = ref(false);
const syncStatus = ref("");
const syncError = ref("");
const syncProgress = ref<SyncProgress | null>(null);
const syncSummary = ref<SyncSummary | null>(null);
const lastSyncTime = ref<number | null>(null);
const showPushConfirm = ref(false);
const showConflictModal = ref(false);
const conflictReason = ref(
  "The collection schema has changed (e.g. notetypes were modified on another device). Choose which version to keep.",
);
const showAdvancedSync = ref(false);
const lastSyncType = ref<string | null>(localStorage.getItem("anki-last-sync-type"));
const lastSyncProto = ref<string | null>(localStorage.getItem("anki-last-sync-proto"));

onMounted(() => {
  const config = readSyncConfig();
  if (config) {
    serverUrl.value = config.serverUrl;
    username.value = config.username;
  }

  const state = readSyncState();
  if (state.hkey) {
    isLoggedIn.value = true;
  }
  lastSyncTime.value = state.lastSync;
});

async function handleLogin() {
  syncError.value = "";
  syncStatus.value = "Logging in...";

  try {
    const hkey = await login(serverUrl.value, username.value, password.value);

    writeSyncConfig({ serverUrl: serverUrl.value, username: username.value });
    const prevState = readSyncState();
    writeSyncState({ ...prevState, hkey });

    isLoggedIn.value = true;
    syncActiveSig.value = true;
    syncStatus.value = "Logged in successfully.";
    password.value = "";
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : "Login failed";
    syncStatus.value = "";
  }
}

async function handleLogout() {
  clearSyncState();
  await clearSyncedCollection();
  isLoggedIn.value = false;
  syncActiveSig.value = false;
  syncStatus.value = "";
  syncError.value = "";
  lastSyncTime.value = null;
}

/** Primary sync action — uses incremental sync, falls back to full sync. */
async function handleSync() {
  const state = readSyncState();
  if (!state.hkey) {
    syncError.value = "Not logged in. Please log in first.";
    return;
  }

  if (!acquireSyncLock()) {
    syncError.value = "A sync is already in progress.";
    return;
  }

  syncError.value = "";
  syncSummary.value = null;
  isSyncing.value = true;

  // Create a backup before sync (if enabled in backup settings)
  syncStatus.value = "Preparing backup...";
  await triggerPreSyncBackup();

  try {
    // Check if we have a local collection — if not, do a full pull first
    const cachedBytes = await getCachedSqlite();
    if (!cachedBytes) {
      syncStatus.value = "No local collection. Performing full download...";
      syncProgress.value = createProgress("downloading-collection");
      await doFullPull(state.hkey);
      return;
    }

    // Attempt normal (incremental) sync
    const deckId = getActiveDeckId();
    const result = await normalSync(
      serverUrl.value,
      state.hkey,
      deckId,
      cachedBytes,
      (status, progress) => {
        syncStatus.value = status;
        if (progress) syncProgress.value = progress;
      },
    );

    if (result.action === "noChanges") {
      setSyncInfo("Incremental", result.proto);
      syncProgress.value = createProgress("done");
      syncStatus.value = "Already up to date.";
      const now = Date.now();
      writeSyncState({ ...state, lastSync: now });
      lastSyncTime.value = now;
      return;
    }

    if (result.sqliteBytes) {
      syncStatus.value = "Updating local collection...";
      await refreshSyncedCollection(result.sqliteBytes);
      await initializeReviewQueue();
    }

    // Build summary from the sync result, will be updated with media counts
    const summary: SyncSummary = {
      ...(result.summary ?? {
        remoteGraves: 0,
        localGraves: 0,
        remoteMetadataChanges: 0,
        localMetadataChanges: 0,
        chunksReceived: 0,
        chunksSent: 0,
        mediaDownloaded: 0,
        mediaUploaded: 0,
      }),
    };

    // Download then upload media sequentially — each calls /msync/begin which
    // starts a new server session, so running them in parallel would invalidate
    // the first session and cause 400 errors on downloadFiles.
    syncStatus.value = "Downloading media...";
    syncProgress.value = createProgress("downloading-media");
    try {
      const dlMedia = await downloadMedia(serverUrl.value, state.hkey, (s) => {
        syncStatus.value = s;
      });
      if (dlMedia.size > 0) {
        const typedBlobs = new Map<string, Blob>();
        for (const [filename, blob] of dlMedia) {
          typedBlobs.set(
            filename,
            new Blob([blob], { type: mime.getType(filename) ?? "application/octet-stream" }),
          );
        }
        syncStatus.value = `Downloaded ${dlMedia.size} media file${dlMedia.size === 1 ? "" : "s"}. Caching...`;
        await addMediaToCache(typedBlobs);
        summary.mediaDownloaded = dlMedia.size;
      }
    } catch (dlErr) {
      console.warn("Media download failed (non-fatal):", dlErr);
    }

    syncStatus.value = "Uploading media...";
    syncProgress.value = createProgress("uploading-media");
    try {
      const uploaded = await uploadMedia(serverUrl.value, state.hkey, (s) => {
        syncStatus.value = s;
      });
      if (uploaded > 0) {
        syncStatus.value = `Uploaded ${uploaded} media file${uploaded === 1 ? "" : "s"}.`;
        summary.mediaUploaded = uploaded;
      }
    } catch (ulErr) {
      console.warn("Media upload failed (non-fatal):", ulErr);
    }

    setSyncInfo("Incremental", result.proto);
    syncProgress.value = createProgress("done");
    syncSummary.value = summary;

    const newState = { ...state, ...result.newState };
    writeSyncState(newState);
    lastSyncTime.value = newState.lastSync ?? Date.now();

    syncStatus.value = "Sync completed successfully.";
  } catch (err) {
    syncProgress.value = createProgress("error");
    if (err instanceof FullSyncRequiredError) {
      conflictReason.value =
        err.message ||
        "The collection schema has changed (e.g. notetypes were modified on another device). Choose which version to keep.";
      showConflictModal.value = true;
      syncStatus.value = "";
      return;
    }
    if (err instanceof Error && err.message.includes("Authentication expired")) {
      isLoggedIn.value = false;
      syncActiveSig.value = false;
      clearSyncState();
    }
    syncError.value = err instanceof Error ? err.message : "Sync failed";
    syncStatus.value = "";
  } finally {
    isSyncing.value = false;
    releaseSyncLock();
  }
}

/** Full download (pull) — replaces local collection entirely. */
async function doFullPull(hkey: string) {
  syncStatus.value = "Downloading collection...";
  syncProgress.value = createProgress("downloading-collection");
  const setStatus = (s: string) => {
    syncStatus.value = s;
  };
  const sqliteBytes = await downloadCollection(serverUrl.value, hkey, setStatus);

  syncStatus.value = "Downloading media files...";
  syncProgress.value = createProgress("downloading-media");
  const mediaBlobs = await downloadMedia(serverUrl.value, hkey, setStatus);
  let typedMediaBlobs: Map<string, Blob> | undefined;
  if (mediaBlobs.size > 0) {
    typedMediaBlobs = new Map<string, Blob>();
    for (const [filename, blob] of mediaBlobs) {
      typedMediaBlobs.set(
        filename,
        new Blob([blob], { type: mime.getType(filename) ?? "application/octet-stream" }),
      );
    }
    syncStatus.value = `Downloaded ${mediaBlobs.size} media files. Loading...`;
  }

  syncStatus.value = "Parsing collection...";
  await loadSyncedCollection(sqliteBytes, typedMediaBlobs);

  setSyncInfo("Full download");
  syncProgress.value = createProgress("done");

  const now = Date.now();
  const prevState = readSyncState();
  writeSyncState({ ...prevState, lastSync: now });
  lastSyncTime.value = now;

  syncStatus.value = "Collection synced successfully.";
}

async function handlePull() {
  const state = readSyncState();
  if (!state.hkey) {
    syncError.value = "Not logged in. Please log in first.";
    return;
  }

  if (!acquireSyncLock()) {
    syncError.value = "A sync is already in progress.";
    return;
  }

  showConflictModal.value = false;
  syncError.value = "";
  syncSummary.value = null;
  isSyncing.value = true;

  try {
    await doFullPull(state.hkey);
  } catch (err) {
    syncProgress.value = createProgress("error");
    if (err instanceof Error && err.message.includes("Authentication expired")) {
      isLoggedIn.value = false;
      syncActiveSig.value = false;
      clearSyncState();
    }
    syncError.value = err instanceof Error ? err.message : "Sync failed";
    syncStatus.value = "";
  } finally {
    isSyncing.value = false;
    releaseSyncLock();
  }
}

async function handlePush() {
  const state = readSyncState();
  if (!state.hkey) {
    syncError.value = "Not logged in. Please log in first.";
    return;
  }

  if (!acquireSyncLock()) {
    syncError.value = "A sync is already in progress.";
    return;
  }

  showPushConfirm.value = false;
  showConflictModal.value = false;
  syncError.value = "";
  syncSummary.value = null;
  isSyncing.value = true;
  syncStatus.value = "Preparing collection for upload...";
  syncProgress.value = createProgress("merging-local");

  try {
    const sqliteBytes = await getCachedSqlite();
    if (!sqliteBytes) {
      throw new Error("No local collection found. Pull first before pushing.");
    }

    // Merge review state from IndexedDB into the SQLite
    syncStatus.value = "Writing review state into collection...";
    const deckId = getActiveDeckId();
    const modifiedSqlite = await applyReviewStateToSqlite(sqliteBytes, deckId);

    // Upload to server
    syncStatus.value = "Uploading collection to server...";
    syncProgress.value = createProgress("uploading-collection");
    await uploadCollection(serverUrl.value, state.hkey, modifiedSqlite);

    // Upload media files
    syncStatus.value = "Uploading media files...";
    syncProgress.value = createProgress("uploading-media");
    try {
      const mediaUploaded = await uploadMedia(serverUrl.value, state.hkey, (s) => {
        syncStatus.value = s;
      });
      if (mediaUploaded > 0) {
        syncStatus.value = `Uploaded ${mediaUploaded} media file${mediaUploaded === 1 ? "" : "s"}.`;
      }
    } catch (mediaErr) {
      console.warn("Media upload failed (non-fatal):", mediaErr);
    }

    // Update local cache with the modified version
    await refreshSyncedCollection(modifiedSqlite);

    setSyncInfo("Full upload");
    syncProgress.value = createProgress("done");

    const now = Date.now();
    writeSyncState({ ...state, lastSync: now });
    lastSyncTime.value = now;

    syncStatus.value = "Collection pushed successfully.";
  } catch (err) {
    syncProgress.value = createProgress("error");
    if (err instanceof Error && err.message.includes("Authentication expired")) {
      isLoggedIn.value = false;
      syncActiveSig.value = false;
      clearSyncState();
    }
    syncError.value = err instanceof Error ? err.message : "Push failed";
    syncStatus.value = "";
  } finally {
    isSyncing.value = false;
    releaseSyncLock();
  }
}

async function handleDisconnect() {
  writeSyncConfig(null);
  clearSyncState();
  await clearSyncedCollection();
  serverUrl.value = "";
  username.value = "";
  password.value = "";
  isLoggedIn.value = false;
  syncActiveSig.value = false;
  syncStatus.value = "";
  syncError.value = "";
  lastSyncTime.value = null;
}

function setSyncInfo(type: string, proto?: 10 | 11) {
  lastSyncType.value = type;
  localStorage.setItem("anki-last-sync-type", type);
  if (proto) {
    const label = `v${proto}${proto === 11 ? " (zstd)" : " (legacy)"}`;
    lastSyncProto.value = label;
    localStorage.setItem("anki-last-sync-proto", label);
  }
}

function formatLastSync(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}
</script>

<template>
  <div class="sync-panel">
    <h2 class="sync-title">Sync Server</h2>
    <p class="sync-description">
      Pull your collection from a self-hosted Anki sync server. Compatible with
      <code>anki-sync-server</code>, Anki's built-in server, and other implementations.
    </p>

    <!-- Server Configuration -->
    <div class="sync-section">
      <label class="sync-label" for="server-url">Server URL</label>
      <input
        id="server-url"
        v-model="serverUrl"
        type="url"
        class="sync-input"
        placeholder="https://sync.example.com"
        :disabled="isLoggedIn"
      />

      <label class="sync-label" for="username">Username</label>
      <input
        id="username"
        v-model="username"
        type="text"
        class="sync-input"
        placeholder="username"
        :disabled="isLoggedIn"
      />

      <template v-if="!isLoggedIn">
        <label class="sync-label" for="password">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          class="sync-input"
          placeholder="password"
          @keydown.enter="handleLogin"
        />

        <button
          class="sync-btn sync-btn--primary"
          :disabled="!serverUrl || !username || !password"
          @click="handleLogin"
        >
          Log In
        </button>
      </template>

      <template v-else>
        <div class="sync-connected">
          <span class="sync-connected-dot" />
          Connected as <strong>{{ username }}</strong>
        </div>

        <div class="sync-last-sync">Last sync: {{ formatLastSync(lastSyncTime) }}</div>
        <div v-if="lastSyncType" class="sync-last-sync">
          Type: {{ lastSyncType
          }}<template v-if="lastSyncProto"> · Protocol: {{ lastSyncProto }}</template>
        </div>

        <div class="sync-actions">
          <button class="sync-btn sync-btn--primary" :disabled="isSyncing" @click="handleSync">
            <svg
              v-if="isSyncing"
              class="sync-spinner"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-dasharray="50 20"
              />
            </svg>
            {{ isSyncing ? "Syncing..." : "Sync" }}
          </button>
          <button class="sync-btn sync-btn--secondary" :disabled="isSyncing" @click="handleLogout">
            Log Out
          </button>
          <button class="sync-btn sync-btn--danger" :disabled="isSyncing" @click="handleDisconnect">
            Disconnect
          </button>
        </div>

        <!-- Sync progress indicator -->
        <SyncProgressBar :progress="syncProgress" :is-active="isSyncing" />

        <!-- Sync summary (shown after sync completes) -->
        <SyncSummaryPanel :summary="syncSummary" />

        <!-- Push confirmation dialog -->
        <div v-if="showPushConfirm" class="sync-confirm">
          <p class="sync-confirm-text">
            <strong>Push will overwrite the server collection</strong> with your local copy
            including any reviews done here. If you reviewed on another device without pulling
            first, those reviews will be lost.
          </p>
          <div class="sync-confirm-actions">
            <button class="sync-btn sync-btn--danger" @click="handlePush">
              Push &amp; Overwrite
            </button>
            <button class="sync-btn sync-btn--secondary" @click="showPushConfirm = false">
              Cancel
            </button>
          </div>
        </div>

        <!-- Advanced: Force full sync -->
        <details class="sync-advanced" @toggle="showAdvancedSync = !showAdvancedSync">
          <summary>Force full sync</summary>
          <div class="sync-advanced-content">
            <p class="sync-advanced-desc">
              Bypass incremental sync and transfer the entire collection.
            </p>
            <div class="sync-actions">
              <button
                class="sync-btn sync-btn--secondary"
                :disabled="isSyncing"
                @click="handlePull"
              >
                Full Download
              </button>
              <button
                class="sync-btn sync-btn--push"
                :disabled="isSyncing"
                @click="showPushConfirm = true"
              >
                Full Upload
              </button>
            </div>
          </div>
        </details>
      </template>
    </div>

    <!-- Conflict resolution modal -->
    <SyncConflictModal
      :is-open="showConflictModal"
      :reason="conflictReason"
      @close="showConflictModal = false"
      @keep-remote="handlePull"
      @keep-local="
        showPushConfirm = true;
        showConflictModal = false;
      "
    />

    <!-- Status Messages -->
    <div v-if="syncStatus" class="sync-status">{{ syncStatus }}</div>
    <div v-if="syncError" class="sync-error">{{ syncError }}</div>

    <!-- Help Section -->
    <details class="sync-help">
      <summary>Setup guide</summary>
      <div class="sync-help-content">
        <h3>CORS Configuration</h3>
        <p>
          Your sync server must allow cross-origin requests from this app. If you control the
          server, add CORS headers to allow this origin.
        </p>

        <h3>Anki Built-in Server</h3>
        <p>
          Start with: <code>SYNC_USER1=user:pass anki --syncserver</code><br />
          The server runs at <code>http://localhost:8080</code> by default.
        </p>

        <h3>anki-sync-server</h3>
        <p>
          See the project documentation for setup. The default URL is typically
          <code>http://localhost:27701</code>.
        </p>

        <h3>What gets synced</h3>
        <p>
          <strong>Sync</strong> performs an incremental two-way sync, sending only changes since the
          last sync. Reviews done on desktop and here are merged automatically (newer wins).
        </p>
        <p>
          If the collection schema changed (e.g. notetypes were edited), a full sync is required and
          you'll be asked to choose a direction.
        </p>
        <p>
          <strong>Force full sync</strong> options bypass incremental sync and transfer the entire
          collection in one direction (download or upload).
        </p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.sync-panel {
  max-width: 540px;
  margin: 0 auto;
  padding: var(--spacing-8) var(--spacing-4);
  text-align: left;
}

.sync-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-2) 0;
}

.sync-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0 0 var(--spacing-6) 0;
  line-height: 1.5;
}

.sync-description code {
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-sm);
}

.sync-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.sync-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.sync-input {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  transition: var(--transition-colors);
}

.sync-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 25%, transparent);
}

.sync-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sync-connected {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.sync-connected-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
}

.sync-last-sync {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.sync-actions {
  display: flex;
  gap: var(--spacing-2);
  flex-wrap: wrap;
}

.sync-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sync-spinner {
  width: 14px;
  height: 14px;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sync-btn--primary {
  color: white;
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.sync-btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.sync-btn--secondary {
  color: var(--color-text-primary);
  background: var(--color-surface);
}

.sync-btn--secondary:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.sync-btn--push {
  color: white;
  background: var(--color-warning-500);
  border-color: var(--color-warning-500);
}

.sync-btn--push:hover:not(:disabled) {
  filter: brightness(1.1);
}

.sync-btn--danger {
  color: #ef4444;
  background: var(--color-surface);
  border-color: #ef4444;
}

.sync-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 10%, var(--color-surface));
}

.sync-confirm {
  margin-top: var(--spacing-3);
  padding: var(--spacing-3);
  background: color-mix(in srgb, var(--color-warning-500) 8%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-warning-500) 30%, var(--color-border));
  border-radius: var(--radius-md);
}

.sync-confirm-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-3) 0;
  line-height: 1.5;
}

.sync-confirm-actions {
  display: flex;
  gap: var(--spacing-2);
}

.sync-status {
  margin-top: var(--spacing-4);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  border-radius: var(--radius-md);
}

.sync-error {
  margin-top: var(--spacing-4);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 8%, var(--color-surface));
  border-radius: var(--radius-md);
}

.sync-advanced {
  margin-top: var(--spacing-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.sync-advanced summary {
  cursor: pointer;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.sync-advanced-content {
  padding-top: var(--spacing-3);
}

.sync-advanced-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin: 0 0 var(--spacing-2) 0;
}

.sync-help {
  margin-top: var(--spacing-6);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.sync-help summary {
  cursor: pointer;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.sync-help-content {
  padding-top: var(--spacing-3);
  line-height: 1.6;
}

.sync-help-content h3 {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: var(--spacing-4) 0 var(--spacing-1) 0;
}

.sync-help-content h3:first-child {
  margin-top: 0;
}

.sync-help-content p {
  margin: 0 0 var(--spacing-2) 0;
}

.sync-help-content code {
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-sm);
}
</style>
