<script setup lang="ts">
import { watch, onUnmounted } from "vue";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const props = withDefaults(
  defineProps<{
    title?: string;
    isOpen: boolean;
    size?: ModalSize;
    showCloseButton?: boolean;
    closeOnClickOutside?: boolean;
  }>(),
  {
    size: "md",
    showCloseButton: true,
    closeOnClickOutside: true,
  },
);

const emit = defineEmits<{
  close: [];
}>();

let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

function addKeydownListener() {
  removeKeydownListener();
  keydownHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") emit("close");
  };
  window.addEventListener("keydown", keydownHandler);
}

function removeKeydownListener() {
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) addKeydownListener();
    else removeKeydownListener();
  },
  { immediate: true },
);

onUnmounted(removeKeydownListener);

function handleOverlayClick() {
  if (props.closeOnClickOutside) emit("close");
}

function handleContentClick(e: MouseEvent) {
  e.stopPropagation();
}
</script>

<template>
  <div v-if="isOpen" class="ds-modal-overlay" @click="handleOverlayClick">
    <div :class="['ds-modal', `ds-modal--${size}`]" @click="handleContentClick">
      <div v-if="title || showCloseButton" class="ds-modal__header">
        <h2 v-if="title" class="ds-modal__title">{{ title }}</h2>
        <div v-else />
        <button v-if="showCloseButton" class="ds-modal__close" @click="emit('close')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
            <path
              d="M289.94 256l95-95A24 24 0 0 0 351 127l-95 95l-95-95a24 24 0 0 0-34 34l95 95l-95 95a24 24 0 1 0 34 34l95-95l95 95a24 24 0 0 0 34-34z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      <div class="ds-modal__content">
        <slot />
      </div>

      <div v-if="$slots.footer" class="ds-modal__footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ds-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: var(--color-overlay);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-index-modal);
}

.ds-modal {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  z-index: calc(var(--z-index-modal) + 1);
}

.ds-modal--sm {
  width: 500px;
}
.ds-modal--md {
  width: 800px;
}
.ds-modal--lg {
  width: 1000px;
}
.ds-modal--xl {
  width: 1200px;
}

.ds-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
}

.ds-modal__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.ds-modal__content {
  padding: var(--spacing-8);
  overflow-y: auto;
  flex: 1;
}

.ds-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-3);
  padding: var(--spacing-4);
  border-top: 1px solid var(--color-border);
}

.ds-modal__close {
  background: none;
  color: var(--color-text-primary);
  border: none;
  cursor: pointer;
  transition: var(--transition-opacity);
  padding: var(--spacing-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ds-modal__close:hover {
  opacity: 0.7;
}
.ds-modal__close svg {
  width: 24px;
  height: 24px;
}
</style>
