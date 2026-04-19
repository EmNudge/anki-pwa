<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import {
  ankiDataSig,
  mediaFilesSig,
  activeDeckSourceIdSig,
  activeViewSig,
  updateNote,
  bulkAddTag,
  bulkRemoveTag,
  renameTag,
  deleteTag,
  repositionNewCards,
} from "../stores";
import FindReplaceModal from "./FindReplaceModal.vue";
import { getRenderedCardString, replaceMediaFiles } from "../utils/render";
import { isImageOcclusionCard, renderImageOcclusion } from "../utils/imageOcclusion";
import { sanitizeHtmlForPreview } from "../utils/sanitize";
import { stripHtml } from "../utils/stripHtml";
import { playAudio } from "../utils/sound";
import { Button, Checkbox, Modal, TextInput } from "../design-system";
import NoteEditModal from "./NoteEditModal.vue";
import TagTree from "./TagTree.vue";
import { buildTagTree, tagMatchesOrIsChild } from "../utils/tagTree";
import { useVirtualScroll } from "../composables/useVirtualScroll";
import { getFlags } from "../lib/flags";
import { reviewDB } from "../scheduler/db";
import { QUEUE_USER_BURIED, QUEUE_SUSPENDED } from "../lib/syncWrite";
import { markDataChanged } from "../lib/autoSync";
import { triggerRef } from "vue";
import {
  parseSearch as _parseSearch,
  matchExpr as _matchExpr,
  IS_VALUES,
  QUALIFIERS,
  type SearchLeaf,
  type SearchExpr,
  type SearchableCard,
} from "../search/engine";

type ViewMode = "cards" | "notes";
const viewMode = ref<ViewMode>("notes");
const searchQuery = ref("");
const sortColumn = ref<string>("sort-field");
const sortAsc = ref(true);
const selectedRowKey = ref<string | null>(null);
const selectedRowKeys = ref<Set<string>>(new Set());
const lastClickedKey = ref<string | null>(null);

// Preview panel state
const previewSide = ref<"front" | "back">("front");
const showPreviewPanel = ref(true);

// Column customization
const showColumnMenu = ref(false);
const columnMenuRef = ref<HTMLElement | null>(null);

type ColumnDef = {
  key: string;
  label: string;
  modes: ViewMode[];
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: "sort-field", label: "Sort Field", modes: ["notes", "cards"] },
  { key: "card-type", label: "Card/Note Type", modes: ["notes", "cards"] },
  { key: "cards", label: "Cards", modes: ["notes"] },
  { key: "tags", label: "Tags", modes: ["notes", "cards"] },
  { key: "due", label: "Due", modes: ["cards"] },
  { key: "deck", label: "Deck", modes: ["notes", "cards"] },
  { key: "interval", label: "Interval", modes: ["cards"] },
  { key: "ease", label: "Ease", modes: ["cards"] },
  { key: "reps", label: "Reviews", modes: ["cards"] },
  { key: "lapses", label: "Lapses", modes: ["cards"] },
];

function loadColumnPrefs(): string[] {
  try {
    const stored = localStorage.getItem("browser-columns");
    if (stored) return JSON.parse(stored) as string[];
  } catch {
    // ignore
  }
  return ["sort-field", "card-type", "cards", "tags", "due", "deck"];
}

const enabledColumnKeys = ref<string[]>(loadColumnPrefs());

watch(
  enabledColumnKeys,
  (keys) => {
    localStorage.setItem("browser-columns", JSON.stringify(keys));
  },
  { deep: true },
);

function toggleColumn(key: string) {
  const idx = enabledColumnKeys.value.indexOf(key);
  if (idx >= 0) {
    enabledColumnKeys.value = enabledColumnKeys.value.filter((k) => k !== key);
  } else {
    enabledColumnKeys.value = [...enabledColumnKeys.value, key];
  }
}

const visibleColumns = computed(() =>
  ALL_COLUMNS.filter(
    (col) => col.modes.includes(viewMode.value) && enabledColumnKeys.value.includes(col.key),
  ),
);

// Close column menu on outside click
function handleColumnMenuOutsideClick(e: MouseEvent) {
  if (columnMenuRef.value && !columnMenuRef.value.contains(e.target as Node)) {
    showColumnMenu.value = false;
  }
}

watch(showColumnMenu, (open) => {
  if (open) {
    document.addEventListener("mousedown", handleColumnMenuOutsideClick);
  } else {
    document.removeEventListener("mousedown", handleColumnMenuOutsideClick);
  }
});

// Reset selection when switching modes
watch(viewMode, () => {
  selectedRowKey.value = null;
  selectedRowKeys.value = new Set();
  lastClickedKey.value = null;
});

