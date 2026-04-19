<script setup lang="ts">
import { computed } from "vue";

type TextareaSize = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    size?: TextareaSize;
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
    "ds-textarea",
    `ds-textarea--${props.size}`,
    props.error ? "ds-textarea--error" : undefined,
    props.fullWidth ? "ds-textarea--full-width" : undefined,
  ]
    .filter(Boolean)
    .join(" "),
);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <textarea :class="classes" :value="modelValue" v-bind="$attrs" @input="onInput" />
</template>

<style scoped>
.ds-textarea {
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
  resize: vertical;
  min-height: 80px;
}

.ds-textarea::placeholder {
  color: var(--color-text-tertiary);
}

.ds-textarea:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.ds-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ds-textarea--error {
  border-color: var(--color-error-500);
}

.ds-textarea--error:focus {
  border-color: var(--color-error-500);
  box-shadow: var(--shadow-focus-ring-error);
}

.ds-textarea--sm {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  min-height: 60px;
}

.ds-textarea--md {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-sm);
  min-height: 80px;
}

.ds-textarea--lg {
  padding: var(--spacing-3) var(--spacing-4);
  font-size: var(--font-size-base);
  min-height: 100px;
}

.ds-textarea--full-width {
  width: 100%;
}
</style>
