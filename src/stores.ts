import { ref, computed, watch, shallowRef, triggerRef } from "vue";
import { getAnkiDataFromBlob, getAnkiDataFromSqlite } from "./ankiParser";
import type { AnkiData } from "./ankiParser";
import { createDatabase } from "./utils/sql";

import { stringHash } from "./utils/constants";
import { ReviewQueue, type ReviewCard } from "./scheduler/queue";
import {
  DEFAULT_SCHEDULER_SETTINGS,
  type OptionPreset,
  type SchedulerSettings,
} from "./scheduler/types";
import { reviewDB } from "./scheduler/db";
import type { DeckInfo, DeckTreeNode } from "./types";
import { sampleDeckMap, sampleDecks, mergedSampleDeckData } from "./sampleDecks";
import {
  importedDeckFileName,
  persistActiveDeckSourceId as persistStoredActiveDeckSourceId,
  readAdoptedSampleIds,
  readCachedFiles,
  readStoredActiveDeckSourceId,
  removeCachedFileEntry,
  type CachedFileEntry,
  type DeckInput,
  upsertCachedFileEntry,
  writeAdoptedSampleIds,
  writeCachedFiles,
} from "./deckLibrary";
import { readSyncState } from "./lib/ankiSync";
import {
  loadMediaObjectUrls,
  revokeMediaObjectUrls,
  mediaCachePath,
  mediaKeyToFilename,
  clearMediaCache,
  filterMediaKeys,
} from "./utils/mediaCache";
import { QUEUE_USER_BURIED, QUEUE_SUSPENDED } from "./lib/syncWrite";
import { markDataChanged } from "./lib/autoSync";
import { pushUndo, clearUndoHistory } from "./undoRedo";

/** Revoke object URLs from the previous media map to prevent memory leaks. */
function revokeOldMediaUrls() {
  const current = activeDeckInputSig.value;
  if (current?.kind === "sqlite" && current.mediaFiles) {
    revokeMediaObjectUrls(current.mediaFiles);
  }
}

// View state
export type AppView = "review" | "browse" | "create" | "sync" | "duplicates" | "stats";
export const activeViewSig = ref<AppView>("review");
export const reviewModeSig = ref<"deck-list" | "studying">("deck-list");

export const deckInfoSig = shallowRef<DeckInfo | null>(null);

export const selectedDeckIdSig = ref<string | null>(null);

const ankiCachePromise = caches.open("anki-cache");
const sampleDeckIds = new Set(sampleDecks.map((deck) => deck.id));
const activeDeckInputSig = shallowRef<DeckInput | null>(null);
export const cachedFilesSig = ref<CachedFileEntry[]>(readCachedFiles());
export const activeDeckSourceIdSig = ref<string | null>(null);

activeDeckSourceIdSig.value = readStoredActiveDeckSourceId({
  cachedFiles: cachedFilesSig.value,
  sampleDeckIds,
});

function persistActiveDeckSourceId(id: string | null) {
  activeDeckSourceIdSig.value = id;
  persistStoredActiveDeckSourceId(id);
}

function clearLoadedDeck() {
  persistActiveDeckSourceId(null);
  activeDeckInputSig.value = null;
  deckInfoSig.value = null;
  selectedDeckIdSig.value = null;
  activeViewSig.value = "review";
  reviewModeSig.value = "deck-list";
  clearUndoHistory();
}

// Initialize: migrate old single-file cache and load active file
ankiCachePromise.then(async (cache) => {
  // Migrate old "anki-deck" entry to new format
  const oldResponse = await cache.match("anki-deck");
  if (oldResponse) {
    const blob = await oldResponse.blob();
    const name = importedDeckFileName;
    await cache.put(`/files/${name}`, new Response(blob));
    await cache.delete("anki-deck");
    cachedFilesSig.value = upsertCachedFileEntry(cachedFilesSig.value, {
      name,
      size: blob.size,
      addedAt: Date.now(),
    });
    writeCachedFiles(cachedFilesSig.value);
    if (!activeDeckSourceIdSig.value) {
      persistActiveDeckSourceId(name);
    }
  }

  if (!activeDeckSourceIdSig.value) {
    // Auto-load sample decks when no sync is configured and nothing else is active
    if (!syncActiveSig.value) {
      persistActiveDeckSourceId(SAMPLE_COLLECTION_ID);
      activeDeckInputSig.value = { kind: "sample", data: mergedSampleDeckData };
      activeViewSig.value = "review";
      reviewModeSig.value = "deck-list";
    }
    return;
  }

  // Restore synced collection from cache
  if (activeDeckSourceIdSig.value === SYNC_COLLECTION_ID) {
    const sqliteResp = await cache.match("/sync/collection.sqlite");
    if (sqliteResp) {
      const bytes = new Uint8Array(await sqliteResp.arrayBuffer());

      // Restore cached media blobs as object URLs
      const allKeys = await cache.keys();
      const hasMedia = filterMediaKeys(allKeys).length > 0;
      let mediaFiles: Map<string, string> | undefined;
      if (hasMedia) {
        mediaFiles = await loadMediaObjectUrls(cache);
      }

      activeDeckInputSig.value = { kind: "sqlite", bytes, mediaFiles };
      activeViewSig.value = "review";
      reviewModeSig.value = "deck-list";
      return;
    }
    persistActiveDeckSourceId(null);
    return;
  }

  // Restore merged sample collection
  if (activeDeckSourceIdSig.value === SAMPLE_COLLECTION_ID) {
    if (syncActiveSig.value) {
      persistActiveDeckSourceId(null);
      return;
    }
    activeDeckInputSig.value = { kind: "sample", data: mergedSampleDeckData };
    activeViewSig.value = "review";
    reviewModeSig.value = "deck-list";
    return;
  }

  const sampleDeck = sampleDeckMap.get(activeDeckSourceIdSig.value);
  if (sampleDeck) {
    // Don't auto-load sample decks when sync is active
    if (syncActiveSig.value) {
      persistActiveDeckSourceId(null);
      return;
    }
    activeDeckInputSig.value = { kind: "sample", data: sampleDeck.data };
    activeViewSig.value = "review";
    reviewModeSig.value = "deck-list";
    return;
  }

  const response = await cache.match(`/files/${activeDeckSourceIdSig.value}`);
  if (response) {
    activeDeckInputSig.value = { kind: "blob", blob: await response.blob() };
    activeViewSig.value = "review";
    reviewModeSig.value = "deck-list";
    return;
  }

  persistActiveDeckSourceId(null);
});

export async function addCachedFile(file: File) {
  const cache = await ankiCachePromise;
  await cache.put(`/files/${file.name}`, new Response(file));

  cachedFilesSig.value = upsertCachedFileEntry(cachedFilesSig.value, {
    name: file.name,
    size: file.size,
    addedAt: Date.now(),
  });
  writeCachedFiles(cachedFilesSig.value);

  persistActiveDeckSourceId(file.name);
  activeDeckInputSig.value = { kind: "blob", blob: file };
  activeViewSig.value = "review";
  reviewModeSig.value = "studying";
}

export async function loadCachedFile(name: string) {
  const cache = await ankiCachePromise;
  const response = await cache.match(`/files/${name}`);
  if (response) {
    persistActiveDeckSourceId(name);
    activeDeckInputSig.value = { kind: "blob", blob: await response.blob() };
    activeViewSig.value = "review";
    reviewModeSig.value = "studying";
  }
}

