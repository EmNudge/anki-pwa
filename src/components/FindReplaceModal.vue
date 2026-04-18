<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ankiDataSig, bulkUpdateNoteFields } from "../stores";
import { stripHtml } from "../utils/stripHtml";
import { escapeHtml, truncate } from "../utils/format";
import { Button, Modal } from "../design-system";

type Scope = "all" | "selected" | "deck";

const props = defineProps<{
  isOpen: boolean;
  /** GUIDs of currently selected notes in the browser (for "selected" scope) */
  selectedGuids: string[];
  /** All deck names in the collection */
  deckNames: string[];
}>();

const emit = defineEmits<{
  close: [];
  applied: [];
}>();

// ── Form state ──

const findText = ref("");
const replaceText = ref("");
const useRegex = ref(false);
const caseSensitive = ref(false);
const wholeWord = ref(false);
const scope = ref<Scope>("all");
const scopeDeck = ref("");
const targetField = ref("__all__");
const applying = ref(false);
const errorMsg = ref("");

// Reset state when modal opens
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      errorMsg.value = "";
      applying.value = false;
      if (props.selectedGuids.length > 0) {
        scope.value = "selected";
      } else {
        scope.value = "all";
      }
      if (props.deckNames.length > 0 && !scopeDeck.value) {
        scopeDeck.value = props.deckNames[0] ?? "";
      }
    }
  },
);

// ── Field names from collection ──

const fieldNames = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [];
  const names = new Set<string>();
  for (const card of data.cards) {
    for (const key of Object.keys(card.values)) {
      names.add(key);
    }
  }
  return Array.from(names).sort();
});

// ── Build regex from inputs ──

function buildRegex(): RegExp | null {
  errorMsg.value = "";
  if (!findText.value) return null;

  try {
    let pattern: string;
    if (useRegex.value) {
      pattern = findText.value;
    } else {
      // Escape special regex chars for literal matching
      pattern = findText.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    if (wholeWord.value) {
      pattern = `\\b${pattern}\\b`;
    }

    const flags = caseSensitive.value ? "g" : "gi";
    return new RegExp(pattern, flags);
  } catch (e) {
    errorMsg.value = `Invalid regex: ${(e as Error).message}`;
    return null;
  }
}

// ── Collect in-scope notes (deduplicated by guid) ──

type NoteInfo = {
  guid: string;
  fields: Record<string, string | null>;
  deckName: string;
};

function getNotesInScope(): NoteInfo[] {
  const data = ankiDataSig.value;
  if (!data) return [];

  const noteMap = new Map<string, NoteInfo>();
  for (const card of data.cards) {
    if (noteMap.has(card.guid)) continue;

    // Scope filter
    if (scope.value === "selected" && !props.selectedGuids.includes(card.guid)) continue;
    if (scope.value === "deck") {
      const deckLower = card.deckName.toLowerCase();
      const filterLower = scopeDeck.value.toLowerCase();
      if (deckLower !== filterLower && !deckLower.startsWith(filterLower + "::")) continue;
    }

    noteMap.set(card.guid, {
      guid: card.guid,
      fields: { ...card.values },
      deckName: card.deckName,
    });
  }

  return Array.from(noteMap.values());
}

// ── Preview changes ──

type FieldChange = {
  fieldName: string;
  oldValue: string;
  newValue: string;
};

type NoteChange = {
  guid: string;
  sortField: string;
  changes: FieldChange[];
};

const preview = computed<NoteChange[]>(() => {
  const regex = buildRegex();
  if (!regex) return [];

  const notes = getNotesInScope();
  const result: NoteChange[] = [];

  for (const note of notes) {
    const changes: FieldChange[] = [];

    for (const [fieldName, rawValue] of Object.entries(note.fields)) {
      if (targetField.value !== "__all__" && fieldName !== targetField.value) continue;

      const oldValue = rawValue ?? "";
      // Reset regex lastIndex for each field
      regex.lastIndex = 0;
      if (!regex.test(oldValue)) continue;

      // Reset again before replace
      regex.lastIndex = 0;
      const newValue = oldValue.replace(regex, replaceText.value);
      if (newValue !== oldValue) {
        changes.push({ fieldName, oldValue, newValue });
      }
    }

    if (changes.length > 0) {
      const sortField = stripHtml(Object.values(note.fields)[0] ?? "");
      result.push({ guid: note.guid, sortField, changes });
    }
  }

  return result;
});

const totalChanges = computed(() => preview.value.reduce((sum, n) => sum + n.changes.length, 0));

// ── Highlight matches in a string for display ──

function highlightMatches(text: string, isOld: boolean): string {
  const regex = buildRegex();
  if (!regex) return escapeHtml(text);

  regex.lastIndex = 0;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Clone the regex to avoid state issues
  const scanRegex = new RegExp(regex.source, regex.flags);
  while ((match = scanRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }
    if (isOld) {
      parts.push(`<span class="fr-diff-del">${escapeHtml(match[0])}</span>`);
    } else {
      // Show what the replacement produces for this match
      const replaced = match[0].replace(regex, replaceText.value);
      regex.lastIndex = 0; // Reset after replace
      parts.push(`<span class="fr-diff-ins">${escapeHtml(replaced)}</span>`);
    }
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) {
      scanRegex.lastIndex++;
      if (scanRegex.lastIndex > text.length) break;
    }
  }
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }
  return parts.join("");
}

