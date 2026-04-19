<script setup lang="ts">
defineProps<{
  summary: string;
}>();
</script>

<template>
  <details class="ds-disclosure">
    <summary class="ds-disclosure__summary">{{ summary }}</summary>
    <div class="ds-disclosure__content">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.ds-disclosure {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.ds-disclosure__summary {
  cursor: pointer;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  user-select: none;
}

.ds-disclosure__content {
  padding-top: var(--spacing-3);
  line-height: var(--line-height-normal);
}
</style>
