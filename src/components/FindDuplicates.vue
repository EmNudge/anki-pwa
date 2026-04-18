<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ankiDataSig, activeViewSig } from "../stores";
import { stripHtml } from "../utils/stripHtml";
import { truncate } from "../utils/format";
import {
  findDuplicates,
  buildNoteInfos,
  type DuplicateGroup,
  type DuplicateScope,
  type DuplicateSearchOptions,
  type NoteInfo,
} from "../utils/duplicates";
import { Button, Modal } from "../design-system";
import { deleteNotesByGuid } from "../stores";

// Search options
const fieldIndex = ref(0);
const scope = ref<DuplicateScope>("all");
const fuzzy = ref(false);
const fuzzyThreshold = ref(0.8);

// Results
const duplicateGroups = ref<DuplicateGroup[]>([]);
const hasSearched = ref(false);
const isSearching = ref(false);

// Expanded groups
const expandedGroups = ref(new Set<string>());

// Confirmation modal
const confirmAction = ref<{
  type: "delete" | "merge";
  group: DuplicateGroup;
  keepGuid?: string;
  deleteGuids?: string[];
} | null>(null);

/** All unique field names from the loaded deck */
const fieldNames = computed(() => {
  const data = ankiDataSig.value;
  if (!data || data.cards.length === 0) return [];
  // Collect field names from the first card (representative of the notetype)
  const names = new Set<string>();
  for (const card of data.cards) {
    for (const key of Object.keys(card.values)) {
      names.add(key);
    }
  }
  return Array.from(names);
});

/** All unique deck names */
const deckNames = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [];
  const names = new Set<string>();
  for (const card of data.cards) {
    names.add(card.deckName);
  }
  return Array.from(names).sort();
});

/** Build note infos from current data */
const noteInfos = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [];
  return buildNoteInfos(data.cards);
});

/** Total number of duplicate notes found */
const totalDuplicateNotes = computed(() => {
  return duplicateGroups.value.reduce((sum, g) => sum + g.notes.length, 0);
});

