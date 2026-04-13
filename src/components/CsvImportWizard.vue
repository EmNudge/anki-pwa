<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Button } from "../design-system";
import { createApkg } from "../ankiExporter";
import { addCachedFile } from "../stores";
import { downloadBlob } from "../utils/downloadBlob";
import {
  parseCsv,
  detectDelimiter,
  resolveDelimiter,
  type DelimiterName,
} from "../utils/csvParser";

type DuplicatePolicy = "skip" | "update" | "create";
type WizardStep = "upload" | "configure" | "map" | "preview";

const PREVIEW_ROW_COUNT = 10;

const step = ref<WizardStep>("upload");
const fileText = ref("");
const fileName = ref("");
const delimiterName = ref<DelimiterName>("comma");
const customDelimiter = ref("");
const hasHeaderRow = ref(true);
const deckName = ref("Imported Deck");
const duplicatePolicy = ref<DuplicatePolicy>("create");
const importStatus = ref<"idle" | "building" | "done" | "error">("idle");
const errorMessage = ref("");

// fieldMap[csvColumnIndex] = ankiFieldName ("front" | "back" | "tags" | "skip")
const fieldMap = ref<string[]>([]);

const delimiter = computed(() => resolveDelimiter(delimiterName.value, customDelimiter.value));

const allRows = computed(() => {
  if (!fileText.value) return [];
  return parseCsv(fileText.value, delimiter.value);
});

const headers = computed(() => {
  if (allRows.value.length === 0) return [];
  if (hasHeaderRow.value) return allRows.value[0] ?? [];
  const colCount = allRows.value[0]?.length ?? 0;
  return Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
});

const dataRows = computed(() => {
  if (allRows.value.length === 0) return [];
  return hasHeaderRow.value ? allRows.value.slice(1) : allRows.value;
});

const previewRows = computed(() => dataRows.value.slice(0, PREVIEW_ROW_COUNT));

const ankiFields = ["Front", "Back", "Tags", "(skip)"] as const;

// Initialize field map when columns change
watch(headers, (newHeaders) => {
  fieldMap.value = newHeaders.map((_, i) => {
    if (i === 0) return "Front";
    if (i === 1) return "Back";
    return "(skip)";
  });
});

const mappedCards = computed(() => {
  const frontIdx = fieldMap.value.indexOf("Front");
  const backIdx = fieldMap.value.indexOf("Back");
  const tagIdx = fieldMap.value.indexOf("Tags");

  if (frontIdx === -1) return [];

  return dataRows.value
    .map((row) => ({
      front: (row[frontIdx] ?? "").trim(),
      back: frontIdx !== -1 && backIdx !== -1 ? (row[backIdx] ?? "").trim() : "",
      tags:
        tagIdx !== -1
          ? (row[tagIdx] ?? "")
              .split(/[,;]/)
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
    }))
    .filter((card) => card.front.length > 0);
});

const hasFrontMapping = computed(() => fieldMap.value.includes("Front"));
const hasBackMapping = computed(() => fieldMap.value.includes("Back"));

const duplicateCount = computed(() => {
  if (duplicatePolicy.value === "create") return 0;
  const seen = new Set<string>();
  let dupes = 0;
  for (const card of mappedCards.value) {
    if (seen.has(card.front)) {
      dupes++;
    } else {
      seen.add(card.front);
    }
  }
  return dupes;
});