export function loadSampleDeck(id: string) {
  const sampleDeck = sampleDeckMap.get(id);
  if (!sampleDeck) {
    return;
  }

  persistActiveDeckSourceId(id);
  activeDeckInputSig.value = { kind: "sample", data: sampleDeck.data };
  activeViewSig.value = "review";
  reviewModeSig.value = "studying";
}

// Adopted sample decks — sample decks the user has added to "Your Decks"
export const adoptedSampleIdsSig = ref<string[]>(readAdoptedSampleIds());

export function adoptSampleDeck(id: string) {
  if (adoptedSampleIdsSig.value.includes(id)) return;
  adoptedSampleIdsSig.value = [...adoptedSampleIdsSig.value, id];
  writeAdoptedSampleIds(adoptedSampleIdsSig.value);
  loadSampleDeck(id);
}

export function removeAdoptedSample(id: string) {
  adoptedSampleIdsSig.value = adoptedSampleIdsSig.value.filter((s) => s !== id);
  writeAdoptedSampleIds(adoptedSampleIdsSig.value);

  if (activeDeckSourceIdSig.value !== id) return;

  // If the removed sample was active, load the next available deck or clear
  const nextCached = cachedFilesSig.value[0];
  if (nextCached) {
    loadCachedFile(nextCached.name);
  } else {
    const nextAdopted = adoptedSampleIdsSig.value[0];
    if (nextAdopted) {
      loadSampleDeck(nextAdopted);
    } else {
      clearLoadedDeck();
    }
  }
}

export async function deleteCachedFile(name: string) {
  const cache = await ankiCachePromise;
  await cache.delete(`/files/${name}`);
  cachedFilesSig.value = removeCachedFileEntry(cachedFilesSig.value, name);
  writeCachedFiles(cachedFilesSig.value);

  if (activeDeckSourceIdSig.value !== name) {
    return;
  }

  const nextFile = cachedFilesSig.value[0];
  if (nextFile) {
    await loadCachedFile(nextFile.name);
    return;
  }

  clearLoadedDeck();
}

const SYNC_COLLECTION_ID = "sync-collection";
export const SAMPLE_COLLECTION_ID = "sample-collection";

export async function loadSyncedCollection(bytes: Uint8Array, mediaBlobs?: Map<string, Blob>) {
  // Cache SQLite bytes and media blobs so they survive page reloads
  const cache = await ankiCachePromise;
  await cache.put("/sync/collection.sqlite", new Response(new Blob([bytes as BlobPart])));

  // Revoke old object URLs before clearing
  revokeOldMediaUrls();

  // Store new media entries first, then clear old ones that weren't replaced.
  // This avoids losing all media if the new store operations fail.
  let mediaFiles: Map<string, string> | undefined;
  const newMediaFilenames = new Set<string>();
  if (mediaBlobs && mediaBlobs.size > 0) {
    mediaFiles = new Map<string, string>();
    const puts: Promise<void>[] = [];
    for (const [filename, blob] of mediaBlobs) {
      newMediaFilenames.add(filename);
      mediaFiles.set(filename, URL.createObjectURL(blob));
      puts.push(cache.put(mediaCachePath(filename), new Response(blob)));
    }
    await Promise.all(puts);
  }

  // Clear old media entries that weren't replaced by new ones
  const oldMediaKeys = filterMediaKeys(await cache.keys());
  const deletes = oldMediaKeys.filter((req) => !newMediaFilenames.has(mediaKeyToFilename(req)));
  await Promise.all(deletes.map((req) => cache.delete(req)));

  persistActiveDeckSourceId(SYNC_COLLECTION_ID);
  activeDeckInputSig.value = { kind: "sqlite", bytes, mediaFiles };
  activeViewSig.value = "review";
  reviewModeSig.value = "studying";
}

/**
 * Retrieve the cached SQLite collection bytes, or null if none exists.
 */
export async function getCachedSqlite(): Promise<Uint8Array | null> {
  const cache = await ankiCachePromise;
  const resp = await cache.match("/sync/collection.sqlite");
  if (!resp) return null;
  return new Uint8Array(await resp.arrayBuffer());
}

/**
 * Store SQLite bytes in the cache and update the UI without touching media.
 * Used after normal (incremental) sync where media hasn't changed.
 */
export async function refreshSyncedCollection(bytes: Uint8Array) {
  const cache = await ankiCachePromise;
  await cache.put("/sync/collection.sqlite", new Response(new Blob([bytes as BlobPart])));

  // Recover existing media object URLs from the current activeDeckInputSig
  const currentInput = activeDeckInputSig.value;
  const existingMedia = currentInput?.kind === "sqlite" ? currentInput.mediaFiles : undefined;

  persistActiveDeckSourceId(SYNC_COLLECTION_ID);
  activeDeckInputSig.value = { kind: "sqlite", bytes, mediaFiles: existingMedia };
  activeViewSig.value = "review";
  reviewModeSig.value = "studying";
}

/**
 * Add new media blobs to the cache and update the active deck's media map.
 * Used during incremental sync to add newly downloaded media without a full reload.
 */
export async function addMediaToCache(mediaBlobs: Map<string, Blob>) {
  if (mediaBlobs.size === 0) return;

  const cache = await ankiCachePromise;
  const puts: Promise<void>[] = [];
  const currentInput = activeDeckInputSig.value;

  // Get or create the media files map
  const existingMedia = currentInput?.kind === "sqlite" ? currentInput.mediaFiles : undefined;
  const mediaFiles = existingMedia ? new Map(existingMedia) : new Map<string, string>();

  for (const [filename, blob] of mediaBlobs) {
    // Revoke old URL if replacing an existing entry
    const oldUrl = mediaFiles.get(filename);
    if (oldUrl) URL.revokeObjectURL(oldUrl);

    mediaFiles.set(filename, URL.createObjectURL(blob));
    puts.push(cache.put(mediaCachePath(filename), new Response(blob)));
  }
  await Promise.all(puts);

  // Update the active deck input with the new media map
  if (currentInput?.kind === "sqlite") {
    activeDeckInputSig.value = { ...currentInput, mediaFiles };
  }
}

export async function clearSyncedCollection() {
  const cache = await ankiCachePromise;
  await cache.delete("/sync/collection.sqlite");
  revokeOldMediaUrls();
  await clearMediaCache(cache);
  if (activeDeckSourceIdSig.value === SYNC_COLLECTION_ID) {
    clearLoadedDeck();
  }
}

// Sync state: tracks whether user is logged in to a sync server
export const syncActiveSig = ref(readSyncState().hkey !== null);

// Resource replacement: watch active deck input and fetch data
export const ankiDataSig = shallowRef<AnkiData | null>(null);

let activeDeckLoadVersion = 0;

watch(activeDeckInputSig, async (newInput, oldInput) => {
  // Revoke object URLs from previous deck to prevent memory leaks.
  // Skip revocation when the same Map reference is reused (e.g. refreshSyncedCollection)
  // to avoid invalidating URLs that the new input still needs.
  if (oldInput?.kind === "sqlite" && oldInput.mediaFiles) {
    const newMedia = newInput?.kind === "sqlite" ? newInput.mediaFiles : undefined;
    if (oldInput.mediaFiles !== newMedia) {
      revokeMediaObjectUrls(oldInput.mediaFiles);
    }
  }
  // Revoke media object URLs from previous AnkiData (from .apkg parsing)
  const oldData = ankiDataSig.value;
  if (oldData?.files && oldData.files.size > 0) {
    revokeMediaObjectUrls(oldData.files);
  }

  const loadVersion = activeDeckLoadVersion + 1;
  activeDeckLoadVersion = loadVersion;

  if (!newInput) {
    ankiDataSig.value = null;
    return;
  }

  if (newInput.kind === "sample") {
    ankiDataSig.value = newInput.data;
    return;
  }

  if (newInput.kind === "sqlite") {
    const parsedDeck = await getAnkiDataFromSqlite(newInput.bytes, newInput.mediaFiles);
    if (activeDeckLoadVersion === loadVersion) {
      ankiDataSig.value = parsedDeck;
    }
    return;
  }

  const parsedDeck = await getAnkiDataFromBlob(newInput.blob);
  if (activeDeckLoadVersion === loadVersion) {
    ankiDataSig.value = parsedDeck;
  }
});

