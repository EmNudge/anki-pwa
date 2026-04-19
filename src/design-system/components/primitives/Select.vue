<script setup lang="ts">
import { computed } from "vue";

type SelectSize = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    size?: SelectSize;
    error?: boolean;
    fullWidth?: boolean;
  }>(),
  {
    modelValue: "",
    size: "md",
    error: false,
    fullWidth: true,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const classes = computed(() =>
  [
    "ds-select",
    `ds-select--${props.size}`,
    props.error ? "ds-select--error" : undefined,
    props.fullWidth ? "ds-select--full-width" : undefined,
  ]
    .filter(Boolean)
    .join(" "),
);

function onChange(e: Event) {
  emit("update:modelValue", (e.target as HTMLSelectElement).value);
}
</script>

<template>
  <select :class="classes" :value="modelValue" v-bind="$attrs" @change="onChange">
    <slot />
  </select>
</template>

<style scoped>
.ds-select {
  display: block;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
  transition: var(--transition-colors);
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--spacing-2) center;
  padding-right: var(--spacing-8);
}

.ds-select:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.ds-select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ds-select--error {
  border-color: var(--color-error-500);
}

.ds-select--error:focus {
  border-color: var(--color-error-500);
  box-shadow: var(--shadow-focus-ring-error);
}

.ds-select--sm {
  padding: var(--spacing-1) var(--spacing-2);
  padding-right: var(--spacing-7);
  font-size: var(--font-size-xs);
}

.ds-select--md {
  padding: var(--spacing-2) var(--spacing-3);
  padding-right: var(--spacing-8);
  font-size: var(--font-size-sm);
}

.ds-select--lg {
  padding: var(--spacing-3) var(--spacing-4);
  padding-right: var(--spacing-10);
  font-size: var(--font-size-base);
}

.ds-select--full-width {
  width: 100%;
}
</style>
