<script setup lang="ts">
import { Modal } from "../design-system/components";

defineProps<{
  isOpen: boolean;
  reason: string;
}>();

const emit = defineEmits<{
  close: [];
  "keep-local": [];
  "keep-remote": [];
}>();
</script>

<template>
  <Modal title="Sync Conflict" :is-open="isOpen" size="sm" @close="emit('close')">
    <div class="conflict-body">
      <p class="conflict-reason">{{ reason }}</p>

      <div class="conflict-options">
        <button class="conflict-option conflict-option--remote" @click="emit('keep-remote')">
          <div class="conflict-option__icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div class="conflict-option__text">
            <strong>Download from Server</strong>
            <span
              >Replace local collection with the server version. Any unsynced local changes will be
              lost.</span
            >
          </div>
        </button>

        <button class="conflict-option conflict-option--local" @click="emit('keep-local')">
          <div class="conflict-option__icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div class="conflict-option__text">
            <strong>Upload to Server</strong>
            <span
              >Replace the server collection with your local version. Any changes made on other
              devices will be overwritten.</span
            >
          </div>
        </button>
      </div>
    </div>

    <template #footer>
      <button class="conflict-cancel" @click="emit('close')">Cancel</button>
    </template>
  </Modal>
</template>

<style scoped>
.conflict-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.conflict-reason {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.conflict-options {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.conflict-option {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: var(--transition-colors);
}

.conflict-option:hover {
  background: var(--color-surface-hover);
}

.conflict-option--remote:hover {
  border-color: var(--color-primary);
}

.conflict-option--local:hover {
  border-color: #f59e0b;
}

.conflict-option__icon {
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.conflict-option__text {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.conflict-option__text strong {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.conflict-option__text span {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.conflict-cancel {
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
}

.conflict-cancel:hover {
  background: var(--color-surface-hover);
}
</style>
