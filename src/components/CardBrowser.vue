<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ankiDataSig, mediaFilesSig } from "../stores";
import { getRenderedCardString } from "../utils/render";
import { sanitizeHtmlForPreview } from "../utils/sanitize";
import { playAudio } from "../utils/sound";

type ViewMode = "cards" | "notes";
const viewMode = ref<ViewMode>("notes");
const searchQuery = ref("");
const filterDeck = ref<string | null>(null);
const filterTag = ref<string | null>(null);
const sortColumn = ref<string>("sort-field");
const sortAsc = ref(true);
const selectedRowKey = ref<string | null>(null);

// Reset selection when switching modes
watch(viewMode, () => {
  selectedRowKey.value = null;
});

/** Strip HTML and sound tags to plain text for display and search */
function stripHtml(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/\[sound:[^\]]+\]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/** All unique field names across all cards */
const fieldNames = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [];
  const names = new Set<string>();
  for (const card of data.cards) {
    for (const key of Object.keys(card.values)) names.add(key);
  }
  return Array.from(names);
});

/** All unique tags */
const allTags = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [];
  const tags = new Set<string>();
  for (const card of data.cards) {
    for (const tag of card.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
});

/** All unique deck names */
const allDecks = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [];
  const decks = new Set<string>();
  for (const card of data.cards) decks.add(card.deckName);
  return Array.from(decks).sort();
});

// ── Row types ──

type NoteRow = {
  kind: "note";
  key: string; // guid
  index: number; // first card index for this note
  sortField: string;
  fields: Record<string, string>;
  deck: string;
  tags: string[];
  cardCount: number;
  templateNames: string;
};

type CardRow = {
  kind: "card";
  key: string; // card index as string
  index: number;
  sortField: string;
  fields: Record<string, string>;
  deck: string;
  tags: string[];
  templateName: string;
  type: string;
  queue: string;
  due: string;
  interval: string;
  ease: string;
  reviews: string;
  lapses: string;
};

type Row = NoteRow | CardRow;

const rows = computed<Row[]>(() => {
  const data = ankiDataSig.value;
  if (!data) return [];

  if (viewMode.value === "notes") {
    // Group by guid — one row per note
    const noteMap = new Map<string, { indices: number[] }>();
    for (let i = 0; i < data.cards.length; i++) {
      const card = data.cards[i]!;
      const existing = noteMap.get(card.guid);
      if (existing) {
        existing.indices.push(i);
      } else {
        noteMap.set(card.guid, { indices: [i] });
      }
    }

    const result: NoteRow[] = [];
    for (const [guid, { indices }] of noteMap) {
      const firstCard = data.cards[indices[0]!]!;
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(firstCard.values)) {
        fields[k] = stripHtml(v);
      }

      // Collect all template names across cards for this note
      const tplNames = new Set<string>();
      for (const idx of indices) {
        for (const t of data.cards[idx]!.templates) tplNames.add(t.name);
      }

      result.push({
        kind: "note",
        key: guid,
        index: indices[0]!,
        sortField: Object.values(fields)[0] ?? "",
        fields,
        deck: firstCard.deckName,
        tags: firstCard.tags,
        cardCount: indices.length,
        templateNames: Array.from(tplNames).join(", "),
      });
    }
    return result;
  }

  // Cards mode
  const result: CardRow[] = [];
  for (let i = 0; i < data.cards.length; i++) {
    const card = data.cards[i]!;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(card.values)) {
      fields[k] = stripHtml(v);
    }

    const sched = card.scheduling;
    result.push({
      kind: "card",
      key: String(i),
      index: i,
      sortField: Object.values(fields)[0] ?? "",
      fields,
      deck: card.deckName,
      tags: card.tags,
      templateName: card.templates[0]?.name ?? "",
      type: sched?.typeName ?? "new",
      queue: sched?.queueName ?? "new",
      due: sched ? formatDue(sched) : "",
      interval: sched ? formatInterval(sched.ivl, sched.ivlUnit) : "",
      ease: sched?.easeFactor != null ? `${Math.round(sched.easeFactor * 100)}%` : "",
      reviews: sched ? String(sched.reps) : "0",
      lapses: sched ? String(sched.lapses) : "0",
    });
  }
  return result;
});

