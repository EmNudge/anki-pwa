<script setup lang="ts">
import { computed } from "vue";

export type ContainerSize = "sm" | "md" | "lg" | "xl" | "full";

const props = withDefaults(defineProps<{
  size?: ContainerSize;
  padding?: boolean;
}>(), {
  size: "lg",
  padding: true,
});

const classes = computed(() =>
  [
    "ds-container",
    `ds-container--${props.size}`,
    props.padding ? "ds-container--padding" : undefined,
  ].filter(Boolean).join(" ")
);
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>

<style scoped>
.ds-container { width: 100%; margin-left: auto; margin-right: auto; }
.ds-container--padding { padding-left: var(--spacing-4); padding-right: var(--spacing-4); }
.ds-container--sm { max-width: 640px; }
.ds-container--md { max-width: 768px; }
.ds-container--lg { max-width: 1024px; }
.ds-container--xl { max-width: 1280px; }
.ds-container--full { max-width: 100%; }
</style>
