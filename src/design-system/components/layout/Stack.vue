<script setup lang="ts">
import { computed } from "vue";

export type StackDirection = "vertical" | "horizontal";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between" | "around";
export type StackSpacing = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "8" | "10" | "12";

const props = withDefaults(defineProps<{
  direction?: StackDirection;
  align?: StackAlign;
  justify?: StackJustify;
  spacing?: StackSpacing;
  wrap?: boolean;
}>(), {
  direction: "vertical",
  spacing: "4",
});

const classes = computed(() =>
  [
    "ds-stack",
    `ds-stack--${props.direction}`,
    `ds-stack--spacing-${props.spacing}`,
    props.align ? `ds-stack--align-${props.align}` : undefined,
    props.justify ? `ds-stack--justify-${props.justify}` : undefined,
    props.wrap ? "ds-stack--wrap" : undefined,
  ].filter(Boolean).join(" ")
);
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>

<style scoped>
.ds-stack { display: flex; }
.ds-stack--vertical { flex-direction: column; }
.ds-stack--horizontal { flex-direction: row; }
.ds-stack--wrap { flex-wrap: wrap; }
.ds-stack--align-start { align-items: flex-start; }
.ds-stack--align-center { align-items: center; }
.ds-stack--align-end { align-items: flex-end; }
.ds-stack--align-stretch { align-items: stretch; }
.ds-stack--justify-start { justify-content: flex-start; }
.ds-stack--justify-center { justify-content: center; }
.ds-stack--justify-end { justify-content: flex-end; }
.ds-stack--justify-between { justify-content: space-between; }
.ds-stack--justify-around { justify-content: space-around; }
.ds-stack--spacing-0 { gap: var(--spacing-0); }
.ds-stack--spacing-1 { gap: var(--spacing-1); }
.ds-stack--spacing-2 { gap: var(--spacing-2); }
.ds-stack--spacing-3 { gap: var(--spacing-3); }
.ds-stack--spacing-4 { gap: var(--spacing-4); }
.ds-stack--spacing-5 { gap: var(--spacing-5); }
.ds-stack--spacing-6 { gap: var(--spacing-6); }
.ds-stack--spacing-8 { gap: var(--spacing-8); }
.ds-stack--spacing-10 { gap: var(--spacing-10); }
.ds-stack--spacing-12 { gap: var(--spacing-12); }
</style>
