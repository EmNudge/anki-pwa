<script setup lang="ts">
import { computed } from "vue";

export type CardVariant = "flat" | "elevated" | "outlined";
export type CardPadding = "none" | "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    variant?: CardVariant;
    padding?: CardPadding;
  }>(),
  {
    variant: "elevated",
    padding: "md",
  },
);

const classes = computed(() =>
  ["ds-card", `ds-card--${props.variant}`, `ds-card--padding-${props.padding}`].join(" "),
);
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>

<style scoped>
.ds-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
}
.ds-card--flat {
  border: none;
  box-shadow: none;
}
.ds-card--elevated {
  border: none;
  box-shadow: var(--shadow-base);
}
.ds-card--outlined {
  border: 1px solid var(--color-border);
  box-shadow: none;
}
.ds-card--padding-none {
  padding: 0;
}
.ds-card--padding-sm {
  padding: var(--spacing-3);
}
.ds-card--padding-md {
  padding: var(--spacing-4);
}
.ds-card--padding-lg {
  padding: var(--spacing-6);
}
</style>
