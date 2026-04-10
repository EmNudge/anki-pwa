<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { ankiDataSig, mediaFilesSig, activeDeckSourceIdSig, updateNote } from "../stores";
import { getRenderedCardString } from "../utils/render";
import { sanitizeHtmlForPreview } from "../utils/sanitize";
import { playAudio } from "../utils/sound";
import Button from "../design-system/components/primitives/Button.vue";
import NoteEditModal from "./NoteEditModal.vue";

type ViewMode = "cards" | "notes";
const viewMode = ref<ViewMode>("notes");
const searchQuery = ref("");
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

/** All unique tags */
const allTags = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [] as string[];
  const tags = new Set<string>();
  for (const card of data.cards) {
    for (const tag of card.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
});

/** All unique deck names */
const allDecks = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [] as string[];
  const decks = new Set<string>();
  for (const card of data.cards) decks.add(card.deckName);
  return Array.from(decks).sort();
});

/** All unique template/note type names */
const allNoteTypes = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [] as string[];
  const names = new Set<string>();
  for (const card of data.cards) {
    for (const t of card.templates) names.add(t.name);
  }
  return Array.from(names).sort();
});

// ── Search parsing ──

type SearchToken =
  | { type: "text"; value: string }
  | { type: "deck"; value: string }
  | { type: "tag"; value: string }
  | { type: "is"; value: string }
  | { type: "flag"; value: number }
  | { type: "card"; value: string }
  | { type: "note"; value: string }
  | { type: "negate"; inner: SearchToken };

const IS_VALUES = ["new", "learn", "review", "due", "suspended", "buried"] as const;
const FLAG_VALUES = [
  { value: 0, label: "none" },
  { value: 1, label: "red" },
  { value: 2, label: "orange" },
  { value: 3, label: "green" },
  { value: 4, label: "blue" },
  { value: 5, label: "pink" },
  { value: 6, label: "turquoise" },
  { value: 7, label: "purple" },
] as const;

const QUALIFIERS = ["deck:", "tag:", "is:", "flag:", "card:", "note:"] as const;

function parseSearch(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  // Split on whitespace, but keep quoted strings together
  const regex = /(-?)(?:"([^"]*)"|(deck|tag|is|flag|card|note):(?:"([^"]*)"|(\S*))|(\S+))/gi;
  let match;
  while ((match = regex.exec(query)) !== null) {
    const negate = match[1] === "-";
    const quoted = match[2];
    const qualifier = match[3]?.toLowerCase();
    const qualifierValueQuoted = match[4];
    const qualifierValue = match[5];
    const plainWord = match[6];

    let token: SearchToken;
    if (quoted != null) {
      token = { type: "text", value: quoted };
    } else if (qualifier) {
      const val = qualifierValueQuoted ?? qualifierValue ?? "";
      switch (qualifier) {
        case "deck":
          token = { type: "deck", value: val };
          break;
        case "tag":
          token = { type: "tag", value: val };
          break;
        case "is":
          token = { type: "is", value: val.toLowerCase() };
          break;
        case "flag":
          token = { type: "flag", value: parseInt(val, 10) || 0 };
          break;
        case "card":
          token = { type: "card", value: val };
          break;
        case "note":
          token = { type: "note", value: val };
          break;
        default:
          token = { type: "text", value: `${qualifier}:${val}` };
      }
    } else {
      token = { type: "text", value: plainWord ?? "" };
    }

    tokens.push(negate ? { type: "negate", inner: token } : token);
  }
  return tokens;
}

// ── Autocomplete ──

const searchInputRef = ref<HTMLInputElement | null>(null);
const showAutocomplete = ref(false);
const selectedSuggestionIndex = ref(0);

type Suggestion = {
  /** The full text to insert (replaces the current token) */
  insert: string;
  /** What to display */
  label: string;
  /** Optional description shown dimmed */
  description?: string;
};

/** Extract the token currently being typed (from cursor position backwards) */
function getCurrentToken(input: string, cursorPos: number): { token: string; start: number } {
  // Walk backwards from cursor to find start of current token
  let start = cursorPos;
  while (start > 0 && input[start - 1] !== " ") {
    start--;
  }
  return { token: input.slice(start, cursorPos), start };
}