// ── Apply changes ──

async function applyChanges() {
  if (preview.value.length === 0) return;
  applying.value = true;

  try {
    const notes = getNotesInScope();
    const regex = buildRegex();
    if (!regex) return;

    const updates: { guid: string; fields: Record<string, string | null> }[] = [];

    for (const noteChange of preview.value) {
      const note = notes.find((n) => n.guid === noteChange.guid);
      if (!note) continue;

      const newFields = { ...note.fields };
      for (const change of noteChange.changes) {
        newFields[change.fieldName] = change.newValue;
      }
      updates.push({ guid: noteChange.guid, fields: newFields });
    }

    await bulkUpdateNoteFields(updates);
    emit("applied");
    emit("close");
  } catch (e) {
    errorMsg.value = `Error applying changes: ${(e as Error).message}`;
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Find & Replace" size="lg" @close="emit('close')">
    <div class="fr-layout">
      <!-- Form -->
      <div class="fr-form">
        <div class="fr-row">
          <div class="fr-field fr-field--grow">
            <label class="fr-label">Find</label>
            <input
              v-model="findText"
              class="fr-input"
              type="text"
              placeholder="Search text or regex..."
              @keydown.enter="applyChanges"
            />
          </div>
        </div>

        <div class="fr-row">
          <div class="fr-field fr-field--grow">
            <label class="fr-label">Replace with</label>
            <input
              v-model="replaceText"
              class="fr-input"
              type="text"
              placeholder="Replacement text..."
              @keydown.enter="applyChanges"
            />
          </div>
        </div>

        <div class="fr-row fr-row--options">
          <label class="fr-toggle">
            <input v-model="useRegex" type="checkbox" />
            <span>Regex</span>
          </label>
          <label class="fr-toggle">
            <input v-model="caseSensitive" type="checkbox" />
            <span>Case sensitive</span>
          </label>
          <label class="fr-toggle">
            <input v-model="wholeWord" type="checkbox" />
            <span>Whole word</span>
          </label>
        </div>

        <div class="fr-row">
          <div class="fr-field">
            <label class="fr-label">In field</label>
            <select v-model="targetField" class="fr-select">
              <option value="__all__">All fields</option>
              <option v-for="name in fieldNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>

          <div class="fr-field">
            <label class="fr-label">Scope</label>
            <select v-model="scope" class="fr-select">
              <option value="all">Entire collection</option>
              <option v-if="selectedGuids.length > 0" value="selected">
                Selected notes ({{ selectedGuids.length }})
              </option>
              <option value="deck">Current deck</option>
            </select>
          </div>

          <div v-if="scope === 'deck'" class="fr-field">
            <label class="fr-label">Deck</label>
            <select v-model="scopeDeck" class="fr-select">
              <option v-for="d in deckNames" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
        </div>

        <p v-if="errorMsg" class="fr-error">{{ errorMsg }}</p>
      </div>

      <!-- Preview -->
      <div class="fr-preview">
        <div class="fr-preview-header">
          <span v-if="findText && preview.length > 0" class="fr-preview-count">
            {{ totalChanges }} change{{ totalChanges === 1 ? "" : "s" }} in
            {{ preview.length }} note{{ preview.length === 1 ? "" : "s" }}
          </span>
          <span v-else-if="findText" class="fr-preview-empty">No matches found</span>
          <span v-else class="fr-preview-empty">Enter search text to preview changes</span>
        </div>

        <div v-if="preview.length > 0" class="fr-diff-list">
          <div v-for="note in preview.slice(0, 100)" :key="note.guid" class="fr-diff-note">
            <div class="fr-diff-note-header">{{ truncate(note.sortField, 60) }}</div>
            <div v-for="(change, i) in note.changes" :key="i" class="fr-diff-change">
              <div class="fr-diff-field-name">{{ change.fieldName }}</div>
              <div class="fr-diff-row fr-diff-row--old">
                <span class="fr-diff-indicator">-</span>
                <span v-html="highlightMatches(truncate(change.oldValue), true)" />
              </div>
              <div class="fr-diff-row fr-diff-row--new">
                <span class="fr-diff-indicator">+</span>
                <span v-html="highlightMatches(truncate(change.newValue), false)" />
              </div>
            </div>
          </div>
          <p v-if="preview.length > 100" class="fr-truncated">
            ...and {{ preview.length - 100 }} more notes
          </p>
        </div>
      </div>
    </div>

    <template #footer>
      <Button variant="secondary" size="sm" @click="emit('close')">Cancel</Button>
      <Button
        size="sm"
        :disabled="preview.length === 0 || applying"
        :loading="applying"
        @click="applyChanges"
      >
        Replace all ({{ totalChanges }})
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.fr-layout {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
  max-height: 60vh;
}

.fr-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  flex-shrink: 0;
}

.fr-row {
  display: flex;
  gap: var(--spacing-3);
  align-items: flex-end;
}

.fr-row--options {
  gap: var(--spacing-4);
  align-items: center;
}

.fr-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.fr-field--grow {
  flex: 1;
}

.fr-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.fr-input,
.fr-select {
  padding: var(--spacing-1-5) var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  outline: none;
}

.fr-input:focus,
.fr-select:focus {
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.fr-select {
  min-width: 140px;
}

.fr-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
}

.fr-toggle input[type="checkbox"] {
  accent-color: var(--color-primary);
}

.fr-error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger, #e53e3e);
}

