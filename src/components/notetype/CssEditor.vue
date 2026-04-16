<script setup lang="ts">
defineProps<{
  css: string;
}>();

const emit = defineEmits<{
  updateCss: [css: string];
}>();
</script>

<template>
  <div class="css-editor">
    <label class="css-label">Card Styling (CSS)</label>
    <textarea
      class="css-textarea"
      :value="css"
      @input="emit('updateCss', ($event.target as HTMLTextAreaElement).value)"
      spellcheck="false"
      placeholder="Enter CSS styles for cards..."
    />
  </div>
</template>

<style scoped>
.css-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.css-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.css-textarea {
  min-height: 300px;
  padding: var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  background: var(--color-surface);
  color: var(--color-text-primary);
  resize: vertical;
  tab-size: 2;
}

.css-textarea:focus {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -1px;
}
</style>
