<script setup lang="ts">
import { computed } from "vue";

export type GridColumns = "1" | "2" | "3" | "4" | "6" | "12";
export type GridGap = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "8" | "10" | "12";

const props = withDefaults(
  defineProps<{
    columns?: GridColumns;
    gap?: GridGap;
  }>(),
  {
    columns: "1",
    gap: "4",
  },
);

const classes = computed(() =>
  ["ds-grid", `ds-grid--cols-${props.columns}`, `ds-grid--gap-${props.gap}`].join(" "),
);
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>

<style scoped>
.ds-grid {
  display: grid;
}
.ds-grid--cols-1 {
  grid-template-columns: repeat(1, minmax(0, 1fr));
}
.ds-grid--cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ds-grid--cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.ds-grid--cols-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.ds-grid--cols-6 {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.ds-grid--cols-12 {
  grid-template-columns: repeat(12, minmax(0, 1fr));
}
.ds-grid--gap-0 {
  gap: var(--spacing-0);
}
.ds-grid--gap-1 {
  gap: var(--spacing-1);
}
.ds-grid--gap-2 {
  gap: var(--spacing-2);
}
.ds-grid--gap-3 {
  gap: var(--spacing-3);
}
.ds-grid--gap-4 {
  gap: var(--spacing-4);
}
.ds-grid--gap-5 {
  gap: var(--spacing-5);
}
.ds-grid--gap-6 {
  gap: var(--spacing-6);
}
.ds-grid--gap-8 {
  gap: var(--spacing-8);
}
.ds-grid--gap-10 {
  gap: var(--spacing-10);
}
.ds-grid--gap-12 {
  gap: var(--spacing-12);
}
</style>