const dedupedCards = computed(() => {
  if (duplicatePolicy.value === "create") return mappedCards.value;

  const seen = new Map<string, (typeof mappedCards.value)[number]>();
  const result: typeof mappedCards.value = [];

  for (const card of mappedCards.value) {
    const existing = seen.get(card.front);
    if (existing) {
      if (duplicatePolicy.value === "update") {
        // Replace existing with newer
        const idx = result.indexOf(existing);
        if (idx !== -1) result[idx] = card;
        seen.set(card.front, card);
      }
      // "skip" just ignores duplicates
    } else {
      seen.set(card.front, card);
      result.push(card);
    }
  }

  return result;
});

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  fileName.value = file.name;
  deckName.value = file.name.replace(/\.[^.]+$/, "");

  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    fileText.value = text;
    delimiterName.value = detectDelimiter(text);
    step.value = "configure";
  };
  reader.readAsText(file);
  input.value = "";
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;

  fileName.value = file.name;
  deckName.value = file.name.replace(/\.[^.]+$/, "");

  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    fileText.value = text;
    delimiterName.value = detectDelimiter(text);
    step.value = "configure";
  };
  reader.readAsText(file);
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
}

function goToStep(target: WizardStep) {
  step.value = target;
}

async function handleExportApkg() {
  if (dedupedCards.value.length === 0) return;

  importStatus.value = "building";
  errorMessage.value = "";

  try {
    const blob = await createApkg({
      deckName: deckName.value,
      cards: dedupedCards.value.map((c) => ({
        front: c.front,
        back: c.back,
        tags: c.tags,
      })),
    });

    downloadBlob(blob, `${deckName.value.replace(/[^a-zA-Z0-9 _-]/g, "")}.apkg`);
    importStatus.value = "done";
  } catch (e) {
    importStatus.value = "error";
    errorMessage.value = e instanceof Error ? e.message : String(e);
  }
}

async function handleLoadInApp() {
  if (dedupedCards.value.length === 0) return;

  importStatus.value = "building";
  errorMessage.value = "";

  try {
    const blob = await createApkg({
      deckName: deckName.value,
      cards: dedupedCards.value.map((c) => ({
        front: c.front,
        back: c.back,
        tags: c.tags,
      })),
    });

    const filename = `${deckName.value.replace(/[^a-zA-Z0-9 _-]/g, "")}.apkg`;
    const file = new File([blob], filename, { type: "application/octet-stream" });
    await addCachedFile(file);
    importStatus.value = "done";
  } catch (e) {
    importStatus.value = "error";
    errorMessage.value = e instanceof Error ? e.message : String(e);
  }
}

function handleReset() {
  step.value = "upload";
  fileText.value = "";
  fileName.value = "";
  fieldMap.value = [];
  importStatus.value = "idle";
  errorMessage.value = "";
}
</script>

