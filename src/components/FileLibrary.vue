<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { Button, Tooltip } from "../design-system";
import { createCachedDeckLibraryItem, createSampleDeckLibraryItem } from "../deckLibrary";
import {
  cachedFilesSig,
  activeDeckSourceIdSig,
  addCachedFile,
  loadCachedFile,
  deleteCachedFile,
  loadSampleDeck,
  sampleDecksSig,
  syncActiveSig,
  deckInfoSig,
  selectedDeckIdSig,
  reviewModeSig,
  openDeckSettings,
} from "../stores";
import type { DeckTreeNode } from "../types";

const fileInput = ref<HTMLInputElement>();

const sampleDecks = computed(() => sampleDecksSig.map(createSampleDeckLibraryItem));
const uploadedDecks = computed(() =>
  [...cachedFilesSig.value]
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(createCachedDeckLibraryItem),
);

// Track collapsed state for parent decks
const collapsed = reactive(new Set<string>());

function handleFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) addCachedFile(file);
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

const flatTree = computed(() => deckInfoSig.value ? flattenTree(deckInfoSig.value.tree) : []);

function handleOpenSettings(node: DeckTreeNode, event: Event) {
  event.stopPropagation();
  // Compute the card count for this deck to match the storage key used by initializeReviewQueue
  openDeckSettings(`deck-${node.cardCount}`);
}
</script>

<template>
  <div class="file-library">
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

    <section v-if="!syncActiveSig" class="library-section">
      <div class="section-header">
        <h3 class="section-title">Sample Decks</h3>
        <span class="section-count">{{ sampleDecks.length }}</span>
      </div>
      <div class="file-grid">
        <div
          v-for="sampleDeck in sampleDecks"
          :key="sampleDeck.id"
          :class="['file-card', { 'file-card--active': activeDeckSourceIdSig === sampleDeck.id }]"
          @click="loadSampleDeck(sampleDeck.id)"
        >
          <div class="file-info">
            <span class="file-name">{{ sampleDeck.title }}</span>
            <span class="file-meta">{{ sampleDeck.detail }}</span>
            <span class="file-meta">{{ sampleDeck.meta }}</span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="syncActiveSig && deckInfoSig" class="library-section">
      <div class="section-header">
        <h3 class="section-title">Synced Decks</h3>
        <span class="section-count">{{ deckInfoSig.subdecks.length }}</span>
      </div>
      <div v-if="deckInfoSig.subdecks.length === 0" class="empty-state">
        <p class="empty-text">No decks synced yet. Pull your collection from the Sync tab.</p>
      </div>
      <div v-else class="deck-tree">
        <div
          v-for="node in flatTree"
          :key="node.fullName"
          :class="['deck-row', { 'deck-row--active': selectedDeckIdSig === node.id }]"
          :style="{ paddingLeft: `${12 + node.depth * 20}px` }"
          @click="selectSubdeck(node.id)"
        >
          <div class="deck-row-left">
            <button
              v-if="node.children.length > 0"
              class="collapse-btn"
              :title="collapsed.has(node.fullName) ? 'Expand' : 'Collapse'"
              @click="toggleCollapse(node.fullName, $event)"
            >
              <span :class="['collapse-icon', { 'collapse-icon--collapsed': collapsed.has(node.fullName) }]">&#9662;</span>
            </button>
            <span v-else class="collapse-spacer" />
            <span class="deck-name">{{ node.name }}</span>
          </div>
          <div class="deck-row-right">
            <Tooltip text="New"><span class="stat stat--new">{{ node.newCount }}</span></Tooltip>
            <Tooltip text="Learning"><span class="stat stat--learn">{{ node.learnCount }}</span></Tooltip>
            <Tooltip text="Due"><span class="stat stat--due">{{ node.dueCount }}</span></Tooltip>
            <button
              class="settings-btn"
              title="Deck settings"
              @click="handleOpenSettings(node, $event)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
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
        <span class="section-count">{{ uploadedDecks.length }}</span>
      </div>

      <div v-if="uploadedDecks.length === 0" class="empty-state">
        <p class="empty-text">No uploaded decks yet. Add an .apkg file to keep your own deck here.</p>
        <Button variant="secondary" @click="fileInput?.click()"> Choose a Deck File </Button>
      </div>

      <div v-else class="file-grid">
        <div
          v-for="deck in uploadedDecks"
          :key="deck.id"
          :class="['file-card', { 'file-card--active': activeDeckSourceIdSig === deck.id }]"
          @click="loadCachedFile(deck.id)"
        >
          <div class="file-info">
            <span class="file-name">{{ deck.title }}</span>
            <span class="file-meta">{{ deck.detail }}</span>
            <span class="file-meta">{{ deck.meta }}</span>
          </div>
          <button
            class="delete-btn"
            title="Remove from library"
            @click.stop="deleteCachedFile(deck.id)"
          >
            &times;
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.file-library {
  max-width: 700px;
  margin: 0 auto;
  padding: var(--spacing-8) var(--spacing-4);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-6);
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

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  box-shadow: none;
}

.collapse-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
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

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text-tertiary);
  box-shadow: none;
  transition: var(--transition-colors);
}

.settings-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
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

.delete-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.delete-btn:hover {
  color: var(--color-error);
  background: var(--color-surface-hover);
}
</style>
