<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Plus, Trash2 } from "lucide-vue-next";
import Button from "~/design-system/components/primitives/Button.vue";

export interface TemplateEntry {
  ord: number;
  name: string;
  qfmt: string;
  afmt: string;
}

const props = defineProps<{
  templates: TemplateEntry[];
  css: string;
  isCloze: boolean;
}>();

const emit = defineEmits<{
  updateTemplate: [ord: number, updates: { name?: string; qfmt?: string; afmt?: string }];
  addTemplate: [template: { name: string; qfmt: string; afmt: string }];
  removeTemplate: [ord: number];
}>();

const selectedOrd = ref(0);
const editSide = ref<"front" | "back">("front");

const selectedTemplate = computed(() =>
  props.templates.find((t) => t.ord === selectedOrd.value) ?? props.templates[0],
);

// Reset selection if current template is removed
watch(
  () => props.templates,
  (tmpls) => {
    if (!tmpls.find((t) => t.ord === selectedOrd.value) && tmpls.length > 0) {
      selectedOrd.value = tmpls[0]!.ord;
    }
  },
);

const editContent = computed({
  get: () => {
    if (!selectedTemplate.value) return "";
    return editSide.value === "front" ? selectedTemplate.value.qfmt : selectedTemplate.value.afmt;
  },
  set: (val: string) => {
    if (!selectedTemplate.value) return;
    if (editSide.value === "front") {
      emit("updateTemplate", selectedTemplate.value.ord, { qfmt: val });
    } else {
      emit("updateTemplate", selectedTemplate.value.ord, { afmt: val });
    }
  },
});

const editingName = ref(false);
const nameInput = ref("");

function startRenameTmpl() {
  if (!selectedTemplate.value) return;
  editingName.value = true;
  nameInput.value = selectedTemplate.value.name;
}

function commitRenameTmpl() {
  const trimmed = nameInput.value.trim();
  if (trimmed && selectedTemplate.value && trimmed !== selectedTemplate.value.name) {
    emit("updateTemplate", selectedTemplate.value.ord, { name: trimmed });
  }
  editingName.value = false;
}

function handleAddTemplate() {
  const nextNum = props.templates.length + 1;
  emit("addTemplate", {
    name: `Card ${nextNum}`,
    qfmt: "{{Front}}",
    afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}',
  });
}
</script>

<template>
  <div class="template-editor">
    <div class="template-selector">
      <div class="template-tabs">
        <button
          v-for="tmpl in templates"
          :key="tmpl.ord"
          :class="['tmpl-tab', { 'tmpl-tab--active': selectedOrd === tmpl.ord }]"
          @click="selectedOrd = tmpl.ord"
          @dblclick="startRenameTmpl"
        >
          {{ tmpl.name }}
        </button>
        <button
          v-if="!isCloze"
          class="tmpl-tab tmpl-tab--add"
          title="Add template"
          @click="handleAddTemplate"
        >
          <Plus :size="14" />
        </button>
      </div>

      <div class="template-actions">
        <template v-if="editingName">
          <input
            v-model="nameInput"
            class="tmpl-name-input"
            @keydown.enter="commitRenameTmpl"
            @keydown.escape="editingName = false"
            @blur="commitRenameTmpl"
            autofocus
          />
        </template>
        <button
          v-if="templates.length > 1 && !isCloze"
          class="icon-btn icon-btn--danger"
          title="Delete template"
          @click="selectedTemplate && emit('removeTemplate', selectedTemplate.ord)"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <div class="side-tabs">
      <button
        :class="['side-tab', { 'side-tab--active': editSide === 'front' }]"
        @click="editSide = 'front'"
      >
        Front Template
      </button>
      <button
        :class="['side-tab', { 'side-tab--active': editSide === 'back' }]"
        @click="editSide = 'back'"
      >
        Back Template
      </button>
    </div>

    <textarea
      class="template-textarea"
      :value="editContent"
      @input="editContent = ($event.target as HTMLTextAreaElement).value"
      spellcheck="false"
      placeholder="Enter template HTML..."
    />

    <div class="template-help">
      <details>
        <summary>Template syntax help</summary>
        <!-- v-pre prevents Vue from parsing mustache-like Anki template syntax -->
        <div v-pre class="help-content">
          <p><code>{{FieldName}}</code> — Insert field value</p>
          <p><code>{{#FieldName}}...{{/FieldName}}</code> — Conditional (show if field is non-empty)</p>
          <p><code>{{^FieldName}}...{{/FieldName}}</code> — Inverted conditional (show if field is empty)</p>
          <p><code>{{FrontSide}}</code> — Insert front template content (back template only)</p>
          <p><code>{{type:FieldName}}</code> — Type-in-the-answer input</p>
          <p><code>{{cloze:FieldName}}</code> — Cloze deletion</p>
          <p><code>{{hint:FieldName}}</code> — Hint (click to reveal)</p>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.template-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.template-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);
}

.template-tabs {
  display: flex;
  gap: var(--spacing-1);
  align-items: center;
}

.tmpl-tab {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.tmpl-tab:hover {
  background: var(--color-surface-hover);
}

.tmpl-tab--active {
  color: var(--color-primary);
  background: var(--color-surface-elevated);
  border-color: var(--color-primary-500);
}

.tmpl-tab--add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-1);
  width: 28px;
  height: 28px;
}

.template-actions {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}

.tmpl-name-input {
  padding: var(--spacing-1) var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.side-tabs {
  display: flex;
  gap: var(--spacing-1);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--spacing-1);
}

.side-tab {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.side-tab:hover {
  color: var(--color-text-primary);
}

.side-tab--active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary-500);
}

.template-textarea {
  min-height: 200px;
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

.template-textarea:focus {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -1px;
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
}

.icon-btn--danger:hover:not(:disabled) {
  color: var(--color-error-500);
}

.template-help {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.template-help summary {
  cursor: pointer;
  user-select: none;
}

.help-content {
  padding: var(--spacing-2) var(--spacing-3);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.help-content p {
  margin: 0;
}

.help-content code {
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
  background: var(--color-surface-elevated);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
}
</style>
