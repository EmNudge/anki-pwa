<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Button } from "../design-system";
import {
  checkOllamaAvailable,
  getOllamaModels,
  generateAnkiDeck,
  type AnkiDeckSpec,
} from "../lib/ollama";
import { createApkg } from "../ankiExporter";
import { addCachedFile } from "../stores";

// --- Generated deck cache (Cache API + localStorage index) ---

type GeneratedEntry = { name: string; deckName: string; cardCount: number; createdAt: number };

const GENERATED_STORAGE_KEY = "anki-ai-generated";
const GENERATED_CACHE_PREFIX = "/ai-generated/";

function readGeneratedEntries(): GeneratedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(GENERATED_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeGeneratedEntries(entries: GeneratedEntry[]) {
  localStorage.setItem(GENERATED_STORAGE_KEY, JSON.stringify(entries));
}

const generatedEntries = ref<GeneratedEntry[]>(readGeneratedEntries());

const cachePromise = caches.open("anki-ai-cache");

async function cacheGeneratedDeck(spec: AnkiDeckSpec, blob: Blob): Promise<string> {
  const name = `${spec.deckName.replace(/[^a-zA-Z0-9 _-]/g, "")}-${Date.now()}.apkg`;
  const cache = await cachePromise;
  await cache.put(GENERATED_CACHE_PREFIX + name, new Response(blob));

  const entry: GeneratedEntry = {
    name,
    deckName: spec.deckName,
    cardCount: spec.cards.length,
    createdAt: Date.now(),
  };
  generatedEntries.value = [...generatedEntries.value, entry];
  writeGeneratedEntries(generatedEntries.value);
  return name;
}

async function loadGeneratedBlob(name: string): Promise<Blob | null> {
  const cache = await cachePromise;
  const response = await cache.match(GENERATED_CACHE_PREFIX + name);
  return response ? response.blob() : null;
}

async function deleteGeneratedEntry(name: string) {
  const cache = await cachePromise;
  await cache.delete(GENERATED_CACHE_PREFIX + name);
  generatedEntries.value = generatedEntries.value.filter((e) => e.name !== name);
  writeGeneratedEntries(generatedEntries.value);
}

// --- Active state ---

const ollamaAvailable = ref<boolean | null>(null);
const models = ref<string[]>([]);
const selectedModel = ref("");
const documentText = ref("");
const instructions = ref("");
const status = ref<"idle" | "generating" | "building" | "done" | "error">("idle");
const errorMessage = ref("");
const generatedSpec = ref<AnkiDeckSpec | null>(null);
const generatedBlob = ref<Blob | null>(null);
const activeName = ref<string | null>(null);

onMounted(async () => {
  const available = await checkOllamaAvailable();
  ollamaAvailable.value = available;
  if (available) {
    models.value = await getOllamaModels();
    if (models.value.length > 0) {
      selectedModel.value = models.value[0]!;
    }
  }
});

async function handleGenerate() {
  if (!documentText.value.trim()) return;

  status.value = "generating";
  errorMessage.value = "";
  generatedSpec.value = null;
  generatedBlob.value = null;
  activeName.value = null;

  try {
    const spec = await generateAnkiDeck(documentText.value, instructions.value, selectedModel.value);
    generatedSpec.value = spec;

    status.value = "building";
    const blob = await createApkg(spec);
    generatedBlob.value = blob;

    activeName.value = await cacheGeneratedDeck(spec, blob);
    status.value = "done";
  } catch (e) {
    status.value = "error";
    errorMessage.value = e instanceof Error ? e.message : String(e);
  }
}

function handleDownload() {
  if (!generatedBlob.value || !generatedSpec.value) return;

  const url = URL.createObjectURL(generatedBlob.value);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${generatedSpec.value.deckName.replace(/[^a-zA-Z0-9 _-]/g, "")}.apkg`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleDownloadEntry(entry: GeneratedEntry) {
  const blob = await loadGeneratedBlob(entry.name);
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = entry.name;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleLoadInApp() {
  if (!generatedBlob.value || !generatedSpec.value) return;

  const filename = `${generatedSpec.value.deckName.replace(/[^a-zA-Z0-9 _-]/g, "")}.apkg`;
  const file = new File([generatedBlob.value], filename, { type: "application/octet-stream" });
  await addCachedFile(file);
}

async function handleLoadEntryInApp(entry: GeneratedEntry) {
  const blob = await loadGeneratedBlob(entry.name);
  if (!blob) return;

  const file = new File([blob], entry.name, { type: "application/octet-stream" });
  await addCachedFile(file);
}

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    documentText.value = reader.result as string;
  };
  reader.readAsText(file);
  input.value = "";
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="ai-generator">
    <h2 class="title">AI Deck Generator</h2>

    <div v-if="ollamaAvailable === null" class="status-message">Checking Ollama availability...</div>

    <div v-else-if="!ollamaAvailable" class="status-message status-message--error">
      <p>
        Ollama is not running at <code>localhost:11434</code>. Start Ollama to use the AI deck
        generator.
      </p>
      <p class="hint">
        Install from <code>ollama.com</code>, then run <code>ollama serve</code> and
        <code>ollama pull gemma3</code>.
      </p>
    </div>

    <template v-else>
      <p class="description">
        Paste or upload a document and Ollama will generate Anki flashcards from it. You can
        download the result as an .apkg file or load it directly into the app.
      </p>

      <div class="controls">
        <label class="control-label">
          Model:
          <select v-model="selectedModel" class="control-select">
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>

        <label class="control-label">
          <input type="file" accept=".txt,.md,.html,.csv,.json" class="file-input" @change="handleFileUpload" />
          <span class="file-btn">Upload document</span>
        </label>
      </div>

      <textarea
        v-model="documentText"
        class="input-area"
        placeholder="Paste your document content here..."
        rows="10"
      />

      <textarea
        v-model="instructions"
        class="input-area input-area--small"
        placeholder="Optional: extra instructions (e.g. 'focus on vocabulary', 'make cloze cards', 'create 20 cards max')"
        rows="3"
      />

      <div class="actions">
        <Button
          variant="primary"
          :loading="status === 'generating' || status === 'building'"
          :disabled="!documentText.trim() || status === 'generating' || status === 'building'"
          @click="handleGenerate"
        >
          {{ status === "generating" ? "Generating cards..." : status === "building" ? "Building .apkg..." : "Generate Deck" }}
        </Button>
      </div>

      <div v-if="status === 'error'" class="status-message status-message--error">
        {{ errorMessage }}
      </div>

      <div v-if="generatedSpec && status === 'done'" class="result-section">
        <div class="result-header">
          <h3 class="result-title">{{ generatedSpec.deckName }}</h3>
          <span class="result-count">{{ generatedSpec.cards.length }} cards</span>
        </div>

        <div class="table-wrapper">
          <table class="preview-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th>Front</th>
                <th>Back</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(card, i) in generatedSpec.cards" :key="i">
                <td class="col-num">{{ i + 1 }}</td>
                <td>{{ card.front }}</td>
                <td>{{ card.back }}</td>
                <td class="col-tags">{{ (card.tags ?? []).join(", ") }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="result-actions">
          <Button variant="primary" @click="handleDownload">Download .apkg</Button>
          <Button variant="secondary" @click="handleLoadInApp">Load in app</Button>
        </div>
      </div>

      <div v-if="generatedEntries.length > 0" class="history-section">
        <h3 class="history-title">Previously Generated</h3>
        <ul class="history-list">
          <li
            v-for="entry in [...generatedEntries].reverse()"
            :key="entry.name"
            :class="['history-item', { 'history-item--active': entry.name === activeName }]"
          >
            <div class="history-info">
              <span class="history-name">{{ entry.deckName }}</span>
              <span class="history-meta">{{ entry.cardCount }} cards · {{ formatDate(entry.createdAt) }}</span>
            </div>
            <div class="history-actions">
              <button class="history-btn" @click="handleDownloadEntry(entry)">Download</button>
              <button class="history-btn" @click="handleLoadEntryInApp(entry)">Load</button>
              <button class="history-btn history-btn--danger" @click="deleteGeneratedEntry(entry.name)">Delete</button>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-generator {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--spacing-8) var(--spacing-4);
}

.title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-2) 0;
}

.description {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin: 0 0 var(--spacing-4) 0;
}

.status-message {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  padding: var(--spacing-4);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
}

.status-message--error {
  color: var(--color-error-500);
  border-color: var(--color-error-500);
}

.status-message code {
  background: var(--color-surface);
  padding: 0 var(--spacing-1);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.hint {
  margin-top: var(--spacing-2);
  opacity: 0.8;
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
  margin-bottom: var(--spacing-3);
  flex-wrap: wrap;
}

.control-label {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.control-select {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.file-input {
  display: none;
}

.file-btn {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
}

.file-btn:hover {
  background: var(--color-surface-elevated);
  border-color: var(--color-border-hover);
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

.input-area--small {
  min-height: auto;
  margin-top: var(--spacing-3);
  font-family: var(--font-family-sans);
}

.input-area::placeholder {
  color: var(--color-text-tertiary);
}

.input-area:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.actions {
  margin-top: var(--spacing-4);
}

.result-section {
  margin-top: var(--spacing-6);
}

.result-header {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-2);
}

.result-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.result-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.note-types {
  display: flex;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-4);
}

.note-type-badge {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
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

.col-type {
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.col-tags {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.field-row {
  margin-bottom: var(--spacing-1);
}

.field-row:last-child {
  margin-bottom: 0;
}

.field-name {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  margin-right: var(--spacing-1);
}

.field-value {
  color: var(--color-text-primary);
}

.result-actions {
  display: flex;
  gap: var(--spacing-3);
}

.history-section {
  margin-top: var(--spacing-8);
  border-top: 1px solid var(--color-border);
  padding-top: var(--spacing-6);
}

.history-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-3) 0;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.history-item--active {
  border-color: var(--color-primary-500);
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  min-width: 0;
}

.history-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.history-actions {
  display: flex;
  gap: var(--spacing-2);
  flex-shrink: 0;
}

.history-btn {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.history-btn:hover {
  background: var(--color-surface-elevated);
  color: var(--color-text-primary);
}

.history-btn--danger:hover {
  color: var(--color-error-500);
  border-color: var(--color-error-500);
}
</style>