/** Single-pass extraction of tags, tag note counts, decks, and note types from cards */
const cardMetadata = computed(() => {
  const data = ankiDataSig.value;
  const tags = new Set<string>();
  const decks = new Set<string>();
  const noteTypes = new Set<string>();
  const seenPerTag = new Map<string, Set<string>>();

  if (data) {
    for (const card of data.cards) {
      decks.add(card.deckName);
      for (const t of card.templates) noteTypes.add(t.name);
      for (const tag of card.tags) {
        tags.add(tag);
        const seen = seenPerTag.get(tag) ?? new Set<string>();
        seen.add(card.guid);
        seenPerTag.set(tag, seen);
      }
    }
  }

  const tagNoteCounts = new Map<string, number>();
  for (const [tag, guids] of seenPerTag) {
    tagNoteCounts.set(tag, guids.size);
  }

  return {
    tags: Array.from(tags).sort(),
    tagNoteCounts,
    decks: Array.from(decks).sort(),
    noteTypes: Array.from(noteTypes).sort(),
  };
});

const allTags = computed(() => cardMetadata.value.tags);
const tagNoteCounts = computed(() => cardMetadata.value.tagNoteCounts);

/** Hierarchical tag tree */
const tagTree = computed(() => buildTagTree(allTags.value, tagNoteCounts.value));

/** Currently selected tag filter from sidebar */
const activeTagFilter = ref<string | null>(null);

/** Whether the tag sidebar is visible */
const tagSidebarOpen = ref(true);

// ── Multi-select (see handleRowClick / selectAll / clearSelection below) ──

const selectedGuids = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return [] as string[];
  const guids = new Set<string>();
  for (const row of filteredRows.value) {
    if (!selectedRowKeys.value.has(row.key)) continue;
    const card = data.cards[row.index];
    if (card) guids.add(card.guid);
  }
  return Array.from(guids);
});

// ── Bulk tag add/remove ──

const bulkTagModalOpen = ref(false);
const bulkTagMode = ref<"add" | "remove">("add");
const bulkTagInput = ref("");

function openBulkTagModal(mode: "add" | "remove") {
  bulkTagMode.value = mode;
  bulkTagInput.value = "";
  bulkTagModalOpen.value = true;
}

async function applyBulkTag() {
  const tag = bulkTagInput.value.trim();
  if (!tag || selectedGuids.value.length === 0) return;

  if (bulkTagMode.value === "add") {
    await bulkAddTag(selectedGuids.value, tag);
  } else {
    await bulkRemoveTag(selectedGuids.value, tag);
  }
  bulkTagModalOpen.value = false;
  clearSelection();
}

// ── Reposition new cards ──

const repositionModalOpen = ref(false);
const repositionStart = ref(0);
const repositionStep = ref(1);
const repositionRandomize = ref(false);
const repositionResultMsg = ref("");

/** Count how many selected cards are new (queue=0) for the toolbar label */
const selectedNewCardCount = computed(() => {
  const data = ankiDataSig.value;
  if (!data || viewMode.value !== "cards") return 0;
  let count = 0;
  for (const row of filteredRows.value) {
    if (!selectedRowKeys.value.has(row.key)) continue;
    if (row.kind !== "card") continue;
    if (row.queueName === "new") count++;
  }
  return count;
});

function openRepositionModal() {
  repositionStart.value = 0;
  repositionStep.value = 1;
  repositionRandomize.value = false;
  repositionResultMsg.value = "";
  repositionModalOpen.value = true;
}

async function applyReposition() {
  const data = ankiDataSig.value;
  if (!data) return;

  // Collect card indices from selected rows (cards mode only)
  const indices: number[] = [];
  for (const row of filteredRows.value) {
    if (!selectedRowKeys.value.has(row.key)) continue;
    if (row.kind === "card") {
      indices.push(row.index);
    }
  }

  if (indices.length === 0) return;

  const count = await repositionNewCards(
    indices,
    repositionStart.value,
    repositionStep.value,
    repositionRandomize.value,
  );

  if (count === 0) {
    repositionResultMsg.value =
      "No new cards found in selection. Only new (unseen) cards can be repositioned.";
  } else {
    repositionResultMsg.value = `Repositioned ${count} new card${count === 1 ? "" : "s"}.`;
    setTimeout(() => {
      repositionModalOpen.value = false;
      clearSelection();
    }, 1200);
  }
}

// ── Tag rename/delete modals ──

const tagRenameModalOpen = ref(false);
const tagRenameOld = ref("");
const tagRenameNew = ref("");

function openTagRename(tag: string) {
  tagRenameOld.value = tag;
  tagRenameNew.value = tag;
  tagRenameModalOpen.value = true;
}

async function applyTagRename() {
  const oldTag = tagRenameOld.value;
  const newTag = tagRenameNew.value.trim();
  if (!newTag || newTag === oldTag) {
    tagRenameModalOpen.value = false;
    return;
  }
  await renameTag(oldTag, newTag);
  if (activeTagFilter.value === oldTag) activeTagFilter.value = newTag;
  tagRenameModalOpen.value = false;
}

const tagDeleteConfirmOpen = ref(false);
const tagDeleteTarget = ref("");

function openTagDelete(tag: string) {
  tagDeleteTarget.value = tag;
  tagDeleteConfirmOpen.value = true;
}