const suggestions = computed<Suggestion[]>(() => {
  const input = searchQuery.value;
  const cursor = searchInputRef.value?.selectionStart ?? input.length;
  const { token } = getCurrentToken(input, cursor);

  if (!token) return [];

  const lower = token.toLowerCase();
  const results: Suggestion[] = [];

  // Check if we're typing a negated token
  const isNegated = lower.startsWith("-");
  const prefix = isNegated ? "-" : "";
  const tokenBody = isNegated ? lower.slice(1) : lower;

  // Step 1: If no colon yet, suggest qualifier prefixes
  if (!tokenBody.includes(":")) {
    for (const q of QUALIFIERS) {
      if (q.startsWith(tokenBody) && tokenBody.length > 0) {
        results.push({
          insert: `${prefix}${q}`,
          label: `${prefix}${q}`,
          description: getQualifierHint(q),
        });
      }
    }
    // Also fall through to text search — don't return early so user sees qualifiers AND can just type text
    if (results.length > 0) return results;
    return [];
  }

  // Step 2: We have a qualifier — suggest values
  const colonIdx = tokenBody.indexOf(":");
  const qualifier = tokenBody.slice(0, colonIdx + 1);
  const valuePart = tokenBody.slice(colonIdx + 1).toLowerCase();

  switch (qualifier) {
    case "deck:":
      for (const d of allDecks.value) {
        if (d.toLowerCase().includes(valuePart)) {
          const val = d.includes(" ") ? `"${d}"` : d;
          results.push({ insert: `${prefix}deck:${val}`, label: d });
        }
      }
      break;
    case "tag:":
      for (const t of allTags.value) {
        if (t.toLowerCase().includes(valuePart)) {
          const val = t.includes(" ") ? `"${t}"` : t;
          results.push({ insert: `${prefix}tag:${val}`, label: t });
        }
      }
      break;
    case "is:":
      for (const v of IS_VALUES) {
        if (v.startsWith(valuePart)) {
          results.push({ insert: `${prefix}is:${v}`, label: v, description: getIsHint(v) });
        }
      }
      break;
    case "flag:":
      for (const f of FLAG_VALUES) {
        const numStr = String(f.value);
        if (numStr.startsWith(valuePart) || f.label.startsWith(valuePart)) {
          results.push({
            insert: `${prefix}flag:${f.value}`,
            label: `${f.value}`,
            description: f.label,
          });
        }
      }
      break;
    case "card:":
    case "note:":
      for (const n of allNoteTypes.value) {
        if (n.toLowerCase().includes(valuePart)) {
          const val = n.includes(" ") ? `"${n}"` : n;
          results.push({ insert: `${prefix}${qualifier}${val}`, label: n });
        }
      }
      break;
  }

  return results.slice(0, 10);
});

function getQualifierHint(q: string): string {
  switch (q) {
    case "deck:":
      return "filter by deck";
    case "tag:":
      return "filter by tag";
    case "is:":
      return "card state (new, review, ...)";
    case "flag:":
      return "card flag (0-7)";
    case "card:":
      return "card/template name";
    case "note:":
      return "note type name";
    default:
      return "";
  }
}

function getIsHint(v: string): string {
  switch (v) {
    case "new":
      return "new cards";
    case "learn":
      return "currently learning";
    case "review":
      return "review cards";
    case "due":
      return "cards due now";
    case "suspended":
      return "suspended cards";
    case "buried":
      return "buried cards";
    default:
      return "";
  }
}

function applySuggestion(suggestion: Suggestion) {
  const input = searchQuery.value;
  const cursor = searchInputRef.value?.selectionStart ?? input.length;
  const { start } = getCurrentToken(input, cursor);

  const before = input.slice(0, start);
  const after = input.slice(cursor);
  // Only add trailing space for complete values, not qualifier prefixes like "deck:"
  const isQualifierPrefix = suggestion.insert.endsWith(":");
  const suffix = isQualifierPrefix ? "" : " ";
  searchQuery.value = before + suggestion.insert + suffix + after.trimStart();
  showAutocomplete.value = isQualifierPrefix;
  selectedSuggestionIndex.value = 0;

  nextTick(() => {
    const newCursor = (before + suggestion.insert + suffix).length;
    searchInputRef.value?.setSelectionRange(newCursor, newCursor);
    searchInputRef.value?.focus();
  });
}