export const selectedCardSig = ref(0);
export const cardsSig = computed(() => {
  const ankiData = ankiDataSig.value;
  const selectedDeckId = selectedDeckIdSig.value;

  if (!ankiData) return [];

  if (!selectedDeckId) return ankiData.cards;

  const selectedDeck = ankiData.decks[selectedDeckId];
  if (!selectedDeck) return ankiData.cards;

  // Include cards from this deck and all child decks (prefix match on "Name::")
  const prefix = selectedDeck.name + "::";
  return ankiData.cards.filter(
    (card) => card.deckName === selectedDeck.name || card.deckName.startsWith(prefix),
  );
});

// Reset selection when cards change
watch(cardsSig, () => {
  selectedCardSig.value = 0;
});

export const selectedTemplateSig = ref(0);
export const templatesSig = computed(() => {
  return cardsSig.value[selectedCardSig.value]?.templates;
});

// Reset template selection when templates change
watch(templatesSig, () => {
  selectedTemplateSig.value = 0;
});

export const mediaFilesSig = computed(() => ankiDataSig.value?.files ?? new Map<string, string>());

export const soundEffectsEnabledSig = ref(localStorage.getItem("soundEffectsEnabled") === "true");

export function toggleSoundEffects() {
  const newValue = !soundEffectsEnabledSig.value;
  soundEffectsEnabledSig.value = newValue;
  localStorage.setItem("soundEffectsEnabled", newValue.toString());
}

// Scheduler and review queue state
export const schedulerSettingsSig = ref<SchedulerSettings>(DEFAULT_SCHEDULER_SETTINGS);

export const schedulerEnabledSig = computed(() => schedulerSettingsSig.value.enabled);

export const reviewQueueSig = shallowRef<ReviewQueue | null>(null);

const dueCardsSig = shallowRef<ReviewCard[]>([]);
export const fullQueueSig = shallowRef<ReviewCard[]>([]);

export const currentReviewCardSig = shallowRef<ReviewCard | null>(null);

export const schedulerSettingsModalOpenSig = ref(false);
export const flagSettingsModalOpenSig = ref(false);
/** The deck ID whose settings are being edited in the modal */
export const settingsTargetDeckIdSig = ref<string | null>(null);
/** The deck tree node whose settings are being edited */
export const settingsTargetDeckNodeSig = ref<DeckTreeNode | null>(null);

/**
 * Open the scheduler settings modal for a specific deck.
 * Loads that deck's persisted settings into the form.
 */
export async function openDeckSettings(deckId: string, node?: DeckTreeNode) {
  const settings = await reviewDB.getSettings(deckId);
  schedulerSettingsSig.value = settings;
  settingsTargetDeckIdSig.value = deckId;
  settingsTargetDeckNodeSig.value = node ?? null;
  schedulerSettingsModalOpenSig.value = true;
}

/**
 * Whether the active deck is a synced SQLite collection.
 */
export function isSyncedCollection(): boolean {
  return activeDeckInputSig.value?.kind === "sqlite";
}

/**
 * Rename a deck in the synced SQLite collection.
 * Updates the deck name and all child deck name prefixes.
 */
export async function renameDeckInCollection(
  deckId: string,
  oldFullName: string,
  newName: string,
): Promise<void> {
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set((tables[0]?.values ?? []).map((row) => String(row[0])));
    const anki21b = tableNames.has("notetypes");

    // Compute new full name: replace the last segment of oldFullName
    const parts = oldFullName.split("::");
    parts[parts.length - 1] = newName;
    const newFullName = parts.join("::");

    const mod = Math.floor(Date.now() / 1000);

    if (anki21b) {
      // Update the deck itself
      db.run("UPDATE decks SET name=?, mtime_secs=?, usn=-1 WHERE id=?", [
        newFullName,
        mod,
        deckId,
      ]);
      // Update child decks: replace oldFullName:: prefix with newFullName::
      const children = db.exec("SELECT id, name FROM decks WHERE name LIKE ?", [
        oldFullName + "::%",
      ]);
      if (children[0]) {
        for (const row of children[0].values) {
          const childId = Number(row[0]);
          const childName = String(row[1]);
          const updatedName = newFullName + childName.slice(oldFullName.length);
          db.run("UPDATE decks SET name=?, mtime_secs=?, usn=-1 WHERE id=?", [
            updatedName,
            mod,
            childId,
          ]);
        }
      }
    } else {
      // anki2: decks stored as JSON in col.decks
      const result = db.exec("SELECT decks FROM col");
      const decksJson = JSON.parse(String(result[0]?.values[0]?.[0] ?? "{}"));
      const deck = decksJson[String(deckId)];
      if (deck) {
        deck.name = newFullName;
        deck.mod = mod;
        deck.usn = -1;
      }
      // Update children
      for (const d of Object.values(decksJson) as Array<{
        name: string;
        mod: number;
        usn: number;
      }>) {
        if (d.name.startsWith(oldFullName + "::")) {
          d.name = newFullName + d.name.slice(oldFullName.length);
          d.mod = mod;
          d.usn = -1;
        }
      }
      db.run("UPDATE col SET decks=?", [JSON.stringify(decksJson)]);
    }

    const newBytes = new Uint8Array(db.export());

    // Update cache
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));

    // Update in-place and re-parse
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    const { getAnkiDataFromSqlite } = await import("./ankiParser");
    ankiDataSig.value = await getAnkiDataFromSqlite(newBytes, input.mediaFiles);
    markDataChanged();
  } finally {
    db.close();
  }
}

/**
 * Delete a deck from the synced SQLite collection.
 * Removes the deck, its cards, orphaned notes, and marks for sync.
 */
