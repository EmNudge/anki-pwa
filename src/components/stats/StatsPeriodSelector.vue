<script setup lang="ts">
import type { StatsPeriod } from "../../stats/types";

const props = defineProps<{ modelValue: StatsPeriod }>();
const emit = defineEmits<{ "update:modelValue": [value: StatsPeriod] }>();

const periods: { value: StatsPeriod; label: string }[] = [
  { value: "1m", label: "1 Month" },
  { value: "3m", label: "3 Months" },
  { value: "1y", label: "1 Year" },
  { value: "all", label: "All Time" },
];
</script>

<template>
  <div class="period-selector">
    <button
      v-for="p in periods"
      :key="p.value"
      class="period-btn"
      :class="{ 'period-btn--active': props.modelValue === p.value }"
      @click="emit('update:modelValue', p.value)"
    >
      {{ p.label }}
    </button>
  </div>
</template>

<style scoped>
.period-selector {
  display: flex;
  gap: var(--spacing-1);
  background: var(--color-neutral-100);
  border-radius: var(--radius-lg);
  padding: var(--spacing-0-5);
}

.period-btn {
  padding: var(--spacing-1) var(--spacing-3);
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-neutral-600);
  cursor: pointer;
  transition: all 0.15s ease;
}

.period-btn:hover {
  color: var(--color-neutral-900);
}

.period-btn--active {
  background: var(--color-surface);
  color: var(--color-neutral-900);
  font-weight: var(--font-weight-medium);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
</style>
