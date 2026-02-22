<script setup lang="ts">
import { ref, computed } from "vue";
import { Button } from "../design-system";
import {
  cachedFilesSig,
  activeFileNameSig,
  addCachedFile,
  loadCachedFile,
  deleteCachedFile,
} from "../stores";

const fileInput = ref<HTMLInputElement>();

const sortedFiles = computed(() =>
  [...cachedFilesSig.value].sort((a, b) => b.addedAt - a.addedAt),
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function handleFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) addCachedFile(file);
}
</script>

<template>
  <div class="file-library">
    <div class="header">
      <h2 class="title">Your Decks</h2>
      <input ref="fileInput" type="file" accept=".apkg" class="hidden-input" @change="handleFileInput" />
      <Button variant="primary" size="sm" @click="fileInput?.click()">
        Add File
      </Button>
    </div>

    <div v-if="sortedFiles.length === 0" class="empty-state">
      <p class="empty-text">No decks yet. Add an .apkg file to get started.</p>
      <Button variant="secondary" @click="fileInput?.click()">
        Choose a Deck File
      </Button>
    </div>

    <div v-else class="file-grid">
      <div
        v-for="file in sortedFiles"
        :key="file.name"
        :class="['file-card', { 'file-card--active': activeFileNameSig === file.name }]"
        @click="loadCachedFile(file.name)"
      >
        <div class="file-info">
          <span class="file-name">{{ file.name }}</span>
          <span class="file-meta">{{ formatSize(file.size) }} &middot; {{ formatDate(file.addedAt) }}</span>
        </div>
        <button
          class="delete-btn"
          title="Remove from library"
          @click.stop="deleteCachedFile(file.name)"
        >
          &times;
        </button>
      </div>
    </div>
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
