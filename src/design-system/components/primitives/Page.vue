<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="ds-page">
    <div class="ds-page__header" v-if="title || $slots.title">
      <slot name="title">
        <h2 class="ds-page__title">{{ title }}</h2>
      </slot>
    </div>
    <div class="ds-page__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ds-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: var(--spacing-8) var(--spacing-4);
  padding-top: none;

  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.ds-page__title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.ds-page__content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}
</style>