async function applyTagDelete() {
  await deleteTag(tagDeleteTarget.value);
  if (activeTagFilter.value === tagDeleteTarget.value) activeTagFilter.value = null;
  tagDeleteConfirmOpen.value = false;
}

const allDecks = computed(() => cardMetadata.value.decks);
const allNoteTypes = computed(() => cardMetadata.value.noteTypes);

// ── Search parsing (delegated to src/search/engine.ts) ──

const FLAG_VALUES = computed(() => [
  { value: 0, label: "none" },
  ...getFlags().map((f) => ({ value: f.flag, label: f.label.toLowerCase() })),
]);

function parseSearch(query: string) {
  return _parseSearch(query);
}

// ── Autocomplete ──

const searchInputRef = ref<HTMLInputElement | null>(null);
const showAutocomplete = ref(false);
const selectedSuggestionIndex = ref(0);

type Suggestion = {
  insert: string;
  label: string;
  description?: string;
};

function getCurrentToken(input: string, cursorPos: number): { token: string; start: number } {
  let start = cursorPos;
  while (start > 0 && !" ()\t".includes(input[start - 1]!)) {
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

  const isNegated = lower.startsWith("-");
  const prefix = isNegated ? "-" : "";
  const tokenBody = isNegated ? lower.slice(1) : lower;

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
    if (results.length > 0) return results;
    return [];
  }

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
      for (const f of FLAG_VALUES.value) {
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
    case "prop:":
      for (const p of [
        "ease>",
        "ease<",
        "ease=",
        "ivl>",
        "ivl<",
        "due>",
        "due<",
        "reps>",
        "reps<",
        "lapses>",
        "lapses<",
      ]) {
        if (p.startsWith(valuePart)) {
          results.push({
            insert: `${prefix}prop:${p}`,
            label: `prop:${p}`,
            description: "numeric comparison",
          });
        }
      }
      break;
    case "added:":
    case "edited:":
    case "rated:":
      for (const n of [1, 3, 7, 14, 30, 365]) {
        const s = String(n);
        if (s.startsWith(valuePart)) {
          results.push({
            insert: `${prefix}${qualifier}${s}`,
            label: s,
            description: `last ${n} day${n > 1 ? "s" : ""}`,
          });
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
    case "prop:":
      return "numeric property (ease, ivl, due, reps, lapses)";
    case "added:":
      return "cards added in last N days";
    case "edited:":
      return "notes edited in last N days";
    case "rated:":
      return "cards reviewed in last N days";
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
  key: string;
  index: number;
  sortField: string;
  fields: Record<string, string>;
  deck: string;
  tags: string[];
  cardCount: number;
  templateNames: string;
  guid: string;
  indices: number[];
  cardCreatedMs: number;
  noteModSec: number;
};

type CardRow = {
  kind: "card";
  key: string;
  index: number;
  sortField: string;
  fields: Record<string, string>;
  deck: string;
  tags: string[];
  templateName: string;
  due: string;
  queueName: string;
  typeName: string;
  flags: number;
  interval: string;
  ease: string;
  reps: number;
  lapses: number;
  guid: string;
  rawEase: number | null;
  rawIvl: number;
  rawDue: number;
  rawDueType: string;
  cardCreatedMs: number;
  noteModSec: number;
  cardModSec: number;
};

type Row = NoteRow | CardRow;

const rows = computed<Row[]>(() => {
  const data = ankiDataSig.value;
  if (!data) return [];

  if (viewMode.value === "notes") {
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
        guid,
        indices,
        cardCreatedMs: firstCard.ankiCardId ?? 0,
        noteModSec: firstCard.noteMod ?? 0,
      });
    }
    return result;
  }

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
      interval: sched ? formatInterval(sched.ivl, sched.ivlUnit) : "",
      ease: sched?.easeFactor != null ? `${Math.round(sched.easeFactor * 100)}%` : "",
      reps: sched?.reps ?? 0,
      lapses: sched?.lapses ?? 0,
      guid: card.guid,
      rawEase: sched?.easeFactor ?? null,
      rawIvl: sched?.ivl ?? 0,
      rawDue: sched?.due ?? 0,
      rawDueType: sched?.dueType ?? "position",
      cardCreatedMs: card.ankiCardId ?? 0,
      noteModSec: card.noteMod ?? 0,
      cardModSec: card.cardMod ?? 0,
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
  if (unit === "seconds") return ivl < 60 ? `${ivl}s` : `${Math.round(ivl / 60)}m`;
  if (ivl === 0) return "";
  if (ivl < 30) return `${ivl}d`;
  if (ivl < 365) return `${(ivl / 30).toFixed(1)}mo`;
  return `${(ivl / 365).toFixed(1)}y`;
}

// ── Filtering (delegated to search engine, with Row adapter) ──

function rowToSearchable(row: Row): SearchableCard {
  if (row.kind === "card") {
    return {
      fields: row.fields,
      deck: row.deck,
      tags: row.tags,
      templateName: row.templateName,
      queueName: row.queueName,
      flags: row.flags,
      rawEase: row.rawEase,
      rawIvl: row.rawIvl,
      rawDue: row.rawDue,
      rawDueType: row.rawDueType,
      cardCreatedMs: row.cardCreatedMs,
      noteModSec: row.noteModSec,
      cardModSec: row.cardModSec,
      reps: row.reps,
      lapses: row.lapses,
    };
  }
  // NoteRow — card-specific fields default to zero/empty since note rows can't match card filters
  return {
    fields: row.fields,
    deck: row.deck,
    tags: row.tags,
    templateName: "",
    templateNames: row.templateNames,
    queueName: "",
    flags: 0,
    rawEase: null,
    rawIvl: 0,
    rawDue: 0,
    rawDueType: "position",
    cardCreatedMs: row.cardCreatedMs,
    noteModSec: row.noteModSec,
    cardModSec: 0,
    reps: 0,
    lapses: 0,
  };
}

function matchExpr(row: Row, expr: SearchExpr): boolean {
  const collectionTime = ankiDataSig.value?.collectionCreationTime ?? 0;
  return _matchExpr(rowToSearchable(row), expr, collectionTime);
}

/** Filtered + sorted rows */
const filteredRows = computed(() => {
  const expr = parseSearch(searchQuery.value);
  let result = rows.value;

  // Apply tag sidebar filter
  const tagFilter = activeTagFilter.value;
  if (tagFilter) {
    result = result.filter((row) => row.tags.some((t) => tagMatchesOrIsChild(t, tagFilter)));
  }

  if (expr) {
    result = result.filter((row) => matchExpr(row, expr));
  }

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
  if (col === "interval") return row.interval;
  if (col === "ease") return row.ease;
  if (col === "reps") return String(row.reps);
  if (col === "lapses") return String(row.lapses);
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
  if (col === "interval") return row.interval;
  if (col === "ease") return row.ease;
  if (col === "reps") return String(row.reps);
  if (col === "lapses") return String(row.lapses);
  return "";
}

// ── Virtual scrolling ──

const {
  scrollContainerRef,
  onScroll: onTableScroll,
  virtualSlice,
} = useVirtualScroll({
  items: filteredRows,
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleColumnMenuOutsideClick);
});

// ── Row selection (multi-select) ──

function handleRowClick(row: Row, event: MouseEvent) {
  if (event.shiftKey && lastClickedKey.value !== null) {
    // Range select
    const allKeys = filteredRows.value.map((r) => r.key);
    const lastIdx = allKeys.indexOf(lastClickedKey.value);
    const currentIdx = allKeys.indexOf(row.key);
    if (lastIdx >= 0 && currentIdx >= 0) {
      const start = Math.min(lastIdx, currentIdx);
      const end = Math.max(lastIdx, currentIdx);
      const newSet = new Set(selectedRowKeys.value);
      for (let i = start; i <= end; i++) {
        newSet.add(allKeys[i]!);
      }
      selectedRowKeys.value = newSet;
    }
  } else if (event.ctrlKey || event.metaKey) {
    // Toggle single
    const newSet = new Set(selectedRowKeys.value);
    if (newSet.has(row.key)) {
      newSet.delete(row.key);
    } else {
      newSet.add(row.key);
    }
    selectedRowKeys.value = newSet;
  } else {
    // Single select
    selectedRowKeys.value = new Set([row.key]);
  }

  lastClickedKey.value = row.key;
  selectedRowKey.value = row.key;
}

function selectAll() {
  selectedRowKeys.value = new Set(filteredRows.value.map((r) => r.key));
}

function clearSelection() {
  selectedRowKeys.value = new Set();
  selectedRowKey.value = null;
}

const hasMultiSelection = computed(() => selectedRowKeys.value.size > 1);

// ── Detail pane ──

const selectedCard = computed(() => {
  const data = ankiDataSig.value;
  const key = selectedRowKey.value;
  if (!data || key === null) return null;

  const row = filteredRows.value.find((r) => r.key === key);
  if (!row) return null;
  return data.cards[row.index] ?? null;
});

const selectedPreviewFront = computed(() => {
  const card = selectedCard.value;
  if (!card || card.templates.length === 0) return null;
  if (isImageOcclusionCard(card)) {
    return sanitizeHtmlForPreview(
      replaceMediaFiles(
        renderImageOcclusion({ values: card.values, cardOrd: 0, isAnswer: false }),
        mediaFilesSig.value,
      ),
    );
  }
  const template = card.templates[0]!;
  return sanitizeHtmlForPreview(
    getRenderedCardString({
      templateString: template.qfmt,
      variables: { ...card.values },
      mediaFiles: mediaFilesSig.value,
    }),
  );
});

const selectedPreviewBack = computed(() => {
  const card = selectedCard.value;
  if (!card || card.templates.length === 0) return null;
  if (isImageOcclusionCard(card)) {
    return sanitizeHtmlForPreview(
      replaceMediaFiles(
        renderImageOcclusion({ values: card.values, cardOrd: 0, isAnswer: true }),
        mediaFilesSig.value,
      ),
    );
  }
  const template = card.templates[0]!;
  if (!template.afmt) return null;
  const frontHtml = getRenderedCardString({
    templateString: template.qfmt,
    variables: { ...card.values },
    mediaFiles: mediaFilesSig.value,
  });
  return sanitizeHtmlForPreview(
    getRenderedCardString({
      templateString: template.afmt,
      variables: { ...card.values, FrontSide: frontHtml },
      mediaFiles: mediaFilesSig.value,
      isAnswer: true,
      frontTemplate: template.qfmt,
    }),
  );
});

const selectedPreview = computed(() =>
  previewSide.value === "front" ? selectedPreviewFront.value : selectedPreviewBack.value,
);

const SOUND_ICON_SVG =
  '<svg style="height:1em;width:1em;vertical-align:middle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M625.9 115c-5.9 0-11.9 1.6-17.4 5.3L254 352H90c-8.8 0-16 7.2-16 16v288c0 8.8 7.2 16 16 16h164l354.5 231.7c5.5 3.6 11.6 5.3 17.4 5.3c16.7 0 32.1-13.3 32.1-32.1V147.1c0-18.8-15.4-32.1-32.1-32.1zM586 803L293.4 611.7l-18-11.7H146V424h129.4l17.9-11.7L586 221v582zm348-327H806c-8.8 0-16 7.2-16 16v40c0 8.8 7.2 16 16 16h128c8.8 0 16-7.2 16-16v-40c0-8.8-7.2-16-16-16zm-41.9 261.8l-110.3-63.7a15.9 15.9 0 0 0-21.7 5.9l-19.9 34.5c-4.4 7.6-1.8 17.4 5.8 21.8L856.3 800a15.9 15.9 0 0 0 21.7-5.9l19.9-34.5c4.4-7.6 1.7-17.4-5.8-21.8zM760 344a15.9 15.9 0 0 0 21.7 5.9L892 286.2c7.6-4.4 10.2-14.2 5.8-21.8L878 230a15.9 15.9 0 0 0-21.7-5.9L746 287.8a15.99 15.99 0 0 0-5.8 21.8L760 344z" fill="currentColor"></path></svg>';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pre-compiled media replacement regexps, keyed by mediaFilesSig identity */
const mediaRegexps = computed(() =>
  Array.from(mediaFilesSig.value, ([filename, url]) => ({
    re: new RegExp(`((?:src|data-sound-file)="[^"]*?)${escapeRegExp(filename)}`, "g"),
    url,
  })),
);

function renderFieldHtml(html: string | null): string {
  if (!html) return "";
  let result = html.replace(/\[sound:(.+?)\]/g, (_match, filename) => {
    return `<button class="sound-btn" style="color: var(--color-text-secondary)" data-sound-file="${filename}">${SOUND_ICON_SVG}</button>`;
  });
  for (const { re, url } of mediaRegexps.value) {
    result = result.replace(re, `$1${url}`);
  }
  return sanitizeHtmlForPreview(result);
}

function handleDetailClick(event: Event) {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".sound-btn");
  if (!btn) return;
  const src = btn.dataset.soundFile;
  if (src) playAudio(src);
}