function onSearchInput() {
  showAutocomplete.value = true;
  selectedSuggestionIndex.value = 0;
}

function onSearchKeydown(e: KeyboardEvent) {
  const list = suggestions.value;
  if (!showAutocomplete.value || list.length === 0) {
    if (e.key === "Escape") {
      showAutocomplete.value = false;
    }
    return;
  }

  if (e.key === "Tab" || e.key === "Enter") {
    e.preventDefault();
    applySuggestion(list[selectedSuggestionIndex.value]!);
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedSuggestionIndex.value = (selectedSuggestionIndex.value + 1) % list.length;
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedSuggestionIndex.value = (selectedSuggestionIndex.value - 1 + list.length) % list.length;
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    showAutocomplete.value = false;
    return;
  }
}

function onSearchBlur() {
  // Delay to allow click on suggestion
  setTimeout(() => {
    showAutocomplete.value = false;
  }, 150);
}

function onSearchFocus() {
  if (suggestions.value.length > 0) {
    showAutocomplete.value = true;
  }
}

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
  due: string;
  // Raw scheduling data for filter matching
  queueName: string;
  typeName: string;
  flags: number;
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
      due: sched ? formatDue(sched) : "",
      queueName: sched?.queueName ?? "new",
      typeName: sched?.typeName ?? "new",
      flags: sched?.flags ?? 0,
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

// ── Filtering ──

function matchToken(row: Row, token: SearchToken): boolean {
  if (token.type === "negate") {
    return !matchToken(row, token.inner);
  }

  switch (token.type) {
    case "text": {
      const q = token.value.toLowerCase();
      if (!q) return true;
      for (const v of Object.values(row.fields)) {
        if (v.toLowerCase().includes(q)) return true;
      }
      if (row.deck.toLowerCase().includes(q)) return true;
      if (row.tags.some((t) => t.toLowerCase().includes(q))) return true;
      if (row.kind === "card" && row.templateName.toLowerCase().includes(q)) return true;
      if (row.kind === "note" && row.templateNames.toLowerCase().includes(q)) return true;
      return false;
    }
    case "deck": {
      const v = token.value.toLowerCase();
      const deck = row.deck.toLowerCase();
      // Support deck hierarchy: deck:foo matches foo and foo::bar
      return deck === v || deck.startsWith(v + "::");
    }
    case "tag": {
      const v = token.value.toLowerCase();
      return row.tags.some((t) => t.toLowerCase() === v || t.toLowerCase().startsWith(v + "::"));
    }
    case "is": {
      if (row.kind === "note") {
        // For notes, check if *any* matching state applies
        // We only have first-card data, so approximate
        return false;
      }
      const q = row.queueName;
      const t = row.typeName;
      switch (token.value) {
        case "new":
          return q === "new";
        case "learn":
          return q === "learning" || q === "dayLearning";
        case "review":
          return q === "review";
        case "due":
          return q === "review" || q === "learning" || q === "dayLearning";
        case "suspended":
          return q === "suspended";
        case "buried":
          return q === "userBuried" || q === "schedulerBuried";
        default:
          return false;
      }
    }
    case "flag": {
      if (row.kind === "note") return false;
      return row.flags === token.value;
    }
    case "card":
    case "note": {
      const v = token.value.toLowerCase();
      if (row.kind === "card") return row.templateName.toLowerCase().includes(v);
      return row.templateNames.toLowerCase().includes(v);
    }
  }
}

