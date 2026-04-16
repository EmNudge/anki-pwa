<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Copy, Plus, Trash2 } from "lucide-vue-next";
import Modal from "~/design-system/components/primitives/Modal.vue";
import Button from "~/design-system/components/primitives/Button.vue";
import FieldEditor, { type FieldEntry } from "./notetype/FieldEditor.vue";
import TemplateEditor, { type TemplateEntry } from "./notetype/TemplateEditor.vue";
import CssEditor from "./notetype/CssEditor.vue";
import ConvertNotetypeModal, { type NotetypeInfo } from "./notetype/ConvertNotetypeModal.vue";
import { createDatabase } from "~/utils/sql";
import { getActiveSqliteBytes, withDbMutation, ankiDataSig } from "~/stores";
import {
  getAllNotetypes,
  getFieldsForNotetype,
  getTemplatesForNotetype,
  getNotetypeUsageCounts,
  createNotetype,
  cloneNotetype,
  renameNotetype,
  updateNotetypeCss,
  addField,
  removeField,
  renameField,
  reorderFields,
  addTemplate,
  removeTemplate,
  updateTemplate,
  deleteNotetype,
  convertNotes,
  updateFieldConfig,
} from "~/lib/notetypeOps";
import {
  parseNotesTypeConfigProto,
  parseFieldConfigProto,
  parseTemplatesProto,
} from "~/ankiParser/anki21b/proto";
import type { Anki21bFieldConfig } from "~/ankiParser/anki21b/proto";
import { executeQueryAll } from "~/utils/sql";

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

type Tab = "fields" | "templates" | "css";
const activeTab = ref<Tab>("fields");
const selectedNtid = ref<string | null>(null);
const searchQuery = ref("");
const showNewDialog = ref(false);
const newNotetypeName = ref("");
const newNotetypeKind = ref(0);
const convertModalOpen = ref(false);
const editingName = ref(false);
const nameInput = ref("");

// Loaded data from SQLite
interface LoadedNotetype {
  id: string;
  name: string;
  kind: number;
  css: string;
  fields: FieldEntry[];
  templates: TemplateEntry[];
  noteCount: number;
}

const notetypes = ref<LoadedNotetype[]>([]);

const filteredNotetypes = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return notetypes.value;
  return notetypes.value.filter((nt) => nt.name.toLowerCase().includes(q));
});

const selectedNotetype = computed(() =>
  notetypes.value.find((nt) => nt.id === selectedNtid.value) ?? null,
);

const allNotetypeInfos = computed<NotetypeInfo[]>(() =>
  notetypes.value.map((nt) => ({
    id: nt.id,
    name: nt.name,
    fields: nt.fields.map((f) => f.name),
  })),
);

// Load notetypes from DB when modal opens
watch(
  () => props.isOpen,
  async (open) => {
    if (open) await loadNotetypes();
  },
  { immediate: true },
);

// Reload when ankiData changes (after mutations)
watch(ankiDataSig, async () => {
  if (props.isOpen) {
    const prevId = selectedNtid.value;
    await loadNotetypes();
    // Restore selection if it still exists
    if (prevId && notetypes.value.find((nt) => nt.id === prevId)) {
      selectedNtid.value = prevId;
    }
  }
});

async function loadNotetypes() {
  const bytes = getActiveSqliteBytes();
  if (!bytes) {
    notetypes.value = [];
    return;
  }

  const db = await createDatabase(bytes);
  try {
    const ntRows = getAllNotetypes(db);
    const usageCounts = getNotetypeUsageCounts(db);

    notetypes.value = ntRows.map((row) => {
      const config = parseNotesTypeConfigProto(row.config);
      const fieldRows = getFieldsForNotetype(db, row.id);
      const tmplRows = getTemplatesForNotetype(db, row.id);

      return {
        id: row.id,
        name: row.name,
        kind: config.kind,
        css: config.css,
        fields: fieldRows.map((f) => ({
          ord: f.ord,
          name: f.name,
          config: parseFieldConfigProto(f.config),
        })),
        templates: tmplRows.map((t) => {
          const tc = parseTemplatesProto(t.config);
          return {
            ord: t.ord,
            name: t.name,
            qfmt: tc.qFormat,
            afmt: tc.aFormat,
          };
        }),
        noteCount: usageCounts.get(row.id) ?? 0,
      };
    });

    // Auto-select first if none selected
    if (!selectedNtid.value && notetypes.value.length > 0) {
      selectedNtid.value = notetypes.value[0]!.id;
    }
  } finally {
    db.close();
  }
}