// ── Bulk operations ──

const bulkOperationInProgress = ref(false);

function getSelectedRows(): Row[] {
  const keys = selectedRowKeys.value;
  return filteredRows.value.filter((r) => keys.has(r.key));
}

function getCardIndicesForRows(selectedRows: Row[]): number[] {
  const indices: number[] = [];
  for (const row of selectedRows) {
    if (row.kind === "note") {
      for (const idx of row.indices) indices.push(idx);
    } else {
      indices.push(row.index);
    }
  }
  return indices;
}

function getGuidsForRows(selectedRows: Row[]): string[] {
  const guids = new Set<string>();
  for (const row of selectedRows) guids.add(row.guid);
  return Array.from(guids);
}

async function bulkSuspend() {
  const data = ankiDataSig.value;
  if (!data || bulkOperationInProgress.value) return;

  bulkOperationInProgress.value = true;
  try {
    const indices = getCardIndicesForRows(getSelectedRows());
    const patches: { cardId: string; patch: { queueOverride: number } }[] = [];
    for (const idx of indices) {
      const card = data.cards[idx];
      if (!card?.scheduling) continue;
      const cardId = card.ankiCardId;
      if (cardId != null) {
        patches.push({ cardId: String(cardId), patch: { queueOverride: QUEUE_SUSPENDED } });
      }
      card.scheduling = {
        ...card.scheduling,
        queue: QUEUE_SUSPENDED,
        queueName: "suspended",
      };
    }
    await reviewDB.patchCards(patches);
    triggerRef(ankiDataSig);
    markDataChanged();
  } finally {
    bulkOperationInProgress.value = false;
  }
}