<template>
  <div class="csv-wizard">
    <!-- Step indicators -->
    <div class="steps">
      <button
        v-for="(s, i) in ['upload', 'configure', 'map', 'preview'] as const"
        :key="s"
        :class="[
          'step-indicator',
          {
            'step-indicator--active': step === s,
            'step-indicator--done':
              (['upload', 'configure', 'map', 'preview'] as const).indexOf(step) > i,
          },
        ]"
        :disabled="(['upload', 'configure', 'map', 'preview'] as const).indexOf(step) < i"
        @click="goToStep(s)"
      >
        <span class="step-number">{{ i + 1 }}</span>
        <span class="step-label">{{
          { upload: "Upload", configure: "Configure", map: "Map Fields", preview: "Preview" }[s]
        }}</span>
      </button>
    </div>

    <!-- Step 1: Upload -->
    <div v-if="step === 'upload'" class="step-content">
      <div class="drop-zone" @drop="handleDrop" @dragover="handleDragOver">
        <p class="drop-text">Drop a CSV or TSV file here</p>
        <p class="drop-hint">or</p>
        <label class="file-upload-label">
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            class="file-input-hidden"
            @change="handleFileSelect"
          />
          <Button variant="primary" size="sm" as="span">Choose File</Button>
        </label>
      </div>
    </div>

    <!-- Step 2: Configure -->
    <div v-if="step === 'configure'" class="step-content">
      <p class="file-name">{{ fileName }}</p>

      <div class="config-grid">
        <label class="config-label">
          Delimiter
          <select v-model="delimiterName" class="config-select">
            <option value="comma">Comma (,)</option>
            <option value="tab">Tab</option>
            <option value="semicolon">Semicolon (;)</option>
            <option value="pipe">Pipe (|)</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label v-if="delimiterName === 'custom'" class="config-label">
          Custom delimiter
          <input
            v-model="customDelimiter"
            class="config-input"
            maxlength="4"
            placeholder="e.g. ::"
          />
        </label>

        <label class="config-label config-label--row">
          <input v-model="hasHeaderRow" type="checkbox" class="config-checkbox" />
          First row is a header
        </label>

        <label class="config-label">
          Deck name
          <input v-model="deckName" class="config-input" placeholder="My Deck" />
        </label>

        <label class="config-label">
          Duplicate handling (by first field)
          <select v-model="duplicatePolicy" class="config-select">
            <option value="create">Import all (allow duplicates)</option>
            <option value="skip">Skip duplicates</option>
            <option value="update">Update duplicates (keep latest)</option>
          </select>
        </label>
      </div>

      <!-- Quick preview of parsed data -->
      <div v-if="allRows.length > 0" class="quick-preview">
        <p class="quick-preview-info">
          {{ dataRows.length }} data rows detected, {{ headers.length }} columns
        </p>
        <div class="table-wrapper">
          <table class="preview-table">
            <thead>
              <tr>
                <th v-for="(h, i) in headers" :key="i">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, ri) in allRows.slice(hasHeaderRow ? 1 : 0, (hasHeaderRow ? 1 : 0) + 5)"
                :key="ri"
              >
                <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="step-actions">
        <Button variant="ghost" size="sm" @click="handleReset">Back</Button>
        <Button
          variant="primary"
          size="sm"
          :disabled="allRows.length === 0"
          @click="goToStep('map')"
        >
          Next: Map Fields
        </Button>
      </div>
    </div>

    <!-- Step 3: Map Fields -->
    <div v-if="step === 'map'" class="step-content">
      <p class="description">Map each CSV column to an Anki field.</p>

      <div class="mapping-grid">
        <div class="mapping-header">CSV Column</div>
        <div class="mapping-header">Anki Field</div>

        <template v-for="(header, i) in headers" :key="i">
          <div class="mapping-col-name">{{ header }}</div>
          <select v-model="fieldMap[i]" class="config-select">
            <option v-for="field in ankiFields" :key="field" :value="field">{{ field }}</option>
          </select>
        </template>
      </div>

      <p v-if="!hasFrontMapping" class="validation-error">
        You must map at least one column to "Front".
      </p>
      <p v-else-if="!hasBackMapping" class="validation-warning">
        No column mapped to "Back" -- cards will have empty backs.
      </p>

      <div class="step-actions">
        <Button variant="ghost" size="sm" @click="goToStep('configure')">Back</Button>
        <Button
          variant="primary"
          size="sm"
          :disabled="!hasFrontMapping"
          @click="goToStep('preview')"
        >
          Next: Preview
        </Button>
      </div>
    </div>

    <!-- Step 4: Preview & Import -->
    <div v-if="step === 'preview'" class="step-content">
      <div class="preview-header">
        <h3 class="preview-title">{{ deckName }}</h3>
        <span class="preview-count">
          {{ dedupedCards.length }} cards
          <template v-if="duplicateCount > 0">
            ({{ duplicateCount }} duplicates
            {{ duplicatePolicy === "skip" ? "skipped" : "merged" }})
          </template>
        </span>
      </div>

      <div class="table-wrapper">
        <table class="preview-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th>Front</th>
              <th>Back</th>
              <th v-if="fieldMap.includes('Tags')">Tags</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(card, i) in dedupedCards.slice(0, PREVIEW_ROW_COUNT)" :key="i">
              <td class="col-num">{{ i + 1 }}</td>
              <td>{{ card.front }}</td>
              <td>{{ card.back }}</td>
              <td v-if="fieldMap.includes('Tags')" class="col-tags">
                {{ (card.tags ?? []).join(", ") }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="dedupedCards.length > PREVIEW_ROW_COUNT" class="preview-truncated">
        Showing {{ PREVIEW_ROW_COUNT }} of {{ dedupedCards.length }} cards.
      </p>

      <div v-if="importStatus === 'error'" class="error-message">{{ errorMessage }}</div>
      <div v-if="importStatus === 'done'" class="success-message">Import complete.</div>

      <div class="step-actions">
        <Button variant="ghost" size="sm" @click="goToStep('map')">Back</Button>
        <Button
          variant="secondary"
          size="sm"
          :loading="importStatus === 'building'"
          :disabled="dedupedCards.length === 0"
          @click="handleExportApkg"
        >
          Download .apkg
        </Button>
        <Button
          variant="primary"
          size="sm"
          :loading="importStatus === 'building'"
          :disabled="dedupedCards.length === 0"
          @click="handleLoadInApp"
        >
          Load in App
        </Button>
      </div>

      <div v-if="importStatus === 'done'" class="step-actions">
        <Button variant="ghost" size="sm" @click="handleReset">Import Another</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.csv-wizard {
}

.steps {
  display: flex;
  gap: var(--spacing-1);
  margin-bottom: var(--spacing-6);
}

.step-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-1-5);
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.step-indicator:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.step-indicator--active {
  color: var(--color-primary);
  border-color: var(--color-primary-500);
  background: var(--color-surface-elevated);
}

