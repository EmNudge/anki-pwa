<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  error?: boolean;
  errorMessage?: string;
  label?: string;
  helperText?: string;
  id?: string;
  modelValue?: string | number;
}>(), {
  error: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const inputId = computed(() => props.id ?? `input-${Math.random().toString(36).slice(2, 11)}`);

const inputClasses = computed(() =>
  ["ds-input", props.error ? "ds-input--error" : undefined]
    .filter(Boolean)
    .join(" ")
);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="ds-input-wrapper">
    <label v-if="label" class="ds-input-label" :for="inputId">
      {{ label }}
    </label>
    <input
      :id="inputId"
      :class="inputClasses"
      :value="modelValue"
      @input="onInput"
      v-bind="$attrs"
    />
    <span v-if="error && errorMessage" class="ds-input-error-message">{{ errorMessage }}</span>
    <span v-if="!error && helperText" class="ds-input-helper-text">{{ helperText }}</span>
  </div>
</template>

<style scoped>
.ds-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.ds-input-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.ds-input {
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
}

.ds-input::placeholder { color: var(--color-text-tertiary); }
.ds-input:hover:not(:disabled) { border-color: var(--color-border-hover); }
.ds-input:focus { outline: none; border-color: var(--color-border-focus); box-shadow: var(--shadow-focus-ring); }
.ds-input:disabled { opacity: 0.5; cursor: not-allowed; }
.ds-input--error { border-color: var(--color-error-500); }
.ds-input--error:focus { border-color: var(--color-error-500); box-shadow: var(--shadow-focus-ring-error); }
.ds-input-helper-text { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.ds-input-error-message { font-size: var(--font-size-xs); color: var(--color-error-500); }
</style>
