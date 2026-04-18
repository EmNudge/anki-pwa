<script setup lang="ts">
import "./App.css";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import FlashCard from "./components/FlashCard.vue";
import CardButtons from "./components/CardButtons.vue";
import type { Answer } from "./scheduler/types";
import {
  getRenderedCardString,
  hasTypeAnswerField,
  extractExpectedAnswer,
  replaceMediaFiles,
} from "./utils/render";
import { isImageOcclusionCard, renderImageOcclusion } from "./utils/imageOcclusion";
import { renderDiffHtml } from "./utils/typeansDiff";
import { computeDeckInfo } from "./utils/deckInfo";
import { pushUndo } from "./undoRedo";
import { executeUndo, executeRedo } from "./undoRedoExecutor";
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
  schedulerSettingsSig,
  flagSettingsModalOpenSig,
  notetypeManagerOpenSig,
  selectedCardSig,
  selectedDeckIdSig,
  selectedTemplateSig,
  templatesSig,
  updateDueCardsAfterReview,
  activeFilteredDeckIdSig,
  activeFilteredDeckSig,
  emptyFilteredDeck,
} from "./stores";
import StatusBar from "./components/StatusBar.vue";
import FileLibrary from "./components/FileLibrary.vue";
import DeckCreator from "./components/DeckCreator.vue";

import CardBrowser from "./components/CardBrowser.vue";
import FindDuplicates from "./components/FindDuplicates.vue";
import SyncPanel from "./components/SyncPanel.vue";
import { defineAsyncComponent } from "vue";
const StatsPanel = defineAsyncComponent(() => import("./components/StatsPanel.vue"));
const NoteTypeManager = defineAsyncComponent(() => import("./components/NoteTypeManager.vue"));
const BackupPanel = defineAsyncComponent(() => import("./components/BackupPanel.vue"));
const DatabaseCheckPanel = defineAsyncComponent(
  () => import("./components/DatabaseCheckPanel.vue"),
);
import CongratsScreen from "./components/CongratsScreen.vue";
import SchedulerSettings from "./components/SchedulerSettings.vue";
import FlagSettings from "./components/FlagSettings.vue";
import CommandPalette from "./components/CommandPalette.vue";
import { useCommands } from "./composables/useCommands";
import { getAutoplayAudioSources, playAudio } from "./utils/sound";
import { Info } from "lucide-vue-next";
import { Modal, Tooltip } from "./design-system";
import { markDataChanged, startAutoSync } from "./lib/autoSync";
import { startAutoBackup } from "./backup/autoBackup";
import NoteEditModal from "./components/NoteEditModal.vue";
import ImageOcclusionNoteEditor from "./components/ImageOcclusionNoteEditor.vue";
import {
  updateNote,
  isSyncedCollection,
  addNote,
  getOrCreateIONotetype,
  addMediaToCache,
  getActiveDeckId,
} from "./stores";

const activeSide = ref<"front" | "back">("front");
const reviewStartTime = ref<number>(Date.now());
const editModalOpen = ref(false);
const ioCreateModalOpen = ref(false);
const shortcutsModalOpen = ref(false);
const typedAnswer = ref("");

