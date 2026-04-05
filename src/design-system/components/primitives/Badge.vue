<script setup lang="ts">
import { computed } from "vue";

export type BadgeVariant = "success" | "error" | "warning" | "neutral" | "primary";
export type BadgeSize = "sm" | "md" | "lg";
export type BadgeStyle = "filled" | "outlined" | "soft";

const props = withDefaults(
  defineProps<{
    variant?: BadgeVariant;
    size?: BadgeSize;
    badgeStyle?: BadgeStyle;
  }>(),
  {
    variant: "neutral",
    size: "md",
    badgeStyle: "filled",
  },
);

const classes = computed(() =>
  ["ds-badge", `ds-badge--${props.size}`, `ds-badge--${props.variant}-${props.badgeStyle}`].join(
    " ",
  ),
);
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>

<style scoped>
.ds-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  font-family: var(--font-family-sans);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  border: 1px solid transparent;
}

.ds-badge--sm {
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-tight);
}

.ds-badge--md {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
}

.ds-badge--lg {
  padding: var(--spacing-1-5) var(--spacing-4);
  font-size: var(--font-size-base);
  line-height: var(--line-height-tight);
}

.ds-badge--success-filled {
  background: var(--color-success-500);
  color: white;
}
.ds-badge--success-outlined {
  background: transparent;
  color: var(--color-success-600);
  border-color: var(--color-success-500);
}
.ds-badge--success-soft {
  background: var(--color-success-100);
  color: var(--color-success-700);
}
.ds-badge--error-filled {
  background: var(--color-error-500);
  color: white;
}
.ds-badge--error-outlined {
  background: transparent;
  color: var(--color-error-600);
  border-color: var(--color-error-500);
}
.ds-badge--error-soft {
  background: var(--color-error-100);
  color: var(--color-error-700);
}
.ds-badge--warning-filled {
  background: var(--color-warning-500);
  color: white;
}
.ds-badge--warning-outlined {
  background: transparent;
  color: var(--color-warning-600);
  border-color: var(--color-warning-500);
}
.ds-badge--warning-soft {
  background: var(--color-warning-100);
  color: var(--color-warning-700);
}
.ds-badge--neutral-filled {
  background: var(--color-neutral-500);
  color: white;
}
.ds-badge--neutral-outlined {
  background: transparent;
  color: var(--color-text-primary);
  border-color: var(--color-border);
}
.ds-badge--neutral-soft {
  background: var(--color-neutral-200);
  color: var(--color-neutral-700);
}
.ds-badge--primary-filled {
  background: var(--color-primary-500);
  color: white;
}
.ds-badge--primary-outlined {
  background: transparent;
  color: var(--color-primary-600);
  border-color: var(--color-primary-500);
}
.ds-badge--primary-soft {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
}
</style>
