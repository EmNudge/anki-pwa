<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    error?: boolean;
    errorMessage?: string;
    label?: string;
    helperText?: string;
    id?: string;
    modelValue?: string | number;
  }>(),
  {
    error: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const selectId = computed(() => props.id ?? `select-${Math.random().toString(36).slice(2, 11)}`);

const selectClasses = computed(() =>
  ["ds-select", props.error ? "ds-select--error" : undefined].filter(Boolean).join(" "),
);

function onChange(e: Event) {
  emit("update:modelValue", (e.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="ds-select-wrapper">
    <label v-if="label" class="ds-select-label" :for="selectId">
      {{ label }}
    </label>
    <select
      :id="selectId"
      :class="selectClasses"
      :value="modelValue"
      @change="onChange"
      v-bind="$attrs"
    >
      <slot />
    </select>
    <span v-if="error && errorMessage" class="ds-select-error-message">{{ errorMessage }}</span>
    <span v-if="!error && helperText" class="ds-select-helper-text">{{ helperText }}</span>
  </div>
</template>

<style scoped>
.ds-select-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.ds-select-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.ds-select {
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: var(--font-family-sans);
  line-height: var(--line-height-normal);
  transition: var(--transition-colors);
  cursor: pointer;
}

.ds-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
}
.ds-select:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}
.ds-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ds-select--error {
  border-color: var(--color-error-500);
}
.ds-select--error:focus {
  border-color: var(--color-error-500);
  box-shadow: var(--shadow-focus-ring-error);
}
.ds-select-helper-text {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.ds-select-error-message {
  font-size: var(--font-size-xs);
  color: var(--color-error-500);
}
</style>