function formatDue(sched: { dueType: string; due: number }): string {
  if (sched.dueType === "position") return `#${sched.due}`;
  if (sched.dueType === "timestamp") {
    return new Date(sched.due * 1000).toLocaleDateString();
  }
  if (sched.dueType === "dayOffset" || sched.dueType === "dayLearningOffset") {
    return `${sched.due}d`;
  }
  return String(sched.due);
}

function formatInterval(ivl: number, unit: string): string {
  if (unit === "seconds") {
    if (ivl < 60) return `${ivl}s`;
    if (ivl < 3600) return `${Math.round(ivl / 60)}m`;
    return `${Math.round(ivl / 3600)}h`;
  }
  if (ivl === 0) return "";
  if (ivl < 30) return `${ivl}d`;
  if (ivl < 365) return `${(ivl / 30).toFixed(1)}mo`;
  return `${(ivl / 365).toFixed(1)}y`;
}

/** Filtered + sorted rows */
const filteredRows = computed(() => {
  const q = searchQuery.value.toLowerCase();
  const deckFilter = filterDeck.value;
  const tagFilter = filterTag.value;

  let result = rows.value;

  if (deckFilter) {
    result = result.filter((r) => r.deck === deckFilter || r.deck.startsWith(deckFilter + "::"));
  }

  if (tagFilter) {
    result = result.filter((r) => r.tags.includes(tagFilter));
  }

  if (q) {
    result = result.filter((row) => {
      for (const v of Object.values(row.fields)) {
        if (v.toLowerCase().includes(q)) return true;
      }
      if (row.deck.toLowerCase().includes(q)) return true;
      if (row.tags.some((t) => t.toLowerCase().includes(q))) return true;
      if (row.kind === "card" && row.templateName.toLowerCase().includes(q)) return true;
      if (row.kind === "note" && row.templateNames.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // Sort
  const col = sortColumn.value;
  const asc = sortAsc.value;
  const sorted = [...result].sort((a, b) => {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);
    const cmp = va.localeCompare(vb, undefined, { numeric: true });
    return asc ? cmp : -cmp;
  });

  return sorted;
});

function getSortValue(row: Row, col: string): string {
  if (col === "sort-field") return row.sortField;
  if (col === "deck") return row.deck;
  if (col === "tags") return row.tags.join(" ");
  if (col in row.fields) return row.fields[col] ?? "";

  if (row.kind === "note") {
    if (col === "cards") return String(row.cardCount);
    if (col === "card-type") return row.templateNames;
    return "";
  }

  // Card-specific columns
  if (col === "card-type") return row.templateName;
  if (col === "type") return row.type;
  if (col === "queue") return row.queue;
  if (col === "due") return row.due;
  if (col === "interval") return row.interval;
  if (col === "ease") return row.ease;
  if (col === "reviews") return row.reviews;
  if (col === "lapses") return row.lapses;
  return "";
}

function handleSort(col: string) {
  if (sortColumn.value === col) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortColumn.value = col;
    sortAsc.value = true;
  }
}

function sortIndicator(col: string): string {
  if (sortColumn.value !== col) return "";
  return sortAsc.value ? " \u25B4" : " \u25BE";
}

// ── Columns ──

const noteMetaColumns = [
  { key: "deck", label: "Deck" },
  { key: "tags", label: "Tags" },
  { key: "card-type", label: "Card Type" },
  { key: "cards", label: "Cards" },
];

const cardMetaColumns = [
  { key: "deck", label: "Deck" },
  { key: "tags", label: "Tags" },
  { key: "card-type", label: "Card Type" },
  { key: "type", label: "Type" },
  { key: "queue", label: "Queue" },
  { key: "due", label: "Due" },
  { key: "interval", label: "Interval" },
  { key: "ease", label: "Ease" },
  { key: "reviews", label: "Reviews" },
  { key: "lapses", label: "Lapses" },
];

const visibleColumns = computed(() => {
  const cols: { key: string; label: string }[] = [];
  for (const name of fieldNames.value) {
    cols.push({ key: name, label: name });
  }
  const meta = viewMode.value === "notes" ? noteMetaColumns : cardMetaColumns;
  cols.push(...meta);
  return cols;
});

function getCellValue(row: Row, col: string): string {
  if (col === "deck") return row.deck;
  if (col === "tags") return row.tags.join(", ");
  if (col in row.fields) return row.fields[col] ?? "";

  if (row.kind === "note") {
    if (col === "card-type") return row.templateNames;
    if (col === "cards") return String(row.cardCount);
    return "";
  }

  if (col === "card-type") return row.templateName;
  if (col === "type") return row.type;
  if (col === "queue") return row.queue;
  if (col === "due") return row.due;
  if (col === "interval") return row.interval;
  if (col === "ease") return row.ease;
  if (col === "reviews") return row.reviews;
  if (col === "lapses") return row.lapses;
  return "";
}

// ── Detail pane ──

const selectedCard = computed(() => {
  const data = ankiDataSig.value;
  const key = selectedRowKey.value;
  if (!data || key === null) return null;

  const row = filteredRows.value.find((r) => r.key === key);
  if (!row) return null;
  return data.cards[row.index] ?? null;
});

const selectedPreview = computed(() => {
  const card = selectedCard.value;
  if (!card || card.templates.length === 0) return null;
  const template = card.templates[0]!;
  const html = getRenderedCardString({
    templateString: template.qfmt,
    variables: { ...card.values },
    mediaFiles: mediaFilesSig.value,
  });
  return sanitizeHtmlForPreview(html);
});

const SOUND_ICON_SVG =
  '<svg style="height:1em;width:1em;vertical-align:middle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M625.9 115c-5.9 0-11.9 1.6-17.4 5.3L254 352H90c-8.8 0-16 7.2-16 16v288c0 8.8 7.2 16 16 16h164l354.5 231.7c5.5 3.6 11.6 5.3 17.4 5.3c16.7 0 32.1-13.3 32.1-32.1V147.1c0-18.8-15.4-32.1-32.1-32.1zM586 803L293.4 611.7l-18-11.7H146V424h129.4l17.9-11.7L586 221v582zm348-327H806c-8.8 0-16 7.2-16 16v40c0 8.8 7.2 16 16 16h128c8.8 0 16-7.2 16-16v-40c0-8.8-7.2-16-16-16zm-41.9 261.8l-110.3-63.7a15.9 15.9 0 0 0-21.7 5.9l-19.9 34.5c-4.4 7.6-1.8 17.4 5.8 21.8L856.3 800a15.9 15.9 0 0 0 21.7-5.9l19.9-34.5c4.4-7.6 1.7-17.4-5.8-21.8zM760 344a15.9 15.9 0 0 0 21.7 5.9L892 286.2c7.6-4.4 10.2-14.2 5.8-21.8L878 230a15.9 15.9 0 0 0-21.7-5.9L746 287.8a15.99 15.99 0 0 0-5.8 21.8L760 344z" fill="currentColor"></path></svg>';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Render a field value with media URLs resolved and sound tags as buttons */
function renderFieldHtml(html: string | null): string {
  if (!html) return "";
  // Convert [sound:...] tags to clickable audio buttons
  let result = html.replace(/\[sound:(.+?)\]/g, (_match, filename) => {
    return `<button class="sound-btn" style="color: var(--color-text-secondary)" data-sound-file="${filename}">${SOUND_ICON_SVG}</button>`;
  });
  // Replace media filenames with blob URLs only inside attribute values
  for (const [filename, url] of mediaFilesSig.value) {
    result = result.replace(
      new RegExp(`((?:src|data-sound-file)="[^"]*?)${escapeRegExp(filename)}`, "g"),
      `$1${url}`,
    );
  }
  return sanitizeHtmlForPreview(result);
}

/** Handle clicks on sound buttons in the detail pane */
function handleDetailClick(event: Event) {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".sound-btn");
  if (!btn) return;
  const src = btn.dataset.soundFile;
  if (src) playAudio(src);
}
</script>

<template>
  <div class="browser">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="view-toggle">
          <button
            :class="['toggle-btn', { 'toggle-btn--active': viewMode === 'notes' }]"
            @click="viewMode = 'notes'"
          >
            Notes
          </button>
          <button
            :class="['toggle-btn', { 'toggle-btn--active': viewMode === 'cards' }]"
            @click="viewMode = 'cards'"
          >
            Cards
          </button>
        </div>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Filter..."
        />
        <select v-model="filterDeck" class="filter-select">
          <option :value="null">All decks</option>
          <option v-for="deck in allDecks" :key="deck" :value="deck">{{ deck }}</option>
        </select>
        <select v-if="allTags.length > 0" v-model="filterTag" class="filter-select">
          <option :value="null">All tags</option>
          <option v-for="tag in allTags" :key="tag" :value="tag">{{ tag }}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <span class="result-count">{{ filteredRows.length }} {{ viewMode }}</span>
      </div>
    </div>

    <div v-if="!ankiDataSig" class="empty-state">
      <p class="empty-text">No deck loaded. Load a deck from the Review tab first.</p>
    </div>

    <div v-else class="browser-body">
      <!-- Table -->
      <div class="table-wrap">
        <table class="browse-table">
          <thead>
            <tr>
              <th
                v-for="col in visibleColumns"
                :key="col.key"
                class="th"
                @click="handleSort(col.key)"
              >
                {{ col.label }}{{ sortIndicator(col.key) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRows"
              :key="row.key"
              :class="['tr', { 'tr--selected': selectedRowKey === row.key }]"
              @click="selectedRowKey = row.key"
            >
              <td
                v-for="col in visibleColumns"
                :key="col.key"
                class="td"
              >
                {{ getCellValue(row, col.key) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Detail pane -->
      <div v-if="selectedCard" class="detail-pane" @click="handleDetailClick">
        <div class="detail-header">
          <h3 class="detail-title">{{ selectedCard.deckName }}</h3>
          <span class="detail-meta">{{ selectedCard.templates.map(t => t.name).join(", ") }}</span>
        </div>
        <div v-if="selectedPreview" class="detail-preview" v-html="selectedPreview" />
        <div class="detail-fields">
          <div v-for="(val, key) in selectedCard.values" :key="key" class="detail-field">
            <div class="detail-field-label">{{ key }}</div>
            <div class="detail-field-value" v-html="renderFieldHtml(val)" />
          </div>
        </div>
        <div v-if="selectedCard.tags.length > 0" class="detail-tags">
          <span v-for="tag in selectedCard.tags" :key="tag" class="tag-badge">{{ tag }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 44px);
  overflow: hidden;
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex: 1;
  min-width: 0;
}

.toolbar-right {
  flex-shrink: 0;
}

.view-toggle {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
}

.toggle-btn {
  padding: var(--spacing-1) var(--spacing-2-5);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: none;
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.toggle-btn:hover {
  background: var(--color-surface-hover);
}

.toggle-btn--active {
  color: var(--color-primary);
  background: var(--color-surface-elevated);
}

.search-input {
  flex: 1;
  min-width: 120px;
  max-width: 300px;
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: var(--transition-colors);
}

.search-input:focus {
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.search-input::placeholder {
  color: var(--color-text-tertiary);
}

.filter-select {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  outline: none;
  max-width: 180px;
}

.filter-select:focus {
  border-color: var(--color-border-focus);
}

.result-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

/* Empty state */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.empty-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

/* Browser body: table + optional detail */
.browser-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

@media (min-width: 900px) {
  .browser-body {
    flex-direction: row;
  }
}

/* Table */
.table-wrap {
  flex: 1;
  overflow: auto;
  min-width: 0;
}

.browse-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-xs);
  table-layout: auto;
}

.th {
  position: sticky;
  top: 0;
  padding: var(--spacing-1-5) var(--spacing-2);
  text-align: left;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  z-index: 1;
}

.th:hover {
  color: var(--color-text-primary);
}

.tr {
  cursor: pointer;
  transition: background 0.1s;
}

.tr:hover {
  background: var(--color-surface-hover);
}

.tr--selected {
  background: var(--color-surface-elevated);
}

.td {
  padding: var(--spacing-1) var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Detail pane — bottom on narrow, right side on wide */
.detail-pane {
  flex-shrink: 0;
  max-height: 40%;
  overflow-y: auto;
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

@media (min-width: 900px) {
  .detail-pane {
    max-height: none;
    width: 340px;
    border-top: none;
    border-left: 1px solid var(--color-border);
  }
}

.detail-header {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-2);
}

.detail-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.detail-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.detail-preview {
  padding: var(--spacing-2) var(--spacing-3);
  margin-bottom: var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  word-break: break-word;
}

.detail-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-0-5);
}

.detail-field-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

.detail-field-value {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  word-break: break-word;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-1);
  margin-top: var(--spacing-2);
}

.tag-badge {
  padding: 1px var(--spacing-1-5);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.detail-field-value :deep(.sound-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-0-5) var(--spacing-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  vertical-align: middle;
}

.detail-field-value :deep(.sound-btn:hover) {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}
</style>
