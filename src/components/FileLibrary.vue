<script setup lang="ts">
import { ref, computed } from "vue";
import { Button } from "../design-system";
import { createCachedDeckLibraryItem, createSampleDeckLibraryItem } from "../deckLibrary";
import {
  cachedFilesSig,
  activeDeckSourceIdSig,
  addCachedFile,
  loadCachedFile,
  deleteCachedFile,
  loadSampleDeck,
  sampleDecksSig,
} from "../stores";

const fileInput = ref<HTMLInputElement>();

const sampleDecks = computed(() => sampleDecksSig.map(createSampleDeckLibraryItem));
const uploadedDecks = computed(() =>
  [...cachedFilesSig.value]
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(createCachedDeckLibraryItem),
);

function handleFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) addCachedFile(file);
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

    <section class="library-section">
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
