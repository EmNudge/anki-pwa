<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  required?: boolean;
}>(), {
  required: false,
});

const classes = computed(() => ["ds-label"].filter(Boolean).join(" "));
</script>

<template>
  <label :class="classes">
    <slot />
    <span v-if="props.required" class="ds-label-required">*</span>
  </label>
</template>

<style scoped>
.ds-label {
  display: inline-block;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  line-height: var(--line-height-normal);
}

.ds-label-required {
  color: var(--color-error-500);
  margin-left: var(--spacing-1);
}
</style>
