<script setup lang="ts">
import { computed } from "vue";

type AlertVariant = "info" | "success" | "error" | "warning";

const props = withDefaults(
  defineProps<{
    variant?: AlertVariant;
  }>(),
  {
    variant: "info",
  },
);

const classes = computed(() => `ds-alert ds-alert--${props.variant}`);
</script>

<template>
  <div :class="classes" role="alert">
    <slot />
  </div>
</template>

<style scoped>
.ds-alert {
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  border-radius: var(--radius-md);
  line-height: var(--line-height-normal);
}

.ds-alert--info {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
}

.ds-alert--success {
  color: var(--color-success-600);
  background: color-mix(in srgb, var(--color-success-500) 8%, var(--color-surface));
}

.ds-alert--error {
  color: var(--color-error-500);
  background: color-mix(in srgb, var(--color-error-500) 8%, var(--color-surface));
}

.ds-alert--warning {
  color: var(--color-warning-600);
  background: color-mix(in srgb, var(--color-warning-500) 8%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-warning-500) 30%, var(--color-border));
}
</style>
