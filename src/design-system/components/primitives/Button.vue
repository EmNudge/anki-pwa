<script setup lang="ts">
import { computed } from "vue";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
}>(), {
  variant: "primary",
  size: "md",
  fullWidth: false,
  loading: false,
  disabled: false,
});

const classes = computed(() =>
  [
    "ds-button",
    `ds-button--${props.variant}`,
    `ds-button--${props.size}`,
    props.fullWidth ? "ds-button--full-width" : undefined,
  ]
    .filter(Boolean)
    .join(" ")
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

.ds-button:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: 2px; box-shadow: var(--shadow-focus-ring); }
.ds-button:disabled { cursor: not-allowed; opacity: 0.5; }

.ds-button--primary { background: var(--color-primary-500); color: var(--color-text-inverse); border-color: var(--color-primary-500); }
.ds-button--primary:hover:not(:disabled) { background: var(--color-primary-600); border-color: var(--color-primary-600); }
.ds-button--primary:active:not(:disabled) { background: var(--color-primary-700); border-color: var(--color-primary-700); }
.ds-button--secondary { background: transparent; color: var(--color-text-primary); border-color: var(--color-border); }
.ds-button--secondary:hover:not(:disabled) { background: var(--color-surface-elevated); border-color: var(--color-border-hover); }
.ds-button--secondary:active:not(:disabled) { background: var(--color-surface); }
.ds-button--ghost { background: transparent; color: var(--color-text-primary); border-color: transparent; }
.ds-button--ghost:hover:not(:disabled) { background: var(--color-surface); }
.ds-button--ghost:active:not(:disabled) { background: var(--color-surface-elevated); }
.ds-button--danger { background: var(--color-error-500); color: var(--color-text-inverse); border-color: var(--color-error-500); }
.ds-button--danger:hover:not(:disabled) { background: var(--color-error-600); border-color: var(--color-error-600); }
.ds-button--danger:active:not(:disabled) { background: var(--color-error-700); border-color: var(--color-error-700); }

.ds-button--sm { padding: var(--spacing-1-5) var(--spacing-3); font-size: var(--font-size-sm); line-height: var(--line-height-tight); }
.ds-button--md { padding: var(--spacing-2) var(--spacing-4); font-size: var(--font-size-base); line-height: var(--line-height-normal); }
.ds-button--lg { padding: var(--spacing-3) var(--spacing-6); font-size: var(--font-size-lg); line-height: var(--line-height-normal); }

.ds-button--full-width { width: 100%; }

.ds-button-spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
