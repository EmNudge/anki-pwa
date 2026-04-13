<script setup lang="ts">
import "./App.css";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
  flagSettingsModalOpenSig,
  selectedCardSig,
  selectedDeckIdSig,
  selectedTemplateSig,
  templatesSig,
  updateDueCardsAfterReview,
} from "./stores";
import StatusBar from "./components/StatusBar.vue";
import FileLibrary from "./components/FileLibrary.vue";
import DeckCreator from "./components/DeckCreator.vue";

import CardBrowser from "./components/CardBrowser.vue";
import SyncPanel from "./components/SyncPanel.vue";
import CongratsScreen from "./components/CongratsScreen.vue";
import SchedulerSettings from "./components/SchedulerSettings.vue";
import FlagSettings from "./components/FlagSettings.vue";
import CommandPalette from "./components/CommandPalette.vue";
import { useCommands } from "./composables/useCommands";
import { getAutoplayAudioSources, playAudio } from "./utils/sound";
import { Info } from "lucide-vue-next";
import Modal from "./design-system/components/primitives/Modal.vue";
import Tooltip from "./design-system/components/primitives/Tooltip.vue";
import { markDataChanged, startAutoSync } from "./lib/autoSync";
import NoteEditModal from "./components/NoteEditModal.vue";
import { updateNote } from "./stores";

const activeSide = ref<"front" | "back">("front");
const reviewStartTime = ref<number>(Date.now());
const editModalOpen = ref(false);
const shortcutsModalOpen = ref(false);

const commands = useCommands({
  onEditCard: () => {
    editModalOpen.value = true;
  },
  onReplayAudio: () => {
    const card = renderedCard.value;
    if (!card) return;
    const html = activeSide.value === "front" ? card.frontSideHtml : card.backSideHtml;
    for (const filename of getAutoplayAudioSources(html)) {
      playAudio(filename);
    }
  },
  onPauseAudio: () => {
    // Pause/resume all active audio elements on the page
    const audios = document.querySelectorAll<HTMLAudioElement>("audio");
    for (const audio of audios) {
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    }
  },
  onShowShortcuts: () => {
    shortcutsModalOpen.value = true;
  },
});

// Start background auto-sync timer
startAutoSync();

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

const selectedSubdeck = computed(() => {
  const info = deckInfoSig.value;
  const id = selectedDeckIdSig.value;
  if (!info || !id) return null;
  return info.subdecks.find((d) => d.id === id) ?? null;
});

const selectedDeckName = computed(() => {
  return selectedSubdeck.value?.name ?? deckInfoSig.value?.name ?? null;
});

const selectedDeckDescription = computed(() => {
  return selectedSubdeck.value?.description || null;
});

const deckInfoModalOpen = ref(false);

// Initialize review queue when cards are loaded (scheduler enabled state is per-deck, checked inside)
watch([cardsSig, templatesSig, selectedDeckIdSig], ([cards, templates]) => {
  if (cards.length > 0 && templates && templates.length > 0) {
    initializeReviewQueue();
  }
});

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

// Autoplay front-side audio when entering studying mode or when the card changes
watch(
  () => [reviewModeSig.value, renderedCard.value] as const,
  ([mode, card], [oldMode]) => {
    if (mode !== "studying" || !card) return;
    if (oldMode !== "studying" || activeSide.value === "front") {
      activeSide.value = "front";
      for (const filename of getAutoplayAudioSources(card.frontSideHtml)) {
        playAudio(filename);
      }
    }
  },
);

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

const currentNoteCard = computed(() => {
  const data = currentCardData.value;
  if (!data) return null;
  return cardsSig.value[data.cardIndex] ?? null;
});

async function handleNoteSave(payload: { fields: Record<string, string | null>; tags: string[] }) {
  const card = currentNoteCard.value;
  if (!card) return;
  await updateNote(card.guid, payload.fields, payload.tags);
  editModalOpen.value = false;
}

// Handle 'E' key for edit - only on front side to avoid conflict with 'Easy' answer
function handleEditKeydown(e: KeyboardEvent) {
  if (
    e.key.toLowerCase() === "e" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    activeSide.value === "front" &&
    reviewModeSig.value === "studying" &&
    activeViewSig.value === "review" &&
    currentNoteCard.value &&
    !(e.target instanceof HTMLInputElement) &&
    !(e.target instanceof HTMLTextAreaElement)
  ) {
    e.preventDefault();
    editModalOpen.value = true;
  }
}

