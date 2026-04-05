<script setup lang="ts">
import "./App.css";
import { computed, ref, watch } from "vue";
import FlashCard from "./components/FlashCard.vue";
import CardButtons from "./components/CardButtons.vue";
import type { Answer } from "./scheduler/types";
import { getRenderedCardString } from "./utils/render";
import { computeDeckInfo } from "./utils/deckInfo";
import {
  activeViewSig,
  ankiDataSig,
  cardsSig,
  currentReviewCardSig,
  deckInfoSig,
  initializeReviewQueue,
  mediaFilesSig,
  moveToNextCard,
  moveToNextReviewCard,
  reviewModeSig,
  reviewQueueSig,
  schedulerEnabledSig,
  schedulerSettingsModalOpenSig,
  selectedCardSig,
  selectedDeckIdSig,
  selectedTemplateSig,
  templatesSig,
} from "./stores";
import StatusBar from "./components/StatusBar.vue";
import FileLibrary from "./components/FileLibrary.vue";
import DeckCreator from "./components/DeckCreator.vue";

import SyncPanel from "./components/SyncPanel.vue";
import SchedulerSettings from "./components/SchedulerSettings.vue";
import CommandPalette from "./components/CommandPalette.vue";
import { useCommands } from "./composables/useCommands";
import { getAutoplayAudioSources, playAudio } from "./utils/sound";

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

  return { frontSideHtml, backSideHtml, cardCss: card.css ?? "" };
});

function updateActiveSide(side: "front" | "back") {
  activeSide.value = side;
  const card = renderedCard.value;
  if (!card) return;

  if (side === "front") {
    for (const filename of getAutoplayAudioSources(card.frontSideHtml)) {
      playAudio(filename);
    }
  } else {
    const frontSideAudioFilenames = new Set(getAutoplayAudioSources(card.frontSideHtml));
    const backSideAudioFilenames = new Set(getAutoplayAudioSources(card.backSideHtml));
    const newAudioFilenames = backSideAudioFilenames.difference(frontSideAudioFilenames);
    for (const filename of newAudioFilenames) {
      playAudio(filename);
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

function handleAudioButtonClick(src: string) {
  playAudio(src);
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
    moveToNextCard();
  }

  updateActiveSide("front");
  reviewStartTime.value = Date.now();
}
</script>

<template>
  <StatusBar />

  <!-- CREATE DECK VIEW -->
  <DeckCreator v-if="activeViewSig === 'create'" />

  <!-- SYNC VIEW -->
  <SyncPanel v-else-if="activeViewSig === 'sync'" />

  <!-- REVIEW VIEW: deck list or studying -->
  <FileLibrary v-else-if="reviewModeSig === 'deck-list'" />

  <main v-else>
    <div class="layout-center-column">
      <template v-if="renderedCard">
        <FlashCard
          :active-side="activeSide"
          :front-html="renderedCard.frontSideHtml"
          :back-html="renderedCard.backSideHtml"
          :card-css="renderedCard.cardCss"
          :intervals="intervals"
          @reveal="handleReveal"
          @choose-answer="handleChooseAnswer"
          @audio-button-click="handleAudioButtonClick"
        />
        <CardButtons
          :active-side="activeSide"
          :intervals="intervals"
          @reveal="handleReveal"
          @choose-answer="handleChooseAnswer"
        />
      </template>
      <p v-else-if="cardsSig.length === 0" class="no-deck-message">
        No deck loaded. Click the
        <button class="link-btn" @click="reviewModeSig = 'deck-list'">Review</button> tab to choose a deck.
      </p>
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
  min-height: calc(100vh - 44px);
}

.layout-center-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-4);
  padding: var(--spacing-8) var(--spacing-4);
}

.no-deck-message {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.link-btn {
  display: inline;
  padding: 0;
  font: inherit;
  color: var(--color-primary);
  background: none;
  border: none;
  box-shadow: none;
  cursor: pointer;
  text-decoration: underline;
}
</style>
