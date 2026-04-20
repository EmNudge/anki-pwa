<script setup lang="ts">
import { ref, computed } from "vue";
import { Button, Page } from "../design-system";
import AiDeckGenerator from "./AiDeckGenerator.vue";
import CsvImportWizard from "./CsvImportWizard.vue";
import { downloadBlob } from "../utils/downloadBlob";

const mode = ref<"manual" | "csv" | "ai">("manual");
const rawInput = ref("");
const delimiter = ref<"tab" | "comma">("tab");

const parsedRows = computed(() => {
  const sep = delimiter.value === "tab" ? "\t" : ",";
  return rawInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(sep);
      return {
        front: (parts[0] ?? "").trim(),
        back: (parts[1] ?? "").trim(),
      };
    })
    .filter((row) => row.front.length > 0);
});

function exportDeck() {
  if (parsedRows.value.length === 0) return;

  const tsv = parsedRows.value.map((r) => `${r.front}\t${r.back}`).join("\n");
  downloadBlob(new Blob([tsv], { type: "text/plain" }), "deck.txt");
}
</script>

<template>
  <Page title="Create Deck">
    <div class="mode-toggle">
      <button
        :class="['mode-btn', { 'mode-btn--active': mode === 'manual' }]"
        @click="mode = 'manual'"
      >
        Manual
      </button>
      <button
        :class="['mode-btn', { 'mode-btn--active': mode === 'csv' }]"
        @click="mode = 'csv'"
      >
        CSV Import
      </button>
      <button :class="['mode-btn', { 'mode-btn--active': mode === 'ai' }]" @click="mode = 'ai'">
        AI Generate
      </button>
    </div>

    <template v-if="mode === 'manual'">
      <p class="description">
        Paste a table with two columns. Column 1 becomes the front of each card, column 2 becomes
        the back. Export as a text file you can import into Anki.
      </p>

      <div class="controls">
        <label class="delimiter-label">
          Delimiter:
          <select v-model="delimiter" class="delimiter-select">
            <option value="tab">Tab</option>
            <option value="comma">Comma</option>
          </select>
        </label>
      </div>

      <textarea
        v-model="rawInput"
        class="input-area"
        placeholder="Paste your table here&#10;front1&#9;back1&#10;front2&#9;back2"
        rows="10"
      />

      <div v-if="parsedRows.length > 0" class="preview-section" data-testid="preview-section">
        <div class="preview-header">
          <h3 class="preview-title">Preview ({{ parsedRows.length }} cards)</h3>
          <Button variant="primary" size="sm" @click="exportDeck"> Export .txt </Button>
        </div>
        <div class="table-wrapper">
          <table class="preview-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th>Front</th>
                <th>Back</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in parsedRows" :key="i">
                <td class="col-num">{{ i + 1 }}</td>
                <td>{{ row.front }}</td>
                <td>{{ row.back }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <CsvImportWizard v-else-if="mode === 'csv'" />

    <AiDeckGenerator v-else />
  </Page>
</template>

<style scoped>
.mode-toggle {
  display: flex;
  gap: var(--spacing-1);
  margin-bottom: var(--spacing-4);
  padding: var(--spacing-1);
  background: var(--color-surface-elevated);
  border-radius: var(--radius-md);
  width: fit-content;
}

.mode-btn {
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.mode-btn:hover {
  color: var(--color-text-primary);
}

.mode-btn--active {
  color: var(--color-text-primary);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.description {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin: 0 0 var(--spacing-4) 0;
}

.controls {
  margin-bottom: var(--spacing-3);
}

.delimiter-label {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.delimiter-select {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.input-area {
  width: 100%;
  min-height: 200px;
  padding: var(--spacing-3);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  resize: vertical;
  box-sizing: border-box;
  transition: var(--transition-colors);
}

.input-area::placeholder {
  color: var(--color-text-tertiary);
}

.input-area:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.preview-section {
  margin-top: var(--spacing-6);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-3);
}

.preview-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  margin: 0;
}

.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.preview-table th,
.preview-table td {
  padding: var(--spacing-2) var(--spacing-3);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.preview-table th {
  background: var(--color-surface-elevated);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.preview-table td {
  color: var(--color-text-primary);
}

.preview-table tbody tr:last-child td {
  border-bottom: none;
}

.col-num {
  width: 40px;
  color: var(--color-text-tertiary);
}
</style>