function toggleGroup(key: string) {
  const next = new Set(expandedGroups.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedGroups.value = next;
}

function runSearch() {
  isSearching.value = true;
  hasSearched.value = false;

  // Use requestAnimationFrame to let the UI update before heavy computation
  requestAnimationFrame(() => {
    const options: DuplicateSearchOptions = {
      fieldIndex: fieldIndex.value,
      scope: scope.value,
      fuzzy: fuzzy.value,
      fuzzyThreshold: fuzzyThreshold.value,
    };

    const results = findDuplicates(noteInfos.value, options);
    duplicateGroups.value = results;
    hasSearched.value = true;
    isSearching.value = false;

    // Auto-expand first few groups
    const initial = new Set<string>();
    for (let i = 0; i < Math.min(3, results.length); i++) {
      initial.add(results[i]!.key);
    }
    expandedGroups.value = initial;
  });
}

/** Get a preview of note fields (excluding the comparison field) */
function getNotePreview(note: NoteInfo, skipFieldIndex: number): string {
  const entries: string[] = [];
  const keys = note.fieldNames;
  for (let i = 0; i < keys.length; i++) {
    if (i === skipFieldIndex) continue;
    const key = keys[i]!;
    const val = stripHtml(note.values[key] ?? null);
    if (val) {
      entries.push(`${key}: ${truncate(val, 80)}`);
    }
  }
  return entries.join(" | ") || "(no other fields)";
}

function handleDeleteDuplicate(group: DuplicateGroup, guid: string) {
  confirmAction.value = {
    type: "delete",
    group,
    deleteGuids: [guid],
  };
}

function handleDeleteAllBut(group: DuplicateGroup, keepGuid: string) {
  const deleteGuids = group.notes.filter((n) => n.guid !== keepGuid).map((n) => n.guid);
  confirmAction.value = {
    type: "merge",
    group,
    keepGuid,
    deleteGuids,
  };
}

async function confirmDeletion() {
  const action = confirmAction.value;
  if (!action || !action.deleteGuids) return;

  await deleteNotesByGuid(action.deleteGuids);

  // Remove deleted notes from the current results
  const deletedSet = new Set(action.deleteGuids);
  duplicateGroups.value = duplicateGroups.value
    .map((group) => ({
      ...group,
      notes: group.notes.filter((n) => !deletedSet.has(n.guid)),
    }))
    .filter((group) => group.notes.length >= 2);

  confirmAction.value = null;
}

function goBack() {
  activeViewSig.value = "browse";
}

// Reset search when data changes
watch(ankiDataSig, () => {
  duplicateGroups.value = [];
  hasSearched.value = false;
});
</script>

<template>
  <main class="find-duplicates">
    <div class="find-duplicates__container">
      <div class="find-duplicates__header">
        <div class="find-duplicates__title-row">
          <button class="find-duplicates__back-btn" @click="goBack" title="Back to Browse">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 class="find-duplicates__title">Find Duplicates</h1>
        </div>
        <p class="find-duplicates__subtitle">
          Detect and manage duplicate notes in your collection.
        </p>
      </div>

      <!-- Search Options -->
      <div class="find-duplicates__options">
        <div class="find-duplicates__option">
          <label class="find-duplicates__label" for="dup-field">Compare field</label>
          <select id="dup-field" v-model="fieldIndex" class="find-duplicates__select">
            <option v-for="(name, idx) in fieldNames" :key="idx" :value="idx">
              {{ name }}{{ idx === 0 ? " (sort field)" : "" }}
            </option>
          </select>
        </div>

        <div class="find-duplicates__option">
          <label class="find-duplicates__label" for="dup-scope">Scope</label>
          <select id="dup-scope" v-model="scope" class="find-duplicates__select">
            <option value="all">Across all decks</option>
            <option value="deck">Within each deck</option>
          </select>
        </div>

        <div class="find-duplicates__option find-duplicates__option--inline">
          <label class="find-duplicates__checkbox-label">
            <input type="checkbox" v-model="fuzzy" class="find-duplicates__checkbox" />
            <span>Include fuzzy matches</span>
          </label>
        </div>

        <div v-if="fuzzy" class="find-duplicates__option">
          <label class="find-duplicates__label" for="dup-threshold">
            Similarity threshold: {{ Math.round(fuzzyThreshold * 100) }}%
          </label>
          <input
            id="dup-threshold"
            type="range"
            v-model.number="fuzzyThreshold"
            min="0.5"
            max="0.99"
            step="0.01"
            class="find-duplicates__range"
          />
        </div>

        <Button
          variant="primary"
          size="md"
          :loading="isSearching"
          :disabled="!ankiDataSig || noteInfos.length === 0"
          @click="runSearch"
        >
          Search for Duplicates
        </Button>
      </div>

      <!-- Results -->
      <div v-if="hasSearched" class="find-duplicates__results">
        <div v-if="duplicateGroups.length === 0" class="find-duplicates__empty">
          <p>No duplicates found.</p>
        </div>

        <template v-else>
          <div class="find-duplicates__results-header">
            <span class="find-duplicates__results-count">
              {{ duplicateGroups.length }} duplicate group{{
                duplicateGroups.length !== 1 ? "s" : ""
              }}
              ({{ totalDuplicateNotes }} notes total)
            </span>
          </div>

          <div v-for="group in duplicateGroups" :key="group.key" class="find-duplicates__group">
            <button class="find-duplicates__group-header" @click="toggleGroup(group.key)">
              <svg
                :class="[
                  'find-duplicates__chevron',
                  { 'find-duplicates__chevron--open': expandedGroups.has(group.key) },
                ]"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              <span class="find-duplicates__group-title">
                {{ truncate(group.displayKey, 100) }}
              </span>
              <span class="find-duplicates__group-badge"> {{ group.notes.length }} notes </span>
              <span v-if="group.similarity < 1" class="find-duplicates__group-similarity">
                ~{{ Math.round(group.similarity * 100) }}% similar
              </span>
            </button>

            <div v-if="expandedGroups.has(group.key)" class="find-duplicates__group-body">
              <div v-for="note in group.notes" :key="note.guid" class="find-duplicates__note">
                <div class="find-duplicates__note-content">
                  <div class="find-duplicates__note-field">
                    {{
                      truncate(stripHtml(note.values[note.fieldNames[fieldIndex] ?? ""] ?? ""), 150)
                    }}
                  </div>
                  <div class="find-duplicates__note-preview">
                    {{ getNotePreview(note, fieldIndex) }}
                  </div>
                  <div class="find-duplicates__note-meta">
                    <span class="find-duplicates__note-deck">{{ note.deckName }}</span>
                    <span v-if="note.tags.length > 0" class="find-duplicates__note-tags">
                      {{ note.tags.join(", ") }}
                    </span>
                  </div>
                </div>
                <div class="find-duplicates__note-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    title="Keep this note, delete all others in this group"
                    @click="handleDeleteAllBut(group, note.guid)"
                  >
                    Keep
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    title="Delete this note"
                    @click="handleDeleteDuplicate(group, note.guid)"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- No deck loaded -->
      <div v-else-if="!ankiDataSig" class="find-duplicates__empty">
        <p>No deck loaded. Load a deck first to search for duplicates.</p>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <Modal
      :is-open="!!confirmAction"
      :title="confirmAction?.type === 'merge' ? 'Keep Note & Delete Duplicates' : 'Delete Note'"
      size="sm"
      @close="confirmAction = null"
    >
      <div v-if="confirmAction" class="find-duplicates__confirm">
        <p v-if="confirmAction.type === 'merge'">
          Keep the selected note and delete
          <strong>{{ confirmAction.deleteGuids?.length }}</strong>
          duplicate{{ (confirmAction.deleteGuids?.length ?? 0) !== 1 ? "s" : "" }}? This cannot be
          undone.
        </p>
        <p v-else>Delete this note? This cannot be undone.</p>
      </div>
      <template #footer>
        <Button variant="secondary" size="sm" @click="confirmAction = null">Cancel</Button>
        <Button variant="danger" size="sm" @click="confirmDeletion">
          {{ confirmAction?.type === "merge" ? "Delete Duplicates" : "Delete" }}
        </Button>
      </template>
    </Modal>
  </main>