// --- Mutation handlers ---

async function handleRename(newName: string) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => renameNotetype(db, ntid, newName));
}

async function handleUpdateCss(css: string) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => updateNotetypeCss(db, ntid, css));
}

async function handleAddField(name: string, ord: number) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => addField(db, ntid, name, ord));
}

async function handleRemoveField(ord: number) {
  if (!selectedNtid.value) return;
  const nt = selectedNotetype.value;
  if (nt && nt.fields.length <= 1) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => removeField(db, ntid, ord));
}

async function handleRenameField(ord: number, newName: string) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => renameField(db, ntid, ord, newName));
}

async function handleReorderFields(newOrdering: number[]) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => reorderFields(db, ntid, newOrdering));
}

async function handleUpdateFieldConfig(ord: number, updates: Partial<Anki21bFieldConfig>) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => updateFieldConfig(db, ntid, ord, updates));
}

async function handleUpdateTemplate(
  ord: number,
  updates: { name?: string; qfmt?: string; afmt?: string },
) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) =>
    updateTemplate(db, ntid, ord, {
      name: updates.name,
      qfmt: updates.qfmt,
      afmt: updates.afmt,
    }),
  );
}

async function handleAddTemplate(tmpl: { name: string; qfmt: string; afmt: string }) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => addTemplate(db, ntid, tmpl));
}

async function handleRemoveTemplate(ord: number) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;
  await withDbMutation((db) => removeTemplate(db, ntid, ord));
}

async function handleCreate() {
  const name = newNotetypeName.value.trim();
  if (!name) return;

  let newId: string | null = null;
  await withDbMutation((db) => {
    newId = createNotetype(db, {
      name,
      kind: newNotetypeKind.value,
      fields: [{ name: "Front" }, { name: "Back" }],
      templates: [
        {
          name: "Card 1",
          qfmt: "{{Front}}",
          afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}',
        },
      ],
    });
  });

  showNewDialog.value = false;
  newNotetypeName.value = "";
  newNotetypeKind.value = 0;
  if (newId) selectedNtid.value = newId;
}

async function handleClone() {
  if (!selectedNtid.value || !selectedNotetype.value) return;
  const ntid = selectedNtid.value;
  const cloneName = `${selectedNotetype.value.name} (copy)`;
  let newId: string | null = null;
  await withDbMutation((db) => {
    newId = cloneNotetype(db, ntid, cloneName);
  });
  if (newId) selectedNtid.value = newId;
}

async function handleDelete() {
  if (!selectedNtid.value || !selectedNotetype.value) return;
  if (selectedNotetype.value.noteCount > 0) return;
  if (!confirm(`Delete note type "${selectedNotetype.value.name}"?`)) return;

  const ntid = selectedNtid.value;
  await withDbMutation((db) => deleteNotetype(db, ntid));
  selectedNtid.value = notetypes.value[0]?.id ?? null;
}

async function handleConvert(targetNtid: string, fieldMapping: Record<string, string>) {
  if (!selectedNtid.value) return;
  const ntid = selectedNtid.value;

  const bytes = getActiveSqliteBytes();
  if (!bytes) return;

  // Get note IDs for this notetype
  const db = await createDatabase(bytes);
  let noteIds: number[];
  try {
    noteIds = executeQueryAll<{ id: number }>(
      db,
      "SELECT id FROM notes WHERE mid=?",
      [Number(ntid)] as unknown as Record<string, string>,
    ).map((r) => r.id);
  } finally {
    db.close();
  }

  if (noteIds.length === 0) return;

  await withDbMutation((db) => convertNotes(db, noteIds, targetNtid, fieldMapping));
  convertModalOpen.value = false;
}