export async function deleteDeckFromCollection(deckId: string, fullName: string): Promise<void> {
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set((tables[0]?.values ?? []).map((row) => String(row[0])));
    const anki21b = tableNames.has("notetypes");

    // Collect all deck IDs to delete (this deck + children)
    const deckIdsToDelete: number[] = [];

    if (anki21b) {
      const rows = db.exec("SELECT id FROM decks WHERE id=? OR name LIKE ?", [
        deckId,
        fullName + "::%",
      ]);
      if (rows[0]) {
        for (const row of rows[0].values) deckIdsToDelete.push(Number(row[0]));
      }
    } else {
      const result = db.exec("SELECT decks FROM col");
      const decksJson = JSON.parse(String(result[0]?.values[0]?.[0] ?? "{}")) as Record<
        string,
        { name: string }
      >;
      for (const [id, d] of Object.entries(decksJson)) {
        if (id === String(deckId) || d.name.startsWith(fullName + "::")) {
          deckIdsToDelete.push(Number(id));
        }
      }
    }

    // Delete cards in those decks and track orphaned notes
    for (const did of deckIdsToDelete) {
      const cardRows = db.exec("SELECT id, nid FROM cards WHERE did=?", [did]);
      if (cardRows[0]) {
        for (const row of cardRows[0].values) {
          const cardId = Number(row[0]);
          const noteId = Number(row[1]);
          db.run("DELETE FROM cards WHERE id=?", [cardId]);
          await reviewDB.deleteCard(String(cardId));
          await reviewDB.deleteReviewLogsForCard(String(cardId));

          // Delete note if no more cards reference it
          const remaining = db.exec("SELECT COUNT(*) FROM cards WHERE nid=?", [noteId]);
          if (Number(remaining[0]?.values[0]?.[0] ?? -1) === 0) {
            db.run("DELETE FROM notes WHERE id=?", [noteId]);
          }
        }
      }

      // Delete the deck and record graves for sync
      if (anki21b) {
        db.run("DELETE FROM decks WHERE id=?", [did]);
      }
      // Record in graves table for sync
      db.run("INSERT INTO graves (usn, oid, type) VALUES (-1, ?, 2)", [did]);
      await reviewDB.markDeckDeleted(String(did));
    }

    if (!anki21b) {
      // anki2: remove from JSON
      const result = db.exec("SELECT decks FROM col");
      const decksJson = JSON.parse(String(result[0]?.values[0]?.[0] ?? "{}"));
      for (const did of deckIdsToDelete) delete decksJson[String(did)];
      db.run("UPDATE col SET decks=?", [JSON.stringify(decksJson)]);
    }

    const newBytes = new Uint8Array(db.export());

    // Update cache
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));

    // Update in-place and re-parse
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    const { getAnkiDataFromSqlite } = await import("./ankiParser");
    ankiDataSig.value = await getAnkiDataFromSqlite(newBytes, input.mediaFiles);

    // Clear selected deck if it was the deleted one
    if (selectedDeckIdSig.value === deckId) {
      selectedDeckIdSig.value = null;
    }
    markDataChanged();
  } finally {
    db.close();
  }
}

/**
 * Export a deck (and its subdecks) from the synced SQLite collection as an .apkg file.
 */
export async function exportDeckFromCollection(fullName: string): Promise<void> {
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const { BlobWriter, ZipWriter, BlobReader } = await import("@zip-js/zip-js");

  const srcDb = await createDatabase(input.bytes);
  const destDb = await createDatabase();

  try {
    const tables = srcDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set((tables[0]?.values ?? []).map((row) => String(row[0])));
    const anki21b = tableNames.has("notetypes");

    // Get the full schema from source and create in destination
    const schemaRows = srcDb.exec(
      "SELECT sql FROM sqlite_master WHERE type='table' OR type='index'",
    );
    if (schemaRows[0]) {
      for (const row of schemaRows[0].values) {
        const sql = row[0];
        if (typeof sql === "string") destDb.run(sql);
      }
    }

    // Collect deck IDs to export
    const deckIds: number[] = [];
    if (anki21b) {
      const rows = srcDb.exec("SELECT id FROM decks WHERE name=? OR name LIKE ?", [
        fullName,
        fullName + "::%",
      ]);
      if (rows[0]) {
        for (const row of rows[0].values) deckIds.push(Number(row[0]));
      }

      // Copy matching decks
      for (const did of deckIds) {
        const deckData = srcDb.exec("SELECT * FROM decks WHERE id=?", [did]);
        if (deckData[0] && deckData[0].values.length > 0) {
          const cols = deckData[0].columns.map(() => "?").join(",");
          const row = deckData[0].values[0];
          if (row) destDb.run(`INSERT INTO decks VALUES (${cols})`, [...row]);
        }
      }
    } else {
      const result = srcDb.exec("SELECT decks FROM col");
      const decksJson = JSON.parse(String(result[0]?.values[0]?.[0] ?? "{}")) as Record<
        string,
        { name: string }
      >;
      const exportDecks: Record<string, unknown> = {};
      for (const [id, d] of Object.entries(decksJson)) {
        if (d.name === fullName || d.name.startsWith(fullName + "::")) {
          exportDecks[id] = d;
          deckIds.push(Number(id));
        }
      }
      // Also include Default deck (id=1) as Anki requires it
      if (decksJson["1"]) exportDecks["1"] = decksJson["1"];

      // Copy col row with filtered decks
      const colRow = srcDb.exec("SELECT * FROM col");
      const colValues = colRow[0]?.values[0];
      if (colRow[0] && colValues) {
        const row = [...colValues];
        const decksIdx = colRow[0].columns.indexOf("decks");
        if (decksIdx !== -1) row[decksIdx] = JSON.stringify(exportDecks);
        const cols = colRow[0].columns.map(() => "?").join(",");
        destDb.run(`INSERT INTO col VALUES (${cols})`, row);
      }
    }

    // Copy cards for those decks
    const placeholders = deckIds.map(() => "?").join(",");
    const cardRows = srcDb.exec(`SELECT * FROM cards WHERE did IN (${placeholders})`, deckIds);
    const noteIds = new Set<number>();
    if (cardRows[0]) {
      const nidIdx = cardRows[0].columns.indexOf("nid");
      const cols = cardRows[0].columns.map(() => "?").join(",");
      for (const row of cardRows[0].values) {
        destDb.run(`INSERT INTO cards VALUES (${cols})`, [...row]);
        noteIds.add(Number(row[nidIdx]));
      }
    }

    // Copy notes referenced by those cards
    if (noteIds.size > 0) {
      const noteIdArr = [...noteIds];
      const notePlaceholders = noteIdArr.map(() => "?").join(",");
      const noteRows = srcDb.exec(
        `SELECT * FROM notes WHERE id IN (${notePlaceholders})`,
        noteIdArr,
      );
      if (noteRows[0]) {
        const cols = noteRows[0].columns.map(() => "?").join(",");
        for (const row of noteRows[0].values) {
          destDb.run(`INSERT INTO notes VALUES (${cols})`, [...row]);
        }
      }
    }

    // Copy revlog for exported cards
    if (cardRows[0]) {
      const cidIdx = cardRows[0].columns.indexOf("id");
      const cardIdArr = cardRows[0].values.map((r) => Number(r[cidIdx]));
      if (cardIdArr.length > 0) {
        const revPlaceholders = cardIdArr.map(() => "?").join(",");
        const revRows = srcDb.exec(
          `SELECT * FROM revlog WHERE cid IN (${revPlaceholders})`,
          cardIdArr,
        );
        if (revRows[0]) {
          const cols = revRows[0].columns.map(() => "?").join(",");
          for (const row of revRows[0].values) {
            destDb.run(`INSERT INTO revlog VALUES (${cols})`, [...row]);
          }
        }
      }
    }

    // For anki21b, copy notetypes and deck_config referenced by notes/decks
    if (anki21b) {
      // Copy notetypes used by the notes
      if (noteIds.size > 0) {
        const midSet = new Set<number>();
        const noteIdArr = [...noteIds];
        const notePlaceholders = noteIdArr.map(() => "?").join(",");
        const midRows = srcDb.exec(
          `SELECT DISTINCT mid FROM notes WHERE id IN (${notePlaceholders})`,
          noteIdArr,
        );
        if (midRows[0]) {
          for (const row of midRows[0].values) midSet.add(Number(row[0]));
        }
        for (const mid of midSet) {
          const ntRows = srcDb.exec("SELECT * FROM notetypes WHERE id=?", [mid]);
          const ntRow = ntRows[0]?.values[0];
          if (ntRows[0] && ntRow) {
            const cols = ntRows[0].columns.map(() => "?").join(",");
            destDb.run(`INSERT INTO notetypes VALUES (${cols})`, [...ntRow]);
          }
        }
      }

      // Copy col row for anki21b
      const colRow = srcDb.exec("SELECT * FROM col");
      const colValues = colRow[0]?.values[0];
      if (colRow[0] && colValues) {
        const cols = colRow[0].columns.map(() => "?").join(",");
        destDb.run(`INSERT INTO col VALUES (${cols})`, [...colValues]);
      }
    }

    // Build the APKG zip
    const dbData = destDb.export();
    const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
    await zipWriter.add(
      anki21b ? "collection.anki21b" : "collection.anki2",
      new BlobReader(new Blob([new Uint8Array(dbData)])),
    );
    await zipWriter.add("media", new BlobReader(new Blob([JSON.stringify({})])));
    const blob = await zipWriter.close();

    // Download
    const safeName = fullName.replace(/::/g, "_").replace(/[^a-zA-Z0-9_-]/g, "_");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.apkg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    srcDb.close();
    destDb.close();
  }
}

