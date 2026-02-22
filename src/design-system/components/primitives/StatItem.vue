<script setup lang="ts">
defineProps<{
  label: string;
  value?: string | number;
}>();
</script>

<template>
  <div class="ds-stat-item">
    <div class="ds-stat-label">{{ label }}</div>
    <div class="ds-stat-value">
      <slot>{{ value }}</slot>
    </div>
  </div>
</template>

<style scoped>
.ds-stat-item {
  display: flex;
  justify-content: space-between;
  padding: var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.ds-stat-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.ds-stat-value {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}
</style>