/** Filtered + sorted rows */
const filteredRows = computed(() => {
  const tokens = parseSearch(searchQuery.value);
  let result = rows.value;

  if (tokens.length > 0) {
    result = result.filter((row) => tokens.every((token) => matchToken(row, token)));
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

  if (row.kind === "note") {
    if (col === "card-type") return row.templateNames;
    if (col === "cards") return String(row.cardCount);
    return "";
  }

  if (col === "card-type") return row.templateName;
  if (col === "due") return row.due;
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

const visibleColumns = computed(() => {
  if (viewMode.value === "notes") {
    return [
      { key: "sort-field", label: "Sort Field" },
      { key: "card-type", label: "Note Type" },
      { key: "cards", label: "Cards" },
      { key: "tags", label: "Tags" },
    ];
  }
  return [
    { key: "sort-field", label: "Sort Field" },
    { key: "card-type", label: "Card Type" },
    { key: "due", label: "Due" },
    { key: "deck", label: "Deck" },
  ];
});

function getCellValue(row: Row, col: string): string {
  if (col === "sort-field") return row.sortField;
  if (col === "deck") return row.deck;
  if (col === "tags") return row.tags.join(", ");

  if (row.kind === "note") {
    if (col === "card-type") return row.templateNames;
    if (col === "cards") return String(row.cardCount);
    return "";
  }

  if (col === "card-type") return row.templateName;
  if (col === "due") return row.due;
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

// ── Edit modal ──

const editModalOpen = ref(false);
const isSynced = computed(() => activeDeckSourceIdSig.value === "sync-collection");

async function handleNoteSave(payload: { fields: Record<string, string | null>; tags: string[] }) {
  const card = selectedCard.value;
  if (!card) return;
  await updateNote(card.guid, payload.fields, payload.tags);
  editModalOpen.value = false;
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
        <div class="search-wrap">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="Filter... (deck:, tag:, is:, flag:)"
            @input="onSearchInput"
            @keydown="onSearchKeydown"
            @blur="onSearchBlur"
            @focus="onSearchFocus"
          />
          <div v-if="showAutocomplete && suggestions.length > 0" class="autocomplete">
            <div
              v-for="(s, i) in suggestions"
              :key="s.insert"
              :class="[
                'autocomplete-item',
                { 'autocomplete-item--selected': i === selectedSuggestionIndex },
              ]"
              @mousedown.prevent="applySuggestion(s)"
            >
              <span class="autocomplete-label">{{ s.label }}</span>
              <span v-if="s.description" class="autocomplete-desc">{{ s.description }}</span>
            </div>
            <div class="autocomplete-hint"><kbd>Tab</kbd> to accept</div>
          </div>
        </div>
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
              <td v-for="col in visibleColumns" :key="col.key" class="td">
                {{ getCellValue(row, col.key) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Detail pane -->
      <div class="detail-pane" @click="handleDetailClick">
        <template v-if="selectedCard">
          <div class="detail-header">
            <div class="detail-header-text">
              <h3 class="detail-title">{{ selectedCard.deckName }}</h3>
              <span class="detail-meta">{{
                selectedCard.templates.map((t) => t.name).join(", ")
              }}</span>
            </div>
            <Button variant="secondary" size="sm" @click="editModalOpen = true">Edit</Button>
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
        </template>
        <p v-else class="detail-empty">No card selected</p>
      </div>
    </div>

    <NoteEditModal
      :is-open="editModalOpen"
      :card="selectedCard"
      @close="editModalOpen = false"
      @save="handleNoteSave"
    />
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

/* Search with autocomplete */
.search-wrap {
  position: relative;
  flex: 1;
  min-width: 120px;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: var(--transition-colors);
  box-sizing: border-box;
}

.search-input:focus {
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.search-input::placeholder {
  color: var(--color-text-tertiary);
}

.autocomplete {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 2px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.15));
  z-index: 100;
  overflow: hidden;
}

.autocomplete-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-1-5) var(--spacing-2);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.autocomplete-item:hover,
.autocomplete-item--selected {
  background: var(--color-surface-hover);
}

.autocomplete-label {
  font-weight: var(--font-weight-medium);
}

.autocomplete-desc {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  margin-left: auto;
}

.autocomplete-hint {
  padding: var(--spacing-1) var(--spacing-2);
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.autocomplete-hint kbd {
  display: inline-block;
  padding: 0 var(--spacing-1);
  font-size: var(--font-size-xs);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
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
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-2);
}

.detail-header-text {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-2);
  min-width: 0;
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

.detail-empty {
  margin: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
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
