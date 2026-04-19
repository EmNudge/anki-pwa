<script setup lang="ts">
import { computed } from "vue";

type CheckboxSize = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    size?: CheckboxSize;
    label?: string;
  }>(),
  {
    modelValue: false,
    size: "md",
    label: undefined,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const classes = computed(() => ["ds-checkbox", `ds-checkbox--${props.size}`].join(" "));

function onChange(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <label :class="classes">
    <input
      type="checkbox"
      class="ds-checkbox-input"
      :checked="modelValue"
      v-bind="$attrs"
      @change="onChange"
    />
    <span v-if="label || $slots.default" class="ds-checkbox-label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.ds-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  cursor: pointer;
  user-select: none;
}

.ds-checkbox-input {
  accent-color: var(--color-primary);
  cursor: pointer;
  margin: 0;
}

.ds-checkbox-label {
  color: var(--color-text-primary);
  font-family: var(--font-family-sans);
}

.ds-checkbox--sm {
  font-size: var(--font-size-xs);
}

.ds-checkbox--sm .ds-checkbox-input {
  width: 14px;
  height: 14px;
}

.ds-checkbox--md {
  font-size: var(--font-size-sm);
}

.ds-checkbox--md .ds-checkbox-input {
  width: 16px;
  height: 16px;
}

.ds-checkbox--lg {
  font-size: var(--font-size-base);
}

.ds-checkbox--lg .ds-checkbox-input {
  width: 18px;
  height: 18px;
}
</style>
