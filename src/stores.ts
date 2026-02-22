import { ref, computed, watch, shallowRef } from "vue";
import { getAnkiDataFromBlob } from "./ankiParser";
import { ReviewQueue, type ReviewCard } from "./scheduler/queue";
import { DEFAULT_SCHEDULER_SETTINGS, type SchedulerSettings } from "./scheduler/types";
import { reviewDB } from "./scheduler/db";
import type { DeckInfo } from "./types";

export const deckInfoSig = shallowRef<DeckInfo | null>(null);

export const selectedDeckIdSig = ref<string | null>(null);

export const ankiCachePromise = caches.open("anki-cache");
export const blobSig = shallowRef<Blob | null>(null);

ankiCachePromise.then(async (cache) => {
  const response = await cache.match("anki-deck");
  if (!response) {
    return;
  }

  blobSig.value = await response.blob();
});

// Resource replacement: watch blobSig and fetch data
type AnkiData = Awaited<ReturnType<typeof getAnkiDataFromBlob>>;
export const ankiDataSig = shallowRef<AnkiData | null>(null);

watch(blobSig, async (newBlob) => {
  if (!newBlob) {
    ankiDataSig.value = null;
    return;
  }
  ankiDataSig.value = await getAnkiDataFromBlob(newBlob);
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
  // Reset queue when toggling
  reviewQueueSig.value = null;
  dueCardsSig.value = [];
  currentReviewCardSig.value = null;
}

export const schedulerSettingsSig = ref<SchedulerSettings>(DEFAULT_SCHEDULER_SETTINGS);

export const reviewQueueSig = shallowRef<ReviewQueue | null>(null);

export const dueCardsSig = shallowRef<ReviewCard[]>([]);

export const currentReviewCardSig = shallowRef<ReviewCard | null>(null);

export const schedulerSettingsModalOpenSig = ref(false);

/**
 * Initialize the review queue for the current deck
 */
export async function initializeReviewQueue() {
  const cards = cardsSig.value;
  const templates = templatesSig.value;

  if (cards.length === 0 || !templates || templates.length === 0) {
    reviewQueueSig.value = null;
    dueCardsSig.value = [];
    currentReviewCardSig.value = null;
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

  reviewQueueSig.value = null;
  dueCardsSig.value = [];
  currentReviewCardSig.value = null;

  if (schedulerEnabledSig.value && cardsSig.value.length > 0) {
    await initializeReviewQueue();
  }
}
