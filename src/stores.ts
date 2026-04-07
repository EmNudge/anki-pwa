import { ref, computed, watch, shallowRef } from "vue";
import { getAnkiDataFromBlob, getAnkiDataFromSqlite } from "./ankiParser";
import type { AnkiData } from "./ankiParser";
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
      const mediaKeys = allKeys.filter((req) =>
        new URL(req.url).pathname.startsWith("/sync/media/"),
      );
      let mediaFiles: Map<string, string> | undefined;
      if (mediaKeys.length > 0) {
        mediaFiles = new Map<string, string>();
        for (const req of mediaKeys) {
          const mediaResp = await cache.match(req);
          if (mediaResp) {
            const filename = new URL(req.url).pathname.replace("/sync/media/", "");
            mediaFiles.set(filename, URL.createObjectURL(await mediaResp.blob()));
          }
        }
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
    new Response(new Blob([bytes.buffer as ArrayBuffer])),
  );

  // Clear old media entries and store new ones
  const existingKeys = await cache.keys();
  await Promise.all(
    existingKeys
      .filter((req) => new URL(req.url).pathname.startsWith("/sync/media/"))
      .map((req) => cache.delete(req)),
  );

  let mediaFiles: Map<string, string> | undefined;
  if (mediaBlobs && mediaBlobs.size > 0) {
    mediaFiles = new Map<string, string>();
    const puts: Promise<void>[] = [];
    for (const [filename, blob] of mediaBlobs) {
      mediaFiles.set(filename, URL.createObjectURL(blob));
      puts.push(cache.put(`/sync/media/${filename}`, new Response(blob)));
    }
    await Promise.all(puts);
  }

  persistActiveDeckSourceId(SYNC_COLLECTION_ID);
  activeDeckInputSig.value = { kind: "sqlite", bytes, mediaFiles };
  activeViewSig.value = "review";
  reviewModeSig.value = "studying";
}

export async function clearSyncedCollection() {
  const cache = await ankiCachePromise;
  await cache.delete("/sync/collection.sqlite");
  const allKeys = await cache.keys();
  await Promise.all(
    allKeys
      .filter((req) => new URL(req.url).pathname.startsWith("/sync/media/"))
      .map((req) => cache.delete(req)),
  );
  if (activeDeckSourceIdSig.value === SYNC_COLLECTION_ID) {
    clearLoadedDeck();
  }
}

// Sync state: tracks whether user is logged in to a sync server
export const syncActiveSig = ref(readSyncState().hkey !== null);

// Resource replacement: watch active deck input and fetch data
export const ankiDataSig = shallowRef<AnkiData | null>(null);

let activeDeckLoadVersion = 0;

watch(activeDeckInputSig, async (newInput) => {
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
  const learningCards = dueCards.filter(
    (c) => c.cardId !== currentId && queue?.isCardInLearning(c),
  );
  if (learningCards.length > 0) {
    // Pick the one due soonest
    learningCards.sort((a, b) => {
      const aDue = (a.reviewState.cardState as { due: number }).due;
      const bDue = (b.reviewState.cardState as { due: number }).due;
      return aDue - bDue;
    });
    currentReviewCardSig.value = learningCards[0] ?? null;
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
  await reviewDB.patchCard(card.cardId, { queueOverride: -2 });
  card.reviewState.queueOverride = -2;
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