onMounted(() => document.addEventListener("keydown", handleEditKeydown));
onUnmounted(() => document.removeEventListener("keydown", handleEditKeydown));

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
      const updatedState = await queue.processReview(reviewCard, answer, reviewTimeMs);
      updateDueCardsAfterReview(reviewCard.cardId, updatedState);
      moveToNextReviewCard();
      markDataChanged();
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

  <!-- BROWSE VIEW -->
  <CardBrowser v-if="activeViewSig === 'browse'" />

  <!-- CREATE DECK VIEW -->
  <DeckCreator v-else-if="activeViewSig === 'create'" />

  <!-- SYNC VIEW -->
  <SyncPanel v-else-if="activeViewSig === 'sync'" />

  <!-- REVIEW VIEW: deck list or studying -->
  <FileLibrary v-else-if="reviewModeSig === 'deck-list'" />

  <main v-else>
    <div class="layout-center-column">
      <template v-if="renderedCard">
        <div v-if="selectedDeckName" class="deck-header">
          <Tooltip :text="selectedDeckDescription ?? 'No description'">
            <button class="deck-info-btn" @click="deckInfoModalOpen = true">
              <Info :size="16" />
            </button>
          </Tooltip>
          <span>{{ selectedDeckName }}</span>
        </div>
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
      <CongratsScreen v-else-if="schedulerEnabledSig && cardsSig.length > 0" />
      <p v-else-if="cardsSig.length === 0" class="no-deck-message">
        No deck loaded. Click the
        <button class="link-btn" @click="reviewModeSig = 'deck-list'">Review</button> tab to choose
        a deck.
      </p>
    </div>
  </main>

  <SchedulerSettings
    :is-open="schedulerSettingsModalOpenSig"
    @close="schedulerSettingsModalOpenSig = false"
  />

  <FlagSettings
    :is-open="flagSettingsModalOpenSig"
    @close="flagSettingsModalOpenSig = false"
  />

  <Modal :is-open="deckInfoModalOpen" title="Deck Info" size="sm" @close="deckInfoModalOpen = false">
    <div v-if="selectedSubdeck" class="deck-info-content">
      <dl class="deck-info-dl">
        <dt>Name</dt>
        <dd>{{ selectedSubdeck.fullName }}</dd>
        <dt>Description</dt>
        <dd>{{ selectedSubdeck.description || 'No description' }}</dd>
        <dt>Cards</dt>
        <dd>{{ selectedSubdeck.cardCount }}</dd>
        <dt>New</dt>
        <dd>{{ selectedSubdeck.newCount }}</dd>
        <dt>Learning</dt>
        <dd>{{ selectedSubdeck.learnCount }}</dd>
        <dt>Due</dt>
        <dd>{{ selectedSubdeck.dueCount }}</dd>
      </dl>
    </div>
  </Modal>

  <CommandPalette :commands="commands" />

  <NoteEditModal
    :is-open="editModalOpen"
    :card="currentNoteCard"
    :media-files="mediaFilesSig"
    @close="editModalOpen = false"
    @save="handleNoteSave"
  />

  <Modal :is-open="shortcutsModalOpen" title="Keyboard Shortcuts" size="lg" @close="shortcutsModalOpen = false">
    <div class="shortcuts-grid">
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Review</h3>
        <dl class="shortcuts-list">
          <dt><kbd>Space</kbd> / <kbd>Enter</kbd></dt><dd>Reveal answer</dd>
          <dt><kbd>1</kbd> / <kbd>A</kbd></dt><dd>Again</dd>
          <dt><kbd>2</kbd> / <kbd>H</kbd></dt><dd>Hard</dd>
          <dt><kbd>3</kbd> / <kbd>G</kbd> / <kbd>Space</kbd></dt><dd>Good</dd>
          <dt><kbd>4</kbd> / <kbd>E</kbd></dt><dd>Easy</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Card Actions</h3>
        <dl class="shortcuts-list">
          <dt><kbd>E</kbd></dt><dd>Edit current card</dd>
          <dt><kbd>*</kbd></dt><dd>Mark / unmark note</dd>
          <dt><kbd>-</kbd></dt><dd>Bury card</dd>
          <dt><kbd>=</kbd></dt><dd>Bury note</dd>
          <dt><kbd>@</kbd></dt><dd>Suspend card</dd>
          <dt><kbd>I</kbd></dt><dd>Card info</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>Del</kbd></dt><dd>Delete note</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Flags</h3>
        <dl class="shortcuts-list">
          <dt><kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>7</kbd></dt><dd>Set flag 1–7</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>0</kbd></dt><dd>Remove flag</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Audio</h3>
        <dl class="shortcuts-list">
          <dt><kbd>R</kbd></dt><dd>Replay audio</dd>
          <dt><kbd>5</kbd></dt><dd>Pause / resume audio</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">General</h3>
        <dl class="shortcuts-list">
          <dt><kbd>Ctrl</kbd>+<kbd>K</kbd></dt><dd>Command palette</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>T</kbd></dt><dd>Toggle theme</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>E</kbd></dt><dd>Toggle sound effects</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>,</kbd></dt><dd>Scheduler settings</dd>
          <dt><kbd>?</kbd></dt><dd>Show this help</dd>
        </dl>
      </div>
    </div>
  </Modal>
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

.deck-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-1-5);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.no-deck-message {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.deck-info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  color: var(--color-text-tertiary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.deck-info-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.deck-info-content {
  padding: var(--spacing-2) 0;
}

.deck-info-dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--spacing-1-5) var(--spacing-4);
  margin: 0;
  font-size: var(--font-size-sm);
}

.deck-info-dl dt {
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}

.deck-info-dl dd {
  margin: 0;
  color: var(--color-text-primary);
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

.shortcuts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-6);
  padding: var(--spacing-2) 0;
}

@media (max-width: 600px) {
  .shortcuts-grid {
    grid-template-columns: 1fr;
  }
}

.shortcuts-heading {
  margin: 0 0 var(--spacing-2);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.shortcuts-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--spacing-1) var(--spacing-3);
  margin: 0;
  font-size: var(--font-size-sm);
}

.shortcuts-list dt {
  text-align: right;
  white-space: nowrap;
}

.shortcuts-list dd {
  margin: 0;
  color: var(--color-text-secondary);
}

.shortcuts-list kbd {
  display: inline-block;
  padding: 1px var(--spacing-1-5);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  min-width: 20px;
  text-align: center;
}
</style>
