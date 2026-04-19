<script setup lang="ts">
import { computed } from "vue";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "warning";
type ButtonSize = "xs" | "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    loading?: boolean;
    disabled?: boolean;
    square?: boolean;
  }>(),
  {
    variant: "primary",
    size: "md",
    fullWidth: false,
    loading: false,
    disabled: false,
    square: false,
  },
);

const classes = computed(() =>
  [
    "ds-button",
    `ds-button--${props.variant}`,
    `ds-button--${props.size}`,
    props.fullWidth ? "ds-button--full-width" : undefined,
    props.square ? "ds-button--square" : undefined,
  ]
    .filter(Boolean)
    .join(" "),
);
</script>

<template>
  <button :class="classes" :disabled="disabled || loading" v-bind="$attrs">
    <span v-if="loading" class="ds-button-spinner" aria-label="Loading" />
    <slot v-if="!loading" name="iconLeft" />
    <slot />
    <slot v-if="!loading" name="iconRight" />
  </button>
</template>

<style scoped>
.ds-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-family-sans);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: var(--transition-colors);
  white-space: nowrap;
  user-select: none;
}

.ds-button:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
  box-shadow: var(--shadow-focus-ring);
}
.ds-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ds-button--primary {
  background: color-mix(in srgb, var(--color-primary-500) 14%, transparent);
  color: var(--color-primary-500);
  border-color: color-mix(in srgb, var(--color-primary-500) 25%, transparent);
}
.ds-button--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary-500) 22%, transparent);
  border-color: color-mix(in srgb, var(--color-primary-500) 35%, transparent);
}
.ds-button--primary:active:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary-500) 30%, transparent);
  border-color: color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
.ds-button--secondary {
  background: transparent;
  color: var(--color-text-primary);
  border-color: var(--color-border);
}
.ds-button--secondary:hover:not(:disabled) {
  background: var(--color-surface-elevated);
  border-color: var(--color-border-hover);
}
.ds-button--secondary:active:not(:disabled) {
  background: var(--color-surface);
}
.ds-button--ghost {
  background: transparent;
  color: var(--color-text-primary);
  border-color: transparent;
}
.ds-button--ghost:hover:not(:disabled) {
  background: var(--color-surface);
}
.ds-button--ghost:active:not(:disabled) {
  background: var(--color-surface-elevated);
}
.ds-button--danger {
  background: color-mix(in srgb, var(--color-error-500) 14%, transparent);
  color: var(--color-error-500);
  border-color: color-mix(in srgb, var(--color-error-500) 25%, transparent);
}
.ds-button--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error-500) 22%, transparent);
  border-color: color-mix(in srgb, var(--color-error-500) 35%, transparent);
}
.ds-button--danger:active:not(:disabled) {
  background: color-mix(in srgb, var(--color-error-500) 30%, transparent);
  border-color: color-mix(in srgb, var(--color-error-500) 40%, transparent);
}
.ds-button--danger-outline {
  background: transparent;
  color: var(--color-error-500);
  border-color: var(--color-error-500);
}
.ds-button--danger-outline:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error-500) 10%, transparent);
}
.ds-button--danger-outline:active:not(:disabled) {
  background: color-mix(in srgb, var(--color-error-500) 16%, transparent);
}
.ds-button--warning {
  background: color-mix(in srgb, var(--color-warning-500) 14%, transparent);
  color: var(--color-warning-600);
  border-color: color-mix(in srgb, var(--color-warning-500) 25%, transparent);
}
.ds-button--warning:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-warning-500) 22%, transparent);
  border-color: color-mix(in srgb, var(--color-warning-500) 35%, transparent);
}
.ds-button--warning:active:not(:disabled) {
  background: color-mix(in srgb, var(--color-warning-500) 30%, transparent);
  border-color: color-mix(in srgb, var(--color-warning-500) 40%, transparent);
}

.ds-button--xs {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-tight);
}
.ds-button--sm {
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
}
.ds-button--md {
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--font-size-base);
  line-height: var(--line-height-normal);
}
.ds-button--lg {
  padding: var(--spacing-3) var(--spacing-6);
  font-size: var(--font-size-lg);
  line-height: var(--line-height-normal);
}

.ds-button--full-width {
  width: 100%;
}
.ds-button--square {
  padding: 0;
  aspect-ratio: 1;
}
.ds-button--square.ds-button--xs {
  width: 24px;
}
.ds-button--square.ds-button--sm {
  width: 28px;
}
.ds-button--square.ds-button--md {
  width: 32px;
}
.ds-button--square.ds-button--lg {
  width: 40px;
}

.ds-button-spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