/**
 * Export the current deck (or all cards) as CSV or JSON.
 */
export async function exportCardsCsvJson(options: {
  format: "csv" | "json";
  scope: "deck" | "all";
  deckName?: string;
  includeScheduling: boolean;
  includeHtml: boolean;
  csvColumns?: string[];
}): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  const { exportCards } = await import("./ankiExporter/csvJsonExport");
  const { content, mimeType, extension } = exportCards(data, options);
  if (!content) return;

  const safeName = (options.deckName ?? "export")
    .replace(/::/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const blob = new Blob([content], { type: mimeType });
  const { downloadBlob } = await import("./utils/downloadBlob");
  downloadBlob(blob, `${safeName}.${extension}`);
}

/**
 * Resolve the deck ID used for settings/review-queue storage.
 * For the currently-studying deck this is based on selected cards.
 */
export function getActiveDeckId(): string {
  return `deck-${cardsSig.value.length}`;
}

function clearReviewQueueState() {
  reviewQueueSig.value = null;
  dueCardsSig.value = [];
  fullQueueSig.value = [];
  currentReviewCardSig.value = null;
}

/**
 * Initialize the review queue for the current deck
 */
export async function initializeReviewQueue() {
  const cards = cardsSig.value;
  const templates = templatesSig.value;

  if (cards.length === 0 || !templates || templates.length === 0) {
    clearReviewQueueState();
    return;
  }

  const deckId = `deck-${cards.length}`;

  const settings = await reviewDB.getSettings(deckId);
  schedulerSettingsSig.value = settings;

  if (!settings.enabled) {
    clearReviewQueueState();
    return;
  }

  const queue = new ReviewQueue(deckId, settings);
  await queue.init();

  const mappedIds = cards.map((c) => c.ankiCardId);
  const ankiCardIds = mappedIds.every((id): id is number => id != null) ? mappedIds : undefined;
  const fullQueue = await queue.buildQueue(cards.length, templates.length, ankiCardIds);
  const dueCards = queue.getDueCards(fullQueue);

  reviewQueueSig.value = queue;
  fullQueueSig.value = fullQueue;
  dueCardsSig.value = dueCards;

  if (dueCards.length > 0) {
    currentReviewCardSig.value = dueCards[0] ?? null;
  } else {
    currentReviewCardSig.value = null;
  }
}

/**
 * Update the due cards list after a review.
 * - Learning/relearning cards: update their state in the list (re-shown when due)
 * - Graduated/reviewed cards: remove from list (they'll appear in future sessions)
 */
export function updateDueCardsAfterReview(
  reviewedCardId: string,
  updatedState: import("./scheduler/types").CardReviewState,
) {
  const queue = reviewQueueSig.value;
  if (!queue) return;

  const cards = [...dueCardsSig.value];
  const idx = cards.findIndex((c) => c.cardId === reviewedCardId);
  if (idx === -1) return;

  const card = cards[idx]!;
  const updatedCard: ReviewCard = {
    ...card,
    reviewState: updatedState,
    isNew: false,
  };

  const stillLearning = queue.isCardInLearning(updatedCard);

  if (stillLearning) {
    // Keep in list with updated state — will be re-shown when due
    cards[idx] = updatedCard;
  } else {
    // Graduated or reviewed — remove from current session
    cards.splice(idx, 1);
  }

  dueCardsSig.value = cards;
}

/**
 * Move to the next card in the review queue.
 * Prioritizes learning cards that are due NOW, then continues sequentially.
 */
export function moveToNextReviewCard() {
  const dueCards = dueCardsSig.value;
  if (dueCards.length === 0) {
    currentReviewCardSig.value = null;
    return;
  }

  const queue = reviewQueueSig.value;
  const nowMs = Date.now();
  const currentId = currentReviewCardSig.value?.cardId;

  // First priority: any learning card that is due now (but not the one we just reviewed)
  if (queue) {
    for (const card of dueCards) {
      if (card.cardId === currentId) continue;
      if (!queue.isCardInLearning(card)) continue;
      try {
        const dueMs = new Date((card.reviewState.cardState as { due: number }).due).getTime();
        if (dueMs <= nowMs) {
          currentReviewCardSig.value = card;
          return;
        }
      } catch {
        // skip
      }
    }
  }

  // Second priority: next non-learning card in list
  const currentIndex = dueCards.findIndex((card) => card.cardId === currentId);
  for (let i = 1; i < dueCards.length; i++) {
    const nextIdx = (currentIndex + i) % dueCards.length;
    const candidate = dueCards[nextIdx]!;
    if (queue?.isCardInLearning(candidate)) continue;
    currentReviewCardSig.value = candidate;
    return;
  }

  // Third priority: soonest learning card (even if not yet due)
  let soonest: ReviewCard | null = null;
  let soonestDue = Infinity;
  for (const c of dueCards) {
    if (c.cardId === currentId || !queue?.isCardInLearning(c)) continue;
    const due = (c.reviewState.cardState as { due: number }).due;
    if (due < soonestDue) {
      soonest = c;
      soonestDue = due;
    }
  }
  if (soonest) {
    currentReviewCardSig.value = soonest;
    return;
  }

  // No cards left
  currentReviewCardSig.value = dueCards[0] ?? null;
}

/**
 * Reset all scheduler data and re-initialize the review queue
 */
export async function resetScheduler() {
  await reviewDB.clearAll();
  clearUndoHistory();

  clearReviewQueueState();

  if (schedulerEnabledSig.value && cardsSig.value.length > 0) {
    await initializeReviewQueue();
  }
}

/**
 * Remove the current card from the due queue and advance to next card.
 */
function removeCurrentCardAndAdvance() {
  const current = currentReviewCardSig.value;
  if (!current) return;
  dueCardsSig.value = dueCardsSig.value.filter((c) => c.cardId !== current.cardId);
  moveToNextReviewCard();
}

/**
 * Bury the current review card (hide until next day).
 */
export async function buryCurrentCard() {
  const card = currentReviewCardSig.value;
  if (!card) return;
  const previousQueueOverride = card.reviewState.queueOverride;
  await reviewDB.patchCard(card.cardId, { queueOverride: QUEUE_USER_BURIED });
  card.reviewState.queueOverride = QUEUE_USER_BURIED;
  pushUndo({
    type: "buryCard",
    description: "Bury Card",
    undoData: { cardId: card.cardId, previousQueueOverride },
  });
  removeCurrentCardAndAdvance();
}

