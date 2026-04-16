<script setup lang="ts">
import { ref } from "vue";
import { GripVertical, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-vue-next";
import Button from "~/design-system/components/primitives/Button.vue";
import type { Anki21bFieldConfig } from "~/ankiParser/anki21b/proto";

export interface FieldEntry {
  ord: number;
  name: string;
  config: Anki21bFieldConfig;
}

const props = defineProps<{
  fields: FieldEntry[];
}>();

const emit = defineEmits<{
  addField: [name: string, ord: number];
  removeField: [ord: number];
  renameField: [ord: number, newName: string];
  reorderFields: [newOrdering: number[]];
  updateFieldConfig: [ord: number, updates: Partial<Anki21bFieldConfig>];
}>();

const editingField = ref<number | null>(null);
const editName = ref("");
const expandedField = ref<number | null>(null);
const newFieldName = ref("");
const showAddField = ref(false);
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

function startRename(field: FieldEntry) {
  editingField.value = field.ord;
  editName.value = field.name;
}

function commitRename(ord: number) {
  const trimmed = editName.value.trim();
  if (trimmed && trimmed !== props.fields.find((f) => f.ord === ord)?.name) {
    emit("renameField", ord, trimmed);
  }
  editingField.value = null;
}

function handleAdd() {
  const name = newFieldName.value.trim();
  if (!name) return;
  emit("addField", name, props.fields.length);
  newFieldName.value = "";
  showAddField.value = false;
}

function toggleExpand(ord: number) {
  expandedField.value = expandedField.value === ord ? null : ord;
}

function handleDragStart(idx: number) {
  dragIndex.value = idx;
}

function handleDragOver(e: DragEvent, idx: number) {
  e.preventDefault();
  dragOverIndex.value = idx;
}

function handleDrop(idx: number) {
  if (dragIndex.value === null || dragIndex.value === idx) {
    dragIndex.value = null;
    dragOverIndex.value = null;
    return;
  }
  // Build new ordering
  const ordering = props.fields.map((_, i) => i);
  const [moved] = ordering.splice(dragIndex.value, 1);
  ordering.splice(idx, 0, moved!);
  emit("reorderFields", ordering);
  dragIndex.value = null;
  dragOverIndex.value = null;
}

function handleDragEnd() {
  dragIndex.value = null;
  dragOverIndex.value = null;
}
</script>

<template>
  <div class="field-editor">
    <div class="field-list">
      <div
        v-for="(field, idx) in fields"
        :key="field.ord"
        :class="['field-item', { 'field-item--drag-over': dragOverIndex === idx }]"
        draggable="true"
        @dragstart="handleDragStart(idx)"
        @dragover="(e) => handleDragOver(e, idx)"
        @drop="handleDrop(idx)"
        @dragend="handleDragEnd"
      >
        <div class="field-row">
          <GripVertical :size="14" class="drag-handle" />
          <span class="field-ord">{{ idx + 1 }}</span>

          <template v-if="editingField === field.ord">
            <input
              v-model="editName"
              class="field-name-input"
              @keydown.enter="commitRename(field.ord)"
              @keydown.escape="editingField = null"
              @blur="commitRename(field.ord)"
              autofocus
            />
          </template>
          <template v-else>
            <span class="field-name" @dblclick="startRename(field)">{{ field.name }}</span>
          </template>

          <div class="field-actions">
            <button
              class="icon-btn"
              title="Toggle options"
              @click="toggleExpand(field.ord)"
            >
              <ChevronDown v-if="expandedField === field.ord" :size="14" />
              <ChevronRight v-else :size="14" />
            </button>
            <button
              class="icon-btn icon-btn--danger"
              title="Remove field"
              :disabled="fields.length <= 1"
              @click="emit('removeField', field.ord)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div v-if="expandedField === field.ord" class="field-options">
          <label class="option-row">
            <input
              type="checkbox"
              :checked="field.config.rtl"
              @change="emit('updateFieldConfig', field.ord, { rtl: !field.config.rtl })"
            />
            <span>Right-to-left</span>
          </label>
          <label class="option-row">
            <input
              type="checkbox"
              :checked="field.config.sticky"
              @change="emit('updateFieldConfig', field.ord, { sticky: !field.config.sticky })"
            />
            <span>Sticky (remember last input)</span>
          </label>
          <label class="option-row">
            <input
              type="checkbox"
              :checked="field.config.plainText"
              @change="emit('updateFieldConfig', field.ord, { plainText: !field.config.plainText })"
            />
            <span>Plain text (no HTML)</span>
          </label>
          <label class="option-row">
            <input
              type="checkbox"
              :checked="field.config.excludeFromSearch"
              @change="emit('updateFieldConfig', field.ord, { excludeFromSearch: !field.config.excludeFromSearch })"
            />
            <span>Exclude from search</span>
          </label>
          <div class="option-row">
            <label>
              Description
              <input
                type="text"
                class="desc-input"
                :value="field.config.description"
                placeholder="Field description..."
                @change="emit('updateFieldConfig', field.ord, { description: ($event.target as HTMLInputElement).value })"
              />
            </label>
          </div>
          <div class="option-row">
            <label>
              Font
              <input
                type="text"
                class="desc-input"
                :value="field.config.fontName"
                @change="emit('updateFieldConfig', field.ord, { fontName: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              Size
              <input
                type="number"
                class="size-input"
                :value="field.config.fontSize"
                min="8"
                max="72"
                @change="emit('updateFieldConfig', field.ord, { fontSize: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showAddField" class="add-field-form">
      <input
        v-model="newFieldName"
        class="field-name-input"
        placeholder="Field name..."
        @keydown.enter="handleAdd"
        @keydown.escape="showAddField = false"
        autofocus
      />
      <Button size="sm" @click="handleAdd">Add</Button>
      <Button size="sm" variant="ghost" @click="showAddField = false">Cancel</Button>
    </div>

    <Button v-else size="sm" variant="secondary" @click="showAddField = true">
      <template #iconLeft><Plus :size="14" /></template>
      Add Field
    </Button>
  </div>
</template>

<style scoped>
.field-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.field-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.field-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  transition: var(--transition-colors);
}

.field-item--drag-over {
  border-color: var(--color-primary-500);
  background: var(--color-surface-elevated);
}

.field-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
}

.drag-handle {
  cursor: grab;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.field-ord {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  min-width: 1.5em;
  text-align: center;
}

.field-name {
  flex: 1;
  font-weight: var(--font-weight-medium);
  cursor: default;
}

.field-name-input {
  flex: 1;
  padding: var(--spacing-1) var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.field-actions {
  display: flex;
  gap: var(--spacing-1);
  align-items: center;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
  padding: 0;
  box-shadow: none;
}

.icon-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.icon-btn--danger:hover:not(:disabled) {
  color: var(--color-error-500);
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.field-options {
  padding: var(--spacing-2) var(--spacing-3) var(--spacing-3) var(--spacing-8);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.option-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.option-row input[type="checkbox"] {
  accent-color: var(--color-primary-500);
}

.desc-input {
  padding: var(--spacing-1) var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  flex: 1;
  margin-left: var(--spacing-2);
}

.size-input {
  width: 60px;
  padding: var(--spacing-1) var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  margin-left: var(--spacing-2);
}

.add-field-form {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}
</style>