/* Preview area */
.fr-preview {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
}

.fr-preview-header {
  position: sticky;
  top: 0;
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
  z-index: 1;
}

.fr-preview-count {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.fr-preview-empty {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.fr-diff-list {
  padding: var(--spacing-2);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.fr-diff-note {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.fr-diff-note-header {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fr-diff-change {
  padding: var(--spacing-1) var(--spacing-2);
}

.fr-diff-change + .fr-diff-change {
  border-top: 1px solid var(--color-border);
}

.fr-diff-field-name {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  margin-bottom: var(--spacing-0-5);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

.fr-diff-row {
  display: flex;
  gap: var(--spacing-1);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono, monospace);
  line-height: 1.5;
  padding: var(--spacing-0-5) var(--spacing-1);
  border-radius: var(--radius-sm);
  word-break: break-word;
}

.fr-diff-row--old {
  background: color-mix(in srgb, #e53e3e 8%, transparent);
  color: var(--color-text-primary);
}

.fr-diff-row--new {
  background: color-mix(in srgb, #38a169 8%, transparent);
  color: var(--color-text-primary);
}

.fr-diff-indicator {
  flex-shrink: 0;
  font-weight: var(--font-weight-bold, 700);
  width: 1em;
  text-align: center;
}

.fr-diff-row--old .fr-diff-indicator {
  color: #e53e3e;
}

.fr-diff-row--new .fr-diff-indicator {
  color: #38a169;
}

:deep(.fr-diff-del) {
  background: color-mix(in srgb, #e53e3e 25%, transparent);
  border-radius: 2px;
  padding: 0 1px;
}

:deep(.fr-diff-ins) {
  background: color-mix(in srgb, #38a169 25%, transparent);
  border-radius: 2px;
  padding: 0 1px;
}

.fr-truncated {
  margin: 0;
  padding: var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  text-align: center;
}
</style>