/**
 * Suspend the current review card (hide permanently until unsuspended).
 */
export async function suspendCurrentCard() {
  const card = currentReviewCardSig.value;
  if (!card) return;
  const previousQueueOverride = card.reviewState.queueOverride;
  await reviewDB.patchCard(card.cardId, { queueOverride: QUEUE_SUSPENDED });
  card.reviewState.queueOverride = QUEUE_SUSPENDED;
  pushUndo({
    type: "suspendCard",
    description: "Suspend Card",
    undoData: { cardId: card.cardId, previousQueueOverride },
  });
  removeCurrentCardAndAdvance();
}

/**
 * Set a flag (0–7) on the current review card.
 */
export async function flagCurrentCard(flag: number) {
  const card = currentReviewCardSig.value;
  if (!card) return;
  const previousFlag = card.reviewState.flags ?? 0;
  const clamped = flag & 0b111;
  await reviewDB.patchCard(card.cardId, { flags: clamped });
  card.reviewState.flags = clamped;
  pushUndo({
    type: "flagCard",
    description: `Flag Card`,
    undoData: { cardId: card.cardId, previousFlag, newFlag: clamped },
  });
}

/**
 * Toggle the "marked" tag on the current card's note.
 */
export function markCurrentNote() {
  const card = currentReviewCardSig.value;
  const ankiData = ankiDataSig.value;
  if (!card || !ankiData) return;

  const noteCard = ankiData.cards[card.cardIndex];
  if (!noteCard) return;

  const hasMarked = noteCard.tags.some((t) => t.toLowerCase() === "marked");
  if (hasMarked) {
    noteCard.tags = noteCard.tags.filter((t) => t.toLowerCase() !== "marked");
  } else {
    noteCard.tags.push("marked");
  }
  pushUndo({
    type: "markNote",
    description: hasMarked ? "Unmark Note" : "Mark Note",
    undoData: { guid: noteCard.guid, wasMarked: hasMarked },
  });
}

/**
 * Bury all cards of the current note (hide until next day).
 */
export async function buryCurrentNote() {
  const card = currentReviewCardSig.value;
  const ankiData = ankiDataSig.value;
  if (!card || !ankiData) return;

  const noteCard = ankiData.cards[card.cardIndex];
  if (!noteCard) return;

  const guid = noteCard.guid;

  // Find all due cards sharing this note guid and bury them
  const siblingCardIds = dueCardsSig.value
    .filter((c) => {
      const nc = ankiData.cards[c.cardIndex];
      return nc && nc.guid === guid;
    })
    .map((c) => c.cardId);

  // Capture previous overrides for undo
  const previousQueueOverrides: Record<string, number | undefined> = {};
  for (const cardId of siblingCardIds) {
    const sibling = dueCardsSig.value.find((c) => c.cardId === cardId);
    previousQueueOverrides[cardId] = sibling?.reviewState.queueOverride;
  }

  for (const cardId of siblingCardIds) {
    await reviewDB.patchCard(cardId, { queueOverride: QUEUE_USER_BURIED });
    const sibling = dueCardsSig.value.find((c) => c.cardId === cardId);
    if (sibling) sibling.reviewState.queueOverride = QUEUE_USER_BURIED;
  }

  pushUndo({
    type: "buryNote",
    description: "Bury Note",
    undoData: { cardIds: siblingCardIds, previousQueueOverrides },
  });

  dueCardsSig.value = dueCardsSig.value.filter((c) => !siblingCardIds.includes(c.cardId));
  moveToNextReviewCard();
}

/**
 * Delete the current note and all its cards from the review queue.
 */
export async function deleteCurrentNote() {
  const card = currentReviewCardSig.value;
  const ankiData = ankiDataSig.value;
  if (!card || !ankiData) return;

  const noteCard = ankiData.cards[card.cardIndex];
  if (!noteCard) return;

  const guid = noteCard.guid;

  // Capture card data for undo before deleting
  const deletedCards = ankiData.cards
    .filter((c) => c.guid === guid)
    .map((c) => ({
      values: { ...c.values },
      tags: [...c.tags],
      deckName: c.deckName,
      css: c.css ?? "",
      templates: JSON.parse(JSON.stringify(c.templates)),
      ankiCardId: c.ankiCardId,
      fieldDescriptions: c.fieldDescriptions ? { ...c.fieldDescriptions } : undefined,
      guid: c.guid,
    }));

  // Remove all due cards sharing this note guid
  const siblingCardIds = dueCardsSig.value
    .filter((c) => {
      const nc = ankiData.cards[c.cardIndex];
      return nc && nc.guid === guid;
    })
    .map((c) => c.cardId);

  // Capture review states and logs for undo
  const reviewStates: import("./scheduler/types").CardReviewState[] = [];
  const reviewLogs: import("./scheduler/types").StoredReviewLog[] = [];
  for (const cardId of siblingCardIds) {
    const state = await reviewDB.getCard(cardId);
    if (state) reviewStates.push(state);
    const logs = await reviewDB.getReviewLogsForCard(cardId);
    reviewLogs.push(...logs);
  }

  for (const cardId of siblingCardIds) {
    await reviewDB.deleteCard(cardId);
  }

  // Remove cards from in-memory data (mutate in-place to preserve array type)
  for (let i = ankiData.cards.length - 1; i >= 0; i--) {
    if (ankiData.cards[i]!.guid === guid) {
      ankiData.cards.splice(i, 1);
    }
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "noteDelete",
    description: "Delete Note",
    undoData: { guid, cards: deletedCards, reviewStates, reviewLogs },
  });

  dueCardsSig.value = dueCardsSig.value.filter((c) => !siblingCardIds.includes(c.cardId));
  moveToNextReviewCard();
  markDataChanged();
}

export function moveToNextCard() {
  selectedCardSig.value = selectedCardSig.value + 1;
}

/**
 * Update a note's fields and tags across all cards sharing the same guid.
 * Persists to SQLite cache for synced collections (marks usn=-1 for sync).
 * @param skipUndo If true, do not record an undo entry (used by undo/redo executor).
 */
export async function updateNote(
  guid: string,
  newFields: Record<string, string | null>,
  newTags: string[],
  skipUndo = false,
): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  // Capture previous state for undo
  let previousFields: Record<string, string | null> | undefined;
  let previousTags: string[] | undefined;
  if (!skipUndo) {
    const noteCard = data.cards.find((c) => c.guid === guid);
    if (noteCard) {
      previousFields = { ...noteCard.values };
      previousTags = [...noteCard.tags];
    }
  }

  // Update all in-memory cards sharing this note guid
  for (const card of data.cards) {
    if (card.guid !== guid) continue;
    for (const [key, val] of Object.entries(newFields)) {
      card.values[key] = val;
    }
    card.tags = [...newTags];
  }
  triggerRef(ankiDataSig);

  if (!skipUndo && previousFields && previousTags) {
    pushUndo({
      type: "noteEdit",
      description: "Edit Note",
      undoData: {
        guid,
        previousFields,
        previousTags,
        newFields: { ...newFields },
        newTags: [...newTags],
      },
    });
  }

  // Persist to SQLite for synced collections
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    // Look up the note by guid
    const result = db.exec("SELECT id FROM notes WHERE guid=?", [guid]);
    const rawNoteId = result[0]?.values[0]?.[0];
    if (rawNoteId == null) return;
    const noteId = Number(rawNoteId);

    // Build flds (field values joined by \x1F in field order)
    const fieldValues = Object.values(newFields);
    const flds = fieldValues.map((v) => v ?? "").join("\x1f");

    // Compute sfld (sort field = first field, HTML stripped)
    const firstField = fieldValues[0] ?? "";
    const sfld = firstField.replace(/<[^>]*>/g, "").trim();

    // Compute csum (checksum of sort field)
    const csum = stringHash(sfld);

    // Compute mod and tags string
    const mod = Math.floor(Date.now() / 1000);
    const tagsStr = newTags.length > 0 ? ` ${newTags.join(" ")} ` : "";

    db.run("UPDATE notes SET flds=?, sfld=?, csum=?, mod=?, usn=-1, tags=? WHERE id=?", [
      flds,
      sfld,
      csum,
      mod,
      tagsStr,
      noteId,
    ]);

    const newBytes = new Uint8Array(db.export());

    // Write to cache for sync
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));

    // Update in-place without triggering re-parse
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    markDataChanged();
  } finally {
    db.close();
  }
}