</template>

<style scoped>
.find-duplicates {
  min-height: calc(100vh - 44px);
  padding: var(--spacing-6) var(--spacing-4);
}

.find-duplicates__container {
  max-width: 900px;
  margin: 0 auto;
}

.find-duplicates__header {
  margin-bottom: var(--spacing-6);
}

.find-duplicates__title-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.find-duplicates__back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-1);
  color: var(--color-text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.find-duplicates__back-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.find-duplicates__back-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
  box-shadow: var(--shadow-focus-ring);
}

.find-duplicates__title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.find-duplicates__subtitle {
  margin: var(--spacing-1) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

/* Options */
.find-duplicates__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-4);
  align-items: flex-end;
  padding: var(--spacing-4);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  margin-bottom: var(--spacing-6);
}

.find-duplicates__option {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  min-width: 180px;
}

.find-duplicates__option--inline {
  flex-direction: row;
  align-items: center;
  min-width: auto;
}

.find-duplicates__label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.find-duplicates__select {
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  min-width: 160px;
}

.find-duplicates__select:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
  box-shadow: var(--shadow-focus-ring);
}

.find-duplicates__checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
}

.find-duplicates__checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.find-duplicates__range {
  width: 160px;
  accent-color: var(--color-primary);
}

/* Results */
.find-duplicates__results {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.find-duplicates__results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-2);
}

.find-duplicates__results-count {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.find-duplicates__empty {
  text-align: center;
  padding: var(--spacing-8);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

/* Groups */
.find-duplicates__group {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.find-duplicates__group-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  width: 100%;
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-surface-elevated);
  border: none;
  border-bottom: 1px solid transparent;
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  transition: var(--transition-colors);
  box-shadow: none;
}

.find-duplicates__group-header:hover {
  background: var(--color-surface-hover);
}

.find-duplicates__group-header:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
  box-shadow: var(--shadow-focus-ring);
}

.find-duplicates__chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
  color: var(--color-text-tertiary);
}

.find-duplicates__chevron--open {
  transform: rotate(90deg);
}

.find-duplicates__group-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}

.find-duplicates__group-badge {
  flex-shrink: 0;
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
  background: var(--color-primary-50);
  border-radius: var(--radius-full);
}

.find-duplicates__group-similarity {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

/* Group body */
.find-duplicates__group-body {
  border-top: 1px solid var(--color-border);
}

.find-duplicates__note {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-3);
  padding: var(--spacing-3) var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
}

.find-duplicates__note:last-child {
  border-bottom: none;
}

.find-duplicates__note-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.find-duplicates__note-field {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  word-break: break-word;
}

.find-duplicates__note-preview {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.find-duplicates__note-meta {
  display: flex;
  gap: var(--spacing-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.find-duplicates__note-deck {
  padding: var(--spacing-0-5) var(--spacing-1-5);
  background: var(--color-surface-elevated);
  border-radius: var(--radius-sm);
}

.find-duplicates__note-tags {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.find-duplicates__note-actions {
  display: flex;
  gap: var(--spacing-2);
  flex-shrink: 0;
}

/* Confirm modal */
.find-duplicates__confirm p {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  line-height: var(--line-height-relaxed);
}

@media (max-width: 600px) {
  .find-duplicates__options {
    flex-direction: column;
    align-items: stretch;
  }

  .find-duplicates__option {
    min-width: auto;
  }

  .find-duplicates__note {
    flex-direction: column;
  }

  .find-duplicates__note-actions {
    align-self: flex-end;
  }
}
</style>
