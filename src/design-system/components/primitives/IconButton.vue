<script setup lang="ts">
import { computed } from "vue";

export type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    variant?: IconButtonVariant;
    size?: IconButtonSize;
    shape?: "circle" | "square";
  }>(),
  {
    variant: "secondary",
    size: "md",
    shape: "circle",
  },
);

const classes = computed(() =>
  [
    "ds-icon-button",
    `ds-icon-button--${props.variant}`,
    `ds-icon-button--${props.size}`,
    `ds-icon-button--${props.shape}`,
  ].join(" "),
);
</script>

<template>
  <button :class="classes" v-bind="$attrs">
    <slot />
  </button>
</template>

<style scoped>
.ds-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  font-family: var(--font-family-sans);
  cursor: pointer;
  transition: var(--transition-colors);
  user-select: none;
}

.ds-icon-button:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
.ds-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ds-icon-button--primary {
  background: var(--color-primary-500);
  color: var(--color-text-inverse);
  border-color: var(--color-primary-500);
}
.ds-icon-button--primary:hover:not(:disabled) {
  background: var(--color-primary-600);
  border-color: var(--color-primary-600);
}
.ds-icon-button--secondary {
  background: transparent;
  color: var(--color-text-primary);
  border-color: var(--color-border);
}
.ds-icon-button--secondary:hover:not(:disabled) {
  background: var(--color-surface-elevated);
  border-color: var(--color-border-hover);
}
.ds-icon-button--ghost {
  background: transparent;
  color: var(--color-text-primary);
  border-color: transparent;
}
.ds-icon-button--ghost:hover:not(:disabled) {
  background: var(--color-surface);
}
.ds-icon-button--danger {
  background: var(--color-error-500);
  color: var(--color-text-inverse);
  border-color: var(--color-error-500);
}
.ds-icon-button--danger:hover:not(:disabled) {
  background: var(--color-error-600);
  border-color: var(--color-error-600);
}

.ds-icon-button--sm {
  width: 2rem;
  height: 2rem;
  font-size: var(--font-size-sm);
}
.ds-icon-button--md {
  width: 2.5rem;
  height: 2.5rem;
  font-size: var(--font-size-base);
}
.ds-icon-button--lg {
  width: 3rem;
  height: 3rem;
  font-size: var(--font-size-lg);
}

.ds-icon-button--circle {
  border-radius: var(--radius-full);
}
.ds-icon-button--square {
  border-radius: var(--radius-sm);
}
</style>