// --- Option Presets ---

export const presetsSig = ref<OptionPreset[]>([]);

/** Load all presets from the database. */
export async function loadPresets(): Promise<void> {
  presetsSig.value = await reviewDB.getAllPresets();
}

/** Create a new preset from current settings. */
export async function createPreset(name: string, settings: SchedulerSettings): Promise<string> {
  const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const preset: OptionPreset = {
    id,
    name,
    settings: JSON.parse(JSON.stringify(settings)),
    modifiedAt: Date.now(),
  };
  await reviewDB.savePreset(preset);
  await loadPresets();
  return id;
}

/** Clone an existing preset with a new name. */
export async function clonePreset(sourceId: string, newName: string): Promise<string | null> {
  const source = await reviewDB.getPreset(sourceId);
  if (!source) return null;
  return createPreset(newName, source.settings);
}

/** Rename a preset. */
export async function renamePreset(presetId: string, newName: string): Promise<void> {
  const preset = await reviewDB.getPreset(presetId);
  if (!preset) return;
  await reviewDB.savePreset({ ...preset, name: newName, modifiedAt: Date.now() });
  await loadPresets();
}

/** Delete a preset. */
export async function deletePreset(presetId: string): Promise<void> {
  await reviewDB.deletePreset(presetId);
  await loadPresets();
}

/** Apply a preset to the current deck settings. */
export async function applyPresetToDeck(presetId: string): Promise<void> {
  const preset = await reviewDB.getPreset(presetId);
  if (!preset) return;

  const deckId = settingsTargetDeckIdSig.value ?? getActiveDeckId();
  const settingsWithPresetId: SchedulerSettings = {
    ...JSON.parse(JSON.stringify(preset.settings)),
    presetId,
  };

  await reviewDB.saveSettings(deckId, settingsWithPresetId);
  schedulerSettingsSig.value = settingsWithPresetId;

  if (deckId === getActiveDeckId()) {
    await initializeReviewQueue();
  }
}

/** Export a preset as a JSON string for sharing. */
export function exportPresetJson(preset: OptionPreset): string {
  return JSON.stringify(
    { name: preset.name, settings: preset.settings, exportedAt: Date.now() },
    null,
    2,
  );
}

/** Import a preset from a JSON string. Returns the new preset ID or null on failure. */
export async function importPresetJson(json: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(json) as { name?: string; settings?: Record<string, unknown> };
    if (!parsed.name || typeof parsed.name !== "string") return null;
    if (!parsed.settings || typeof parsed.settings !== "object") return null;

    // Validate required SchedulerSettings fields
    const s = parsed.settings;
    if (typeof s.enabled !== "boolean") return null;
    if (typeof s.algorithm !== "string") return null;
    if (typeof s.dailyNewLimit !== "number") return null;
    if (typeof s.dailyReviewLimit !== "number") return null;

    // Pick only known keys to prevent injection of arbitrary properties
    const KNOWN_KEYS = [
      "enabled", "algorithm", "dailyNewLimit", "dailyReviewLimit",
      "showAheadOfSchedule", "learnAheadMins", "rolloverHour",
      "sm2Params", "fsrsParams", "autoAdvance", "easyDays", "loadBalancer", "presetId",
    ];
    const sanitized: Record<string, unknown> = {};
    for (const key of KNOWN_KEYS) {
      if (key in s) sanitized[key] = s[key];
    }

    return createPreset(parsed.name, sanitized as unknown as SchedulerSettings);
  } catch {
    return null;
  }
}

// Load presets on startup
loadPresets();

/**
 * Bulk add a tag to multiple notes (by guid).
 * Persists to SQLite for synced collections.
 */
export async function bulkAddTag(guids: string[], tag: string): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  // Capture previous tags for undo
  const guidSet = new Set(guids);
  const previousTags: Record<string, string[]> = {};
  for (const card of data.cards) {
    if (!guidSet.has(card.guid)) continue;
    if (!previousTags[card.guid]) {
      previousTags[card.guid] = [...card.tags];
    }
    if (!card.tags.includes(tag)) {
      card.tags = [...card.tags, tag];
    }
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "bulkAddTag",
    description: `Add Tag "${tag}"`,
    undoData: { guids, tag, previousTags },
  });

  await bulkPersistTags(guids);
}

/**
 * Bulk remove a tag from multiple notes (by guid).
 * Also removes child tags (prefix match with "::").
 */
export async function bulkRemoveTag(guids: string[], tag: string): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  // Capture previous tags for undo
  const guidSet = new Set(guids);
  const previousTags: Record<string, string[]> = {};
  for (const card of data.cards) {
    if (!guidSet.has(card.guid)) continue;
    if (!previousTags[card.guid]) {
      previousTags[card.guid] = [...card.tags];
    }
    card.tags = card.tags.filter((t) => t !== tag && !t.startsWith(tag + "::"));
  }
  triggerRef(ankiDataSig);

  pushUndo({
    type: "bulkRemoveTag",
    description: `Remove Tag "${tag}"`,
    undoData: { guids, tag, previousTags },
  });

  await bulkPersistTags(guids);
}

/**
 * Rename a tag across all notes in the collection.
 * Also renames child tags (e.g. "old::child" -> "new::child").
 */
export async function renameTag(oldTag: string, newTag: string): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  const affectedGuidSet = new Set<string>();
  for (const card of data.cards) {
    const hasTag = card.tags.some((t) => t === oldTag || t.startsWith(oldTag + "::"));
    if (!hasTag) continue;

    card.tags = card.tags.map((t) => {
      if (t === oldTag) return newTag;
      if (t.startsWith(oldTag + "::")) return newTag + t.slice(oldTag.length);
      return t;
    });
    affectedGuidSet.add(card.guid);
  }
  triggerRef(ankiDataSig);

  const affectedGuids = [...affectedGuidSet];
  pushUndo({
    type: "renameTag",
    description: `Rename Tag "${oldTag}"`,
    undoData: { oldTag, newTag },
  });

  await bulkPersistTags(affectedGuids);
}

/**
 * Delete a tag from all notes in the collection.
 * Also removes child tags.
 */
