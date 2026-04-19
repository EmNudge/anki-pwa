<script setup lang="ts">
import { computed } from "vue";

type InputSize = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    size?: InputSize;
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
  "update:modelValue": [value: string | number];
}>();

const classes = computed(() =>
  [
    "ds-input",
    `ds-input--${props.size}`,
    props.error ? "ds-input--error" : undefined,
    props.fullWidth ? "ds-input--full-width" : undefined,
  ]
    .filter(Boolean)
    .join(" "),
);

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  emit("update:modelValue", target.type === "number" ? target.valueAsNumber : target.value);
}
</script>

<template>
  <input :class="classes" :value="modelValue" v-bind="$attrs" @input="onInput" />
</template>

<style scoped>
.ds-input {
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
}

.ds-input::placeholder {
  color: var(--color-text-tertiary);
}

.ds-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.ds-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ds-input--error {
  border-color: var(--color-error-500);
}

.ds-input--error:focus {
  border-color: var(--color-error-500);
  box-shadow: var(--shadow-focus-ring-error);
}

.ds-input--sm {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
}

.ds-input--md {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-sm);
}

.ds-input--lg {
  padding: var(--spacing-3) var(--spacing-4);
  font-size: var(--font-size-base);
}

.ds-input--full-width {
  width: 100%;
}
</style>