async function bulkUnsuspend() {
  const data = ankiDataSig.value;
  if (!data || bulkOperationInProgress.value) return;

  // Map card type to the appropriate queue to restore to
  const TYPE_TO_QUEUE: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 1 };
  const TYPE_TO_QUEUE_NAME: Record<number, string> = {
    0: "new",
    1: "learning",
    2: "review",
    3: "dayLearning",
  };

  bulkOperationInProgress.value = true;
  try {
    const indices = getCardIndicesForRows(getSelectedRows());
    const patches: { cardId: string; patch: { queueOverride: number } }[] = [];
    for (const idx of indices) {
      const card = data.cards[idx];
      if (!card?.scheduling) continue;
      if (card.scheduling.queueName !== "suspended") continue;
      const restoredQueue = TYPE_TO_QUEUE[card.scheduling.type] ?? 0;
      const restoredQueueName = TYPE_TO_QUEUE_NAME[card.scheduling.type] ?? "new";
      const cardId = card.ankiCardId;
      if (cardId != null) {
        patches.push({ cardId: String(cardId), patch: { queueOverride: restoredQueue } });
      }
      card.scheduling = {
        ...card.scheduling,
        queue: restoredQueue,
        queueName: restoredQueueName,
      };
    }
    await reviewDB.patchCards(patches);
    triggerRef(ankiDataSig);
    markDataChanged();
  } finally {
    bulkOperationInProgress.value = false;
  }
}

