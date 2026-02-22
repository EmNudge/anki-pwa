<script setup lang="ts">
import { computed } from "vue";
import { deckInfoSig, selectedDeckIdSig, ankiDataSig } from "../stores";
import { SidePanel, StatItem } from "../design-system";
import { openCommandPalette } from "../commandPaletteStore";
import { ChevronDown } from "lucide-vue-next";
import { pluralizeWithCount } from "../utils/pluralize";

const deckInfo = computed(() => deckInfoSig.value);

const selectedSubdeck = computed(() => {
  const info = deckInfo.value;
  const selectedId = selectedDeckIdSig.value;
  if (!info || !selectedId) return null;
  return info.subdecks.find((subdeck) => subdeck.id === selectedId) ?? null;
});

const deckCount = computed(() => deckInfo.value?.subdecks.length ?? 0);

const allNotesCount = computed(() => ankiDataSig.value?.cards.length ?? 0);
const allTemplatesCount = computed(() => {
  const data = ankiDataSig.value;
  if (!data) return 0;
  const names = new Set(data.cards.flatMap((card) => card.templates.map((t) => t.name)));
  return names.size;
});

const currentDeckName = computed(() => selectedSubdeck.value?.name ?? "All Cards");
const currentCardCount = computed(() => selectedSubdeck.value?.cardCount ?? deckInfo.value?.cardCount ?? 0);
const currentTemplateCount = computed(() => selectedSubdeck.value?.templateCount ?? deckInfo.value?.templateCount ?? 0);

function handleChangeDeck() { openCommandPalette("switch-deck"); }
function handleBrowseAllNotes() { openCommandPalette("browse-notes"); }
function handleBrowseAllTemplates() { openCommandPalette("browse-templates"); }
</script>

<template>
  <SidePanel title="File Info">
    <h3 class="deck-name">{{ deckInfo?.name }}</h3>

    <div v-if="deckInfo?.subdecks && deckInfo.subdecks.length > 0" class="current-deck-section">
      <div class="current-deck-label">Current Deck ({{ deckCount }})</div>
      <div class="current-deck-display">
        <div class="current-deck-name">{{ currentDeckName }}</div>
        <div class="current-deck-stats">
          {{ pluralizeWithCount(currentCardCount, "card", "cards") }} &bull;
          {{ pluralizeWithCount(currentTemplateCount, "template", "templates") }}
        </div>
      </div>
      <button class="change-deck-button" @click="handleChangeDeck" :disabled="deckCount === 0">
        Select Deck
        <ChevronDown :size="16" />
      </button>
    </div>

    <div class="stats-section">
      <div class="stats-title">Browse</div>
      <div class="browse-item">
        <StatItem label="All Notes" :value="allNotesCount" />
      </div>
      <button
        class="change-deck-button browse-button"
        @click="handleBrowseAllNotes"
        :disabled="allNotesCount === 0"
      >
        Browse All Notes
        <ChevronDown :size="16" />
      </button>
      <div class="browse-item">
        <StatItem label="All Templates" :value="allTemplatesCount" />
      </div>
      <button
        class="change-deck-button"
        @click="handleBrowseAllTemplates"
        :disabled="allTemplatesCount === 0"
      >
        Browse All Templates
        <ChevronDown :size="16" />
      </button>
    </div>
  </SidePanel>
</template>

<style scoped>
.deck-name { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); word-break: break-word; margin-bottom: var(--spacing-2); }
.current-deck-section { margin-bottom: var(--spacing-4); }
.current-deck-label { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); margin-bottom: var(--spacing-2); text-transform: uppercase; letter-spacing: 0.5px; }
.current-deck-display { padding: var(--spacing-3); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--spacing-2); }
.current-deck-name { font-size: var(--font-size-base); font-weight: var(--font-weight-medium); color: var(--color-text-primary); margin-bottom: var(--spacing-1); word-break: break-word; }
.current-deck-stats { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.change-deck-button { width: 100%; padding: var(--spacing-2) var(--spacing-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; color: var(--color-text-primary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); transition: var(--transition-colors); display: flex; align-items: center; justify-content: center; gap: var(--spacing-2); }
.change-deck-button:hover { background: var(--color-surface-elevated); border-color: var(--color-border-hover); }
.change-deck-button:active { transform: scale(0.98); }
.change-deck-button:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
.stats-section { margin-top: var(--spacing-4); padding-top: var(--spacing-4); border-top: 1px solid var(--color-border-primary); }
.stats-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); margin-bottom: var(--spacing-3); }
.browse-item { margin-bottom: var(--spacing-2); }
.browse-button { margin-bottom: var(--spacing-4); }
</style>
