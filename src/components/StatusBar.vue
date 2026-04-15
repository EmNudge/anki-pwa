<script setup lang="ts">
import { type AppView, activeViewSig, reviewModeSig } from "../stores";
import { canUndo, canRedo, undoDescription, redoDescription } from "../undoRedo";
import { executeUndo, executeRedo } from "../undoRedoExecutor";
import { Undo2, Redo2 } from "lucide-vue-next";
import Tooltip from "../design-system/components/primitives/Tooltip.vue";

const emit = defineEmits<{
  undoToast: [message: string];
}>();

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

async function handleUndo() {
  const desc = await executeUndo();
  if (desc) emit("undoToast", `Undo: ${desc}`);
}

async function handleRedo() {
  const desc = await executeRedo();
  if (desc) emit("undoToast", `Redo: ${desc}`);
}
</script>

<template>
  <nav class="status-bar">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { 'tab--active': activeViewSig === tab.id || (tab.id === 'browse' && activeViewSig === 'duplicates') }]"
        @click="handleTabClick(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="status-bar-actions">
      <Tooltip :text="undoDescription ? `Undo: ${undoDescription} (Ctrl+Z)` : 'Nothing to undo'">
        <button
          class="undo-redo-btn"
          :disabled="!canUndo"
          @click="handleUndo"
        >
          <Undo2 :size="16" />
        </button>
      </Tooltip>
      <Tooltip :text="redoDescription ? `Redo: ${redoDescription} (Ctrl+Shift+Z)` : 'Nothing to redo'">
        <button
          class="undo-redo-btn"
          :disabled="!canRedo"
          @click="handleRedo"
        >
          <Redo2 :size="16" />
        </button>
      </Tooltip>
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
  justify-content: space-between;
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

.status-bar-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
}

.undo-redo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.undo-redo-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.undo-redo-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.undo-redo-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}
</style>
