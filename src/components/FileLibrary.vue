<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { Button, Page, Tooltip } from "../design-system";
import { createCachedDeckLibraryItem, createSampleDeckLibraryItem } from "../deckLibrary";
import { sampleDecks as sampleDeckData } from "../sampleDecks";
import {
  cachedFilesSig,
  activeDeckSourceIdSig,
  addCachedFile,
  loadCachedFile,
  deleteCachedFile,
  loadSampleDeck,
  syncActiveSig,
  deckInfoSig,
  selectedDeckIdSig,
  reviewModeSig,
  openDeckSettings,
  adoptedSampleIdsSig,
  adoptSampleDeck,
  removeAdoptedSample,
  SAMPLE_COLLECTION_ID,
  filteredDecksSig,
  studyFilteredDeck,
  rebuildFilteredDeck,
  deleteFilteredDeck,
  countFilteredDeckCards,
  ankiDataSig,
} from "../stores";
import type { DeckTreeNode } from "../types";
import FilteredDeckModal from "./FilteredDeckModal.vue";

const fileInput = ref<HTMLInputElement>();

const adoptedIds = computed(() => new Set(adoptedSampleIdsSig.value));
const sampleDecks = computed(() =>
  sampleDeckData.filter((d) => !adoptedIds.value.has(d.id)).map(createSampleDeckLibraryItem),
);
const adoptedSampleDecks = computed(() =>
  sampleDeckData.filter((d) => adoptedIds.value.has(d.id)).map(createSampleDeckLibraryItem),
);
const uploadedDecks = computed(() =>
  [...cachedFilesSig.value].sort((a, b) => b.addedAt - a.addedAt).map(createCachedDeckLibraryItem),
);

// Track collapsed state for parent decks
const collapsed = reactive(new Set<string>());

async function handleFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await addCachedFile(file);
  } catch (error) {
    console.error("Failed to load deck file:", error);
  }
}

function selectSubdeck(deckId: string) {
  selectedDeckIdSig.value = deckId;
  reviewModeSig.value = "studying";
}

function toggleCollapse(fullName: string, event: Event) {
  event.stopPropagation();
  if (collapsed.has(fullName)) {
    collapsed.delete(fullName);
  } else {
    collapsed.add(fullName);
  }
}

