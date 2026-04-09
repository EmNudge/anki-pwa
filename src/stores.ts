import { ref, computed, watch, shallowRef, triggerRef } from "vue";
import { getAnkiDataFromBlob, getAnkiDataFromSqlite } from "./ankiParser";
import type { AnkiData } from "./ankiParser";
import { createDatabase } from "./utils/sql";
import { stringHash } from "./utils/constants";
import { ReviewQueue, type ReviewCard } from "./scheduler/queue";
import { DEFAULT_SCHEDULER_SETTINGS, type SchedulerSettings } from "./scheduler/types";
import { reviewDB } from "./scheduler/db";
import type { DeckInfo } from "./types";
import { sampleDeckMap, sampleDecks } from "./sampleDecks";
import {
  importedDeckFileName,
  persistActiveDeckSourceId as persistStoredActiveDeckSourceId,
  readCachedFiles,
  readStoredActiveDeckSourceId,
  removeCachedFileEntry,
  type CachedFileEntry,
  type DeckInput,
  upsertCachedFileEntry,
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

/** Revoke object URLs from the previous media map to prevent memory leaks. */
function revokeOldMediaUrls() {
  const current = activeDeckInputSig.value;
  if (current?.kind === "sqlite" && current.mediaFiles) {
    revokeMediaObjectUrls(current.mediaFiles);
  }
}

// View state
export type AppView = "review" | "browse" | "create" | "sync";
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
      reviewModeSig.value = "studying";
      return;
    }
    persistActiveDeckSourceId(null);
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
    reviewModeSig.value = "studying";
    return;
  }

  const response = await cache.match(`/files/${activeDeckSourceIdSig.value}`);
  if (response) {
    activeDeckInputSig.value = { kind: "blob", blob: await response.blob() };
    activeViewSig.value = "review";
    reviewModeSig.value = "studying";
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

export async function loadSyncedCollection(
  bytes: Uint8Array,
  mediaBlobs?: Map<string, Blob>,
) {
  // Cache SQLite bytes and media blobs so they survive page reloads
  const cache = await ankiCachePromise;
  await cache.put(
    "/sync/collection.sqlite",
    new Response(new Blob([bytes as BlobPart])),
  );

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
  const deletes = oldMediaKeys.filter(
    (req) => !newMediaFilenames.has(mediaKeyToFilename(req)),
  );
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
  await cache.put(
    "/sync/collection.sqlite",
    new Response(new Blob([bytes as BlobPart])),
  );

  // Recover existing media object URLs from the current activeDeckInputSig
  const currentInput = activeDeckInputSig.value;
  const existingMedia =
    currentInput?.kind === "sqlite" ? currentInput.mediaFiles : undefined;

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
  const existingMedia =
    currentInput?.kind === "sqlite" ? currentInput.mediaFiles : undefined;
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

export const currentReviewCardSig = shallowRef<ReviewCard | null>(null);

export const schedulerSettingsModalOpenSig = ref(false);
/** The deck ID whose settings are being edited in the modal */
export const settingsTargetDeckIdSig = ref<string | null>(null);

/**
 * Open the scheduler settings modal for a specific deck.
 * Loads that deck's persisted settings into the form.
 */
export async function openDeckSettings(deckId: string) {
  const settings = await reviewDB.getSettings(deckId);
  schedulerSettingsSig.value = settings;
  settingsTargetDeckIdSig.value = deckId;
  schedulerSettingsModalOpenSig.value = true;
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

  const ankiCardIds = cards.every((c) => c.ankiCardId != null)
    ? cards.map((c) => c.ankiCardId!)
    : undefined;
  const fullQueue = await queue.buildQueue(cards.length, templates.length, ankiCardIds);
  const dueCards = queue.getDueCards(fullQueue);

  reviewQueueSig.value = queue;
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
        const dueMs = new Date(
          (card.reviewState.cardState as { due: number }).due,
        ).getTime();
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
  await reviewDB.patchCard(card.cardId, { queueOverride: -3 });
  card.reviewState.queueOverride = -3;
  removeCurrentCardAndAdvance();
}

/**
 * Suspend the current review card (hide permanently until unsuspended).
 */
export async function suspendCurrentCard() {
  const card = currentReviewCardSig.value;
  if (!card) return;
  await reviewDB.patchCard(card.cardId, { queueOverride: -1 });
  card.reviewState.queueOverride = -1;
  removeCurrentCardAndAdvance();
}

/**
 * Set a flag (0–7) on the current review card.
 */
export async function flagCurrentCard(flag: number) {
  const card = currentReviewCardSig.value;
  if (!card) return;
  const clamped = flag & 0b111;
  await reviewDB.patchCard(card.cardId, { flags: clamped });
  card.reviewState.flags = clamped;
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
}

export function moveToNextCard() {
  selectedCardSig.value = selectedCardSig.value + 1;
}

/**
 * Update a note's fields and tags across all cards sharing the same guid.
 * Persists to SQLite cache for synced collections (marks usn=-1 for sync).
 */
export async function updateNote(
  guid: string,
  newFields: Record<string, string | null>,
  newTags: string[],
): Promise<void> {
  const data = ankiDataSig.value;
  if (!data) return;

  // Update all in-memory cards sharing this note guid
  for (const card of data.cards) {
    if (card.guid !== guid) continue;
    for (const [key, val] of Object.entries(newFields)) {
      card.values[key] = val;
    }
    card.tags = [...newTags];
  }
  triggerRef(ankiDataSig);

  // Persist to SQLite for synced collections
  const input = activeDeckInputSig.value;
  if (input?.kind !== "sqlite") return;

  const db = await createDatabase(input.bytes);
  try {
    // Look up the note by guid
    const result = db.exec("SELECT id FROM notes WHERE guid=?", [guid]);
    const noteId = result[0]?.values[0]?.[0] as number | undefined;
    if (noteId === undefined) return;

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

    db.run(
      "UPDATE notes SET flds=?, sfld=?, csum=?, mod=?, usn=-1, tags=? WHERE id=?",
      [flds, sfld, csum, mod, tagsStr, noteId],
    );

    const newBytes = new Uint8Array(db.export());

    // Write to cache for sync
    const cache = await caches.open("anki-cache");
    await cache.put(
      "/sync/collection.sqlite",
      new Response(new Blob([newBytes as BlobPart])),
    );

    // Update in-place without triggering re-parse
    (input as { bytes: Uint8Array }).bytes = newBytes;
  } finally {
    db.close();
  }
}