const showDeleteConfirm = ref(false);

async function bulkDelete() {
  const data = ankiDataSig.value;
  if (!data || bulkOperationInProgress.value) return;

  bulkOperationInProgress.value = true;
  try {
    const guids = new Set(getGuidsForRows(getSelectedRows()));

    // Delete from reviewDB
    for (let i = data.cards.length - 1; i >= 0; i--) {
      const card = data.cards[i]!;
      if (!guids.has(card.guid)) continue;
      if (card.ankiCardId != null) {
        await reviewDB.deleteCard(String(card.ankiCardId));
      }
      data.cards.splice(i, 1);
    }

    triggerRef(ankiDataSig);
    markDataChanged();
    clearSelection();
    showDeleteConfirm.value = false;
  } finally {
    bulkOperationInProgress.value = false;
  }
}

// ── Edit modal ──

const editModalOpen = ref(false);
const findReplaceOpen = ref(false);
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
        <button
          class="toggle-btn"
          :title="tagSidebarOpen ? 'Hide tag tree' : 'Show tag tree'"
          @click="tagSidebarOpen = !tagSidebarOpen"
        >
          Tags
        </button>
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
        <Button variant="secondary" size="sm" @click="findReplaceOpen = true">
          Find &amp; Replace
        </Button>
        <button class="toggle-btn" @click="activeViewSig = 'duplicates'" title="Find Duplicates">
          Find Duplicates
        </button>
        <div class="column-menu-wrap" ref="columnMenuRef">
          <button
            class="toolbar-icon-btn"
            title="Customize columns"
            @click="showColumnMenu = !showColumnMenu"
          >
            Columns
          </button>
          <div v-if="showColumnMenu" class="column-menu">
            <label
              v-for="col in ALL_COLUMNS.filter((c) => c.modes.includes(viewMode))"
              :key="col.key"
              class="column-menu-item"
            >
              <input
                type="checkbox"
                :checked="enabledColumnKeys.includes(col.key)"
                @change="toggleColumn(col.key)"
              />
              {{ col.label }}
            </label>
          </div>
        </div>
        <button
          class="toolbar-icon-btn"
          :title="showPreviewPanel ? 'Hide preview' : 'Show preview'"
          @click="showPreviewPanel = !showPreviewPanel"
        >
          {{ showPreviewPanel ? "Hide Preview" : "Preview" }}
        </button>
        <span class="result-count">{{ filteredRows.length }} {{ viewMode }}</span>
      </div>
    </div>

    <!-- Bulk operations toolbar -->
    <div v-if="hasMultiSelection" class="bulk-toolbar" data-testid="bulk-toolbar">
      <span class="bulk-count" data-testid="bulk-count">{{ selectedRowKeys.size }} selected</span>
      <Button variant="secondary" size="sm" @click="selectAll">Select All</Button>
      <Button variant="secondary" size="sm" @click="clearSelection">Clear</Button>
      <Button variant="secondary" size="sm" @click="openBulkTagModal('add')">Add tag</Button>
      <Button variant="secondary" size="sm" @click="openBulkTagModal('remove')">
        Remove tag
      </Button>
      <Button
        v-if="viewMode === 'cards' && selectedNewCardCount > 0"
        variant="secondary"
        size="sm"
        @click="openRepositionModal"
      >
        Reposition ({{ selectedNewCardCount }} new)
      </Button>
      <Button variant="secondary" size="sm" @click="bulkSuspend" :disabled="bulkOperationInProgress"
        >Suspend</Button
      >
      <Button
        variant="secondary"
        size="sm"
        @click="bulkUnsuspend"
        :disabled="bulkOperationInProgress"
        >Unsuspend</Button
      >
      <Button
        variant="danger"
        size="sm"
        @click="showDeleteConfirm = true"
        :disabled="bulkOperationInProgress"
        >Delete</Button
      >
    </div>

    <!-- Delete confirmation -->
    <div v-if="showDeleteConfirm" class="confirm-overlay" @click.self="showDeleteConfirm = false">
      <div class="confirm-dialog">
        <p class="confirm-text">
          Delete {{ selectedRowKeys.size }} selected {{ viewMode === "notes" ? "notes" : "cards" }}?
          This cannot be undone.
        </p>
        <div class="confirm-actions">
          <Button variant="secondary" size="sm" @click="showDeleteConfirm = false">Cancel</Button>
          <Button variant="danger" size="sm" @click="bulkDelete">Delete</Button>
        </div>
      </div>
    </div>

    <div v-if="!ankiDataSig" class="empty-state">
      <p class="empty-text">No deck loaded. Load a deck from the Review tab first.</p>
    </div>

    <div v-else class="browser-body">
      <!-- Tag sidebar -->
      <div v-if="tagSidebarOpen" class="tag-sidebar">
        <TagTree
          :nodes="tagTree"
          :active-tag="activeTagFilter"
          @select="activeTagFilter = $event"
          @rename="openTagRename($event)"
          @delete="openTagDelete($event)"
        />
      </div>

      <!-- Virtualized table -->
      <div class="table-wrap" ref="scrollContainerRef" @scroll="onTableScroll">
        <div class="virtual-spacer" :style="{ height: virtualSlice.totalHeight + 'px' }">
          <table class="browse-table" data-testid="browse-table">
            <thead>
              <tr>
                <th
                  v-for="col in visibleColumns"
                  :key="col.key"
                  scope="col"
                  class="th"
                  @click="handleSort(col.key)"
                >
                  {{ col.label }}{{ sortIndicator(col.key) }}
                </th>
              </tr>
            </thead>
            <tbody :style="{ transform: `translateY(${virtualSlice.offsetY}px)` }">
              <tr
                v-for="row in virtualSlice.rows"
                :key="row.key"
                :class="[
                  'tr',
                  {
                    'tr--selected': selectedRowKey === row.key,
                    'tr--multi-selected': selectedRowKeys.has(row.key),
                  },
                ]"
                :aria-selected="selectedRowKey === row.key || selectedRowKeys.has(row.key)"
                class="tr-fixed-height"
                @click="handleRowClick(row, $event)"
              >
                <td v-for="col in visibleColumns" :key="col.key" class="td">
                  {{ getCellValue(row, col.key) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Preview / Detail pane -->
      <div v-if="showPreviewPanel" class="detail-pane" data-testid="detail-pane" @click="handleDetailClick">
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

          <!-- Front/Back toggle -->
          <div class="preview-toggle">
            <button
              :class="['toggle-btn', { 'toggle-btn--active': previewSide === 'front' }]"
              @click="previewSide = 'front'"
            >
              Front
            </button>
            <button
              :class="['toggle-btn', { 'toggle-btn--active': previewSide === 'back' }]"
              @click="previewSide = 'back'"
            >
              Back
            </button>
          </div>

          <div v-if="selectedPreview" class="detail-preview" v-html="selectedPreview" />

          <div class="detail-fields">
            <div v-for="(val, key) in selectedCard.values" :key="key" class="detail-field">
              <div class="detail-field-label">{{ key }}</div>
              <div class="detail-field-value" data-testid="detail-field-value" v-html="renderFieldHtml(val)" />
            </div>
          </div>
          <div v-if="selectedCard.tags.length > 0" class="detail-tags" data-testid="detail-tags">
            <span v-for="tag in selectedCard.tags" :key="tag" class="tag-badge">{{ tag }}</span>
          </div>
        </template>
        <p v-else class="detail-empty">No card selected</p>
      </div>
    </div>

    <NoteEditModal
      :is-open="editModalOpen"
      :card="selectedCard"
      :media-files="mediaFilesSig"
      @close="editModalOpen = false"
      @save="handleNoteSave"
    />

    <!-- Bulk tag modal -->
    <Modal
      :is-open="bulkTagModalOpen"
      :title="
        bulkTagMode === 'add' ? 'Add Tag to Selected Notes' : 'Remove Tag from Selected Notes'
      "
      size="sm"
      @close="bulkTagModalOpen = false"
    >
      <div class="modal-field">
        <label class="modal-label">Tag name</label>
        <TextInput
          v-model="bulkTagInput"
          size="sm"
          placeholder="e.g. vocab::spanish"
          @keydown.enter="applyBulkTag"
        />
      </div>
      <template #footer>
        <Button variant="secondary" size="sm" @click="bulkTagModalOpen = false">Cancel</Button>
        <Button size="sm" @click="applyBulkTag">
          {{ bulkTagMode === "add" ? "Add" : "Remove" }}
        </Button>
      </template>
    </Modal>

    <!-- Tag rename modal -->
    <Modal
      :is-open="tagRenameModalOpen"
      title="Rename Tag"
      size="sm"
      @close="tagRenameModalOpen = false"
    >
      <div class="modal-field">
        <label class="modal-label">Current tag</label>
        <TextInput size="sm" :model-value="tagRenameOld" disabled />
      </div>
      <div class="modal-field">
        <label class="modal-label">New tag name</label>
        <TextInput v-model="tagRenameNew" size="sm" @keydown.enter="applyTagRename" />
      </div>
      <template #footer>
        <Button variant="secondary" size="sm" @click="tagRenameModalOpen = false"> Cancel </Button>
        <Button size="sm" @click="applyTagRename">Rename</Button>
      </template>
    </Modal>

    <!-- Tag delete confirmation -->
    <Modal
      :is-open="tagDeleteConfirmOpen"
      title="Delete Tag"
      size="sm"
      @close="tagDeleteConfirmOpen = false"
    >
      <p class="modal-text">
        Remove the tag "{{ tagDeleteTarget }}" and all its child tags from every note?
      </p>
      <template #footer>
        <Button variant="secondary" size="sm" @click="tagDeleteConfirmOpen = false">
          Cancel
        </Button>
        <Button variant="danger" size="sm" @click="applyTagDelete">Delete</Button>
      </template>
    </Modal>

    <!-- Reposition new cards modal -->
    <Modal
      :is-open="repositionModalOpen"
      title="Reposition New Cards"
      size="sm"
      @close="repositionModalOpen = false"
    >
      <p class="modal-text">
        Change the due position of new (unseen) cards. Only cards in the new queue will be affected.
        Learning and review cards are scheduled by the algorithm and cannot be repositioned.
      </p>
      <div class="modal-field">
        <label class="modal-label">Starting position</label>
        <TextInput
          :model-value="String(repositionStart)"
          @update:model-value="repositionStart = Number($event)"
          size="sm"
          type="number"
          min="0"
          placeholder="0"
          @keydown.enter="applyReposition"
        />
      </div>
      <div class="modal-field">
        <label class="modal-label">Step (between cards)</label>
        <TextInput
          :model-value="String(repositionStep)"
          @update:model-value="repositionStep = Number($event)"
          size="sm"
          type="number"
          min="1"
          placeholder="1"
          @keydown.enter="applyReposition"
        />
      </div>
      <div class="modal-field">
        <Checkbox v-model="repositionRandomize" size="sm" label="Randomize order" />
      </div>
      <p v-if="repositionResultMsg" class="modal-result">{{ repositionResultMsg }}</p>
      <template #footer>
        <Button variant="secondary" size="sm" @click="repositionModalOpen = false">Cancel</Button>
        <Button size="sm" @click="applyReposition">Reposition</Button>
      </template>
    </Modal>

    <!-- Find & Replace modal -->
    <FindReplaceModal
      :is-open="findReplaceOpen"
      :selected-guids="selectedGuids"
      :deck-names="allDecks"
      @close="findReplaceOpen = false"
      @applied="clearSelection()"
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
  overflow: hidden;
}

@media (max-width: 640px) {
  .toolbar {
    flex-wrap: wrap;
  }
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .toolbar-right {
    flex-wrap: wrap;
  }
}

.toolbar-icon-btn {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
}

.toolbar-icon-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.view-toggle,
.preview-toggle {
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

/* Column menu */
.column-menu-wrap {
  position: relative;
}

.column-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.15));
  z-index: 100;
  padding: var(--spacing-1) 0;
  min-width: 160px;
}

