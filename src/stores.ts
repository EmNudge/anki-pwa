import { ref, computed, watch, shallowRef } from "vue";
import { getAnkiDataFromBlob } from "./ankiParser";
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

// View state
export type AppView = "files" | "review" | "create" | "ai-generate";
export const activeViewSig = ref<AppView>("files");

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
  activeViewSig.value = "files";
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

  const sampleDeck = sampleDeckMap.get(activeDeckSourceIdSig.value);
  if (sampleDeck) {
    activeDeckInputSig.value = { kind: "sample", data: sampleDeck.data };
    activeViewSig.value = "review";
    return;
  }

  const response = await cache.match(`/files/${activeDeckSourceIdSig.value}`);
  if (response) {
    activeDeckInputSig.value = { kind: "blob", blob: await response.blob() };
    activeViewSig.value = "review";
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
}

export async function loadCachedFile(name: string) {
  const cache = await ankiCachePromise;
  const response = await cache.match(`/files/${name}`);
  if (response) {
    persistActiveDeckSourceId(name);
    activeDeckInputSig.value = { kind: "blob", blob: await response.blob() };
    activeViewSig.value = "review";
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

export const sampleDecksSig = sampleDecks;

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

  return ankiData.cards.filter((card) => card.deckName === selectedDeck.name);
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
export const schedulerEnabledSig = ref(localStorage.getItem("schedulerEnabled") === "true");

export function toggleScheduler() {
  const newValue = !schedulerEnabledSig.value;
  schedulerEnabledSig.value = newValue;
  localStorage.setItem("schedulerEnabled", newValue.toString());
  clearReviewQueueState();
}

export const schedulerSettingsSig = ref<SchedulerSettings>(DEFAULT_SCHEDULER_SETTINGS);

export const reviewQueueSig = shallowRef<ReviewQueue | null>(null);

export const dueCardsSig = shallowRef<ReviewCard[]>([]);

export const currentReviewCardSig = shallowRef<ReviewCard | null>(null);

export const schedulerSettingsModalOpenSig = ref(false);

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

  const queue = new ReviewQueue(deckId, settings);
  await queue.init();

  const fullQueue = await queue.buildQueue(cards.length, templates.length);
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
 * Move to the next card in the review queue
 */
export function moveToNextReviewCard() {
  const dueCards = dueCardsSig.value;
  if (dueCards.length === 0) {
    currentReviewCardSig.value = null;
    return;
  }

  const currentIndex = dueCards.findIndex(
    (card) => card.cardId === currentReviewCardSig.value?.cardId,
  );

  if (currentIndex < dueCards.length - 1) {
    currentReviewCardSig.value = dueCards[currentIndex + 1] ?? null;
  } else {
    currentReviewCardSig.value = dueCards[0] ?? null;
  }
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

export function moveToNextCard() {
  selectedCardSig.value = selectedCardSig.value + 1;
}