const commands = useCommands({
  onEditCard: () => {
    editModalOpen.value = true;
  },
  onUndoToast: (message: string) => {
    showUndoToast(message);
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
startAutoBackup();

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

  // Image occlusion cards use a dedicated renderer
  if (isImageOcclusionCard(card)) {
    const cardOrd = data.templateIndex;
    const frontSideHtml = replaceMediaFiles(
      renderImageOcclusion({ values: card.values, cardOrd, isAnswer: false }),
      mediaFilesSig.value,
    );
    const backSideHtml = replaceMediaFiles(
      renderImageOcclusion({ values: card.values, cardOrd, isAnswer: true }),
      mediaFilesSig.value,
    );
    return { frontSideHtml, backSideHtml, cardCss: card.css ?? "", isTypeAnswer: false };
  }

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

  const isTypeAnswer = hasTypeAnswerField(frontSideHtml);
  return { frontSideHtml, backSideHtml, cardCss: card.css ?? "", isTypeAnswer };
});

// Compute the back HTML with type-answer diff when applicable
const backHtmlWithDiff = computed(() => {
  const card = renderedCard.value;
  if (!card) return "";
  if (!card.isTypeAnswer) return card.backSideHtml;

  const expected = extractExpectedAnswer(card.backSideHtml);
  if (expected === null) return card.backSideHtml;

  const diffHtml = renderDiffHtml(typedAnswer.value, expected);

  // Replace the typeans span with the diff HTML
  return card.backSideHtml.replace(/<span id="typeans"[^>]*>[\s\S]*?<\/span>/, diffHtml);
});

// Reset typed answer when the card changes
watch(renderedCard, () => {
  typedAnswer.value = "";
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

async function handleIONoteCreate(payload: {
  fields: Record<string, string | null>;
  tags: string[];
  imageFile?: File;
}) {
  try {
    // Cache image file if provided
    if (payload.imageFile) {
      const imgField = payload.fields["Image Occlusion"] ?? "";
      const match = imgField.match(/src="([^"]+)"/);
      const filename = match?.[1];
      if (filename) {
        await addMediaToCache(new Map([[filename, payload.imageFile]]));
      }
    }

    const ntId = await getOrCreateIONotetype();
    const deckId = getActiveDeckId();

    // Count shapes to determine number of cards
    const occSvg = payload.fields.Occlusions ?? "";
    const ordinals = [...occSvg.matchAll(/data-ordinal="(\d+)"/g)].map((m) => parseInt(m[1]!));
    const numCards = ordinals.length > 0 ? Math.max(...ordinals) : 1;

    await addNote({
      notetypeId: ntId,
      deckId,
      fields: payload.fields,
      tags: payload.tags,
      numCards,
    });

    ioCreateModalOpen.value = false;
  } catch (err) {
    console.error("Failed to create IO note:", err);
  }
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
    !renderedCard.value?.isTypeAnswer &&
    !(e.target instanceof HTMLInputElement) &&
    !(e.target instanceof HTMLTextAreaElement)
  ) {
    e.preventDefault();
    editModalOpen.value = true;
  }
}

// Undo/redo toast notification
const undoToast = ref<string | null>(null);
let undoToastTimer: ReturnType<typeof setTimeout> | null = null;

function showUndoToast(message: string) {
  undoToast.value = message;
  if (undoToastTimer) clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(() => {
    undoToast.value = null;
  }, 2500);
}

// Handle Ctrl+Z (undo) and Ctrl+Shift+Z (redo) keyboard shortcuts
async function handleUndoRedoKeydown(e: KeyboardEvent) {
  // Skip if focused on an input/textarea element
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    (e.target instanceof HTMLElement && e.target.isContentEditable)
  ) {
    return;
  }

  const isCtrlOrMeta = e.ctrlKey || e.metaKey;
  if (!isCtrlOrMeta) return;

  if (e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    const desc = await executeUndo();
    if (desc) showUndoToast(`Undo: ${desc}`);
  } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
    e.preventDefault();
    const desc = await executeRedo();
    if (desc) showUndoToast(`Redo: ${desc}`);
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleEditKeydown);
  document.addEventListener("keydown", handleUndoRedoKeydown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", handleEditKeydown);
  document.removeEventListener("keydown", handleUndoRedoKeydown);
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
      // Check if we're in cram mode (filtered deck with reschedule=false)
      const filteredDeck = activeFilteredDeckSig.value;
      const isCramMode = filteredDeck && !filteredDeck.reschedule;

      if (isCramMode) {
        // Cram mode: don't persist scheduling changes
        // Just remove the card from the queue and move on
        updateDueCardsAfterReview(reviewCard.cardId, reviewCard.reviewState);
        moveToNextReviewCard();
      } else {
        // Normal mode: process review with scheduling
        // Capture previous state for undo
        const previousState = JSON.parse(JSON.stringify(reviewCard.reviewState));
        const wasNew = reviewCard.isNew;
        const today = new Date();
        const rolloverHour = 4; // Default rollover hour
        if (today.getHours() < rolloverHour) today.setDate(today.getDate() - 1);
        const dailyStatsDate = today.toISOString().split("T")[0]!;

        const reviewTimeMs = Date.now() - reviewStartTime.value;
        const reviewLogTimestamp = Date.now();
        const updatedState = await queue.processReview(reviewCard, answer, reviewTimeMs);

        // Record undo entry
        const answerLabel = answer.charAt(0).toUpperCase() + answer.slice(1);
        pushUndo({
          type: "review",
          description: `Answer ${answerLabel}`,
          undoData: {
            cardId: reviewCard.cardId,
            previousState,
            newState: JSON.parse(JSON.stringify(updatedState)),
            reviewLogTimestamp,
            wasNew,
            dailyStatsDate,
            reviewTimeMs,
          },
        });

        updateDueCardsAfterReview(reviewCard.cardId, updatedState);
        moveToNextReviewCard();
        markDataChanged();
      }
    }
  } else {
    moveToNextCard();
  }

  updateActiveSide("front");
  reviewStartTime.value = Date.now();
}

