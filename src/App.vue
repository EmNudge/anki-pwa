<script setup lang="ts">
import "./App.css";
import { computed, ref, watch } from "vue";
import FlashCard from "./components/FlashCard.vue";
import CardButtons from "./components/CardButtons.vue";
import type { Answer } from "./components/FlashCard.vue";
import { getRenderedCardString } from "./utils/render";
import { computeDeckInfo } from "./utils/deckInfo";
import FilePicker from "./components/FilePicker.vue";
import {
  ankiCachePromise,
  ankiDataSig,
  cardsSig,
  currentReviewCardSig,
  deckInfoSig,
  initializeReviewQueue,
  mediaFilesSig,
  moveToNextReviewCard,
  reviewQueueSig,
  schedulerEnabledSig,
  schedulerSettingsModalOpenSig,
  selectedCardSig,
  selectedDeckIdSig,
  selectedTemplateSig,
  blobSig,
  templatesSig,
} from "./stores";
import SRSVisualization from "./components/SRSVisualization.vue";
import SchedulerSettings from "./components/SchedulerSettings.vue";
import CommandPalette from "./components/CommandPalette.vue";
import FileInfo from "./components/FileInfo.vue";
import { useCommands } from "./composables/useCommands";
import { isTruthy } from "./utils/assert";

const activeSide = ref<"front" | "back">("front");
const reviewStartTime = ref<number>(Date.now());
const commands = useCommands();

// Compute deck info from anki data
const computedDeckInfo = computed(() => {
  const ankiData = ankiDataSig.value;
  return ankiData ? computeDeckInfo(ankiData) : null;
});

// Sync computed deck info to global signal and handle initial deck selection
watch(computedDeckInfo, (newDeckInfo, oldDeckInfo) => {
  if (newDeckInfo) {
    deckInfoSig.value = newDeckInfo;

    // Only set initial selected deck when loading a new deck
    const isNewDeck = !oldDeckInfo || oldDeckInfo.name !== newDeckInfo.name;
    if (isNewDeck && newDeckInfo.subdecks.length > 0) {
      selectedDeckIdSig.value = newDeckInfo.subdecks[0]!.id;
    }
  }
});

// Initialize review queue when cards are loaded and scheduler is enabled
watch(
  [cardsSig, templatesSig, schedulerEnabledSig, selectedDeckIdSig],
  ([cards, templates, schedulerEnabled]) => {
    if (cards.length > 0 && templates && templates.length > 0 && schedulerEnabled) {
      initializeReviewQueue();
    }
  },
);

// Get current card based on mode
const currentCardData = computed(() => {
  if (schedulerEnabledSig.value) {
    const reviewCard = currentReviewCardSig.value;
    if (!reviewCard) return null;

    return {
      cardIndex: reviewCard.cardIndex,
      templateIndex: reviewCard.templateIndex,
      reviewCard,
    };
  }

  return {
    cardIndex: selectedCardSig.value,
    templateIndex: selectedTemplateSig.value,
    reviewCard: null,
  };
});

const renderedCard = computed(() => {
  const data = currentCardData.value;
  if (!data) return null;

  const template = cardsSig.value[data.cardIndex]?.templates[data.templateIndex];
  const card = cardsSig.value[data.cardIndex];

  if (!template || !card) return null;

  const frontSideHtml = getRenderedCardString({
    templateString: template.qfmt,
    variables: { ...card.values },
    mediaFiles: mediaFilesSig.value,
  });

  const backSideHtml = getRenderedCardString({
    templateString: template.afmt,
    variables: { ...card.values, FrontSide: frontSideHtml },
    mediaFiles: mediaFilesSig.value,
  });

  return { frontSideHtml, backSideHtml };
});

function getAudioFilenames(html: string) {
  const allAudioContainers = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelectorAll<HTMLAudioElement>(`div.audio-container[data-autoplay] audio`);
  return [...allAudioContainers].map((audio) => audio.src).filter(isTruthy);
}