/** Flatten a tree into a list, respecting collapsed state */
function flattenTree(nodes: DeckTreeNode[]): DeckTreeNode[] {
  const result: DeckTreeNode[] = [];
  const walk = (nodes: DeckTreeNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children.length > 0 && !collapsed.has(node.fullName)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result;
}

const flatTree = computed(() => (deckInfoSig.value ? flattenTree(deckInfoSig.value.tree) : []));

/** Whether the sample collection is the active deck (no sync configured) */
const isSampleCollectionActive = computed(
  () => !syncActiveSig.value && activeDeckSourceIdSig.value === SAMPLE_COLLECTION_ID,
);

/** Whether the active deck belongs to "Your Decks" (adopted sample or uploaded file) */
const isYourDeckActive = computed(() => {
  const id = activeDeckSourceIdSig.value;
  if (!id) return false;
  return adoptedIds.value.has(id) || cachedFilesSig.value.some((f) => f.name === id);
});

function handleOpenSettings(node: DeckTreeNode, event: Event) {
  event.stopPropagation();
  // Compute the card count for this deck to match the storage key used by initializeReviewQueue
  openDeckSettings(`deck-${node.cardCount}`, node);
}

// Filtered decks
const filteredDeckModalOpen = ref(false);

const filteredDecksWithCounts = computed(() =>
  filteredDecksSig.value.map((d) => ({
    ...d,
    matchCount: countFilteredDeckCards(d.query),
  })),
);

function handleDeleteFiltered(id: string, event: Event) {
  event.stopPropagation();
  deleteFilteredDeck(id);
}
</script>

<template>
  <Page data-testid="file-library">
    <template #title>
      <div class="header">
        <h2 class="title">Deck Library</h2>
        <input
          ref="fileInput"
          type="file"
          accept=".apkg"
          class="hidden-input"
          @change="handleFileInput"
        />
        <Button variant="primary" size="sm" @click="fileInput?.click()"> Add File </Button>
      </div>
    </template>

    <!-- Filtered Decks -->
    <section v-if="ankiDataSig && filteredDecksWithCounts.length > 0" class="library-section">
      <div class="section-header">
        <h3 class="section-title">Filtered Decks</h3>
        <span class="section-count">{{ filteredDecksWithCounts.length }}</span>
      </div>
      <div class="file-grid">
        <div
          v-for="fd in filteredDecksWithCounts"
          :key="fd.id"
          class="file-card file-card--filtered" data-testid="filtered-deck-card"
          role="button"
          tabindex="0"
          @click="studyFilteredDeck(fd.id)"
          @keydown.enter="studyFilteredDeck(fd.id)"
          @keydown.space.prevent="studyFilteredDeck(fd.id)"
        >
          <div class="file-info">
            <span class="file-name">
              <svg
                class="filtered-icon"
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
              {{ fd.name }}
            </span>
            <span class="file-meta"
              >{{ fd.matchCount }} card{{ fd.matchCount === 1 ? "" : "s" }} ·
              {{ fd.reschedule ? "Normal" : "Cram" }}</span
            >
          </div>
          <div class="filtered-actions">
            <Button
              variant="ghost"
              size="sm"
              square
              title="Rebuild"
              @click.stop="rebuildFilteredDeck(fd.id)"
            >
              &#8635;
            </Button>
            <Button
              variant="ghost"
              size="sm"
              square
              title="Delete"
              @click.stop="handleDeleteFiltered(fd.id, $event)"
            >
              &times;
            </Button>
          </div>
        </div>
      </div>
    </section>

    <div v-if="ankiDataSig" class="create-filtered-row">
      <Button variant="secondary" size="sm" @click="filteredDeckModalOpen = true">
        Create Filtered Deck
      </Button>
    </div>

    <FilteredDeckModal :is-open="filteredDeckModalOpen" @close="filteredDeckModalOpen = false" />

    <section
      v-if="(syncActiveSig || isSampleCollectionActive) && deckInfoSig"
      class="library-section"
    >
      <div class="section-header">
        <h3 class="section-title">{{ syncActiveSig ? "Synced Decks" : "Sample Decks" }}</h3>
        <span class="section-count">{{ deckInfoSig.subdecks.length }}</span>
      </div>
      <div v-if="deckInfoSig.subdecks.length === 0" class="empty-state">
        <p class="empty-text">No decks synced yet. Pull your collection from the Sync tab.</p>
      </div>
      <div v-else class="deck-tree">
        <div
          v-for="node in flatTree"
          :key="node.fullName"
          :class="['deck-row', { 'deck-row--active': selectedDeckIdSig === node.id }]" data-testid="deck-row"
          :style="{ paddingLeft: `${12 + node.depth * 20}px` }"
          role="button"
          tabindex="0"
          @click="selectSubdeck(node.id)"
          @keydown.enter="selectSubdeck(node.id)"
          @keydown.space.prevent="selectSubdeck(node.id)"
        >
          <div class="deck-row-left">
            <Button
              v-if="node.children.length > 0"
              variant="ghost"
              size="xs"
              square
              :title="collapsed.has(node.fullName) ? 'Expand' : 'Collapse'"
              @click="toggleCollapse(node.fullName, $event)"
            >
              <span
                :class="[
                  'collapse-icon',
                  { 'collapse-icon--collapsed': collapsed.has(node.fullName) },
                ]"
                >&#9662;</span
              >
            </Button>
            <span v-else class="collapse-spacer" />
            <span class="deck-name">{{ node.name }}</span>
          </div>
          <div class="deck-row-right">
            <Tooltip text="New"
              ><span class="stat stat--new">{{ node.newCount }}</span></Tooltip
            >
            <Tooltip text="Learning"
              ><span class="stat stat--learn">{{ node.learnCount }}</span></Tooltip
            >
            <Tooltip text="Due"
              ><span class="stat stat--due">{{ node.dueCount }}</span></Tooltip
            >
            <Button
              variant="ghost"
              size="xs"
              square
              title="Deck settings"
              @click="handleOpenSettings(node, $event)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="syncActiveSig && !deckInfoSig" class="library-section">
      <div class="empty-state">
        <p class="empty-text">No collection loaded. Pull your collection from the Sync tab.</p>
      </div>
    </section>

    <section class="library-section">
      <div class="section-header">
        <h3 class="section-title">Your Decks</h3>
        <span class="section-count">{{ adoptedSampleDecks.length + uploadedDecks.length }}</span>
      </div>

      <div v-if="uploadedDecks.length === 0 && adoptedSampleDecks.length === 0" class="empty-state">
        <p class="empty-text">No decks yet. Add an .apkg file or a sample deck to get started.</p>
        <Button variant="secondary" @click="fileInput?.click()"> Choose a Deck File </Button>
      </div>

      <template v-else>
        <div class="file-grid">
          <div
            v-for="deck in adoptedSampleDecks"
            :key="deck.id"
            :class="['file-card', { 'file-card--active': activeDeckSourceIdSig === deck.id }]"
            role="button"
            tabindex="0"
            @click="loadSampleDeck(deck.id)"
            @keydown.enter="loadSampleDeck(deck.id)"
            @keydown.space.prevent="loadSampleDeck(deck.id)"
          >
            <div class="file-info">
              <span class="file-name">{{ deck.title }}</span>
              <span class="file-meta">{{ deck.detail }}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              square
              title="Remove from library"
              @click.stop="removeAdoptedSample(deck.id)"
            >
              &times;
            </Button>
          </div>
          <div
            v-for="deck in uploadedDecks"
            :key="deck.id"
            :class="['file-card', { 'file-card--active': activeDeckSourceIdSig === deck.id }]"
            role="button"
            tabindex="0"
            @click="loadCachedFile(deck.id)"
            @keydown.enter="loadCachedFile(deck.id)"
            @keydown.space.prevent="loadCachedFile(deck.id)"
          >
            <div class="file-info">
              <span class="file-name">{{ deck.title }}</span>
              <span class="file-meta">{{ deck.detail }}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              square
              title="Remove from library"
              @click.stop="deleteCachedFile(deck.id)"
            >
              &times;
            </Button>
          </div>
        </div>

        <!-- Deck tree for active your-deck -->
        <div
          v-if="!syncActiveSig && isYourDeckActive && deckInfoSig"
          class="deck-tree your-deck-tree"
        >
          <div
            v-for="node in flatTree"
            :key="node.fullName"
            :class="['deck-row', { 'deck-row--active': selectedDeckIdSig === node.id }]" data-testid="deck-row"
            :style="{ paddingLeft: `${12 + node.depth * 20}px` }"
            role="button"
            tabindex="0"
            @click="selectSubdeck(node.id)"
            @keydown.enter="selectSubdeck(node.id)"
            @keydown.space.prevent="selectSubdeck(node.id)"
          >
            <div class="deck-row-left">
              <Button
                v-if="node.children.length > 0"
                variant="ghost"
                size="xs"
                square
                :title="collapsed.has(node.fullName) ? 'Expand' : 'Collapse'"
                @click="toggleCollapse(node.fullName, $event)"
              >
                <span
                  :class="[
                    'collapse-icon',
                    { 'collapse-icon--collapsed': collapsed.has(node.fullName) },
                  ]"
                  >&#9662;</span
                >
              </Button>
              <span v-else class="collapse-spacer" />
              <span class="deck-name">{{ node.name }}</span>
            </div>
            <div class="deck-row-right">
              <Tooltip text="New"
                ><span class="stat stat--new">{{ node.newCount }}</span></Tooltip
              >
              <Tooltip text="Learning"
                ><span class="stat stat--learn">{{ node.learnCount }}</span></Tooltip
              >
              <Tooltip text="Due"
                ><span class="stat stat--due">{{ node.dueCount }}</span></Tooltip
              >
              <Button
                variant="ghost"
                size="xs"
                square
                title="Deck settings"
                @click="handleOpenSettings(node, $event)"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      </template>
    </section>
  </Page>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-4);
}