// --- Auto-advance timer ---
const autoAdvanceTimerRef = ref<ReturnType<typeof setTimeout> | null>(null);

function clearAutoAdvanceTimer() {
  if (autoAdvanceTimerRef.value !== null) {
    clearTimeout(autoAdvanceTimerRef.value);
    autoAdvanceTimerRef.value = null;
  }
}

watch(
  [activeSide, () => schedulerSettingsSig.value.autoAdvance, () => reviewModeSig.value],
  ([side, autoAdvance, mode]) => {
    clearAutoAdvanceTimer();
    if (mode !== "studying" || !autoAdvance) return;

    if (side === "front" && autoAdvance.autoFlipDelaySecs > 0) {
      autoAdvanceTimerRef.value = setTimeout(
        () => handleReveal(),
        autoAdvance.autoFlipDelaySecs * 1000,
      );
    } else if (side === "back" && autoAdvance.autoAdvanceDelaySecs > 0) {
      autoAdvanceTimerRef.value = setTimeout(
        () => handleChooseAnswer(autoAdvance.autoAdvanceAnswer),
        autoAdvance.autoAdvanceDelaySecs * 1000,
      );
    }
  },
);

onUnmounted(clearAutoAdvanceTimer);
</script>

<template>
  <StatusBar @undo-toast="showUndoToast" />

  <!-- BROWSE VIEW -->
  <CardBrowser v-if="activeViewSig === 'browse'" />

  <!-- FIND DUPLICATES VIEW -->
  <FindDuplicates v-else-if="activeViewSig === 'duplicates'" />

  <!-- CREATE DECK VIEW -->
  <DeckCreator v-else-if="activeViewSig === 'create'" />

  <!-- STATS VIEW -->
  <StatsPanel v-else-if="activeViewSig === 'stats'" />

  <!-- SYNC VIEW -->
  <SyncPanel v-else-if="activeViewSig === 'sync'" />

  <!-- BACKUP VIEW -->
  <BackupPanel v-else-if="activeViewSig === 'backup'" />

  <!-- DATABASE CHECK VIEW -->
  <DatabaseCheckPanel v-else-if="activeViewSig === 'check-db'" />

  <!-- REVIEW VIEW: deck list or studying -->
  <FileLibrary v-else-if="reviewModeSig === 'deck-list'" />

  <main v-else>
    <div class="layout-center-column">
      <template v-if="renderedCard">
        <div v-if="activeFilteredDeckSig" class="filtered-deck-header">
          <span class="filtered-deck-name">
            <svg
              class="filtered-deck-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {{ activeFilteredDeckSig.name }}
            <span v-if="!activeFilteredDeckSig.reschedule" class="cram-badge">Cram</span>
          </span>
          <button
            class="filtered-deck-close"
            @click="
              emptyFilteredDeck(activeFilteredDeckSig.id);
              reviewModeSig = 'deck-list';
            "
          >
            &times;
          </button>
        </div>
        <div v-else-if="selectedDeckName" class="deck-header">
          <Tooltip :text="selectedDeckDescription ?? 'No description'">
            <button class="deck-info-btn" @click="deckInfoModalOpen = true">
              <Info :size="16" />
            </button>
          </Tooltip>
          <span>{{ selectedDeckName }}</span>
          <button
            v-if="isSyncedCollection()"
            class="deck-info-btn io-add-btn"
            title="Add Image Occlusion Note"
            @click="ioCreateModalOpen = true"
          >
            +IO
          </button>
        </div>
        <FlashCard
          :active-side="activeSide"
          :front-html="renderedCard.frontSideHtml"
          :back-html="backHtmlWithDiff"
          :card-css="renderedCard.cardCss"
          :intervals="intervals"
          :has-type-answer="renderedCard.isTypeAnswer"
          @reveal="handleReveal"
          @choose-answer="handleChooseAnswer"
          @audio-button-click="handleAudioButtonClick"
          @type-answer-input="(v: string) => (typedAnswer = v)"
          @type-answer-submit="handleReveal"
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

  <FlagSettings :is-open="flagSettingsModalOpenSig" @close="flagSettingsModalOpenSig = false" />

  <NoteTypeManager :is-open="notetypeManagerOpenSig" @close="notetypeManagerOpenSig = false" />

  <Modal
    :is-open="deckInfoModalOpen"
    title="Deck Info"
    size="sm"
    @close="deckInfoModalOpen = false"
  >
    <div v-if="selectedSubdeck" class="deck-info-content">
      <dl class="deck-info-dl">
        <dt>Name</dt>
        <dd>{{ selectedSubdeck.fullName }}</dd>
        <dt>Description</dt>
        <dd>{{ selectedSubdeck.description || "No description" }}</dd>
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

  <Modal
    :is-open="ioCreateModalOpen"
    title="New Image Occlusion"
    size="xl"
    @close="ioCreateModalOpen = false"
  >
    <ImageOcclusionNoteEditor
      :card="null"
      :media-files="mediaFilesSig"
      :is-new="true"
      @save="handleIONoteCreate"
      @close="ioCreateModalOpen = false"
    />
  </Modal>

  <Modal
    :is-open="shortcutsModalOpen"
    title="Keyboard Shortcuts"
    size="lg"
    @close="shortcutsModalOpen = false"
  >
    <div class="shortcuts-grid">
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Review</h3>
        <dl class="shortcuts-list">
          <dt><kbd>Space</kbd> / <kbd>Enter</kbd></dt>
          <dd>Reveal answer</dd>
          <dt><kbd>1</kbd> / <kbd>A</kbd></dt>
          <dd>Again</dd>
          <dt><kbd>2</kbd> / <kbd>H</kbd></dt>
          <dd>Hard</dd>
          <dt><kbd>3</kbd> / <kbd>G</kbd> / <kbd>Space</kbd></dt>
          <dd>Good</dd>
          <dt><kbd>4</kbd> / <kbd>E</kbd></dt>
          <dd>Easy</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Card Actions</h3>
        <dl class="shortcuts-list">
          <dt><kbd>E</kbd></dt>
          <dd>Edit current card</dd>
          <dt><kbd>*</kbd></dt>
          <dd>Mark / unmark note</dd>
          <dt><kbd>-</kbd></dt>
          <dd>Bury card</dd>
          <dt><kbd>=</kbd></dt>
          <dd>Bury note</dd>
          <dt><kbd>@</kbd></dt>
          <dd>Suspend card</dd>
          <dt><kbd>I</kbd></dt>
          <dd>Card info</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>Del</kbd></dt>
          <dd>Delete note</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Flags</h3>
        <dl class="shortcuts-list">
          <dt><kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>7</kbd></dt>
          <dd>Set flag 1–7</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>0</kbd></dt>
          <dd>Remove flag</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">Audio</h3>
        <dl class="shortcuts-list">
          <dt><kbd>R</kbd></dt>
          <dd>Replay audio</dd>
          <dt><kbd>5</kbd></dt>
          <dd>Pause / resume audio</dd>
        </dl>
      </div>
      <div class="shortcuts-section">
        <h3 class="shortcuts-heading">General</h3>
        <dl class="shortcuts-list">
          <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd></dt>
          <dd>Undo</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></dt>
          <dd>Redo</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>K</kbd></dt>
          <dd>Command palette</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>T</kbd></dt>
          <dd>Toggle theme</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>E</kbd></dt>
          <dd>Toggle sound effects</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>,</kbd></dt>
          <dd>Scheduler settings</dd>
          <dt><kbd>?</kbd></dt>
          <dd>Show this help</dd>
        </dl>
      </div>
    </div>
  </Modal>

  <!-- Undo/Redo toast notification -->
  <Transition name="toast">
    <div v-if="undoToast" class="undo-toast">
      {{ undoToast }}
    </div>
  </Transition>
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

.filtered-deck-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-2);
}

.filtered-deck-name {
  display: flex;
  align-items: center;
  gap: var(--spacing-1-5);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.filtered-deck-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

.cram-badge {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-warning, #f59e0b);
  background: var(--color-warning-alpha, rgba(245, 158, 11, 0.1));
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

.filtered-deck-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  box-shadow: none;
}

.filtered-deck-close:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
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

.io-add-btn {
  margin-left: auto;
  padding: 2px 6px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
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

.undo-toast {
  position: fixed;
  bottom: var(--spacing-6);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-on-primary);
  background: var(--color-text-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-index-tooltip);
  pointer-events: none;
  white-space: nowrap;
}

.toast-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}
</style>
