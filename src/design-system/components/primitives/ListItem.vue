<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    clickable?: boolean;
  }>(),
  {
    active: false,
    clickable: true,
  },
);

const classes = computed(() =>
  [
    "ds-list-item",
    props.active ? "ds-list-item--active" : undefined,
    props.clickable ? "ds-list-item--clickable" : undefined,
  ]
    .filter(Boolean)
    .join(" "),
);
</script>

<template>
  <div :class="classes">
    <div class="ds-list-item__content">
      <slot />
    </div>
    <div v-if="$slots.actions" class="ds-list-item__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ds-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: var(--transition-colors);
}

.ds-list-item--clickable {
  cursor: pointer;
}

.ds-list-item--clickable:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-hover);
}

.ds-list-item--active {
  border-color: var(--color-primary);
  background: var(--color-surface-elevated);
}

.ds-list-item__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ds-list-item__actions {
  display: flex;
  gap: var(--spacing-1);
  flex-shrink: 0;
  align-items: center;
}
</style>
