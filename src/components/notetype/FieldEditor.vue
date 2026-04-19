<script setup lang="ts">
import { ref } from "vue";
import { GripVertical, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-vue-next";
import { Button, Checkbox, TextInput } from "~/design-system";
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
            <TextInput
              v-model="editName"
              size="sm"
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
            <Button
              variant="ghost"
              size="sm"
              square
              title="Toggle options"
              @click="toggleExpand(field.ord)"
            >
              <ChevronDown v-if="expandedField === field.ord" :size="14" />
              <ChevronRight v-else :size="14" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              square
              title="Remove field"
              :disabled="fields.length <= 1"
              @click="emit('removeField', field.ord)"
            >
              <Trash2 :size="14" />
            </Button>
          </div>
        </div>

        <div v-if="expandedField === field.ord" class="field-options">
          <div class="option-row">
            <Checkbox
              :model-value="field.config.rtl"
              size="sm"
              label="Right-to-left"
              @update:model-value="emit('updateFieldConfig', field.ord, { rtl: !field.config.rtl })"
            />
          </div>
          <div class="option-row">
            <Checkbox
              :model-value="field.config.sticky"
              size="sm"
              label="Sticky (remember last input)"
              @update:model-value="
                emit('updateFieldConfig', field.ord, { sticky: !field.config.sticky })
              "
            />
          </div>
          <div class="option-row">
            <Checkbox
              :model-value="field.config.plainText"
              size="sm"
              label="Plain text (no HTML)"
              @update:model-value="
                emit('updateFieldConfig', field.ord, { plainText: !field.config.plainText })
              "
            />
          </div>
          <div class="option-row">
            <Checkbox
              :model-value="field.config.excludeFromSearch"
              size="sm"
              label="Exclude from search"
              @update:model-value="
                emit('updateFieldConfig', field.ord, {
                  excludeFromSearch: !field.config.excludeFromSearch,
                })
              "
            />
          </div>
          <div class="option-row">
            <label>
              Description
              <TextInput
                size="sm"
                class="desc-input"
                :model-value="field.config.description"
                placeholder="Field description..."
                @update:model-value="
                  emit('updateFieldConfig', field.ord, {
                    description: $event,
                  })
                "
              />
            </label>
          </div>
          <div class="option-row">
            <label>
              Font
              <TextInput
                size="sm"
                class="desc-input"
                :model-value="field.config.fontName"
                @update:model-value="
                  emit('updateFieldConfig', field.ord, {
                    fontName: $event,
                  })
                "
              />
            </label>
            <label>
              Size
              <TextInput
                size="sm"
                class="size-input"
                type="number"
                :model-value="String(field.config.fontSize)"
                min="8"
                max="72"
                @update:model-value="
                  emit('updateFieldConfig', field.ord, {
                    fontSize: Number($event),
                  })
                "
              />
            </label>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showAddField" class="add-field-form">
      <TextInput
        v-model="newFieldName"
        size="sm"
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

.field-actions {
  display: flex;
  gap: var(--spacing-1);
  align-items: center;
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

.desc-input {
  flex: 1;
  margin-left: var(--spacing-2);
}

.size-input {
  width: 60px;
  margin-left: var(--spacing-2);
}

.add-field-form {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}
</style>