.title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.hidden-input {
  display: none;
}

.library-section + .library-section {
  margin-top: var(--spacing-8);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-3);
}

.section-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.section-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-4);
  padding: var(--spacing-12) var(--spacing-4);
  text-align: center;
}

.empty-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.file-grid {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.file-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
}

.file-card:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-hover);
}

.file-card--active {
  border-color: var(--color-primary);
  background: var(--color-surface-elevated);
}

.file-card--static {
  cursor: default;
}

.file-card--static:hover {
  background: var(--color-surface);
  border-color: var(--color-border);
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-0-5);
  min-width: 0;
}

.file-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.your-deck-tree {
  margin-top: var(--spacing-3);
}

/* Deck tree (synced decks with hierarchy) */
.deck-tree {
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.deck-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-2-5) var(--spacing-3);
  cursor: pointer;
  transition: var(--transition-colors);
  border-bottom: 1px solid var(--color-border);
}

.deck-row:last-child {
  border-bottom: none;
}

.deck-row:hover {
  background: var(--color-surface-hover);
}

.deck-row--active {
  background: var(--color-surface-elevated);
}

.deck-row-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  min-width: 0;
  flex: 1;
}

.collapse-icon {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.15s ease;
}

.collapse-icon--collapsed {
  transform: rotate(-90deg);
}

.collapse-spacer {
  width: 20px;
  flex-shrink: 0;
}

.deck-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deck-row-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  flex-shrink: 0;
  margin-left: var(--spacing-3);
}

.stat {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  min-width: 24px;
  text-align: right;
}

.stat--new {
  color: #3b82f6;
}

.stat--learn {
  color: #f59e0b;
}

.stat--due {
  color: #22c55e;
}

/* Filtered decks */
.create-filtered-row {
  display: flex;
  justify-content: center;
  margin-top: var(--spacing-4);
  margin-bottom: var(--spacing-2);
}

.file-card--filtered {
  border-left: 3px solid var(--color-primary);
}

.filtered-icon {
  vertical-align: -2px;
  margin-right: var(--spacing-1);
  color: var(--color-primary);
}

.filtered-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  flex-shrink: 0;
}
</style>
