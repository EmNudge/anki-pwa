<script setup lang="ts">
import { type AppView, activeViewSig, reviewModeSig } from "../stores";

const tabs: { id: AppView; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "browse", label: "Browse" },
  { id: "create", label: "Create Deck" },
  { id: "sync", label: "Sync" },
];

function handleTabClick(tabId: AppView) {
  if (tabId === "review" && activeViewSig.value === "review") {
    reviewModeSig.value = "deck-list";
  } else {
    activeViewSig.value = tabId;
  }
}
</script>

<template>
  <nav class="status-bar">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { 'tab--active': activeViewSig === tab.id }]"
        @click="handleTabClick(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
  </nav>
</template>

<style scoped>
.status-bar {
  position: sticky;
  top: 0;
  z-index: var(--z-index-sticky);
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 var(--spacing-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.tabs {
  display: flex;
  gap: var(--spacing-1);
}

.tab {
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.tab:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.tab--active {
  color: var(--color-primary);
  background: var(--color-surface-elevated);
}
</style>