function updateActiveSide(side: "front" | "back") {
  activeSide.value = side;
  const card = renderedCard.value;
  if (!card) return;

  if (side === "front") {
    for (const filename of getAudioFilenames(card.frontSideHtml)) {
      new Audio(filename).play();
    }
  } else {
    const frontSideAudioFilenames = new Set(getAudioFilenames(card.frontSideHtml));
    const backSideAudioFilenames = new Set(getAudioFilenames(card.backSideHtml));
    const newAudioFilenames = backSideAudioFilenames.difference(frontSideAudioFilenames);
    for (const filename of newAudioFilenames) {
      new Audio(filename).play();
    }
  }
}

// Calculate intervals for scheduler mode
const intervals = computed(() => {
  if (!schedulerEnabledSig.value) return undefined;

  const reviewCard = currentReviewCardSig.value;
  const queue = reviewQueueSig.value;

  if (!reviewCard || !queue) return undefined;

  return queue.getNextIntervals(reviewCard);
});

async function handleFileChange(file: File) {
  const cache = await ankiCachePromise;
  await cache.put("anki-deck", new Response(file));
  blobSig.value = file;
}

function handleReveal() {
  updateActiveSide("back");
  reviewStartTime.value = Date.now();
}

async function handleChooseAnswer(answer: Answer) {
  if (schedulerEnabledSig.value) {
    const reviewCard = currentReviewCardSig.value;
    const queue = reviewQueueSig.value;

    if (reviewCard && queue) {
      const reviewTimeMs = Date.now() - reviewStartTime.value;
      await queue.processReview(reviewCard, answer, reviewTimeMs);
      moveToNextReviewCard();
    }
  } else {
    selectedCardSig.value = selectedCardSig.value + 1;
  }

  updateActiveSide("front");
  reviewStartTime.value = Date.now();
}
</script>

<template>
  <main>
    <!-- LEFT COLUMN: File Info -->
    <div class="layout-left-column">
      <FileInfo v-if="deckInfoSig" />
    </div>

    <!-- CENTER COLUMN: Card -->
    <div class="layout-center-column">
      <template v-if="renderedCard">
        <FlashCard
          :active-side="activeSide"
          :intervals="intervals"
          @reveal="handleReveal"
          @choose-answer="handleChooseAnswer"
        >
          <template #front>
            <div v-html="renderedCard.frontSideHtml" />
          </template>
          <template #back>
            <div v-html="renderedCard.backSideHtml" />
          </template>
        </FlashCard>
        <CardButtons
          :active-side="activeSide"
          :intervals="intervals"
          @reveal="handleReveal"
          @choose-answer="handleChooseAnswer"
        />
      </template>
      <FilePicker v-else-if="cardsSig.length === 0" @file-change="handleFileChange" />
    </div>

    <!-- RIGHT COLUMN: SRS Visualization -->
    <div class="layout-right-column">
      <SRSVisualization v-if="cardsSig.length > 0" />
    </div>
  </main>

  <SchedulerSettings
    :is-open="schedulerSettingsModalOpenSig"
    @close="schedulerSettingsModalOpenSig = false"
  />
  <CommandPalette :commands="commands" />
</template>

<style scoped>
main {
  display: grid;
  grid-template-columns: 300px 1fr 400px;
  min-height: 100vh;
}

:global(hr) { margin: var(--spacing-4) 0; }

.layout-left-column {
  grid-column: 1;
  grid-row: 1;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: var(--spacing-4);
  text-align: left;
}

.layout-center-column {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-4);
  padding: var(--spacing-8) var(--spacing-4);
}

.layout-right-column {
  grid-column: 3;
  grid-row: 1;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  padding: var(--spacing-4);
  text-align: left;
}

@media (max-width: 1200px) {
  main {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .layout-left-column,
  .layout-center-column,
  .layout-right-column {
    grid-column: 1;
    position: static;
    height: auto;
    overflow: visible;
    border: none;
  }

  .layout-left-column { grid-row: 1; border-bottom: 1px solid var(--color-border); }
  .layout-center-column { grid-row: 2; background: transparent; }
  .layout-right-column { grid-row: 3; border-top: 1px solid var(--color-border); }
}

.dropdowns { display: flex; gap: var(--spacing-4); justify-content: center; }

.keyboard-hint {
  text-align: right;
  display: inline-block;
  opacity: 0.5;
  grid-column: 1 / -1;
  margin-top: var(--spacing-4);
}
.keyboard-hint button { padding: var(--spacing-2); border-radius: var(--radius-sm); }
</style>
