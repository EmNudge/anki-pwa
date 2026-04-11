<script setup lang="ts">
import { ref, watch } from "vue";
import Modal from "../design-system/components/primitives/Modal.vue";
import Button from "../design-system/components/primitives/Button.vue";
import TiptapEditor from "./TiptapEditor.vue";
import type { AnkiDB2Data } from "../ankiParser/anki2";

type Card = AnkiDB2Data["cards"][number];

const props = defineProps<{
  isOpen: boolean;
  card: Card | null;
  mediaFiles?: Map<string, string>;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: { fields: Record<string, string | null>; tags: string[] }];
}>();

const editFields = ref<Record<string, string>>({});
const editTags = ref<string[]>([]);
const newTagInput = ref("");

watch(
  () => props.isOpen,
  (open) => {
    if (!open || !props.card) return;
    // Deep-copy field values (convert null to "")
    const fields: Record<string, string> = {};
    for (const [key, val] of Object.entries(props.card.values)) {
      fields[key] = val ?? "";
    }
    editFields.value = fields;
    editTags.value = [...props.card.tags];
    newTagInput.value = "";
  },
);

function addTag() {
  const tag = newTagInput.value.trim();
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag);
  }
  newTagInput.value = "";
}

function removeTag(index: number) {
  editTags.value.splice(index, 1);
}

function handleTagKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    addTag();
  }
}

function handleSave() {
  const fields: Record<string, string | null> = {};
  for (const [key, val] of Object.entries(editFields.value)) {
    fields[key] = val || null;
  }
  emit("save", { fields, tags: [...editTags.value] });
}
</script>

<template>
  <Modal :is-open="isOpen" title="Edit Note" size="lg" @close="emit('close')">
    <div class="edit-form">
      <div v-for="(val, key) in editFields" :key="key" class="field-group">
        <label class="field-label">{{ key }}</label>
        <TiptapEditor v-model="editFields[key]" :media-files="mediaFiles" />
      </div>

      <div class="tags-section">
        <label class="field-label">Tags</label>
        <div class="tags-list">
          <span v-for="(tag, i) in editTags" :key="tag" class="tag-badge">
            {{ tag }}
            <button class="tag-remove" @click="removeTag(i)">&times;</button>
          </span>
        </div>
        <div class="tag-add">
          <input
            v-model="newTagInput"
            type="text"
            class="tag-input"
            placeholder="Add tag..."
            @keydown="handleTagKeydown"
          />
          <Button variant="secondary" size="sm" @click="addTag">Add</Button>
        </div>
      </div>
    </div>

    <template #footer>
      <Button variant="secondary" @click="emit('close')">Cancel</Button>
      <Button variant="primary" @click="handleSave">Save</Button>
    </template>
  </Modal>
</template>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.field-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}


.tags-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-1);
}

.tag-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: 1px var(--spacing-1-5);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.tag-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--color-text-tertiary);
  background: none;
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.tag-remove:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.tag-add {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}

.tag-input {
  flex: 1;
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-sizing: border-box;
}

.tag-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}
</style>