export async function deleteTag(tag: string): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  // Capture previous tags for undo
  const previousTags: Record<string, string[]> = {};
  const affectedGuidSet = new Set<string>();
  for (const card of data.cards) {
    const hasTag = card.tags.some((t) => t === tag || t.startsWith(tag + "::"));
    if (!hasTag) continue;

    if (!previousTags[card.guid]) {
      previousTags[card.guid] = [...card.tags];
    }

    card.tags = card.tags.filter((t) => t !== tag && !t.startsWith(tag + "::"));
    affectedGuidSet.add(card.guid);
  }
  const affectedGuids = [...affectedGuidSet];
  triggerRef(ankiDataSig);

  pushUndo({
    type: "deleteTag",
    description: `Delete Tag "${tag}"`,
    undoData: { tag, previousTags },
  });

  await bulkPersistTags(affectedGuids);
}

/**
 * Bulk update field values for multiple notes.
 * Takes an array of { guid, fields } where fields is the full Record<string, string|null>.
 * Persists to SQLite for synced collections.
 */
export async function bulkUpdateNoteFields(
  updates: { guid: string; fields: Record<string, string | null> }[],
): Promise<void> {
  const data = ankiDataSig.value;
  if (!data || updates.length === 0) return;

  // Apply in-memory updates
  const updateMap = new Map(updates.map((u) => [u.guid, u.fields]));
  for (const card of data.cards) {
    const fields = updateMap.get(card.guid);
    if (!fields) continue;
    for (const [key, val] of Object.entries(fields)) {
      card.values[key] = val;
    }
  }
  triggerRef(ankiDataSig);

  // Persist to SQLite for synced collections
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    const mod = Math.floor(Date.now() / 1000);

    for (const { guid, fields } of updates) {
      const result = db.exec("SELECT id FROM notes WHERE guid=?", [guid]);
      const rawNoteId = result[0]?.values[0]?.[0];
      if (rawNoteId == null) continue;
      const noteId = Number(rawNoteId);

      const fieldValues = Object.values(fields);
      const flds = fieldValues.map((v) => v ?? "").join("\x1f");
      const firstField = fieldValues[0] ?? "";
      const sfld = firstField.replace(/<[^>]*>/g, "").trim();
      const csum = stringHash(sfld);

      db.run("UPDATE notes SET flds=?, sfld=?, csum=?, mod=?, usn=-1 WHERE id=?", [
        flds,
        sfld,
        csum,
        mod,
        noteId,
      ]);
    }

    const newBytes = new Uint8Array(db.export());
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    markDataChanged();
  } finally {
    db.close();
  }
}

/**
 * Delete multiple notes (by guid) and all their cards from the collection.
 * Removes from in-memory data and persists to SQLite for synced collections.
 */
export async function deleteNotesByGuid(guids: string[]): Promise<void> {
  const data = ankiDataSig.value;
  if (!data || guids.length === 0) return;

  const guidSet = new Set(guids);

  // Remove from in-memory data
  for (let i = data.cards.length - 1; i >= 0; i--) {
    if (guidSet.has(data.cards[i]!.guid)) {
      data.cards.splice(i, 1);
    }
  }
  triggerRef(ankiDataSig);

  // Persist to SQLite for synced collections
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    for (const guid of guids) {
      // Find note ID
      const result = db.exec("SELECT id FROM notes WHERE guid=?", [guid]);
      const rawNoteId = result[0]?.values[0]?.[0];
      if (rawNoteId == null) continue;
      const noteId = Number(rawNoteId);

      // Delete cards for this note and clean up review data
      const cardRows = db.exec("SELECT id FROM cards WHERE nid=?", [noteId]);
      if (cardRows[0]) {
        for (const row of cardRows[0].values) {
          const cardId = String(row[0]);
          await reviewDB.deleteCard(cardId);
          await reviewDB.deleteReviewLogsForCard(cardId);
        }
      }
      db.run("DELETE FROM cards WHERE nid=?", [noteId]);

      // Record in graves for sync
      db.run("INSERT INTO graves (usn, oid, type) VALUES (-1, ?, 1)", [noteId]);

      // Delete the note
      db.run("DELETE FROM notes WHERE id=?", [noteId]);
    }

    const newBytes = new Uint8Array(db.export());
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    markDataChanged();
  } finally {
    db.close();
  }
}

/**
 * Persist tag changes for a set of notes to the SQLite database.
 */
async function bulkPersistTags(guids: string[]): Promise<void> {
  const data = ankiDataSig.value;
  const input = activeDeckInputSig.value;
  if (!data || input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    const mod = Math.floor(Date.now() / 1000);

    const guidSet = new Set(guids);
    const cardsByGuid = new Map<string, (typeof data.cards)[number]>();
    for (const card of data.cards) {
      if (guidSet.has(card.guid) && !cardsByGuid.has(card.guid)) {
        cardsByGuid.set(card.guid, card);
      }
    }

    for (const guid of guids) {
      const card = cardsByGuid.get(guid);
      if (!card) continue;

      const tagsStr = card.tags.length > 0 ? ` ${card.tags.join(" ")} ` : "";
      db.run("UPDATE notes SET tags=?, mod=?, usn=-1 WHERE guid=?", [tagsStr, mod, guid]);
    }

    const newBytes = new Uint8Array(db.export());
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    markDataChanged();
  } finally {
    db.close();
  }
}

/**
 * Reposition new cards by changing their due position number.
 * Only applies to cards in the "new" queue (type=0, queue=0).
 *
 * @param cardIndices - Indices into ankiDataSig.value.cards[] to reposition
 * @param startPosition - Starting position number (1-based)
 * @param step - Step size between positions (default 1)
 * @param randomize - Whether to randomize order within the selection
 */
export async function repositionNewCards(
  cardIndices: number[],
  startPosition: number,
  step: number,
  randomize: boolean,
): Promise<number> {
  const data = ankiDataSig.value;
  if (!data || cardIndices.length === 0) return 0;

  // Filter to only new cards (queue=0 means new queue)
  const newCardIndices = cardIndices.filter((i) => {
    const card = data.cards[i];
    if (!card?.scheduling) return false;
    return card.scheduling.queue === 0 && card.scheduling.type === 0;
  });

  if (newCardIndices.length === 0) return 0;

  // Optionally randomize the order of the indices (Fisher-Yates shuffle)
  const ordered = [...newCardIndices];
  if (randomize) {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
    }
  }

  // Assign new positions
  for (let i = 0; i < ordered.length; i++) {
    const card = data.cards[ordered[i]!]!;
    if (card.scheduling) {
      card.scheduling = {
        ...card.scheduling,
        due: startPosition + i * step,
      };
    }
  }
  triggerRef(ankiDataSig);

  // Persist to SQLite if available
  await persistNewCardPositions(ordered, startPosition, step);

  return ordered.length;
}

/**
 * Persist new card due-position changes to the SQLite database.
 */
async function persistNewCardPositions(
  cardIndices: number[],
  startPosition: number,
  step: number,
): Promise<void> {
  const data = ankiDataSig.value;
  const input = activeDeckInputSig.value;
  if (!data || input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    const mod = Math.floor(Date.now() / 1000);

    for (let i = 0; i < cardIndices.length; i++) {
      const card = data.cards[cardIndices[i]!];
      if (!card?.ankiCardId) continue;

      const newDue = startPosition + i * step;
      db.run("UPDATE cards SET due=?, mod=?, usn=-1 WHERE id=?", [newDue, mod, card.ankiCardId]);
    }

    const newBytes = new Uint8Array(db.export());
    const cache = await caches.open("anki-cache");
    await cache.put("/sync/collection.sqlite", new Response(new Blob([newBytes as BlobPart])));
    activeDeckInputSig.value = { ...input, bytes: newBytes };
    markDataChanged();
  } finally {
    db.close();
  }
}
