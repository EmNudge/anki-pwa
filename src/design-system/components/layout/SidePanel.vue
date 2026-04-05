<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="ds-side-panel">
    <div class="ds-side-panel-header">
      <div class="ds-side-panel-title">{{ title }}</div>
      <slot name="headerAction" />
    </div>
    <div class="ds-side-panel-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ds-side-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}
.ds-side-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--spacing-2);
}
.ds-side-panel-title {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-lg);
}
.ds-side-panel-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}
</style>