.step-indicator--done {
  color: var(--color-text-secondary);
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: var(--font-size-xs);
  border-radius: var(--radius-full);
  background: var(--color-surface-elevated);
}

.step-indicator--active .step-number {
  background: var(--color-primary-500);
  color: var(--color-text-inverse);
}

.step-label {
  display: none;
}

@media (min-width: 500px) {
  .step-label {
    display: inline;
  }
}

.step-content {
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-2);
  padding: var(--spacing-8);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  transition: var(--transition-colors);
}

.drop-zone:hover {
  border-color: var(--color-border-hover);
  background: var(--color-surface-elevated);
}

.drop-text {
  margin: 0;
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
}

.drop-hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.file-input-hidden {
  display: none;
}

.file-upload-label {
  cursor: pointer;
}

.file-name {
  margin: 0 0 var(--spacing-4) 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.config-grid {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-4);
}

.config-label {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.config-label--row {
  flex-direction: row;
  align-items: center;
  gap: var(--spacing-2);
}

.config-select {
  padding: var(--spacing-1-5) var(--spacing-2);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-width: 300px;
}

.config-input {
  padding: var(--spacing-1-5) var(--spacing-2);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-width: 300px;
}

.config-input:focus,
.config-select:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.config-checkbox {
  accent-color: var(--color-primary-500);
}

.quick-preview {
  margin-bottom: var(--spacing-4);
}

.quick-preview-info {
  margin: 0 0 var(--spacing-2) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.description {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin: 0 0 var(--spacing-4) 0;
}

.mapping-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-2) var(--spacing-3);
  align-items: center;
  margin-bottom: var(--spacing-4);
  max-width: 500px;
}

.mapping-header {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mapping-col-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.validation-error {
  margin: 0 0 var(--spacing-3) 0;
  font-size: var(--font-size-sm);
  color: var(--color-error-500);
}

.validation-warning {
  margin: 0 0 var(--spacing-3) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.preview-header {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-3);
}

.preview-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  margin: 0;
}

.preview-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-4);
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
  vertical-align: top;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.col-tags {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.preview-truncated {
  margin: 0 0 var(--spacing-3) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.error-message {
  margin-bottom: var(--spacing-3);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-error-500);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-error-500);
  border-radius: var(--radius-md);
}

.success-message {
  margin-bottom: var(--spacing-3);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.step-actions {
  display: flex;
  gap: var(--spacing-3);
  margin-top: var(--spacing-4);
}
</style>