function startRename() {
  if (!selectedNotetype.value) return;
  editingName.value = true;
  nameInput.value = selectedNotetype.value.name;
}

function commitRename() {
  const trimmed = nameInput.value.trim();
  if (trimmed && selectedNotetype.value && trimmed !== selectedNotetype.value.name) {
    handleRename(trimmed);
  }
  editingName.value = false;
}
</script>

<template>
  <Modal :is-open="isOpen" title="Manage Note Types" size="xl" @close="emit('close')">
    <div class="manager-layout">
      <!-- Left sidebar -->
      <div class="sidebar">
        <input
          v-model="searchQuery"
          class="search-input"
          placeholder="Search note types..."
        />

        <div class="notetype-list">
          <button
            v-for="nt in filteredNotetypes"
            :key="nt.id"
            :class="['notetype-item', { 'notetype-item--active': selectedNtid === nt.id }]"
            @click="selectedNtid = nt.id"
          >
            <span class="notetype-name">{{ nt.name }}</span>
            <span class="notetype-count">{{ nt.noteCount }} notes</span>
          </button>
          <div v-if="filteredNotetypes.length === 0" class="empty-list">
            No note types found
          </div>
        </div>

        <div class="sidebar-actions">
          <Button size="sm" variant="secondary" @click="showNewDialog = true">
            <template #iconLeft><Plus :size="14" /></template>
            New
          </Button>
          <Button size="sm" variant="secondary" :disabled="!selectedNtid" @click="handleClone">
            <template #iconLeft><Copy :size="14" /></template>
            Clone
          </Button>
        </div>
      </div>

      <!-- Right panel -->
      <div v-if="selectedNotetype" class="detail-panel">
        <div class="detail-header">
          <div class="header-left">
            <template v-if="editingName">
              <input
                v-model="nameInput"
                class="name-edit-input"
                @keydown.enter="commitRename"
                @keydown.escape="editingName = false"
                @blur="commitRename"
                autofocus
              />
            </template>
            <template v-else>
              <h3 class="notetype-title" @dblclick="startRename">
                {{ selectedNotetype.name }}
              </h3>
            </template>
            <span :class="['kind-badge', `kind-badge--${selectedNotetype.kind === 1 ? 'cloze' : 'normal'}`]">
              {{ selectedNotetype.kind === 1 ? "Cloze" : "Normal" }}
            </span>
          </div>
        </div>

        <div class="tab-bar">
          <button
            :class="['detail-tab', { 'detail-tab--active': activeTab === 'fields' }]"
            @click="activeTab = 'fields'"
          >
            Fields ({{ selectedNotetype.fields.length }})
          </button>
          <button
            :class="['detail-tab', { 'detail-tab--active': activeTab === 'templates' }]"
            @click="activeTab = 'templates'"
          >
            Templates ({{ selectedNotetype.templates.length }})
          </button>
          <button
            :class="['detail-tab', { 'detail-tab--active': activeTab === 'css' }]"
            @click="activeTab = 'css'"
          >
            CSS
          </button>
        </div>

        <div class="tab-content">
          <FieldEditor
            v-if="activeTab === 'fields'"
            :fields="selectedNotetype.fields"
            @add-field="handleAddField"
            @remove-field="handleRemoveField"
            @rename-field="handleRenameField"
            @reorder-fields="handleReorderFields"
            @update-field-config="handleUpdateFieldConfig"
          />
          <TemplateEditor
            v-if="activeTab === 'templates'"
            :templates="selectedNotetype.templates"
            :css="selectedNotetype.css"
            :is-cloze="selectedNotetype.kind === 1"
            @update-template="handleUpdateTemplate"
            @add-template="handleAddTemplate"
            @remove-template="handleRemoveTemplate"
          />
          <CssEditor
            v-if="activeTab === 'css'"
            :css="selectedNotetype.css"
            @update-css="handleUpdateCss"
          />
        </div>

        <div class="detail-footer">
          <Button
            v-if="selectedNotetype.noteCount > 0"
            size="sm"
            variant="secondary"
            @click="convertModalOpen = true"
          >
            Convert {{ selectedNotetype.noteCount }} Notes...
          </Button>
          <Button
            size="sm"
            variant="danger"
            :disabled="selectedNotetype.noteCount > 0"
            :title="selectedNotetype.noteCount > 0 ? `Cannot delete: ${selectedNotetype.noteCount} note(s) use this type` : 'Delete note type'"
            @click="handleDelete"
          >
            <template #iconLeft><Trash2 :size="14" /></template>
            Delete
          </Button>
        </div>
      </div>

      <div v-else class="detail-panel detail-panel--empty">
        <p v-if="notetypes.length === 0">
          No note types available. Import a deck or create a new note type to get started.
        </p>
        <p v-else>Select a note type from the list.</p>
      </div>
    </div>

    <!-- New notetype dialog -->
    <Modal
      :is-open="showNewDialog"
      title="New Note Type"
      size="sm"
      @close="showNewDialog = false"
    >
      <div class="new-form">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input
            v-model="newNotetypeName"
            class="form-input"
            placeholder="e.g., Basic, Vocabulary..."
            @keydown.enter="handleCreate"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select v-model="newNotetypeKind" class="form-select">
            <option :value="0">Normal</option>
            <option :value="1">Cloze</option>
          </select>
        </div>
        <p class="form-hint">
          Creates a note type with Front and Back fields and one card template.
        </p>
      </div>
      <template #footer>
        <Button variant="ghost" @click="showNewDialog = false">Cancel</Button>
        <Button :disabled="!newNotetypeName.trim()" @click="handleCreate">Create</Button>
      </template>
    </Modal>

    <!-- Convert modal -->
    <ConvertNotetypeModal
      v-if="selectedNotetype"
      :is-open="convertModalOpen"
      :source-notetype="{
        id: selectedNotetype.id,
        name: selectedNotetype.name,
        fields: selectedNotetype.fields.map((f) => f.name),
      }"
      :all-notetypes="allNotetypeInfos"
      :note-count="selectedNotetype.noteCount"
      @close="convertModalOpen = false"
      @convert="handleConvert"
    />
  </Modal>