.column-menu-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-1-5);
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  cursor: pointer;
  white-space: nowrap;
}

.column-menu-item:hover {
  background: var(--color-surface-hover);
}

.column-menu-item input[type="checkbox"] {
  margin: 0;
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

/* Delete confirmation */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.confirm-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  max-width: 360px;
  box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.15));
}

.confirm-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-3) 0;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
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

/* Virtual-scrolled table */
.table-wrap {
  flex: 1;
  overflow: auto;
  min-width: 0;
}

.virtual-spacer {
  position: relative;
  width: 100%;
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

.tr-fixed-height {
  height: 30px;
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

/* Detail pane */
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

.preview-toggle {
  margin-bottom: var(--spacing-2);
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

/* Tag sidebar */
.tag-sidebar {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  background: var(--color-surface);
}

@media (max-width: 899px) {
  .tag-sidebar {
    display: none;
  }
}

/* Multi-select highlight */
.tr--multi-selected {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.tr--multi-selected:hover {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}

/* Bulk operations toolbar */
.bulk-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-1-5) var(--spacing-3);
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
  flex-shrink: 0;
  flex-wrap: wrap;
  overflow: hidden;
}

.bulk-count {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

/* Modal field styles */
.modal-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  margin-bottom: var(--spacing-3);
}

.modal-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.modal-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin: 0;
}

.modal-result {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: var(--spacing-2) 0 0;
  font-style: italic;
}
</style>