</template>

<style scoped>
.manager-layout {
  display: flex;
  gap: var(--spacing-4);
  min-height: 500px;
  margin: calc(-1 * var(--spacing-8));
  margin-top: calc(-1 * var(--spacing-4));
}

/* Sidebar */
.sidebar {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  border-right: 1px solid var(--color-border);
  padding: var(--spacing-3);
}

.search-input {
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.search-input:focus {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -1px;
}

.notetype-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.notetype-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--spacing-2) var(--spacing-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: var(--transition-colors);
  width: 100%;
  box-shadow: none;
}

.notetype-item:hover {
  background: var(--color-surface-hover);
}

.notetype-item--active {
  background: var(--color-surface-elevated);
  outline: 1px solid var(--color-primary-500);
}

.notetype-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  word-break: break-word;
}

.notetype-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.empty-list {
  padding: var(--spacing-4);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.sidebar-actions {
  display: flex;
  gap: var(--spacing-2);
}

/* Detail panel */
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  overflow-y: auto;
  min-width: 0;
}

.detail-panel--empty {
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.notetype-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  cursor: default;
}

.name-edit-input {
  padding: var(--spacing-1) var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.kind-badge {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.kind-badge--normal {
  background: var(--color-primary-100, #e0e7ff);
  color: var(--color-primary-700, #3730a3);
}

.kind-badge--cloze {
  background: var(--color-warning-100, #fef3c7);
  color: var(--color-warning-700, #92400e);
}

/* Tabs */
.tab-bar {
  display: flex;
  gap: var(--spacing-1);
  border-bottom: 1px solid var(--color-border);
}

.detail-tab {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.detail-tab:hover {
  color: var(--color-text-primary);
}

.detail-tab--active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary-500);
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.detail-footer {
  display: flex;
  gap: var(--spacing-2);
  justify-content: flex-end;
  padding-top: var(--spacing-3);
  border-top: 1px solid var(--color-border);
}

/* New notetype form */
.new-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.form-input {
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.form-select {
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.form-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>
